import { FRAMEWORK_PRIORITY } from "./constants.js";
import { dependencyNames, hasDependency, type ManifestFile, type PackageJsonLike } from "./manifests.js";
import type { FrameworkDetection } from "./types.js";
import { posixExtension } from "./workspace.js";

interface FrameworkRule {
  name: string;
  packages: string[];
  reason: string;
}

const FRAMEWORK_RULES: FrameworkRule[] = [
  { name: "nextjs", packages: ["next"], reason: "next listed in package.json dependencies" },
  { name: "nuxt", packages: ["nuxt"], reason: "nuxt listed in package.json dependencies" },
  {
    name: "angular",
    packages: ["@angular/core"],
    reason: "@angular/core listed in package.json dependencies",
  },
  { name: "astro", packages: ["astro"], reason: "astro listed in package.json dependencies" },
  {
    name: "svelte",
    packages: ["svelte", "@sveltejs/kit"],
    reason: "svelte listed in package.json dependencies",
  },
  { name: "vue", packages: ["vue"], reason: "vue listed in package.json dependencies" },
  { name: "react", packages: ["react", "react-dom"], reason: "react listed in package.json dependencies" },
];

export function detectFrameworkFromPackageJson(
  pkg: PackageJsonLike,
  folderName?: string,
): FrameworkDetection | undefined {
  for (const name of FRAMEWORK_PRIORITY) {
    const rule = FRAMEWORK_RULES.find((item) => item.name === name);
    if (rule === undefined) {
      continue;
    }
    const matched = rule.packages.find((packageName) => hasDependency(pkg, packageName));
    if (matched === undefined) {
      continue;
    }
    const evidence = [
      `${matched} in package.json`,
      ...(folderName === undefined ? [] : [`workspace folder '${folderName}'`]),
    ];
    return {
      name: rule.name,
      evidence,
      reason: rule.reason,
    };
  }
  return undefined;
}

export function detectFrameworkFromManifests(
  packageManifests: Array<{ pkg: PackageJsonLike; folderName: string }>,
): FrameworkDetection | undefined {
  const detections = packageManifests
    .map((item) => detectFrameworkFromPackageJson(item.pkg, item.folderName))
    .filter((item): item is FrameworkDetection => item !== undefined);
  if (detections.length === 0) {
    return undefined;
  }
  for (const name of FRAMEWORK_PRIORITY) {
    const match = detections.find((item) => item.name === name);
    if (match !== undefined) {
      return match;
    }
  }
  return detections[0];
}

export function detectLanguageHints(
  sourcePaths: string[],
  manifests: ManifestFile[],
  packages: PackageJsonLike[],
): string[] {
  const hints: string[] = [];
  const hasTsconfig = manifests.some((file) => file.fileName === "tsconfig.json");
  const hasJsconfig = manifests.some((file) => file.fileName === "jsconfig.json");
  const hasTypescriptDep = packages.some((pkg) => dependencyNames(pkg).includes("typescript"));
  const hasTsSource = sourcePaths.some((path) => {
    const extension = posixExtension(path);
    return extension === ".ts" || extension === ".tsx";
  });
  const hasJsSource = sourcePaths.some((path) => {
    const extension = posixExtension(path);
    return extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs";
  });
  if (hasTsconfig || hasTypescriptDep || hasTsSource) {
    hints.push("TypeScript");
  }
  if (hasJsconfig || (hasJsSource && !hasTsSource)) {
    hints.push("JavaScript");
  }
  return hints;
}

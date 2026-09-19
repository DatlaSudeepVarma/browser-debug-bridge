import { PACKAGE_MANAGER_PRIORITY } from "./constants.js";
import type { ManifestFile } from "./manifests.js";
import type { PackageManagerDetection } from "./types.js";

const LOCKFILE_TO_MANAGER: Record<string, PackageManagerDetection["name"]> = {
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "pnpm-lock.yaml": "pnpm",
  "pnpm-workspace.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
};

export function detectPackageManagerFromFileNames(
  fileNames: string[],
): PackageManagerDetection | undefined {
  const evidence: string[] = [];
  const found = new Set<PackageManagerDetection["name"]>();
  for (const fileName of fileNames) {
    const manager = LOCKFILE_TO_MANAGER[fileName];
    if (manager === undefined) {
      continue;
    }
    found.add(manager);
    evidence.push(fileName);
  }
  for (const name of PACKAGE_MANAGER_PRIORITY) {
    if (found.has(name)) {
      return {
        name,
        evidence,
        reason: `${evidence[0] ?? name} present in the workspace`,
      };
    }
  }
  return undefined;
}

export function detectPackageManagerFromManifests(
  manifests: ManifestFile[],
): PackageManagerDetection | undefined {
  return detectPackageManagerFromFileNames(manifests.map((file) => file.fileName));
}

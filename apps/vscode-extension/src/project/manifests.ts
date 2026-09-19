import { posixBasename } from "./workspace.js";

export interface PackageJsonLike {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface ManifestFile {
  relativePath: string;
  folderName: string;
  folderRoot: string;
  fileName: string;
  content: string;
}

export function parsePackageJson(content: string): PackageJsonLike | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record.name === "string" ? { name: record.name } : {}),
      ...(isStringRecord(record.dependencies)
        ? { dependencies: record.dependencies }
        : {}),
      ...(isStringRecord(record.devDependencies)
        ? { devDependencies: record.devDependencies }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === "string");
}

export function dependencyNames(pkg: PackageJsonLike): string[] {
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];
}

export function hasDependency(pkg: PackageJsonLike, name: string): boolean {
  return (
    Object.hasOwn(pkg.dependencies ?? {}, name) || Object.hasOwn(pkg.devDependencies ?? {}, name)
  );
}

export function manifestKind(relativePath: string): string {
  return posixBasename(relativePath);
}

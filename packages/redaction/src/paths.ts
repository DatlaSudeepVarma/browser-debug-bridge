export type UnsafePathReason =
  | "empty-path"
  | "nul-byte"
  | "path-traversal"
  | "outside-workspace"
  | "env-file"
  | "private-key"
  | "credentials-file"
  | "pem-file";

export type WorkspacePathInspection =
  | { safe: true; relativePath: string }
  | { safe: false; reason: UnsafePathReason };

const PRIVATE_KEY_BASENAMES = new Set([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa.pub",
]);

const CREDENTIAL_BASENAMES = new Set([
  "credentials",
  "credentials.json",
  "credentials.xml",
  ".credentials",
  ".netrc",
]);

function replaceBackslashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function isWindowsDriveAbs(path: string): boolean {
  return /^[a-zA-Z]:\//.test(path);
}

function isUncAbs(path: string): boolean {
  return path.startsWith("//");
}

function isPosixAbs(path: string): boolean {
  return path.startsWith("/");
}

function isAbsolutePath(path: string): boolean {
  return isWindowsDriveAbs(path) || isUncAbs(path) || isPosixAbs(path);
}

function splitDrive(path: string): { drive: string; rest: string } {
  const match = /^([a-zA-Z]:)(\/.*)?$/.exec(path);
  if (match) {
    return { drive: match[1]?.toLowerCase() ?? "", rest: match[2] ?? "/" };
  }

  return { drive: "", rest: path };
}

function splitSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0 && segment !== ".");
}

function containsTraversal(path: string): boolean {
  return splitSegments(path).includes("..");
}

function normalizeAbsolute(path: string): string | undefined {
  const { drive, rest } = splitDrive(path);
  const segments: string[] = [];

  for (const segment of splitSegments(rest)) {
    if (segment === "..") {
      if (segments.length === 0) {
        return undefined;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (drive) {
    return `${drive}/${segments.join("/")}`;
  }

  if (isUncAbs(path)) {
    return `//${segments.join("/")}`;
  }

  return `/${segments.join("/")}`;
}

function joinWorkspaceRelative(workspaceRoot: string, relativePath: string): string | undefined {
  const { drive, rest } = splitDrive(workspaceRoot);
  const segments = splitSegments(rest);

  for (const segment of splitSegments(relativePath)) {
    if (segment === "..") {
      return undefined;
    }
    segments.push(segment);
  }

  if (drive) {
    return `${drive}/${segments.join("/")}`;
  }

  if (isUncAbs(workspaceRoot)) {
    return `//${segments.join("/")}`;
  }

  if (isPosixAbs(workspaceRoot)) {
    return `/${segments.join("/")}`;
  }

  return segments.join("/");
}

function isPrefixPath(workspaceRoot: string, candidate: string): boolean {
  const root = workspaceRoot.endsWith("/") ? workspaceRoot.slice(0, -1) : workspaceRoot;
  const compareRoot = isWindowsDriveAbs(root) ? root.toLowerCase() : root;
  const compareCandidate = isWindowsDriveAbs(candidate)
    ? candidate.toLowerCase()
    : candidate;

  return (
    compareCandidate === compareRoot ||
    compareCandidate.startsWith(`${compareRoot}/`)
  );
}

function toRelative(workspaceRoot: string, absolutePath: string): string {
  const root = workspaceRoot.endsWith("/") ? workspaceRoot.slice(0, -1) : workspaceRoot;
  if (absolutePath.length === root.length) {
    return "";
  }
  return absolutePath.slice(root.length + 1);
}

function basename(path: string): string {
  const segments = splitSegments(path);
  return segments[segments.length - 1] ?? "";
}

function isEnvFile(name: string): boolean {
  return name === ".env" || name.startsWith(".env.");
}

function isPemFile(name: string): boolean {
  return name.toLowerCase().endsWith(".pem");
}

function isPrivateKeyFile(name: string): boolean {
  return PRIVATE_KEY_BASENAMES.has(name);
}

function isCredentialsFile(name: string): boolean {
  return CREDENTIAL_BASENAMES.has(name.toLowerCase());
}

export function inspectWorkspacePath(
  workspaceRoot: string,
  proposedPath: string,
): WorkspacePathInspection {
  if (proposedPath.includes("\0") || workspaceRoot.includes("\0")) {
    return { safe: false, reason: "nul-byte" };
  }

  const root = replaceBackslashes(workspaceRoot.trim());
  const proposed = replaceBackslashes(proposedPath.trim());

  if (root.length === 0 || proposed.length === 0) {
    return { safe: false, reason: "empty-path" };
  }

  if (containsTraversal(proposed)) {
    return { safe: false, reason: "path-traversal" };
  }

  const normalizedRoot = isAbsolutePath(root) ? normalizeAbsolute(root) : root;
  if (!normalizedRoot) {
    return { safe: false, reason: "empty-path" };
  }

  let resolved: string | undefined;
  if (isAbsolutePath(proposed)) {
    resolved = normalizeAbsolute(proposed);
    if (!resolved || !isPrefixPath(normalizedRoot, resolved)) {
      return { safe: false, reason: "outside-workspace" };
    }
  } else {
    resolved = joinWorkspaceRelative(normalizedRoot, proposed);
    if (!resolved) {
      return { safe: false, reason: "path-traversal" };
    }
  }

  const relativePath = isAbsolutePath(proposed)
    ? toRelative(normalizedRoot, resolved)
    : splitSegments(proposed).join("/");
  const fileName = basename(resolved);

  if (isEnvFile(fileName)) {
    return { safe: false, reason: "env-file" };
  }
  if (isPrivateKeyFile(fileName)) {
    return { safe: false, reason: "private-key" };
  }
  if (isPemFile(fileName)) {
    return { safe: false, reason: "pem-file" };
  }
  if (isCredentialsFile(fileName)) {
    return { safe: false, reason: "credentials-file" };
  }

  return { safe: true, relativePath };
}

export function isSafeWorkspacePath(
  workspaceRoot: string,
  proposedPath: string,
): boolean {
  return inspectWorkspacePath(workspaceRoot, proposedPath).safe;
}

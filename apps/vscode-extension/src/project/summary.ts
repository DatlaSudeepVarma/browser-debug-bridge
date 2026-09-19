import type { ProjectContextResult } from "./types.js";

export function formatProjectIntelligenceSummary(result: ProjectContextResult): string {
  if (result.status === "no-workspace") {
    return "Project intelligence: no workspace is open.";
  }
  if (result.status === "cancelled") {
    return "Project intelligence: analysis cancelled.";
  }

  const { context } = result;
  const lines = [
    "Project intelligence complete",
    `Workspace: ${context.workspaceRoot}`,
    `Folders: ${context.folders.map((folder) => folder.name).join(", ") || "(none)"}`,
    `Framework: ${
      context.framework === undefined
        ? "not detected"
        : `${context.framework.name} (${context.framework.reason})`
    }`,
    `Package manager: ${
      context.packageManager === undefined
        ? "not detected"
        : `${context.packageManager.name} (${context.packageManager.reason})`
    }`,
    `Language hints: ${context.languageHints.join(", ") || "(none)"}`,
    `Files considered: ${String(context.metadata.filesConsidered)}`,
    `Files selected: ${String(context.metadata.filesSelected)}`,
    `Truncated: ${context.metadata.truncated ? "true" : "false"}`,
    "",
    "Candidates:",
  ];

  if (context.candidates.length === 0) {
    lines.push("(none)");
    return lines.join("\n");
  }

  context.candidates.forEach((candidate, index) => {
    lines.push(`${String(index + 1)}. ${candidate.relativePath}`);
    lines.push(`   Folder: ${candidate.workspaceFolder}`);
    lines.push("   Reasons:");
    for (const reason of candidate.reasons) {
      lines.push(`   - ${reason.type}: ${reason.explanation}`);
    }
  });

  return lines.join("\n");
}

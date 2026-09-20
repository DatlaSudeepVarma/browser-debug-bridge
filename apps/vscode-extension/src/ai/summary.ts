import type { AiAnalysisResult } from "./types.js";

export function formatDiagnosisSummary(result: AiAnalysisResult): string {
  if (result.status === "error") {
    return [
      "AI diagnosis failed",
      `Provider: ${result.providerId}`,
      `Error: ${result.error.code}`,
      result.error.message,
    ].join("\n");
  }

  const files = new Set<string>();
  for (const hypothesis of result.diagnosis.hypotheses) {
    for (const file of hypothesis.candidateFiles) {
      files.add(file.relativePath);
    }
  }

  const lines = [
    "AI diagnosis complete",
    `AI provider: ${result.providerId}`,
    `Candidates: ${String(result.candidateCount)}`,
    `Context chars: ${String(result.contextChars)}`,
    `Diagnosis completed`,
    `Summary: ${result.diagnosis.summary}`,
    `Hypotheses: ${String(result.diagnosis.hypotheses.length)}`,
    "Referenced files:",
  ];
  if (files.size === 0) {
    lines.push("(none)");
  } else {
    for (const path of [...files].sort((left, right) => left.localeCompare(right))) {
      lines.push(`- ${path}`);
    }
  }
  lines.push("Limitations:");
  if (result.diagnosis.limitations.length === 0) {
    lines.push("(none)");
  } else {
    for (const limitation of result.diagnosis.limitations) {
      lines.push(`- ${limitation}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push(`Warnings: ${String(result.warnings.length)}`);
  }
  return lines.join("\n");
}

import type { DebugSessionV1 } from "@browser-debug-bridge/schema";

export type DiagnosisSelection =
  | { source: "captured" }
  | { source: "synthetic"; allowCreate: boolean }
  | { source: "id"; sessionId: string };

export interface DiagnosisSessionSource {
  getSession(sessionId: string): DebugSessionV1 | undefined;
  latestCapturedSession(): DebugSessionV1 | undefined;
  latestSyntheticSession(): DebugSessionV1 | undefined;
}

export function selectDiagnosisSession(
  selection: DiagnosisSelection,
  source: DiagnosisSessionSource | undefined,
): DebugSessionV1 | undefined {
  if (source === undefined) {
    return undefined;
  }
  if (selection.source === "id") {
    return source.getSession(selection.sessionId);
  }
  if (selection.source === "synthetic") {
    return source.latestSyntheticSession();
  }
  return source.latestCapturedSession();
}

export function clearDiagnosisView(input: {
  diagnosis: { clearDiagnosis(): void; isRunning(): boolean };
  proposals: { isApplying(): boolean; getTreeState(): { generating: boolean }; clear(): void };
  clearPreview(): void;
}): "cleared" | "busy" {
  if (
    input.diagnosis.isRunning() ||
    input.proposals.isApplying() ||
    input.proposals.getTreeState().generating
  ) {
    return "busy";
  }
  input.proposals.clear();
  input.diagnosis.clearDiagnosis();
  input.clearPreview();
  return "cleared";
}

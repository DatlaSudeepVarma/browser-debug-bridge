import type { AiAnalysisResult } from "../ai/types.js";
import type { DebugSessionV1 } from "@browser-debug-bridge/schema";
import type { CancellationTokenLike, ProjectContext, ProjectContextResult } from "../project/types.js";
import type { FixProposalController } from "../fix/proposal-state.js";
import type { DiagnosisController } from "./diagnosis-state.js";

export interface DiagnosisRunDependencies {
  getLatestSession(): DebugSessionV1 | undefined;
  createSessionIfMissing?: () => DebugSessionV1 | undefined;
  analyze(session: DebugSessionV1, token?: CancellationTokenLike): Promise<ProjectContextResult>;
  diagnose(
    session: DebugSessionV1,
    project: ProjectContext,
    token?: CancellationTokenLike,
  ): Promise<AiAnalysisResult>;
}

export type DiagnosisRunOutcome =
  | { status: "replaced"; result: Extract<AiAnalysisResult, { status: "ok" }> }
  | { status: "preserved"; result: Extract<AiAnalysisResult, { status: "error" }> }
  | { status: "no-session" }
  | { status: "no-workspace" }
  | { status: "cancelled" }
  | { status: "busy" }
  | { status: "discarded" };

function isCancellationRequested(token?: CancellationTokenLike): boolean {
  return token?.isCancellationRequested === true;
}

export async function runDiagnosis(
  controller: DiagnosisController,
  deps: DiagnosisRunDependencies,
  options: { allowCreateSession: boolean; proposalController?: FixProposalController },
  token?: CancellationTokenLike,
): Promise<DiagnosisRunOutcome> {
  if (options.proposalController?.isApplying() === true) {
    return { status: "busy" };
  }
  if (!controller.beginRun()) {
    return { status: "busy" };
  }
  const generation = controller.getGeneration();
  try {
    if (isCancellationRequested(token)) {
      return { status: "cancelled" };
    }
    let session = deps.getLatestSession();
    if (session === undefined && options.allowCreateSession) {
      session = deps.createSessionIfMissing?.();
    }
    if (session === undefined) {
      return { status: "no-session" };
    }
    const analysis = await deps.analyze(session, token);
    if (analysis.status === "cancelled" || isCancellationRequested(token)) {
      return { status: "cancelled" };
    }
    if (analysis.status === "no-workspace") {
      return { status: "no-workspace" };
    }
    const result = await deps.diagnose(session, analysis.context, token);
    if (isCancellationRequested(token)) {
      return { status: "cancelled" };
    }
    if (controller.getGeneration() !== generation) {
      return { status: "discarded" };
    }
    if (result.status === "ok") {
      if (options.proposalController?.isApplying() === true) {
        return { status: "discarded" };
      }
      options.proposalController?.clear();
      controller.applyResult(result, analysis.context, session);
      return { status: "replaced", result };
    }
    if (result.error.code === "AI_CANCELLED") {
      return { status: "preserved", result };
    }
    return { status: "preserved", result };
  } finally {
    controller.endRun();
  }
}

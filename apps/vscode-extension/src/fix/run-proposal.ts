import type { CancellationTokenLike } from "../project/types.js";
import type { DiagnosisViewState } from "../ui/diagnosis-state.js";
import { diagnosisFingerprint } from "./hash.js";
import type { FixProposalController } from "./proposal-state.js";
import type { FixProposalResult } from "./types.js";

export type FixProposalRunOutcome =
  | { status: "replaced"; result: Extract<FixProposalResult, { status: "ok" }> }
  | { status: "preserved"; result: Extract<FixProposalResult, { status: "error" }> }
  | { status: "no-diagnosis" }
  | { status: "cancelled" }
  | { status: "busy" };

function isCancellationRequested(token?: CancellationTokenLike): boolean {
  return token?.isCancellationRequested === true;
}

export async function runFixProposal(
  diagnosis: DiagnosisViewState | undefined,
  proposalController: FixProposalController,
  propose: (state: DiagnosisViewState, token?: CancellationTokenLike) => Promise<FixProposalResult>,
  token?: CancellationTokenLike,
): Promise<FixProposalRunOutcome> {
  if (diagnosis === undefined) {
    return { status: "no-diagnosis" };
  }
  if (!proposalController.beginRun()) {
    return { status: "busy" };
  }
  try {
    if (isCancellationRequested(token)) {
      proposalController.applyCancelled();
      return { status: "cancelled" };
    }
    const result = await propose(diagnosis, token);
    if (isCancellationRequested(token) || (result.status === "error" && result.error.code === "AI_FIX_CANCELLED")) {
      proposalController.applyCancelled();
      return result.status === "error"
        ? { status: "preserved", result }
        : { status: "cancelled" };
    }
    if (result.status === "ok") {
      const identity = {
        sessionId: diagnosis.session.sessionId,
        diagnosisFingerprint: diagnosisFingerprint(diagnosis.diagnosis),
      };
      if (
        result.proposal.identity.sessionId !== identity.sessionId ||
        result.proposal.identity.diagnosisFingerprint !== identity.diagnosisFingerprint
      ) {
        proposalController.applyFailure();
        return {
          status: "preserved",
          result: {
            status: "error",
            providerId: result.providerId,
            error: {
              code: "AI_FIX_RESPONSE_INVALID",
              message: "The proposal did not match the current diagnosis.",
            },
          },
        };
      }
      proposalController.applySuccess(result.proposal);
      return { status: "replaced", result };
    }
    proposalController.applyFailure();
    return { status: "preserved", result };
  } finally {
    proposalController.endRun();
  }
}

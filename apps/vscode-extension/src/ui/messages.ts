export const EMPTY_DIAGNOSIS_MESSAGE =
  'No diagnosis available.\n\nRun "Browser Debug Bridge: Diagnose Test Session"';

export const NO_SESSION_MESSAGE =
  "No debug session available. Start a browser debugging session first.";

export const NO_WORKSPACE_MESSAGE = "Open a workspace folder before diagnosing a session.";

export const DIAGNOSIS_BUSY_MESSAGE = "A diagnosis is already running.";

export const DIAGNOSIS_CLEARED_MESSAGE = "Diagnosis cleared.";

export const DIAGNOSIS_COMPLETE_MESSAGE = "Read-only AI diagnosis complete.";

export const NO_DIAGNOSIS_FOR_FIX_MESSAGE = "Run diagnosis before proposing a fix.";

export const FIX_BUSY_MESSAGE = "A fix proposal is already running.";

export const DIAGNOSIS_DISCARDED_MESSAGE =
  "The diagnosis was cleared before it finished. No new diagnosis was stored.";

export const FIX_COMPLETE_MESSAGE = "In-memory proposed change ready. No workspace files were modified.";

export const FIX_STALE_MESSAGE =
  "The diagnosis changed before the proposal was ready. Propose a fix again.";

export const UNSAFE_CANDIDATE_MESSAGE = "That file path is not a validated diagnosis candidate.";

export function missingCandidateMessage(relativePath: string): string {
  return `The referenced file is no longer available: ${relativePath}`;
}

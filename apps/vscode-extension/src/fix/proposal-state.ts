import type { StoredProposal } from "./types.js";

export type ProposalLastOutcome = "none" | "failed" | "cancelled";

export interface ProposalTreeState {
  generating: boolean;
  proposal: StoredProposal | undefined;
  lastOutcome: ProposalLastOutcome;
}

export class FixProposalController {
  private current: StoredProposal | undefined;
  private generating = false;
  private lastOutcome: ProposalLastOutcome = "none";

  public getProposal(): StoredProposal | undefined {
    return this.current;
  }

  public getTreeState(): ProposalTreeState {
    return {
      generating: this.generating,
      proposal: this.current,
      lastOutcome: this.lastOutcome,
    };
  }

  public clear(): void {
    this.current = undefined;
    this.lastOutcome = "none";
  }

  public beginRun(): boolean {
    if (this.generating) {
      return false;
    }
    this.generating = true;
    return true;
  }

  public endRun(): void {
    this.generating = false;
  }

  public applySuccess(proposal: StoredProposal): void {
    this.current = proposal;
    this.lastOutcome = "none";
  }

  public applyFailure(): void {
    this.lastOutcome = "failed";
  }

  public applyCancelled(): void {
    this.lastOutcome = "cancelled";
  }

  public belongsTo(identity: { sessionId: string; diagnosisFingerprint: string }): boolean {
    return (
      this.current !== undefined &&
      this.current.identity.sessionId === identity.sessionId &&
      this.current.identity.diagnosisFingerprint === identity.diagnosisFingerprint
    );
  }
}

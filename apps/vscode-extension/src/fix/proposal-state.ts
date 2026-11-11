import type { StoredProposal } from "./types.js";

export type ProposalLastOutcome = "none" | "failed" | "cancelled" | "rejected" | "applied";

export type RejectProposalResult = "rejected" | "no-proposal" | "stale" | "busy";

export interface ProposalTreeState {
  generating: boolean;
  proposal: StoredProposal | undefined;
  lastOutcome: ProposalLastOutcome;
}

export class FixProposalController {
  private current: StoredProposal | undefined;
  private reviewed: StoredProposal | undefined;
  private generating = false;
  private applying = false;
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
    this.reviewed = undefined;
    this.lastOutcome = "none";
  }

  /** Records that Review opened this exact proposal. A replacement must be reviewed again. */
  public markReviewed(proposal: StoredProposal): boolean {
    if (this.current !== proposal) {
      return false;
    }
    this.reviewed = proposal;
    return true;
  }

  public hasReviewed(proposal: StoredProposal): boolean {
    return this.current === proposal && this.reviewed === proposal;
  }

  public isApplying(): boolean {
    return this.applying;
  }

  public beginRun(): boolean {
    if (this.generating || this.applying) {
      return false;
    }
    this.generating = true;
    return true;
  }

  public endRun(): void {
    this.generating = false;
  }

  public beginApply(): boolean {
    if (this.generating || this.applying) {
      return false;
    }
    this.applying = true;
    return true;
  }

  public endApply(): void {
    this.applying = false;
  }

  /** Drops `expected` after a verified write. A newer proposal is left in place. */
  public consumeApplied(expected: StoredProposal): boolean {
    if (this.current !== expected) {
      return false;
    }
    this.current = undefined;
    this.reviewed = undefined;
    this.lastOutcome = "applied";
    return true;
  }

  public applySuccess(proposal: StoredProposal): void {
    this.current = proposal;
    this.reviewed = undefined;
    this.lastOutcome = "none";
  }

  public applyFailure(): void {
    this.lastOutcome = "failed";
  }

  public applyCancelled(): void {
    this.lastOutcome = "cancelled";
  }

  /**
   * Discards `expected` only if it is still the current proposal. A proposal
   * that replaced it in the meantime is left untouched. The diagnosis is not
   * affected; the developer can propose again.
   */
  public reject(expected: StoredProposal | undefined): RejectProposalResult {
    if (this.applying) {
      return "busy";
    }
    if (this.current === undefined) {
      return "no-proposal";
    }
    if (expected === undefined || this.current !== expected) {
      return "stale";
    }
    this.current = undefined;
    this.reviewed = undefined;
    this.lastOutcome = "rejected";
    return "rejected";
  }

  public belongsTo(identity: { sessionId: string; diagnosisFingerprint: string }): boolean {
    return (
      this.current !== undefined &&
      this.current.identity.sessionId === identity.sessionId &&
      this.current.identity.diagnosisFingerprint === identity.diagnosisFingerprint
    );
  }
}

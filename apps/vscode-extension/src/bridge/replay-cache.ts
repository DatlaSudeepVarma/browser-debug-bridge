export type ReplayCheck = "fresh" | "idempotent" | "conflict";

/**
 * Remembers every requestId for the life of the bridge process.
 * Older ids are not dropped, so a reused id cannot become fresh again.
 */
export class RequestReplayCache {
  private readonly seen = new Map<string, string>();

  public check(requestId: string, sessionId: string): ReplayCheck {
    const existing = this.seen.get(requestId);
    if (existing === undefined) {
      return "fresh";
    }
    return existing === sessionId ? "idempotent" : "conflict";
  }

  public remember(requestId: string, sessionId: string): void {
    if (this.seen.has(requestId)) {
      return;
    }
    this.seen.set(requestId, sessionId);
  }

  public clear(): void {
    this.seen.clear();
  }

  public get size(): number {
    return this.seen.size;
  }
}

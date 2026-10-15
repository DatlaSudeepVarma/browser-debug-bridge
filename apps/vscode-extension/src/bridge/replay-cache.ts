const DEFAULT_MAX_REQUEST_IDS = 128;

export type ReplayCheck = "fresh" | "idempotent" | "conflict";

export class RequestReplayCache {
  private readonly seen = new Map<string, string>();

  public constructor(private readonly maxEntries: number = DEFAULT_MAX_REQUEST_IDS) {}

  public check(requestId: string, sessionId: string): ReplayCheck {
    const existing = this.seen.get(requestId);
    if (existing === undefined) {
      return "fresh";
    }
    return existing === sessionId ? "idempotent" : "conflict";
  }

  public remember(requestId: string, sessionId: string): void {
    if (this.seen.has(requestId)) {
      this.seen.delete(requestId);
    }
    this.seen.set(requestId, sessionId);
    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.seen.delete(oldest);
    }
  }

  public clear(): void {
    this.seen.clear();
  }

  public get size(): number {
    return this.seen.size;
  }
}

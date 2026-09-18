import type { DebugSessionV1 } from "@browser-debug-bridge/schema";

export interface StoredSession {
  session: DebugSessionV1;
  receivedAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  public constructor(private readonly maxSessions: number) {}

  public add(session: DebugSessionV1, receivedAt = Date.now()): void {
    if (this.sessions.has(session.sessionId)) {
      this.sessions.delete(session.sessionId);
    }
    this.sessions.set(session.sessionId, { session, receivedAt });
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.sessions.delete(oldest);
    }
  }

  public get(sessionId: string): StoredSession | undefined {
    return this.sessions.get(sessionId);
  }

  public get size(): number {
    return this.sessions.size;
  }

  public ids(): string[] {
    return [...this.sessions.keys()];
  }
}

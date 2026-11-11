import type { DebugSessionV1 } from "@browser-debug-bridge/schema";
import { MAX_SESSIONS } from "./constants.js";

export type SessionOrigin = "captured" | "synthetic";

export interface StoredSession {
  session: DebugSessionV1;
  receivedAt: number;
  origin: SessionOrigin;
}

export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  public constructor(private readonly maxSessions: number = MAX_SESSIONS) {}

  public add(
    session: DebugSessionV1,
    receivedAt = Date.now(),
    origin: SessionOrigin = "captured",
  ): string[] {
    if (this.sessions.has(session.sessionId)) {
      return [];
    }
    this.sessions.set(session.sessionId, { session, receivedAt, origin });
    const evicted: string[] = [];
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.sessions.delete(oldest);
      evicted.push(oldest);
    }
    return evicted;
  }

  public get(sessionId: string): StoredSession | undefined {
    return this.sessions.get(sessionId);
  }

  public remove(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  public get size(): number {
    return this.sessions.size;
  }

  public ids(): string[] {
    return [...this.sessions.keys()];
  }

  public latest(origin?: SessionOrigin): StoredSession | undefined {
    let found: StoredSession | undefined;
    for (const item of this.sessions.values()) {
      if (origin !== undefined && item.origin !== origin) {
        continue;
      }
      if (found === undefined || item.receivedAt >= found.receivedAt) {
        found = item;
      }
    }
    return found;
  }

  public clear(): void {
    this.sessions.clear();
  }
}

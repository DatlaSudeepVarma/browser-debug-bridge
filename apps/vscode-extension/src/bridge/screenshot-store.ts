import { SCREENSHOT_LIMITS } from "@browser-debug-bridge/schema";
import { MAX_SCREENSHOT_ARTIFACTS } from "./constants.js";

export interface ScreenshotArtifact {
  sessionId: string;
  mime: "image/jpeg";
  bytes: Buffer;
  sha256: string;
  bound: boolean;
  receivedAt: number;
}

export class ScreenshotStore {
  private readonly artifacts = new Map<string, ScreenshotArtifact>();

  public constructor(private readonly maxArtifacts: number = MAX_SCREENSHOT_ARTIFACTS) {}

  public put(artifact: ScreenshotArtifact): string[] {
    if (this.artifacts.has(artifact.sessionId)) {
      this.artifacts.delete(artifact.sessionId);
    }
    this.artifacts.set(artifact.sessionId, artifact);
    const evicted: string[] = [];
    while (this.artifacts.size > this.maxArtifacts) {
      const evictId = this.oldestPendingId() ?? this.artifacts.keys().next().value;
      if (evictId === undefined) {
        break;
      }
      this.artifacts.delete(evictId);
      evicted.push(evictId);
    }
    return evicted;
  }

  public get(sessionId: string): ScreenshotArtifact | undefined {
    return this.artifacts.get(sessionId);
  }

  public bind(sessionId: string): void {
    const existing = this.artifacts.get(sessionId);
    if (existing === undefined) {
      return;
    }
    this.artifacts.set(sessionId, { ...existing, bound: true });
  }

  public delete(sessionId: string): ScreenshotArtifact | undefined {
    const existing = this.artifacts.get(sessionId);
    if (existing === undefined) {
      return undefined;
    }
    this.artifacts.delete(sessionId);
    return existing;
  }

  public get size(): number {
    return this.artifacts.size;
  }

  public get maxBytes(): number {
    return SCREENSHOT_LIMITS.maxBytes;
  }

  private oldestPendingId(): string | undefined {
    for (const [sessionId, artifact] of this.artifacts) {
      if (!artifact.bound) {
        return sessionId;
      }
    }
    return undefined;
  }
}

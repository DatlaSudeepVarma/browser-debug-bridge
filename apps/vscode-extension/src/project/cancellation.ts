import type { CancellationTokenLike } from "./types.js";

export class AnalysisCancelledError extends Error {
  public constructor() {
    super("Project intelligence analysis was cancelled");
    this.name = "AnalysisCancelledError";
  }
}

export function throwIfCancelled(token?: CancellationTokenLike): void {
  if (token?.isCancellationRequested === true) {
    throw new AnalysisCancelledError();
  }
}

export class ManualCancellationToken implements CancellationTokenLike {
  public isCancellationRequested = false;
  private readonly listeners: Array<() => void> = [];

  public cancel(): void {
    this.isCancellationRequested = true;
    for (const listener of this.listeners) {
      listener();
    }
  }

  public onCancellationRequested(listener: () => void): { dispose(): void } {
    this.listeners.push(listener);
    return {
      dispose: (): void => {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
          this.listeners.splice(index, 1);
        }
      },
    };
  }
}

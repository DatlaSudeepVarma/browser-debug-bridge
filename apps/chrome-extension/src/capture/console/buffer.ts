import { MAX_CONSOLE_ENTRIES } from "./limits.js";
import type { BuiltConsoleEntry } from "./entries.js";

export class ConsoleRingBuffer {
  private readonly entries: BuiltConsoleEntry[] = [];

  public constructor(private readonly maxEntries: number = MAX_CONSOLE_ENTRIES) {}

  public push(entry: BuiltConsoleEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  public snapshot(): BuiltConsoleEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  public clear(): void {
    this.entries.length = 0;
  }

  public get size(): number {
    return this.entries.length;
  }
}

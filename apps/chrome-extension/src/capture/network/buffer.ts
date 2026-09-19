import type { BuiltNetworkEntry } from "./entries.js";
import { MAX_NETWORK_ENTRIES } from "./limits.js";

export class NetworkRingBuffer {
  private readonly entries: BuiltNetworkEntry[] = [];

  public constructor(private readonly maxEntries: number = MAX_NETWORK_ENTRIES) {}

  public push(entry: BuiltNetworkEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  public snapshot(): BuiltNetworkEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  public clear(): void {
    this.entries.length = 0;
  }

  public get size(): number {
    return this.entries.length;
  }
}

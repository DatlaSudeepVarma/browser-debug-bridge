import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadFixture(name: string): unknown {
  const filePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", name);
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

export function cloneFixture<T>(value: T): T {
  return structuredClone(value);
}

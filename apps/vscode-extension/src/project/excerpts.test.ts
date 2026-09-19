import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_EXCERPTS_PER_FILE,
  MAX_LINES_PER_EXCERPT,
  MAX_SOURCE_FILE_BYTES,
  MAX_TOTAL_CONTEXT_LINES,
} from "./constants.js";
import { collectExcerpts, excerptAroundLine, remainingContextBudget, splitLines } from "./excerpts.js";

describe("excerpt bounds", () => {
  it("keeps excerpts within 40 lines", () => {
    const lines = Array.from({ length: 200 }, (_, index) => `line ${String(index + 1)}`);
    const excerpt = excerptAroundLine(lines, 80);
    assert.ok(excerpt);
    assert.equal(excerpt.endLine - excerpt.startLine + 1 <= MAX_LINES_PER_EXCERPT, true);
    assert.equal(excerpt.content.includes("line 80"), true);
  });

  it("caps excerpts per file and total context lines", () => {
    const content = Array.from({ length: 400 }, (_, index) => `line ${String(index + 1)}`).join("\n");
    const collected = collectExcerpts({
      content,
      targetLines: [10, 80, 160, 240],
      remainingLines: MAX_TOTAL_CONTEXT_LINES,
      byteLength: content.length,
      exceededSizeLimit: false,
    });
    assert.equal(collected.excerpts.length <= MAX_EXCERPTS_PER_FILE, true);
    assert.equal(collected.usedLines <= MAX_TOTAL_CONTEXT_LINES, true);
    assert.equal(remainingContextBudget(collected.usedLines) >= 0, true);
  });

  it("skips full-file excerpts when the source exceeds the size bound", () => {
    const content = "x".repeat(100);
    const collected = collectExcerpts({
      content,
      targetLines: [],
      remainingLines: MAX_TOTAL_CONTEXT_LINES,
      byteLength: MAX_SOURCE_FILE_BYTES + 1,
      exceededSizeLimit: true,
    });
    assert.deepEqual(collected.excerpts, []);
  });

  it("can still take a targeted excerpt when a line is known", () => {
    const lines = Array.from({ length: 80 }, (_, index) => `line ${String(index + 1)}`);
    const collected = collectExcerpts({
      content: lines.join("\n"),
      targetLines: [12],
      remainingLines: MAX_TOTAL_CONTEXT_LINES,
      byteLength: MAX_SOURCE_FILE_BYTES + 1,
      exceededSizeLimit: false,
    });
    assert.equal(collected.excerpts.length, 1);
    assert.equal(splitLines(collected.excerpts[0]?.content ?? "").length <= MAX_LINES_PER_EXCERPT, true);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatEvidenceLabel,
  isBrowserEvidence,
  isProjectEvidence,
  parseEvidenceRef,
} from "./evidence-refs.js";

describe("evidence references", () => {
  it("parses browser and project evidence ids", () => {
    assert.deepEqual(parseEvidenceRef("BROWSER.page"), { kind: "page" });
    assert.deepEqual(parseEvidenceRef("BROWSER.console[2]"), { kind: "console", index: 2 });
    assert.deepEqual(parseEvidenceRef("BROWSER.network[0]"), { kind: "network", index: 0 });
    assert.deepEqual(parseEvidenceRef("PROJECT.candidate[1]"), { kind: "candidate", index: 1 });
    assert.deepEqual(parseEvidenceRef("PROJECT.candidate[1].excerpt[0]"), {
      kind: "excerpt",
      candidateIndex: 1,
      excerptIndex: 0,
    });
  });

  it("formats human-readable labels without dumping payloads", () => {
    assert.equal(formatEvidenceLabel("BROWSER.page"), "Page");
    assert.equal(formatEvidenceLabel("BROWSER.console[2]"), "Console #2");
    assert.equal(formatEvidenceLabel("BROWSER.network[1]"), "Network #1");
    assert.equal(formatEvidenceLabel("PROJECT.candidate[0]"), "Candidate #0");
    assert.equal(formatEvidenceLabel("PROJECT.candidate[0].excerpt[1]"), "Excerpt #1");
  });

  it("classifies browser versus project evidence", () => {
    assert.equal(isBrowserEvidence("BROWSER.network[0]"), true);
    assert.equal(isProjectEvidence("PROJECT.candidate[0]"), true);
    assert.equal(isBrowserEvidence("PROJECT.framework"), false);
  });
});

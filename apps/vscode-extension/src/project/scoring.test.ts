import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_CANDIDATES, SCORE_WEIGHTS } from "./constants.js";
import {
  compareCandidates,
  rankCandidates,
  scoreContentSignals,
  scorePathSignals,
  type ScoredCandidate,
} from "./scoring.js";
import { extractSessionSignals } from "./signals.js";
import { createProjectIntelligenceSession } from "./test-fixtures/session.js";

const FOLDERS = [{ name: "shop", root: "/workspace/shop" }];

function candidate(path: string, score: number): ScoredCandidate {
  return {
    relativePath: path,
    workspaceFolder: "shop",
    workspaceRoot: "/workspace/shop",
    score,
    reasons: [],
    targetLines: [],
  };
}

describe("candidate scoring", () => {
  it("scores selector, route, network, and console-stack matches", () => {
    const signals = extractSessionSignals(createProjectIntelligenceSession(), FOLDERS);
    const button = scorePathSignals({
      relativePath: "src/components/BuyNowButton.tsx",
      folderName: "shop",
      folderRoot: "/workspace/shop",
      signals,
      frameworkName: "nextjs",
    });
    const page = scorePathSignals({
      relativePath: "src/app/checkout/page.tsx",
      folderName: "shop",
      folderRoot: "/workspace/shop",
      signals,
      frameworkName: "nextjs",
    });
    const service = scorePathSignals({
      relativePath: "src/services/checkout.ts",
      folderName: "shop",
      folderRoot: "/workspace/shop",
      signals,
    });

    assert.equal(
      button.reasons.some((reason) => reason.type === "console-stack"),
      true,
    );
    assert.equal(button.score >= SCORE_WEIGHTS.consoleStack, true);
    assert.equal(
      page.reasons.some((reason) => reason.type === "route"),
      true,
    );
    assert.equal(
      service.reasons.some((reason) => reason.type === "network"),
      true,
    );
  });

  it("gives text matches a low weight", () => {
    const signals = extractSessionSignals(createProjectIntelligenceSession(), FOLDERS);
    const base = scorePathSignals({
      relativePath: "src/components/UnrelatedCard.tsx",
      folderName: "shop",
      folderRoot: "/workspace/shop",
      signals,
    });
    const withText = scoreContentSignals(base, 'export function UnrelatedCard() { return "Buy now"; }', signals);
    assert.equal(
      withText.reasons.some((reason) => reason.type === "text" && reason.weight === SCORE_WEIGHTS.text),
      true,
    );
  });

  it("breaks score ties with lexical path order", () => {
    const left = candidate("src/a.ts", 25);
    const right = candidate("src/b.ts", 25);
    assert.equal(compareCandidates(left, right) < 0, true);
    assert.equal(compareCandidates(right, left) > 0, true);
  });

  it("keeps at most 12 ranked candidates", () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      candidate(`src/file-${String(index).padStart(2, "0")}.ts`, 10 + (index % 3)),
    );
    const ranked = rankCandidates(many);
    assert.equal(ranked.length, MAX_CANDIDATES);
    assert.equal(MAX_CANDIDATES, 12);
    for (let index = 1; index < ranked.length; index += 1) {
      const previous = ranked[index - 1];
      const current = ranked[index];
      assert.ok(previous !== undefined && current !== undefined);
      assert.equal(compareCandidates(previous, current) <= 0, true);
    }
  });
});

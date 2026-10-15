import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import { MAX_DIFF_CHARS } from "./constants.js";
import { generateUnifiedDiff } from "./diff.js";
import { validateUnifiedDiff } from "./diff-validation.js";
import { FAKE_FIX_PROPOSAL } from "./fake-proposal.js";
import { buildBoundedSources } from "./source.js";
import { fixtureAllowedPaths, fixtureSources } from "./test-support.js";
import { validateProposedChange } from "./validation.js";

function validatedProposal() {
  const result = validateProposedChange(
    FAKE_FIX_PROPOSAL,
    createFixtureAiProjectContext(),
    fixtureSources(),
    fixtureAllowedPaths(),
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") {
    throw new Error("expected valid proposal");
  }
  return result.proposedChange;
}

describe("unified diff generation", () => {
  it("produces a deterministic valid unified diff", () => {
    const proposedChange = validatedProposal();
    const sources = fixtureSources();
    const first = generateUnifiedDiff(proposedChange, sources);
    const second = generateUnifiedDiff(proposedChange, sources);
    assert.equal(first.status, "ok");
    assert.equal(second.status, "ok");
    if (first.status !== "ok" || second.status !== "ok") {
      return;
    }
    assert.equal(first.text, second.text);
    assert.equal(first.text.includes("--- a/src/services/checkout.ts"), true);
    assert.equal(first.text.includes("+++ b/src/services/checkout.ts"), true);
    assert.equal(first.text.includes("-  return fetch(\"/api/checkout\");"), true);
    assert.equal(first.text.includes("+  return fetch(\"/api/checkout\", { method: \"POST\" });"), true);
    const validated = validateUnifiedDiff(
      first.text,
      proposedChange,
      createFixtureAiProjectContext(),
      fixtureAllowedPaths(),
    );
    assert.equal(validated.status, "ok");
  });

  it("rejects a source mismatch", () => {
    const proposedChange = validatedProposal();
    const sources = fixtureSources();
    const stale = sources.map((source) =>
      source.relativePath === "src/services/checkout.ts"
        ? { ...source, originalContentHash: "0".repeat(64) }
        : source,
    );
    const result = generateUnifiedDiff(proposedChange, stale);
    assert.equal(result.status, "invalid");
  });

  it("rejects a malformed proposal with no usable edits", () => {
    const proposedChange = {
      ...validatedProposal(),
      changes: [],
    };
    const result = generateUnifiedDiff(proposedChange, fixtureSources());
    assert.equal(result.status, "invalid");
  });

  it("does not treat a proposal for content A as valid against content B", () => {
    const proposedChange = validatedProposal();
    const project = createFixtureAiProjectContext();
    const checkout = project.candidates.find((candidate) => candidate.relativePath === "src/services/checkout.ts");
    if (checkout !== undefined) {
      checkout.excerpts = [{ startLine: 1, endLine: 3, content: "export function other() {\n  return 1;\n}" }];
    }
    const sourcesB = buildBoundedSources(project, ["src/services/checkout.ts"]);
    const result = generateUnifiedDiff(proposedChange, sourcesB);
    assert.equal(result.status, "invalid");
  });

  it("rejects an oversized diff", () => {
    const proposedChange = validatedProposal();
    const generated = generateUnifiedDiff(proposedChange, fixtureSources());
    assert.equal(generated.status, "ok");
    if (generated.status !== "ok") {
      return;
    }
    const oversized = `${generated.text}${"+\n".repeat(MAX_DIFF_CHARS)}`;
    const result = validateUnifiedDiff(
      oversized,
      proposedChange,
      createFixtureAiProjectContext(),
      fixtureAllowedPaths(),
    );
    assert.equal(result.status, "too-large");
  });

  it("supports multiple hunks in one file", () => {
    const sources = fixtureSources();
    const source = sources[0];
    assert.equal(source !== undefined, true);
    if (source === undefined) {
      return;
    }
    const proposedChange = {
      summary: "Two edits",
      rationale: "Replace two lines in the checkout excerpt.",
      changes: [
        {
          relativePath: "src/services/checkout.ts",
          originalContentHash: source.originalContentHash,
          edits: [
            { startLine: 1, endLine: 1, replacement: "export async function submitCheckout(): Promise<Response> {" },
            { startLine: 2, endLine: 2, replacement: '  return fetch("/api/checkout", { method: "POST" });' },
          ],
        },
      ],
    };
    const generated = generateUnifiedDiff(proposedChange, sources);
    assert.equal(generated.status, "ok");
    if (generated.status !== "ok") {
      return;
    }
    assert.equal(generated.text.includes("method: \"POST\""), true);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { FAKE_DIAGNOSIS, FakeAiProvider, FailingAiProvider, UnavailableAiProvider } from "../ai/fake-provider.js";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import { ManualCancellationToken } from "../project/cancellation.js";
import { createProjectIntelligenceSession } from "../project/test-fixtures/session.js";
import { MAX_CHANGED_FILES, MAX_REPLACEMENT_CHARS } from "./constants.js";
import { FAKE_CHECKOUT_SOURCE, FAKE_FIX_PROPOSAL, jsonProposal } from "./fake-proposal.js";
import { sha256Utf8 } from "./hash.js";
import { createMemoryLiveFileReader, type LiveFileReader } from "./live-file.js";
import { FixProposalService } from "./proposal.js";
import { fixtureCanonicalIo } from "./test-support.js";

function propose(provider: FakeAiProvider | FailingAiProvider | UnavailableAiProvider) {
  return new FixProposalService(provider).propose(
    createProjectIntelligenceSession(),
    createFixtureAiProjectContext(),
    FAKE_DIAGNOSIS,
  );
}

describe("fix proposal service", () => {
  it("returns a validated fake proposal and unified diff", async () => {
    const result = await propose(new FakeAiProvider(jsonProposal(FAKE_FIX_PROPOSAL)));
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.proposal.proposedChange.changes[0]?.relativePath, "src/services/checkout.ts");
    assert.equal(result.proposal.diff.text.includes("--- a/src/services/checkout.ts"), true);
    assert.equal(result.proposal.identity.sessionId, createProjectIntelligenceSession().sessionId);
  });

  it("returns AI_FIX_UNAVAILABLE when the provider is unavailable", async () => {
    const result = await propose(new UnavailableAiProvider());
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_UNAVAILABLE");
  });

  it("returns AI_FIX_REQUEST_FAILED when the provider fails", async () => {
    const result = await propose(new FailingAiProvider());
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_REQUEST_FAILED");
  });

  it("returns AI_FIX_CANCELLED when the token is already cancelled", async () => {
    const token = new ManualCancellationToken();
    token.cancel();
    const result = await new FixProposalService(new FakeAiProvider(jsonProposal(FAKE_FIX_PROPOSAL))).propose(
      createProjectIntelligenceSession(),
      createFixtureAiProjectContext(),
      FAKE_DIAGNOSIS,
      token,
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_CANCELLED");
  });

  it("returns AI_FIX_RESPONSE_INVALID for malformed JSON", async () => {
    const result = await propose(new FakeAiProvider("not-json"));
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_RESPONSE_INVALID");
  });

  it("rejects a traversal path from the model", async () => {
    const result = await propose(
      new FakeAiProvider(
        jsonProposal({
          ...FAKE_FIX_PROPOSAL,
          changes: [
            {
              relativePath: "../../secret.ts",
              edits: [{ startLine: 1, endLine: 1, replacement: "x" }],
            },
          ],
        }),
      ),
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_RESPONSE_INVALID");
  });

  it("rejects a non-candidate path from the model", async () => {
    const result = await propose(
      new FakeAiProvider(
        jsonProposal({
          ...FAKE_FIX_PROPOSAL,
          changes: [
            {
              relativePath: "src/random-file.ts",
              edits: [{ startLine: 1, endLine: 1, replacement: "x" }],
            },
          ],
        }),
      ),
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_RESPONSE_INVALID");
  });

  it("rejects too many files", async () => {
    const result = await propose(
      new FakeAiProvider(
        jsonProposal({
          ...FAKE_FIX_PROPOSAL,
          changes: Array.from({ length: MAX_CHANGED_FILES + 1 }, () => FAKE_FIX_PROPOSAL.changes[0]),
        }),
      ),
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_PROPOSAL_TOO_LARGE");
  });

  it("rejects an oversized replacement before generating a diff", async () => {
    const result = await propose(
      new FakeAiProvider(
        jsonProposal({
          ...FAKE_FIX_PROPOSAL,
          changes: [
            {
              relativePath: "src/services/checkout.ts",
              edits: [{ startLine: 2, endLine: 2, replacement: "x".repeat(MAX_REPLACEMENT_CHARS + 1) }],
            },
          ],
        }),
      ),
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_PROPOSAL_TOO_LARGE");
  });

  it("returns AI_FIX_CONTEXT_INSUFFICIENT when no excerpts are available", async () => {
    const result = await new FixProposalService(new FakeAiProvider(jsonProposal(FAKE_FIX_PROPOSAL))).propose(
      createProjectIntelligenceSession(),
      createFixtureAiProjectContext(),
      {
        ...FAKE_DIAGNOSIS,
        hypotheses: [
          {
            title: "No files",
            explanation: "Nothing to edit",
            evidence: [],
            candidateFiles: [],
          },
        ],
      },
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_CONTEXT_INSUFFICIENT");
  });
});

const CHECKOUT = "src/services/checkout.ts";
const EXTENDED_TAIL = `\n\nexport function helper() {\n  return 1;\n}`;

function proposeWithLiveFiles(
  files: Record<string, string | undefined>,
  options?: {
    provider?: FakeAiProvider | FailingAiProvider | UnavailableAiProvider;
    reader?: LiveFileReader;
  },
) {
  return new FixProposalService(
    options?.provider ?? new FakeAiProvider(jsonProposal(FAKE_FIX_PROPOSAL)),
    {
      liveFileReader: options?.reader ?? createMemoryLiveFileReader(files),
      canonicalIo: fixtureCanonicalIo(),
    },
  ).propose(
    createProjectIntelligenceSession(),
    createFixtureAiProjectContext(),
    FAKE_DIAGNOSIS,
  );
}

describe("trusted full-file baselines", () => {
  it("stores the host-computed SHA-256 of the complete current file", async () => {
    const result = await proposeWithLiveFiles({ [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.proposal.liveFileHashes?.[CHECKOUT], sha256Utf8(FAKE_CHECKOUT_SOURCE));
    assert.notEqual(
      result.proposal.liveFileHashes?.[CHECKOUT],
      result.proposal.proposedChange.changes[0]?.originalContentHash,
    );
  });

  it("hashes content outside the edited excerpt as part of the full-file baseline", async () => {
    const live = `${FAKE_CHECKOUT_SOURCE}${EXTENDED_TAIL}`;
    const result = await proposeWithLiveFiles({ [CHECKOUT]: live });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.proposal.liveFileHashes?.[CHECKOUT], sha256Utf8(live));
    assert.notEqual(result.proposal.liveFileHashes?.[CHECKOUT], sha256Utf8(FAKE_CHECKOUT_SOURCE));
  });

  it("ignores model-supplied hashes when storing the host baseline", async () => {
    const poisoned = {
      ...FAKE_FIX_PROPOSAL,
      changes: [
        {
          relativePath: CHECKOUT,
          originalContentHash: "0".repeat(64),
          edits: FAKE_FIX_PROPOSAL.changes[0]?.edits ?? [],
        },
      ],
    };
    const result = await proposeWithLiveFiles(
      { [CHECKOUT]: FAKE_CHECKOUT_SOURCE },
      { provider: new FakeAiProvider(jsonProposal(poisoned)) },
    );
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.proposal.liveFileHashes?.[CHECKOUT], sha256Utf8(FAKE_CHECKOUT_SOURCE));
    assert.notEqual(result.proposal.proposedChange.changes[0]?.originalContentHash, "0".repeat(64));
    assert.equal(result.proposal.proposedChange.changes[0]?.originalContentHash.length, 64);
  });

  it("does not store an apply-ready proposal when the target cannot be read", async () => {
    const result = await proposeWithLiveFiles({ [CHECKOUT]: undefined });
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_SOURCE_UNAVAILABLE");
  });

  it("refuses a proposal when the file changes during AI generation", async () => {
    const original = `${FAKE_CHECKOUT_SOURCE}${EXTENDED_TAIL}`;
    const changed = original.replace("return 1;", "return 2;");
    let reads = 0;
    const reader: LiveFileReader = {
      readText(): string {
        reads += 1;
        return reads === 1 ? original : changed;
      },
    };
    const result = await proposeWithLiveFiles({ [CHECKOUT]: original }, { reader });
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_SOURCE_CHANGED");
    assert.equal(reads >= 2, true);
  });

  it("keeps cancellation working when a live-file reader is injected", async () => {
    const token = new ManualCancellationToken();
    token.cancel();
    const result = await new FixProposalService(new FakeAiProvider(jsonProposal(FAKE_FIX_PROPOSAL)), {
      liveFileReader: createMemoryLiveFileReader({ [CHECKOUT]: FAKE_CHECKOUT_SOURCE }),
      canonicalIo: fixtureCanonicalIo(),
    }).propose(
      createProjectIntelligenceSession(),
      createFixtureAiProjectContext(),
      FAKE_DIAGNOSIS,
      token,
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") {
      return;
    }
    assert.equal(result.error.code, "AI_FIX_CANCELLED");
  });

  it("does not introduce workspace writes or VS Code mutation APIs", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    for (const fileName of ["proposal.ts", "live-file.ts"]) {
      const source = readFileSync(path.join(root, fileName), "utf8");
      assert.equal(/\bWorkspaceEdit\b/.test(source), false);
      assert.equal(/workspace\.applyEdit/.test(source), false);
      assert.equal(/\bwriteFile(?:Sync)?\b/.test(source), false);
      assert.equal(/from ["']vscode["']/.test(source), false);
    }
    const extension = readFileSync(path.join(root, "../extension.ts"), "utf8");
    assert.equal(/\bWorkspaceEdit\b/.test(extension), false);
    assert.equal(/workspace\.applyEdit/.test(extension), false);
    assert.equal(/fs\.writeFile/.test(extension), false);
  });
});

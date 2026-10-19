import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { FAKE_DIAGNOSIS, FakeAiProvider } from "../ai/fake-provider.js";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import type { Diagnosis } from "../ai/types.js";
import { createProjectIntelligenceSession } from "../project/test-fixtures/session.js";
import type { ProjectContext } from "../project/types.js";
import { planSafeApply } from "./apply-plan.js";
import type { CanonicalPathIo } from "./canonical-path.js";
import { FAKE_CHECKOUT_SOURCE, FAKE_FIX_PROPOSAL, jsonProposal } from "./fake-proposal.js";
import { diagnosisFingerprint, sha256Utf8 } from "./hash.js";
import { createMemoryLiveFileReader } from "./live-file.js";
import { FixProposalService } from "./proposal.js";
import { fixtureCanonicalIo } from "./test-support.js";
import type { ProposedFileChange, StoredProposal } from "./types.js";

const CHECKOUT = "src/services/checkout.ts";
const EXPECTED_AFTER = `export async function submitCheckout(): Promise<Response> {
  return fetch("/api/checkout", { method: "POST" });
}`;
const EXTENDED_TAIL = `\n\nexport function helper() {\n  return 1;\n}`;

async function validProposal(): Promise<StoredProposal> {
  const result = await new FixProposalService(new FakeAiProvider(jsonProposal(FAKE_FIX_PROPOSAL))).propose(
    createProjectIntelligenceSession(),
    createFixtureAiProjectContext(),
    FAKE_DIAGNOSIS,
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") {
    throw new Error("expected a valid proposal");
  }
  return result.proposal;
}

async function validProposalWithBaseline(live: string): Promise<StoredProposal> {
  const result = await new FixProposalService(new FakeAiProvider(jsonProposal(FAKE_FIX_PROPOSAL)), {
    liveFileReader: createMemoryLiveFileReader({ [CHECKOUT]: live }),
    canonicalIo: fixtureCanonicalIo(),
  }).propose(
    createProjectIntelligenceSession(),
    createFixtureAiProjectContext(),
    FAKE_DIAGNOSIS,
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") {
    throw new Error("expected a valid proposal with a live-file baseline");
  }
  return result.proposal;
}

function plan(
  proposal: StoredProposal | undefined,
  files: Record<string, string | undefined>,
  options?: {
    sessionId?: string;
    diagnosis?: Diagnosis;
    project?: ProjectContext;
    canonicalIo?: CanonicalPathIo;
    trustedFullFileHashes?: Record<string, string>;
    reads?: string[];
  },
) {
  return planSafeApply({
    proposal,
    sessionId: options?.sessionId ?? createProjectIntelligenceSession().sessionId,
    diagnosis: options?.diagnosis ?? FAKE_DIAGNOSIS,
    project: options?.project ?? createFixtureAiProjectContext(),
    readLiveFile(relativePath: string): string | undefined {
      options?.reads?.push(relativePath);
      return files[relativePath];
    },
    canonicalIo: options?.canonicalIo ?? fixtureCanonicalIo(),
    trustedFullFileHashes: options?.trustedFullFileHashes,
  });
}

function withFirstChange(
  proposal: StoredProposal,
  mutate: (change: ProposedFileChange) => ProposedFileChange,
): StoredProposal {
  const change = proposal.proposedChange.changes[0];
  assert.ok(change);
  return {
    ...proposal,
    proposedChange: {
      ...proposal.proposedChange,
      changes: [mutate({ ...change, edits: change.edits.map((edit) => ({ ...edit })) })],
    },
  };
}

describe("write-free apply planner", () => {
  it("produces the correct full-file after-image for a valid proposal", async () => {
    const proposal = await validProposal();
    const result = plan(proposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.plan.files.length, 1);
    assert.equal(result.plan.files[0]?.relativePath, CHECKOUT);
    assert.equal(result.plan.files[0]?.currentContent, FAKE_CHECKOUT_SOURCE);
    assert.equal(result.plan.files[0]?.proposedContent, EXPECTED_AFTER);
    assert.equal(result.plan.identity.sessionId, proposal.identity.sessionId);
  });

  it("preserves live lines outside the edited excerpt", async () => {
    const proposal = await validProposal();
    const live = `${FAKE_CHECKOUT_SOURCE}${EXTENDED_TAIL}`;
    const result = plan(proposal, { [CHECKOUT]: live });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.plan.files[0]?.proposedContent, `${EXPECTED_AFTER}${EXTENDED_TAIL}`);
    assert.equal(result.plan.files[0]?.proposedContent.includes("export function helper()"), true);
    assert.equal(result.plan.files[0]?.proposedContent.includes("return 1;"), true);
  });

  it("computes a SHA-256 of the complete current UTF-8 file, not the excerpt digest", async () => {
    const proposal = await validProposal();
    const live = `${FAKE_CHECKOUT_SOURCE}${EXTENDED_TAIL}`;
    const result = plan(proposal, { [CHECKOUT]: live });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    const storedExcerptHash = proposal.proposedChange.changes[0]?.originalContentHash;
    assert.equal(result.plan.files[0]?.currentContentHash, sha256Utf8(live));
    assert.equal(result.plan.files[0]?.proposedContentHash, sha256Utf8(`${EXPECTED_AFTER}${EXTENDED_TAIL}`));
    assert.notEqual(result.plan.files[0]?.currentContentHash, storedExcerptHash);
    assert.equal(result.plan.files[0]?.currentContentHash.length, 64);
  });

  it("refuses a missing target file", async () => {
    const proposal = await validProposal();
    const result = plan(proposal, {});
    assert.equal(result.status, "refused");
    if (result.status !== "refused") {
      return;
    }
    assert.equal(result.reason.code, "APPLY_FILE_MISSING");
    assert.equal(result.reason.relativePath, CHECKOUT);
  });

  it("refuses when the live excerpt no longer matches", async () => {
    const proposal = await validProposal();
    const stale = FAKE_CHECKOUT_SOURCE.replace('"/api/checkout"', '"/api/other"');
    const result = plan(proposal, { [CHECKOUT]: stale });
    assert.equal(result.status, "refused");
    if (result.status !== "refused") {
      return;
    }
    assert.equal(result.reason.code, "APPLY_SOURCE_STALE");
  });

  it("detects outside-excerpt changes when a trusted full-file baseline is available", async () => {
    const proposal = await validProposal();
    const original = `${FAKE_CHECKOUT_SOURCE}${EXTENDED_TAIL}`;
    const changedOutside = original.replace("return 1;", "return 2;");
    const result = plan(
      proposal,
      { [CHECKOUT]: changedOutside },
      { trustedFullFileHashes: { [CHECKOUT]: sha256Utf8(original) } },
    );
    assert.equal(result.status, "refused");
    if (result.status !== "refused") {
      return;
    }
    assert.equal(result.reason.code, "APPLY_SOURCE_CHANGED");
  });

  it("still plans when outside-excerpt lines changed but no full-file baseline exists", async () => {
    const proposal = await validProposal();
    const changedOutside = `${FAKE_CHECKOUT_SOURCE}${EXTENDED_TAIL}`.replace("return 1;", "return 2;");
    const result = plan(proposal, { [CHECKOUT]: changedOutside });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(result.plan.files[0]?.proposedContent.includes("return 2;"), true);
  });

  it("refuses path traversal and sensitive files", async () => {
    const proposal = await validProposal();
    const traversal = withFirstChange(proposal, (change) => ({
      ...change,
      relativePath: "../../secret.ts",
    }));
    const traversalResult = plan(traversal, { "../../secret.ts": "secret" });
    assert.equal(traversalResult.status, "refused");
    if (traversalResult.status === "refused") {
      assert.equal(traversalResult.reason.code, "APPLY_PATH_REJECTED");
      assert.equal(
        traversalResult.reason.pathReason === "unsafe" ||
          traversalResult.reason.pathReason === "outside-workspace",
        true,
      );
    }

    const sensitive = withFirstChange(proposal, (change) => ({
      ...change,
      relativePath: ".env",
    }));
    const sensitiveResult = plan(sensitive, { ".env": "SECRET=1" });
    assert.equal(sensitiveResult.status, "refused");
    if (sensitiveResult.status === "refused") {
      assert.equal(sensitiveResult.reason.code, "APPLY_PATH_REJECTED");
      assert.equal(
        sensitiveResult.reason.pathReason === "sensitive" || sensitiveResult.reason.pathReason === "unsafe",
        true,
      );
    }
  });

  it("refuses canonical-path and symlink-escape failures", async () => {
    const proposal = await validProposal();
    const escaped = plan(
      proposal,
      { [CHECKOUT]: FAKE_CHECKOUT_SOURCE },
      {
        canonicalIo: fixtureCanonicalIo({
          realpathOverrides: {
            "/workspace/shop/src/services/checkout.ts": "/etc/passwd",
          },
        }),
      },
    );
    assert.equal(escaped.status, "refused");
    if (escaped.status === "refused") {
      assert.equal(escaped.reason.code, "APPLY_CANONICAL_REJECTED");
    }

    const skipped = plan(
      proposal,
      { [CHECKOUT]: FAKE_CHECKOUT_SOURCE },
      { canonicalIo: fixtureCanonicalIo({ missingRoot: true }) },
    );
    assert.equal(skipped.status, "refused");
    if (skipped.status === "refused") {
      assert.equal(skipped.reason.code, "APPLY_CANONICAL_REJECTED");
    }
  });

  it("refuses a missing proposal and diagnosis or identity mismatches", async () => {
    const proposal = await validProposal();
    const none = plan(undefined, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    assert.equal(none.status, "refused");
    if (none.status === "refused") {
      assert.equal(none.reason.code, "APPLY_NO_PROPOSAL");
    }

    const identity = plan(
      {
        ...proposal,
        identity: { ...proposal.identity, sourceFingerprint: "not-a-fingerprint" },
      },
      { [CHECKOUT]: FAKE_CHECKOUT_SOURCE },
    );
    assert.equal(identity.status, "refused");
    if (identity.status === "refused") {
      assert.equal(identity.reason.code, "APPLY_IDENTITY_MISMATCH");
    }

    const wrongSession = plan(proposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE }, {
      sessionId: "22222222-2222-4222-8222-222222222222",
    });
    assert.equal(wrongSession.status, "refused");
    if (wrongSession.status === "refused") {
      assert.equal(wrongSession.reason.code, "APPLY_DIAGNOSIS_MISMATCH");
    }

    const wrongDiagnosis = plan(proposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE }, {
      diagnosis: { ...FAKE_DIAGNOSIS, summary: "A different diagnosis." },
    });
    assert.equal(wrongDiagnosis.status, "refused");
    if (wrongDiagnosis.status === "refused") {
      assert.equal(wrongDiagnosis.reason.code, "APPLY_DIAGNOSIS_MISMATCH");
      assert.notEqual(diagnosisFingerprint({ ...FAKE_DIAGNOSIS, summary: "A different diagnosis." }), proposal.identity.diagnosisFingerprint);
    }
  });

  it("refuses invalid, overlapping, or out-of-range edits", async () => {
    const proposal = await validProposal();
    const overlapping = withFirstChange(proposal, (change) => ({
      ...change,
      edits: [
        ...change.edits,
        { startLine: 2, endLine: 2, replacement: "  return undefined;" },
      ],
    }));
    const overlapResult = plan(overlapping, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    assert.equal(overlapResult.status, "refused");
    if (overlapResult.status === "refused") {
      assert.equal(overlapResult.reason.code, "APPLY_EDIT_INVALID");
    }

    const outOfRange = withFirstChange(proposal, (change) => ({
      ...change,
      edits: [{ startLine: 99, endLine: 99, replacement: "x" }],
    }));
    const rangeResult = plan(outOfRange, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    assert.equal(rangeResult.status, "refused");
    if (rangeResult.status === "refused") {
      assert.equal(rangeResult.reason.code, "APPLY_EDIT_INVALID");
    }

    const inverted = withFirstChange(proposal, (change) => ({
      ...change,
      edits: [{ startLine: 3, endLine: 1, replacement: "x" }],
    }));
    const invertedResult = plan(inverted, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    assert.equal(invertedResult.status, "refused");
    if (invertedResult.status === "refused") {
      assert.equal(invertedResult.reason.code, "APPLY_EDIT_INVALID");
    }
  });

  it("refuses malformed proposals without throwing", async () => {
    const proposal = await validProposal();
    const cases: unknown[] = [
      { ...proposal, proposedChange: null },
      { ...proposal, proposedChange: { ...proposal.proposedChange, changes: [] } },
      { ...proposal, proposedChange: { ...proposal.proposedChange, changes: "nope" } },
      withFirstChange(proposal, (change) => ({ ...change, edits: [] })),
      withFirstChange(proposal, (change) => ({
        ...change,
        edits: [{ startLine: 2, endLine: 2 } as ProposedFileChange["edits"][number]],
      })),
    ];
    for (const malformed of cases) {
      const result = plan(malformed as StoredProposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
      assert.equal(result.status, "refused");
      if (result.status === "refused") {
        assert.equal(result.reason.code, "APPLY_PROPOSAL_MALFORMED");
      }
    }
  });

  it("refuses mixed line endings and null bytes", async () => {
    const proposal = await validProposal();
    const mixed = plan(proposal, {
      [CHECKOUT]: "export async function submitCheckout(): Promise<Response> {\r\n  return fetch(\"/api/checkout\");\n}",
    });
    assert.equal(mixed.status, "refused");
    if (mixed.status === "refused") {
      assert.equal(mixed.reason.code, "APPLY_TEXT_AMBIGUOUS");
    }

    const nul = plan(proposal, { [CHECKOUT]: `${FAKE_CHECKOUT_SOURCE}\u0000` });
    assert.equal(nul.status, "refused");
    if (nul.status === "refused") {
      assert.equal(nul.reason.code, "APPLY_TEXT_AMBIGUOUS");
    }
  });

  it("rejects an unchanged excerpt when the stored full-file hash no longer matches", async () => {
    const original = `${FAKE_CHECKOUT_SOURCE}${EXTENDED_TAIL}`;
    const proposal = await validProposalWithBaseline(original);
    const changedOutside = original.replace("return 1;", "return 2;");
    const result = plan(proposal, { [CHECKOUT]: changedOutside });
    assert.equal(result.status, "refused");
    if (result.status !== "refused") {
      return;
    }
    assert.equal(result.reason.code, "APPLY_SOURCE_CHANGED");
    assert.equal(proposal.liveFileHashes?.[CHECKOUT], sha256Utf8(original));
  });

  it("accepts a stable file that still matches the stored full-file baseline", async () => {
    const proposal = await validProposalWithBaseline(FAKE_CHECKOUT_SOURCE);
    const result = plan(proposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    assert.equal(proposal.liveFileHashes?.[CHECKOUT], sha256Utf8(FAKE_CHECKOUT_SOURCE));
    assert.equal(result.plan.files[0]?.currentContentHash, sha256Utf8(FAKE_CHECKOUT_SOURCE));
  });

  it("does not invoke filesystem writes or VS Code mutation APIs", async () => {
    const proposal = await validProposal();
    const reads: string[] = [];
    const result = plan(proposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE }, { reads });
    assert.equal(result.status, "ok");
    assert.deepEqual(reads, [CHECKOUT]);

    const plannerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "apply-plan.ts");
    const source = readFileSync(plannerPath, "utf8");
    assert.equal(/\bWorkspaceEdit\b/.test(source), false);
    assert.equal(/workspace\.applyEdit/.test(source), false);
    assert.equal(/\bwriteFile(?:Sync)?\b/.test(source), false);
    assert.equal(/from ["']vscode["']/.test(source), false);
    assert.equal(/fs\.write/.test(source), false);
  });
});

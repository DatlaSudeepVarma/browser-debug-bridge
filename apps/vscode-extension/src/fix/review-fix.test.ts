import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { FAKE_DIAGNOSIS, FakeAiProvider } from "../ai/fake-provider.js";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import { FIXTURE_BUY_NOW_BUTTON } from "../project/test-fixtures/files.js";
import { createProjectIntelligenceSession } from "../project/test-fixtures/session.js";
import { fixtureDiagnosisState, fixtureCanonicalIo } from "./test-support.js";
import { FAKE_CHECKOUT_SOURCE, FAKE_FIX_PROPOSAL, jsonProposal } from "./fake-proposal.js";
import { createMemoryLiveFileReader } from "./live-file.js";
import { ProposedPreviewStore, PROPOSED_PREVIEW_SCHEME } from "./preview-store.js";
import { FixProposalService } from "./proposal.js";
import { publishAndOpenReview } from "./review-open.js";
import { prepareFixReview } from "./review-fix.js";
import type { ProposedFileChange, StoredProposal } from "./types.js";

const CHECKOUT = "src/services/checkout.ts";
const BUTTON = "src/components/BuyNowButton.tsx";
const EXPECTED_AFTER = `export async function submitCheckout(): Promise<Response> {
  return fetch("/api/checkout", { method: "POST" });
}`;
const EXTENDED_TAIL = `\n\nexport function helper() {\n  return 1;\n}`;
const BUTTON_SOURCE = FIXTURE_BUY_NOW_BUTTON.trim();

async function validProposalWithBaseline(
  files: Record<string, string>,
  raw: unknown = FAKE_FIX_PROPOSAL,
  diagnosis = FAKE_DIAGNOSIS,
): Promise<StoredProposal> {
  const result = await new FixProposalService(new FakeAiProvider(jsonProposal(raw)), {
    liveFileReader: createMemoryLiveFileReader(files),
    canonicalIo: fixtureCanonicalIo(),
  }).propose(createProjectIntelligenceSession(), createFixtureAiProjectContext(), diagnosis);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") {
    throw new Error("expected a valid proposal");
  }
  return result.proposal;
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

function review(
  proposal: StoredProposal | undefined,
  files: Record<string, string | undefined>,
  options?: {
    diagnosis?: ReturnType<typeof fixtureDiagnosisState>;
    canonicalIo?: ReturnType<typeof fixtureCanonicalIo>;
    isDirty?: (relativePath: string) => boolean;
  },
) {
  return prepareFixReview({
    proposal,
    diagnosis: options?.diagnosis ?? fixtureDiagnosisState(),
    readLiveFile: (relativePath) => files[relativePath],
    canonicalIo: options?.canonicalIo ?? fixtureCanonicalIo(),
    isDirty: options?.isDirty,
  });
}

describe("native diff review planner", () => {
  it("prepares original and proposed content for a valid proposal", async () => {
    const proposal = await validProposalWithBaseline({ [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    const prepared = review(proposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    assert.equal(prepared.status, "ok");
    if (prepared.status !== "ok") {
      return;
    }
    assert.equal(prepared.files.length, 1);
    assert.equal(prepared.files[0]?.relativePath, CHECKOUT);
    assert.equal(prepared.files[0]?.currentContent, FAKE_CHECKOUT_SOURCE);
    assert.equal(prepared.files[0]?.proposedContent, EXPECTED_AFTER);
    assert.equal(prepared.files[0]?.title.includes("checkout.ts"), true);
    assert.equal(prepared.files[0]?.title.includes("Proposed change"), true);
  });

  it("refuses a missing proposal", () => {
    const prepared = review(undefined, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    assert.equal(prepared.status, "refused");
    if (prepared.status === "refused") {
      assert.equal(prepared.reason.code, "APPLY_NO_PROPOSAL");
    }
  });

  it("refuses review when there is no current diagnosis", async () => {
    const proposal = await validProposalWithBaseline({ [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    const prepared = prepareFixReview({
      proposal,
      diagnosis: undefined,
      readLiveFile: () => FAKE_CHECKOUT_SOURCE,
      canonicalIo: fixtureCanonicalIo(),
    });
    assert.equal(prepared.status, "refused");
    if (prepared.status === "refused") {
      assert.equal(prepared.reason.code, "REVIEW_NO_DIAGNOSIS");
    }
  });

  it("refuses a proposal that belongs to an old diagnosis", async () => {
    const proposal = await validProposalWithBaseline({ [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    const prepared = review(proposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE }, {
      diagnosis: fixtureDiagnosisState({ ...FAKE_DIAGNOSIS, summary: "A different diagnosis." }),
    });
    assert.equal(prepared.status, "refused");
    if (prepared.status === "refused") {
      assert.equal(prepared.reason.code, "APPLY_DIAGNOSIS_MISMATCH");
    }
  });

  it("refuses a changed full-file baseline even when the excerpt is unchanged", async () => {
    const original = `${FAKE_CHECKOUT_SOURCE}${EXTENDED_TAIL}`;
    const proposal = await validProposalWithBaseline({ [CHECKOUT]: original });
    const changedOutside = original.replace("return 1;", "return 2;");
    const prepared = review(proposal, { [CHECKOUT]: changedOutside });
    assert.equal(prepared.status, "refused");
    if (prepared.status === "refused") {
      assert.equal(prepared.reason.code, "APPLY_SOURCE_CHANGED");
    }
  });

  it("refuses a missing or unreadable target", async () => {
    const proposal = await validProposalWithBaseline({ [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    const prepared = review(proposal, {});
    assert.equal(prepared.status, "refused");
    if (prepared.status === "refused") {
      assert.equal(prepared.reason.code, "APPLY_FILE_MISSING");
    }
  });

  it("refuses path traversal and canonical-path failures", async () => {
    const proposal = await validProposalWithBaseline({ [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    const traversal = review(
      withFirstChange(proposal, (change) => ({ ...change, relativePath: "../../secret.ts" })),
      { "../../secret.ts": "secret" },
    );
    assert.equal(traversal.status, "refused");
    if (traversal.status === "refused") {
      assert.equal(traversal.reason.code, "APPLY_PATH_REJECTED");
    }

    const canonical = review(proposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE }, {
      canonicalIo: fixtureCanonicalIo({
        realpathOverrides: { "/workspace/shop/src/services/checkout.ts": "/etc/passwd" },
      }),
    });
    assert.equal(canonical.status, "refused");
    if (canonical.status === "refused") {
      assert.equal(canonical.reason.code, "APPLY_CANONICAL_REJECTED");
    }
  });

  it("refuses a dirty unsaved editor buffer instead of previewing disk content", async () => {
    const proposal = await validProposalWithBaseline({ [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    const prepared = review(proposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE }, {
      isDirty: (relativePath) => relativePath === CHECKOUT,
    });
    assert.equal(prepared.status, "refused");
    if (prepared.status === "refused") {
      assert.equal(prepared.reason.code, "REVIEW_SOURCE_DIRTY");
    }
  });

  it("opens mocked diffs with the expected original and proposed content", async () => {
    const proposal = await validProposalWithBaseline({ [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    const prepared = review(proposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    assert.equal(prepared.status, "ok");
    if (prepared.status !== "ok") {
      return;
    }
    const store = new ProposedPreviewStore(() => "preview-1");
    const opened: { original: string; proposedUri: string; title: string }[] = [];
    const result = await publishAndOpenReview(prepared, store, {
      async openDiff(original, proposedUri, title) {
        opened.push({ original: original.relativePath, proposedUri, title });
        return true;
      },
    });
    assert.equal(result.status, "opened");
    assert.equal(opened.length, 1);
    assert.equal(opened[0]?.original, CHECKOUT);
    assert.equal(store.provide(opened[0]?.proposedUri ?? ""), EXPECTED_AFTER);
    assert.equal(opened[0]?.proposedUri.startsWith(`${PROPOSED_PREVIEW_SCHEME}:`), true);
  });
});

describe("proposed preview store", () => {
  it("resolves distinct virtual URIs to the correct contents for multiple files", async () => {
    const diagnosis = {
      ...FAKE_DIAGNOSIS,
      hypotheses: [
        {
          title: "Two files",
          explanation: "Inspect both candidates.",
          evidence: FAKE_DIAGNOSIS.hypotheses[0]?.evidence ?? [],
          candidateFiles: [
            { relativePath: CHECKOUT, reason: "service" },
            { relativePath: BUTTON, reason: "button" },
          ],
        },
      ],
    };
    const raw = {
      summary: "Update checkout and the button.",
      rationale: "Bounded fixture edits for a two-file review.",
      changes: [
        FAKE_FIX_PROPOSAL.changes[0],
        {
          relativePath: BUTTON,
          edits: [{ startLine: 1, endLine: 1, replacement: "export function BuyNowButton(): void {" }],
        },
      ],
    };
    const proposal = await validProposalWithBaseline(
      { [CHECKOUT]: FAKE_CHECKOUT_SOURCE, [BUTTON]: BUTTON_SOURCE },
      raw,
      diagnosis,
    );
    const prepared = review(
      proposal,
      { [CHECKOUT]: FAKE_CHECKOUT_SOURCE, [BUTTON]: BUTTON_SOURCE },
      { diagnosis: fixtureDiagnosisState(diagnosis) },
    );
    assert.equal(prepared.status, "ok");
    if (prepared.status !== "ok") {
      return;
    }
    assert.equal(prepared.files.length, 2);
    const store = new ProposedPreviewStore(() => "multi");
    const uris: string[] = [];
    const result = await publishAndOpenReview(prepared, store, {
      async openDiff(_original, proposedUri) {
        uris.push(proposedUri);
        return true;
      },
    });
    assert.equal(result.status, "opened");
    assert.equal(uris.length, 2);
    assert.notEqual(uris[0], uris[1]);
    assert.equal(store.provide(uris[0] ?? ""), prepared.files[0]?.proposedContent);
    assert.equal(store.provide(uris[1] ?? ""), prepared.files[1]?.proposedContent);
    assert.notEqual(store.provide(uris[0] ?? ""), store.provide(uris[1] ?? ""));
    assert.equal(store.provide("/p/multi/0"), prepared.files[0]?.proposedContent);
    assert.equal(store.provide("/p/multi/1"), prepared.files[1]?.proposedContent);
  });

  it("does not put file contents in virtual URI strings", async () => {
    const proposal = await validProposalWithBaseline({ [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    const prepared = review(proposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    assert.equal(prepared.status, "ok");
    if (prepared.status !== "ok") {
      return;
    }
    const store = new ProposedPreviewStore(() => "opaque");
    const result = await publishAndOpenReview(prepared, store, {
      async openDiff() {
        return true;
      },
    });
    assert.equal(result.status, "opened");
    const uri = result.documents[0]?.uri ?? "";
    assert.equal(uri.includes(FAKE_CHECKOUT_SOURCE), false);
    assert.equal(uri.includes(EXPECTED_AFTER), false);
    assert.equal(uri.includes("fetch("), false);
    assert.equal(uri.includes(proposal.identity.sourceFingerprint), false);
    assert.equal(uri.startsWith(`${PROPOSED_PREVIEW_SCHEME}:/p/`), true);
  });

  it("cannot reuse stale virtual content after the proposal is invalidated", async () => {
    const proposal = await validProposalWithBaseline({ [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    const prepared = review(proposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    assert.equal(prepared.status, "ok");
    if (prepared.status !== "ok") {
      return;
    }
    const store = new ProposedPreviewStore(() => "stale");
    const result = await publishAndOpenReview(prepared, store, {
      async openDiff() {
        return true;
      },
    });
    assert.equal(result.status, "opened");
    const uri = result.documents[0]?.uri ?? "";
    assert.equal(store.provide(uri), EXPECTED_AFTER);
    store.clear();
    assert.equal(store.provide(uri), undefined);
  });

  it("reports a failed diff opening without claiming success and clears preview data", async () => {
    const proposal = await validProposalWithBaseline({ [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    const prepared = review(proposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    assert.equal(prepared.status, "ok");
    if (prepared.status !== "ok") {
      return;
    }
    const store = new ProposedPreviewStore(() => "fail");
    const result = await publishAndOpenReview(prepared, store, {
      async openDiff() {
        return false;
      },
    });
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.equal(result.opened, 0);
    }
    assert.equal(store.provide(result.documents[0]?.uri ?? ""), undefined);
  });

  it("clears retained preview data on dispose", async () => {
    const proposal = await validProposalWithBaseline({ [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    const prepared = review(proposal, { [CHECKOUT]: FAKE_CHECKOUT_SOURCE });
    assert.equal(prepared.status, "ok");
    if (prepared.status !== "ok") {
      return;
    }
    const store = new ProposedPreviewStore(() => "dispose");
    const result = await publishAndOpenReview(prepared, store, {
      async openDiff() {
        return true;
      },
    });
    const uri = result.status === "opened" ? result.documents[0]?.uri : undefined;
    assert.equal(typeof uri, "string");
    store.dispose();
    assert.equal(store.provide(uri ?? ""), undefined);
  });

  it("does not invoke workspace writes or apply-edit APIs", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    for (const fileName of ["review-fix.ts", "preview-store.ts", "review-open.ts"]) {
      const source = readFileSync(path.join(root, fileName), "utf8");
      assert.equal(/\bWorkspaceEdit\b/.test(source), false);
      assert.equal(/workspace\.applyEdit/.test(source), false);
      assert.equal(/\bwriteFile(?:Sync)?\b/.test(source), false);
      assert.equal(/from ["']vscode["']/.test(source), false);
    }
    const adapter = readFileSync(path.join(root, "../ui/review-diff.ts"), "utf8");
    assert.equal(/\bWorkspaceEdit\b/.test(adapter), false);
    assert.equal(/workspace\.applyEdit/.test(adapter), false);
    assert.equal(/fs\.writeFile/.test(adapter), false);
    assert.equal(adapter.includes("vscode.diff"), true);
    const extension = readFileSync(path.join(root, "../extension.ts"), "utf8");
    assert.equal(extension.includes("registerProposedPreviewProvider(previewStore)"), true);
    assert.equal(extension.includes("previewStore.dispose()"), true);
    assert.equal(/workspace\.applyEdit/.test(extension), false);
    assert.equal(/fs\.writeFile/.test(extension), false);
  });
});

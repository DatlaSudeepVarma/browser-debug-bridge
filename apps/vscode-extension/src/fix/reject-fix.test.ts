import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { FAKE_DIAGNOSIS, FakeAiProvider } from "../ai/fake-provider.js";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import { createProjectIntelligenceSession } from "../project/test-fixtures/session.js";
import { DiagnosisController } from "../ui/diagnosis-state.js";
import { collectTreeNodes } from "../ui/diagnosis-tree.js";
import { rejectFixLogLines, rejectFixUserNotice } from "../ui/notifications.js";
import { FAKE_CHECKOUT_SOURCE, FAKE_FIX_PROPOSAL, jsonProposal } from "./fake-proposal.js";
import { createMemoryLiveFileReader } from "./live-file.js";
import { ProposedPreviewStore, proposalPreviewOwner } from "./preview-store.js";
import { FixProposalService } from "./proposal.js";
import { FixProposalController } from "./proposal-state.js";
import { rejectFixProposal } from "./reject-fix.js";
import { prepareFixReview } from "./review-fix.js";
import { publishAndOpenReview, type OpenReviewResult } from "./review-open.js";
import { fixtureCanonicalIo, fixtureDiagnosisState } from "./test-support.js";
import type { StoredProposal } from "./types.js";

const CHECKOUT = "src/services/checkout.ts";
const EXPECTED_AFTER = `export async function submitCheckout(): Promise<Response> {
  return fetch("/api/checkout", { method: "POST" });
}`;

async function validProposal(): Promise<StoredProposal> {
  const result = await new FixProposalService(new FakeAiProvider(jsonProposal(FAKE_FIX_PROPOSAL)), {
    liveFileReader: createMemoryLiveFileReader({ [CHECKOUT]: FAKE_CHECKOUT_SOURCE }),
    canonicalIo: fixtureCanonicalIo(),
  }).propose(createProjectIntelligenceSession(), createFixtureAiProjectContext(), FAKE_DIAGNOSIS);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") {
    throw new Error("expected a valid proposal");
  }
  return result.proposal;
}

async function openReview(proposal: StoredProposal, store: ProposedPreviewStore): Promise<OpenReviewResult> {
  const prepared = prepareFixReview({
    proposal,
    diagnosis: fixtureDiagnosisState(),
    readLiveFile: (relativePath) => (relativePath === CHECKOUT ? FAKE_CHECKOUT_SOURCE : undefined),
    canonicalIo: fixtureCanonicalIo(),
  });
  assert.equal(prepared.status, "ok");
  if (prepared.status !== "ok") {
    throw new Error("expected review to be prepared");
  }
  return publishAndOpenReview(
    prepared,
    store,
    {
      async openDiff() {
        return true;
      },
    },
    proposalPreviewOwner(proposal),
  );
}

describe("explicit reject", () => {
  it("rejects an existing proposal and clears it", async () => {
    const controller = new FixProposalController();
    const store = new ProposedPreviewStore();
    const proposal = await validProposal();
    controller.applySuccess(proposal);

    const outcome = rejectFixProposal(controller, store, controller.getProposal());
    assert.equal(outcome.status, "rejected");
    assert.equal(controller.getProposal(), undefined);
    assert.equal(controller.getTreeState().lastOutcome, "rejected");
    assert.equal(rejectFixUserNotice(outcome).kind, "info");
  });

  it("does not report success when there is no proposal", () => {
    const controller = new FixProposalController();
    const store = new ProposedPreviewStore();
    const outcome = rejectFixProposal(controller, store, undefined);
    assert.equal(outcome.status, "no-proposal");
    assert.equal(controller.getTreeState().lastOutcome, "none");
    assert.equal(rejectFixUserNotice(outcome).kind, "warn");
    assert.equal(rejectFixLogLines(outcome).some((line) => line.includes("rejected")), false);
  });

  it("does not clear the diagnosis", async () => {
    const diagnosis = new DiagnosisController();
    const state = fixtureDiagnosisState();
    diagnosis.setDiagnosis(state);
    const generation = diagnosis.getGeneration();
    const controller = new FixProposalController();
    controller.applySuccess(await validProposal());

    const outcome = rejectFixProposal(controller, new ProposedPreviewStore(), controller.getProposal());
    assert.equal(outcome.status, "rejected");
    assert.equal(diagnosis.getDiagnosis()?.diagnosis.summary, state.diagnosis.summary);
    assert.equal(diagnosis.getGeneration(), generation);
  });

  it("clears the corresponding virtual preview and old URIs stop resolving", async () => {
    const controller = new FixProposalController();
    const store = new ProposedPreviewStore(() => "reject-me");
    const proposal = await validProposal();
    controller.applySuccess(proposal);
    const opened = await openReview(proposal, store);
    assert.equal(opened.status, "opened");
    const uri = opened.documents[0]?.uri ?? "";
    assert.equal(store.provide(uri), EXPECTED_AFTER);
    assert.equal(store.currentOwner(), proposalPreviewOwner(proposal));

    const clearedUris: string[][] = [];
    store.onDidClear((uris) => clearedUris.push([...uris]));

    const outcome = rejectFixProposal(controller, store, controller.getProposal());
    assert.equal(outcome.status, "rejected");
    if (outcome.status === "rejected") {
      assert.equal(outcome.previewCleared, true);
    }
    assert.equal(store.provide(uri), undefined);
    assert.equal(store.provide("/p/reject-me/0"), undefined);
    assert.equal(store.hasPreview(), false);
    assert.equal(store.currentOwner(), undefined);
    assert.deepEqual(clearedUris, [[uri]]);
  });

  it("lets a subsequent new proposal be reviewed normally", async () => {
    const controller = new FixProposalController();
    let id = 0;
    const store = new ProposedPreviewStore(() => `p${String(++id)}`);
    const first = await validProposal();
    controller.applySuccess(first);
    const firstOpen = await openReview(first, store);
    assert.equal(firstOpen.status, "opened");
    const firstUri = firstOpen.documents[0]?.uri ?? "";

    assert.equal(rejectFixProposal(controller, store, controller.getProposal()).status, "rejected");

    const second = await validProposal();
    controller.applySuccess(second);
    assert.equal(controller.getTreeState().lastOutcome, "none");
    const secondOpen = await openReview(second, store);
    assert.equal(secondOpen.status, "opened");
    const secondUri = secondOpen.documents[0]?.uri ?? "";
    assert.notEqual(secondUri, firstUri);
    assert.equal(store.provide(secondUri), EXPECTED_AFTER);
    assert.equal(store.provide(firstUri), undefined);
  });

  it("refuses a stale reject so a newer proposal survives", async () => {
    const controller = new FixProposalController();
    const store = new ProposedPreviewStore(() => "newer");
    const older = await validProposal();
    controller.applySuccess(older);
    const observed = controller.getProposal();

    const newer = await validProposal();
    controller.applySuccess(newer);
    const opened = await openReview(newer, store);
    assert.equal(opened.status, "opened");
    const newerUri = opened.documents[0]?.uri ?? "";

    const outcome = rejectFixProposal(controller, store, observed);
    assert.equal(outcome.status, "stale");
    assert.equal(controller.getProposal(), newer);
    assert.equal(controller.getTreeState().lastOutcome, "none");
    assert.equal(store.provide(newerUri), EXPECTED_AFTER);
    assert.equal(rejectFixUserNotice(outcome).kind, "warn");
  });

  it("clears an orphaned preview even if its owner tag differs", async () => {
    const controller = new FixProposalController();
    const store = new ProposedPreviewStore(() => "orphan");
    const proposal = await validProposal();
    controller.applySuccess(proposal);
    const prepared = prepareFixReview({
      proposal,
      diagnosis: fixtureDiagnosisState(),
      readLiveFile: () => FAKE_CHECKOUT_SOURCE,
      canonicalIo: fixtureCanonicalIo(),
    });
    assert.equal(prepared.status, "ok");
    if (prepared.status !== "ok") {
      return;
    }
    const documents = store.beginPreview(prepared.files, "some-other-owner");
    const outcome = rejectFixProposal(controller, store, controller.getProposal());
    assert.equal(outcome.status, "rejected");
    if (outcome.status === "rejected") {
      assert.equal(outcome.previewCleared, false);
    }
    assert.equal(store.provide(documents[0]?.uri ?? ""), undefined);
  });

  it("removes the ready-for-review node from the tree after rejection", async () => {
    const controller = new FixProposalController();
    controller.applySuccess(await validProposal());
    const before = collectTreeNodes(fixtureDiagnosisState(), controller.getTreeState());
    assert.equal(before.some((node) => node.kind === "proposal-diff"), true);

    assert.equal(
      rejectFixProposal(controller, new ProposedPreviewStore(), controller.getProposal()).status,
      "rejected",
    );
    const after = collectTreeNodes(fixtureDiagnosisState(), controller.getTreeState());
    assert.equal(after.some((node) => node.kind === "proposal-diff"), false);
    assert.equal(after.some((node) => node.kind === "proposal-files"), false);
    assert.equal(
      after.some((node) => node.kind === "proposal-status" && node.label === "Status: Rejected"),
      true,
    );
    assert.equal(after.some((node) => node.kind === "summary"), true);
  });

  it("performs no workspace writes or apply-edit operations", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    for (const fileName of ["reject-fix.ts", "proposal-state.ts", "preview-store.ts"]) {
      const source = readFileSync(path.join(root, fileName), "utf8");
      assert.equal(/\bWorkspaceEdit\b/.test(source), false);
      assert.equal(/workspace\.applyEdit/.test(source), false);
      assert.equal(/\bwriteFile(?:Sync)?\b/.test(source), false);
      assert.equal(/from ["']node:fs["']/.test(source), false);
      assert.equal(/from ["']vscode["']/.test(source), false);
    }
    for (const fileName of ["../ui/review-diff.ts", "../extension.ts"]) {
      const source = readFileSync(path.join(root, fileName), "utf8");
      assert.equal(/\bWorkspaceEdit\b/.test(source), false);
      assert.equal(/workspace\.applyEdit/.test(source), false);
      assert.equal(/fs\.writeFile/.test(source), false);
    }
    const extension = readFileSync(path.join(root, "../extension.ts"), "utf8");
    assert.equal(extension.includes("registerCommand(REJECT_FIX_COMMAND"), true);
    assert.equal(extension.includes("rejectFixProposal(proposalController, previewStore"), true);
  });
});

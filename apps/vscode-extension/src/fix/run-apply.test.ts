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
import { applyConfirmMessage } from "../ui/messages.js";
import { applyFixUserNotice } from "../ui/notifications.js";
import { runDiagnosis } from "../ui/run-diagnosis.js";
import { FAKE_CHECKOUT_SOURCE, FAKE_FIX_PROPOSAL, jsonProposal } from "./fake-proposal.js";
import { sha256Utf8 } from "./hash.js";
import { createMemoryLiveFileReader } from "./live-file.js";
import { ProposedPreviewStore, proposalPreviewOwner } from "./preview-store.js";
import { FixProposalService } from "./proposal.js";
import { FixProposalController } from "./proposal-state.js";
import { rejectFixProposal } from "./reject-fix.js";
import { runApplyFix, type RunApplyFixInput, type WorkspaceWriteResult } from "./run-apply.js";
import { fixtureCanonicalIo, fixtureDiagnosisState } from "./test-support.js";
import type { SafeApplyPlan, StoredProposal } from "./types.js";

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

function harness(options?: {
  proposal?: StoredProposal;
  files?: Record<string, string | undefined>;
  dirty?: Set<string>;
  confirm?: (fileCount: number) => Promise<boolean>;
  write?: (plan: SafeApplyPlan) => Promise<WorkspaceWriteResult>;
  diagnosis?: ReturnType<typeof fixtureDiagnosisState> | undefined;
  diagnosisRunning?: boolean;
  generation?: number;
}) {
  const controller = new FixProposalController();
  if (options?.proposal !== undefined) {
    controller.applySuccess(options.proposal);
  }
  const files = { ...(options?.files ?? { [CHECKOUT]: FAKE_CHECKOUT_SOURCE }) };
  const store = new ProposedPreviewStore(() => "apply-preview");
  const calls: SafeApplyPlan[] = [];
  let generation = options?.generation ?? 1;
  const input: RunApplyFixInput = {
    proposalController: controller,
    previewStore: store,
    getDiagnosis: () => (options && "diagnosis" in options ? options.diagnosis : fixtureDiagnosisState()),
    getDiagnosisGeneration: () => generation,
    isDiagnosisRunning: () => options?.diagnosisRunning === true,
    readLiveFiles: async () => ({ ...files }),
    dirtyPaths: () => options?.dirty ?? new Set<string>(),
    canonicalIo: fixtureCanonicalIo(),
    confirm: options?.confirm ?? (async () => true),
    write: async (plan) => {
      calls.push(plan);
      if (options?.write !== undefined) {
        return options.write(plan);
      }
      for (const file of plan.files) {
        files[file.relativePath] = file.proposedContent;
      }
      return { status: "applied" };
    },
  };
  return {
    controller,
    store,
    files,
    calls,
    input,
    setGeneration(next: number) {
      generation = next;
    },
  };
}

describe("explicit apply", () => {
  it("writes the planned after-image, clears the proposal, and keeps the diagnosis", async () => {
    const proposal = await validProposal();
    const diagnosis = new DiagnosisController();
    const state = fixtureDiagnosisState();
    diagnosis.setDiagnosis(state);
    const generation = diagnosis.getGeneration();
    const { controller, store, files, calls, input } = harness({ proposal });
    input.getDiagnosis = () => diagnosis.getDiagnosis();
    input.getDiagnosisGeneration = () => diagnosis.getGeneration();
    input.isDiagnosisRunning = () => diagnosis.isRunning();
    const documents = store.beginPreview(
      [
        {
          relativePath: CHECKOUT,
          workspaceRoot: "/workspace/shop",
          currentContent: FAKE_CHECKOUT_SOURCE,
          proposedContent: EXPECTED_AFTER,
          title: "checkout.ts (Proposed change)",
        },
      ],
      proposalPreviewOwner(proposal),
    );
    const previewUri = documents[0]?.uri ?? "";
    assert.equal(store.hasPreview(), true);

    const outcome = await runApplyFix(input);
    assert.equal(outcome.status, "applied");
    if (outcome.status === "applied") {
      assert.equal(outcome.fileCount, 1);
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.files[0]?.relativePath, CHECKOUT);
    assert.equal(calls[0]?.files[0]?.currentContent, FAKE_CHECKOUT_SOURCE);
    assert.equal(calls[0]?.files[0]?.proposedContent, EXPECTED_AFTER);
    assert.equal(files[CHECKOUT], EXPECTED_AFTER);
    assert.equal(sha256Utf8(files[CHECKOUT] ?? ""), calls[0]?.files[0]?.proposedContentHash);
    assert.equal(controller.getProposal(), undefined);
    assert.equal(controller.getTreeState().lastOutcome, "applied");
    assert.equal(controller.isApplying(), false);
    assert.equal(diagnosis.getDiagnosis()?.diagnosis.summary, state.diagnosis.summary);
    assert.equal(diagnosis.getGeneration(), generation);
    assert.equal(store.hasPreview(), false);
    assert.equal(store.provide(previewUri), undefined);
    const nodes = collectTreeNodes(state, controller.getTreeState());
    assert.equal(nodes.some((node) => node.kind === "proposal-diff"), false);
    assert.equal(
      nodes.some((node) => node.kind === "proposal-status" && node.label === "Status: Applied"),
      true,
    );
    assert.equal(applyFixUserNotice(outcome).kind, "info");
  });

  it("does not report success when there is no proposal", async () => {
    const { calls, input } = harness();
    const outcome = await runApplyFix(input);
    assert.equal(outcome.status, "no-proposal");
    assert.equal(calls.length, 0);
    assert.equal(applyFixUserNotice(outcome).kind, "warn");
  });

  it("refuses a proposal for an old diagnosis without writing", async () => {
    const proposal = await validProposal();
    const { controller, calls, files, input } = harness({
      proposal,
      diagnosis: fixtureDiagnosisState({ ...FAKE_DIAGNOSIS, summary: "A different diagnosis." }),
    });
    const outcome = await runApplyFix(input);
    assert.equal(outcome.status, "refused");
    if (outcome.status === "refused") {
      assert.equal(outcome.reason.code, "APPLY_DIAGNOSIS_MISMATCH");
    }
    assert.equal(calls.length, 0);
    assert.equal(files[CHECKOUT], FAKE_CHECKOUT_SOURCE);
    assert.equal(controller.getProposal(), proposal);
  });

  it("refuses a changed full-file baseline without writing", async () => {
    const original = `${FAKE_CHECKOUT_SOURCE}\n\nexport function helper() {\n  return 1;\n}`;
    const result = await new FixProposalService(new FakeAiProvider(jsonProposal(FAKE_FIX_PROPOSAL)), {
      liveFileReader: createMemoryLiveFileReader({ [CHECKOUT]: original }),
      canonicalIo: fixtureCanonicalIo(),
    }).propose(createProjectIntelligenceSession(), createFixtureAiProjectContext(), FAKE_DIAGNOSIS);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") {
      return;
    }
    const { calls, input } = harness({
      proposal: result.proposal,
      files: { [CHECKOUT]: original.replace("return 1;", "return 2;") },
    });
    const outcome = await runApplyFix(input);
    assert.equal(outcome.status, "refused");
    if (outcome.status === "refused") {
      assert.equal(outcome.reason.code, "APPLY_SOURCE_CHANGED");
    }
    assert.equal(calls.length, 0);
  });

  it("refuses a missing target and a traversal path without writing", async () => {
    const proposal = await validProposal();
    const missing = harness({ proposal, files: {} });
    const missingOutcome = await runApplyFix(missing.input);
    assert.equal(missingOutcome.status, "refused");
    if (missingOutcome.status === "refused") {
      assert.equal(missingOutcome.reason.code, "APPLY_FILE_MISSING");
    }
    assert.equal(missing.calls.length, 0);

    const traversal = harness({
      proposal: {
        ...proposal,
        proposedChange: {
          ...proposal.proposedChange,
          changes: proposal.proposedChange.changes.map((change, index) =>
            index === 0 ? { ...change, relativePath: "../../secret.ts" } : change,
          ),
        },
      },
    });
    const traversalOutcome = await runApplyFix(traversal.input);
    assert.equal(traversalOutcome.status, "refused");
    if (traversalOutcome.status === "refused") {
      assert.equal(traversalOutcome.reason.code, "APPLY_PATH_REJECTED");
    }
    assert.equal(traversal.calls.length, 0);
  });

  it("refuses a dirty buffer without writing", async () => {
    const proposal = await validProposal();
    const { calls, files, input } = harness({ proposal, dirty: new Set([CHECKOUT]) });
    const outcome = await runApplyFix(input);
    assert.equal(outcome.status, "refused");
    if (outcome.status === "refused") {
      assert.equal(outcome.reason.code, "REVIEW_SOURCE_DIRTY");
    }
    assert.equal(calls.length, 0);
    assert.equal(files[CHECKOUT], FAKE_CHECKOUT_SOURCE);
  });

  it("leaves the proposal in place when the developer declines", async () => {
    const proposal = await validProposal();
    const { controller, calls, files, input } = harness({ proposal, confirm: async () => false });
    const outcome = await runApplyFix(input);
    assert.equal(outcome.status, "declined");
    assert.equal(calls.length, 0);
    assert.equal(files[CHECKOUT], FAKE_CHECKOUT_SOURCE);
    assert.equal(controller.getProposal(), proposal);
    assert.equal(controller.isApplying(), false);
  });

  it("does not claim success when the workspace edit is refused or does not verify", async () => {
    const proposal = await validProposal();
    const refused = harness({ proposal, write: async () => ({ status: "not-applied" }) });
    const refusedOutcome = await runApplyFix(refused.input);
    assert.equal(refusedOutcome.status, "write-failed");
    if (refusedOutcome.status === "write-failed") {
      assert.equal(refusedOutcome.detail, "not-applied");
    }
    assert.equal(refused.controller.getProposal(), proposal);
    assert.equal(refused.files[CHECKOUT], FAKE_CHECKOUT_SOURCE);
    assert.equal(applyFixUserNotice(refusedOutcome).message.includes("not applied"), true);

    const unsaved = harness({ proposal, write: async () => ({ status: "unsaved" }) });
    assert.equal((await runApplyFix(unsaved.input)).status, "write-failed");
    assert.equal(unsaved.controller.getProposal(), proposal);

    const mismatch = harness({
      proposal,
      write: async () => ({ status: "applied" }),
    });
    const mismatchOutcome = await runApplyFix(mismatch.input);
    assert.equal(mismatchOutcome.status, "write-failed");
    if (mismatchOutcome.status === "write-failed") {
      assert.equal(mismatchOutcome.detail, "verify");
    }
    assert.equal(mismatch.controller.getProposal(), proposal);
  });

  it("does not write when the file changes after confirmation", async () => {
    const proposal = await validProposal();
    let reads = 0;
    const { calls, files, input } = harness({ proposal });
    input.readLiveFiles = async () => {
      reads += 1;
      if (reads === 1) {
        return { [CHECKOUT]: FAKE_CHECKOUT_SOURCE };
      }
      return { [CHECKOUT]: `${FAKE_CHECKOUT_SOURCE}\nexport const changed = true;\n` };
    };
    const outcome = await runApplyFix(input);
    assert.equal(outcome.status, "refused");
    if (outcome.status === "refused") {
      assert.equal(outcome.reason.code, "APPLY_SOURCE_CHANGED");
    }
    assert.equal(calls.length, 0);
    assert.equal(files[CHECKOUT], FAKE_CHECKOUT_SOURCE);
  });

  it("does not write a stale proposal or a changed diagnosis", async () => {
    const proposal = await validProposal();
    const replaced = harness({
      proposal,
      confirm: async () => {
        replaced.controller.applySuccess(await validProposal());
        return true;
      },
    });
    const replacedOutcome = await runApplyFix(replaced.input);
    assert.equal(replacedOutcome.status, "stale");
    assert.equal(replaced.calls.length, 0);
    assert.notEqual(replaced.controller.getProposal(), undefined);

    const proposalAgain = await validProposal();
    const moved = harness({
      proposal: proposalAgain,
      confirm: async () => {
        moved.setGeneration(99);
        return true;
      },
    });
    const movedOutcome = await runApplyFix(moved.input);
    assert.equal(movedOutcome.status, "stale");
    assert.equal(moved.calls.length, 0);
    assert.equal(moved.controller.getProposal(), proposalAgain);
  });

  it("blocks a second apply, a proposal run, a diagnosis, and reject while applying", async () => {
    const proposal = await validProposal();
    let release: (value: boolean) => void = () => undefined;
    const { controller, calls, input } = harness({
      proposal,
      confirm: () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    });
    const running = runApplyFix(input);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    assert.equal(controller.isApplying(), true);
    assert.equal(controller.beginApply(), false);
    assert.equal(controller.beginRun(), false);
    const diagnosis = new DiagnosisController();
    const diagnosed = await runDiagnosis(
      diagnosis,
      {
        getLatestSession: () => createProjectIntelligenceSession(),
        analyze: async () => ({ status: "ok", context: createFixtureAiProjectContext() }),
        diagnose: async () => ({
          status: "ok",
          diagnosis: FAKE_DIAGNOSIS,
          providerId: "fake",
          warnings: [],
          contextChars: 1,
          candidateCount: 1,
        }),
      },
      { allowCreateSession: false, proposalController: controller },
    );
    assert.equal(diagnosed.status, "busy");
    assert.equal(rejectFixProposal(controller, new ProposedPreviewStore(), controller.getProposal()).status, "busy");
    assert.equal(controller.getProposal(), proposal);
    release(false);
    assert.equal((await running).status, "declined");
    assert.equal(calls.length, 0);
    assert.equal(controller.isApplying(), false);
  });

  it("discards an in-flight diagnosis that finishes during apply", async () => {
    const proposal = await validProposal();
    const proposals = new FixProposalController();
    proposals.applySuccess(proposal);
    const diagnosis = new DiagnosisController();
    let release: () => void = () => undefined;
    const running = runDiagnosis(
      diagnosis,
      {
        getLatestSession: () => createProjectIntelligenceSession(),
        analyze: async () => ({ status: "ok", context: createFixtureAiProjectContext() }),
        diagnose: () =>
          new Promise((resolve) => {
            release = () => {
              resolve({
                status: "ok",
                diagnosis: { ...FAKE_DIAGNOSIS, summary: "newer" },
                providerId: "fake",
                warnings: [],
                contextChars: 1,
                candidateCount: 1,
              });
            };
          }),
      },
      { allowCreateSession: false, proposalController: proposals },
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    assert.equal(proposals.beginApply(), true);
    release();
    const outcome = await running;
    assert.equal(outcome.status, "discarded");
    assert.equal(diagnosis.getDiagnosis(), undefined);
    assert.equal(proposals.getProposal(), proposal);
    proposals.endApply();
  });

  it("keeps a newer proposal when the write lands after the proposal was replaced", async () => {
    const proposal = await validProposal();
    const newer = await validProposal();
    const { controller, input } = harness({ proposal });
    let reads = 0;
    input.readLiveFiles = async () => {
      reads += 1;
      return { [CHECKOUT]: reads < 3 ? FAKE_CHECKOUT_SOURCE : EXPECTED_AFTER };
    };
    input.write = async () => {
      controller.applySuccess(newer);
      return { status: "applied" };
    };
    const outcome = await runApplyFix(input);
    assert.equal(outcome.status, "stale-after-write");
    assert.equal(controller.getProposal(), newer);
    assert.equal(controller.getTreeState().lastOutcome, "none");
  });

  it("does not put source text in the confirm prompt and does not write from the planner module", () => {
    const message = applyConfirmMessage(2);
    assert.equal(message.includes("2 files"), true);
    assert.equal(message.includes(FAKE_CHECKOUT_SOURCE), false);
    assert.equal(message.includes("fetch("), false);
    const root = path.dirname(fileURLToPath(import.meta.url));
    const runner = readFileSync(path.join(root, "run-apply.ts"), "utf8");
    assert.equal(/from ["']vscode["']/.test(runner), false);
    assert.equal(/workspace\.applyEdit/.test(runner), false);
    assert.equal(/\bwriteFile(?:Sync)?\b/.test(runner), false);
    const adapter = readFileSync(path.join(root, "../ui/apply-edit.ts"), "utf8");
    assert.equal(adapter.includes("workspace.applyEdit"), true);
    assert.equal(/fs\.writeFile/.test(adapter), false);
    assert.equal(/\bWorkspaceEdit\b/.test(adapter), true);
    const extension = readFileSync(path.join(root, "../extension.ts"), "utf8");
    assert.equal(extension.includes("registerCommand(APPLY_FIX_COMMAND"), true);
    assert.equal(/workspace\.applyEdit/.test(extension), false);
    assert.equal(/fs\.writeFile/.test(extension), false);
  });
});

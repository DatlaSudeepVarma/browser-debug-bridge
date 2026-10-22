import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeDebugSessionV1 } from "@browser-debug-bridge/schema";
import type { Diagnosis } from "../ai/types.js";
import { FAKE_DIAGNOSIS } from "../ai/fake-provider.js";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import { FIXTURE_CHECKOUT_SERVICE } from "../project/test-fixtures/files.js";
import type { DiagnosisViewState } from "./diagnosis-state.js";
import { OPEN_CANDIDATE_COMMAND, REVIEW_FIX_COMMAND } from "./constants.js";
import {
  collectTreeNodes,
  getChildNodes,
  getRootNodes,
  openableRelativePath,
  treeItemCommand,
  type DiagnosisTreeNode,
} from "./diagnosis-tree.js";
import { asPlainTreeText } from "./plain-text.js";

function viewState(diagnosis: Diagnosis = FAKE_DIAGNOSIS): DiagnosisViewState {
  return {
    diagnosis,
    project: createFixtureAiProjectContext(),
    session: createFakeDebugSessionV1(),
    providerId: "fake",
    warnings: [],
  };
}

function kinds(nodes: DiagnosisTreeNode[]): string[] {
  return nodes.map((node) => node.kind);
}

describe("diagnosis tree construction", () => {
  it("is empty when there is no diagnosis", () => {
    assert.deepEqual(getRootNodes(undefined), []);
  });

  it("shows summary, hypotheses, next step, evidence, and limitations", () => {
    const state = viewState();
    const roots = getRootNodes(state);
    assert.deepEqual(kinds(roots), [
      "summary",
      "hypotheses",
      "suggested-next-step",
      "evidence",
      "limitations",
      "proposed-fix",
    ]);
    assert.equal(roots[0]?.label, asPlainTreeText(FAKE_DIAGNOSIS.summary));
    const nodes = collectTreeNodes(state);
    assert.equal(nodes.some((node) => node.kind === "hypothesis" && node.label === "Checkout API failure"), true);
    assert.equal(nodes.some((node) => node.kind === "evidence-ref" && node.label === "Network #0"), true);
    assert.equal(nodes.some((node) => node.kind === "project-evidence"), true);
    assert.equal(
      nodes.some(
        (node) =>
          (node.kind === "candidate" || node.kind === "candidate-group") &&
          node.relativePath === "src/services/checkout.ts",
      ),
      true,
    );
    assert.equal(
      nodes.some((node) => node.kind === "limitation" && node.label.includes("screenshot")),
      true,
    );
    assert.equal(
      nodes.some(
        (node) =>
          node.kind === "excerpt" && node.label.includes(asPlainTreeText(FIXTURE_CHECKOUT_SERVICE.trim())),
      ),
      true,
    );
  });

  it("omits empty hypotheses, evidence, candidate, and limitation sections", () => {
    const state = viewState({
      summary: "Nothing useful yet",
      hypotheses: [],
      suggestedNextStep: "",
      limitations: [],
    });
    assert.deepEqual(kinds(getRootNodes(state)), ["summary", "proposed-fix"]);
  });

  it("omits empty candidate-file and evidence groups under a hypothesis", () => {
    const state = viewState({
      summary: "Summary only",
      hypotheses: [
        {
          title: "Unknown failure",
          explanation: "Not enough evidence",
          evidence: [],
          candidateFiles: [],
        },
      ],
      suggestedNextStep: "Wait for a better session",
      limitations: ["No network failures"],
    });
    const hypothesis = getChildNodes(state, getRootNodes(state)[1] as DiagnosisTreeNode)[0];
    assert.equal(hypothesis?.kind, "hypothesis");
    if (hypothesis === undefined || hypothesis.kind !== "hypothesis") {
      return;
    }
    assert.deepEqual(kinds(getChildNodes(state, hypothesis)), ["explanation"]);
  });

  it("uses already captured excerpts instead of extra file reads", () => {
    const excerpt = collectTreeNodes(viewState()).find((node) => node.kind === "excerpt");
    assert.equal(excerpt?.kind, "excerpt");
    if (excerpt?.kind !== "excerpt") {
      return;
    }
    assert.equal(excerpt.label.includes("submitCheckout"), true);
    assert.equal(excerpt.tooltip.includes("/workspace/shop"), false);
  });
});

describe("diagnosis tree security", () => {
  it("keeps model-generated strings as inert plain text", () => {
    const malicious: Diagnosis = {
      summary: '<script>alert(1)</script>\n$(sync) [Open](command:workbench.action.quit)',
      hypotheses: [
        {
          title: "rm -rf / && $(alert)",
          explanation: '<img src=x onerror="alert(1)">',
          evidence: [{ source: "BROWSER.page", detail: "javascript:alert(1)" }],
          candidateFiles: [{ relativePath: "src/services/checkout.ts", reason: "<b>bold</b>" }],
        },
      ],
      suggestedNextStep: "curl http://evil.example",
      limitations: ["Authorization: Bearer secret-pairing-token"],
    };
    const nodes = collectTreeNodes(viewState(malicious));
    for (const node of nodes) {
      assert.equal(node.label.includes("\n"), false);
      assert.equal(node.label.includes("$(sync)"), false);
      assert.equal(node.label.includes("$(alert)"), false);
      if (node.kind === "summary" || node.kind === "explanation" || node.kind === "hypothesis") {
        assert.equal(openableRelativePath(node), undefined);
      }
    }
    const summary = nodes.find((node) => node.kind === "summary");
    assert.equal(summary?.label.includes("<script>alert(1)</script>"), true);
    const next = nodes.find((node) => node.kind === "suggested-next-step-text");
    assert.equal(next?.label, "curl http://evil.example");
  });
});

describe("proposed fix tree", () => {
  it("shows an ungenerated proposal status", () => {
    const nodes = collectTreeNodes(viewState());
    assert.equal(nodes.some((node) => node.kind === "proposed-fix"), true);
    assert.equal(
      nodes.some((node) => node.kind === "proposal-status" && node.label === "Status: Not generated"),
      true,
    );
  });

  it("wires the proposal-diff node to the review command without stale path arguments", () => {
    const nodes = collectTreeNodes(viewState(), {
      generating: false,
      lastOutcome: "none",
      proposal: {
        proposedChange: {
          summary: "summary",
          rationale: "rationale",
          changes: [{ relativePath: "src/services/checkout.ts", originalContentHash: "a".repeat(64), edits: [] }],
        },
        diff: { text: "diff", fileCount: 1, editCount: 1, lineCount: 1, paths: ["src/services/checkout.ts"] },
        identity: { sessionId: "id", diagnosisFingerprint: "a".repeat(64), sourceFingerprint: "b".repeat(64) },
        createdAt: "2026-01-01T00:00:00.000Z",
        providerId: "fake",
      },
    });
    const diff = nodes.find((node) => node.kind === "proposal-diff");
    assert.equal(diff?.kind, "proposal-diff");
    assert.equal(openableRelativePath(diff as DiagnosisTreeNode), undefined);
    const command = treeItemCommand(diff as DiagnosisTreeNode);
    assert.equal(command?.command, REVIEW_FIX_COMMAND);
    assert.deepEqual(command?.arguments, []);

    const proposalFile = nodes.find((node) => node.kind === "proposal-file");
    assert.equal(proposalFile?.kind, "proposal-file");
    const fileCommand = treeItemCommand(proposalFile as DiagnosisTreeNode);
    assert.equal(fileCommand?.command, OPEN_CANDIDATE_COMMAND);
    assert.deepEqual(fileCommand?.arguments, ["src/services/checkout.ts"]);
  });
});

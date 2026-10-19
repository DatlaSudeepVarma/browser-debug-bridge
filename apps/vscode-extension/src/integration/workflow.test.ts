import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PROTOCOL_VERSION,
  createFakeSessionSubmission,
  type ProtocolError,
} from "@browser-debug-bridge/schema";
import { DiagnosisService } from "../ai/diagnosis.js";
import { FAKE_DIAGNOSIS, FakeAiProvider } from "../ai/fake-provider.js";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import type { Diagnosis } from "../ai/types.js";
import { BridgeServer } from "../bridge/server.js";
import { generatePairingToken } from "../bridge/crypto.js";
import { FAKE_FIX_PROPOSAL, jsonProposal } from "../fix/fake-proposal.js";
import { sha256Utf8 } from "../fix/hash.js";
import { createMemoryLiveFileReader } from "../fix/live-file.js";
import { FixProposalService } from "../fix/proposal.js";
import { FixProposalController } from "../fix/proposal-state.js";
import { runFixProposal } from "../fix/run-proposal.js";
import { memoryWorkspaceCanonicalIo } from "../fix/test-support.js";
import { MemoryWorkspaceAccess } from "../project/memory-access.js";
import { ProjectIntelligenceService } from "../project/service.js";
import {
  FIXTURE_FOLDER_NAME,
  FIXTURE_FOLDER_ROOT,
  createFixtureFileMap,
} from "../project/test-fixtures/files.js";
import { createProjectIntelligenceSession } from "../project/test-fixtures/session.js";
import type { CandidateFile, ProjectContext, ProjectContextResult } from "../project/types.js";
import { DiagnosisController } from "../ui/diagnosis-state.js";
import { runDiagnosis } from "../ui/run-diagnosis.js";

const TOKEN = generatePairingToken();
const EXTENSION_ID = "abcdefghijklmnopqrstuvwxyzabcdef";
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;

const silentLogger = {
  info(): void {},
  warn(): void {},
};

const FIXTURE_CHECKOUT_ON_DISK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test-fixtures/fixture-project/src/services/checkout.ts",
);

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function submissionFromSession() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "session.submit" as const,
    requestId: "22222222-2222-4222-8222-222222222222",
    session: createProjectIntelligenceSession(),
  };
}

async function parseError(response: Response): Promise<ProtocolError> {
  return (await response.json()) as ProtocolError;
}

function fixtureLiveProposalService(provider: FakeAiProvider): FixProposalService {
  const files = createFixtureFileMap();
  return new FixProposalService(provider, {
    liveFileReader: createMemoryLiveFileReader(files),
    canonicalIo: memoryWorkspaceCanonicalIo(FIXTURE_FOLDER_ROOT, Object.keys(files)),
  });
}

function fixtureWorkspace(): MemoryWorkspaceAccess {
  return new MemoryWorkspaceAccess([
    {
      name: FIXTURE_FOLDER_NAME,
      root: FIXTURE_FOLDER_ROOT,
      files: createFixtureFileMap(),
    },
  ]);
}

function rankedCandidateWithExcerpt(context: ProjectContext): CandidateFile {
  const candidate = context.candidates.find((item) => (item.excerpts[0]?.content.length ?? 0) > 0);
  assert.ok(candidate, "project intelligence should produce at least one excerpted candidate");
  return candidate;
}

function diagnosisForCandidate(relativePath: string): Diagnosis {
  return {
    summary: "The ranked candidate is a plausible inspection target for the captured checkout session.",
    hypotheses: [
      {
        title: "Inspect ranked candidate",
        explanation: "Project intelligence ranked this file from the captured checkout session.",
        evidence: [{ source: "BROWSER.network[0]", detail: "Checkout API failure metadata." }],
        candidateFiles: [{ relativePath, reason: "Ranked project-intelligence candidate" }],
      },
    ],
    suggestedNextStep: "Inspect the ranked candidate.",
    limitations: ["Fake provider output for integration tests."],
  };
}

function proposalForCandidate(candidate: CandidateFile) {
  const excerpt = candidate.excerpts[0];
  assert.ok(excerpt);
  const firstLine = excerpt.content.split(/\r?\n/)[0] ?? "";
  return {
    summary: "Make a bounded in-memory edit to a ranked candidate.",
    rationale: "Deterministic fixture change used only to validate the proposal pipeline.",
    changes: [
      {
        relativePath: candidate.relativePath,
        edits: [
          {
            startLine: excerpt.startLine,
            endLine: excerpt.startLine,
            replacement: `${firstLine} // bdb-test`,
          },
        ],
      },
    ],
  };
}

async function analyzeCheckoutSession(): Promise<Extract<ProjectContextResult, { status: "ok" }>> {
  const result = await new ProjectIntelligenceService(fixtureWorkspace()).analyzeSession(
    createProjectIntelligenceSession(),
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") {
    throw new Error("expected project context");
  }
  return result;
}

describe("phase 11 fake end-to-end workflow", () => {
  const servers: BridgeServer[] = [];

  after(async () => {
    await Promise.all(servers.map((server) => server.stop()));
  });

  it("runs session → bridge → project intelligence → fake diagnosis → fake proposal without writing files", async () => {
    const before = sha256File(FIXTURE_CHECKOUT_ON_DISK);
    const server = new BridgeServer({
      extensionVersion: "0.1.0",
      expectedChromeExtensionId: EXTENSION_ID,
      pairingToken: TOKEN,
      port: 0,
      logger: silentLogger,
    });
    await server.start();
    servers.push(server);

    const submission = submissionFromSession();
    const response = await fetch(`http://127.0.0.1:${String(server.addressPort())}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        Origin: ORIGIN,
      },
      body: JSON.stringify(submission),
    });
    assert.equal(response.status, 200);
    assert.equal(JSON.stringify(submission).includes(TOKEN), false);

    const stored = server.getSession(submission.session.sessionId);
    assert.ok(stored);

    const project = await new ProjectIntelligenceService(fixtureWorkspace()).analyzeSession(stored);
    assert.equal(project.status, "ok");
    if (project.status !== "ok") {
      return;
    }
    assert.equal(
      project.context.candidates.some((candidate) => candidate.relativePath === "src/services/checkout.ts"),
      true,
    );
    assert.equal(
      project.context.candidates.some((candidate) => candidate.relativePath === ".env"),
      false,
    );

    const candidate = rankedCandidateWithExcerpt(project.context);
    const diagnosis = diagnosisForCandidate(candidate.relativePath);
    const diagnosisController = new DiagnosisController();
    const proposalController = new FixProposalController();
    const diagnosisOutcome = await runDiagnosis(
      diagnosisController,
      {
        getLatestSession: () => stored,
        analyze: async () => project,
        diagnose: (session, context, token) =>
          new DiagnosisService(new FakeAiProvider(JSON.stringify(diagnosis))).diagnose(session, context, token),
      },
      { allowCreateSession: false, proposalController },
    );
    assert.equal(diagnosisOutcome.status, "replaced");
    assert.equal(diagnosisController.getDiagnosis()?.diagnosis.summary, diagnosis.summary);

    const proposalOutcome = await runFixProposal(
      diagnosisController.getDiagnosis(),
      proposalController,
      (state, token) =>
        fixtureLiveProposalService(new FakeAiProvider(jsonProposal(proposalForCandidate(candidate)))).propose(
          state.session,
          state.project,
          state.diagnosis,
          token,
        ),
      undefined,
      () => diagnosisController.getDiagnosis(),
    );
    assert.equal(
      proposalOutcome.status,
      "replaced",
      proposalOutcome.status === "preserved" ? proposalOutcome.result.error.code : proposalOutcome.status,
    );
    assert.equal(proposalController.getProposal()?.proposedChange.changes[0]?.relativePath, candidate.relativePath);
    assert.equal(
      proposalController.getProposal()?.diff.text.includes(`--- a/${candidate.relativePath}`),
      true,
    );
    const liveContent = createFixtureFileMap()[candidate.relativePath];
    assert.equal(typeof liveContent, "string");
    assert.equal(proposalController.getProposal()?.liveFileHashes?.[candidate.relativePath], sha256Utf8(liveContent ?? ""));
    assert.equal(sha256File(FIXTURE_CHECKOUT_ON_DISK), before);
  });

  it("keeps workspace files unchanged when a valid proposal is rejected by not applying it", async () => {
    const before = sha256File(FIXTURE_CHECKOUT_ON_DISK);
    const session = createProjectIntelligenceSession();
    const project = await analyzeCheckoutSession();
    const candidate = rankedCandidateWithExcerpt(project.context);
    const diagnosis = diagnosisForCandidate(candidate.relativePath);
    const diagnosisController = new DiagnosisController();
    const proposalController = new FixProposalController();
    const diagnosisOutcome = await runDiagnosis(
      diagnosisController,
      {
        getLatestSession: () => session,
        analyze: async () => project,
        diagnose: (current, context) =>
          new DiagnosisService(new FakeAiProvider(JSON.stringify(diagnosis))).diagnose(current, context),
      },
      { allowCreateSession: false, proposalController },
    );
    assert.equal(diagnosisOutcome.status, "replaced");
    const proposalOutcome = await runFixProposal(
      diagnosisController.getDiagnosis(),
      proposalController,
      (state) =>
        fixtureLiveProposalService(new FakeAiProvider(jsonProposal(proposalForCandidate(candidate)))).propose(
          state.session,
          state.project,
          state.diagnosis,
        ),
    );
    assert.equal(proposalOutcome.status, "replaced");
    proposalController.clear();
    assert.equal(proposalController.getProposal(), undefined);
    assert.equal(sha256File(FIXTURE_CHECKOUT_ON_DISK), before);
  });
});

describe("phase 11 security and recovery", () => {
  const servers: BridgeServer[] = [];

  after(async () => {
    await Promise.all(servers.map((server) => server.stop()));
  });

  async function running(): Promise<BridgeServer> {
    const server = new BridgeServer({
      extensionVersion: "0.1.0",
      expectedChromeExtensionId: EXTENSION_ID,
      pairingToken: TOKEN,
      port: 0,
      logger: silentLogger,
    });
    await server.start();
    servers.push(server);
    return server;
  }

  it("rejects an invalid bridge token", async () => {
    const server = await running();
    const response = await fetch(`http://127.0.0.1:${String(server.addressPort())}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${"c".repeat(64)}`,
      },
      body: JSON.stringify(createFakeSessionSubmission()),
    });
    assert.equal(response.status, 401);
    assert.equal((await parseError(response)).code, "UNAUTHORIZED");
  });

  it("rejects a new session that tries to reuse a stale in-memory proposal", async () => {
    const diagnosisController = new DiagnosisController();
    const proposalController = new FixProposalController();
    const firstSession = createProjectIntelligenceSession();
    const project = await analyzeCheckoutSession();
    const candidate = rankedCandidateWithExcerpt(project.context);
    const diagnosis = diagnosisForCandidate(candidate.relativePath);
    await runDiagnosis(
      diagnosisController,
      {
        getLatestSession: () => firstSession,
        analyze: async () => project,
        diagnose: (session, context) =>
          new DiagnosisService(new FakeAiProvider(JSON.stringify(diagnosis))).diagnose(session, context),
      },
      { allowCreateSession: false, proposalController },
    );
    const firstProposal = await runFixProposal(
      diagnosisController.getDiagnosis(),
      proposalController,
      (state) =>
        fixtureLiveProposalService(new FakeAiProvider(jsonProposal(proposalForCandidate(candidate)))).propose(
          state.session,
          state.project,
          state.diagnosis,
        ),
    );
    assert.equal(firstProposal.status, "replaced");
    const previousProposal = proposalController.getProposal();
    assert.ok(previousProposal);

    const secondSession = createFakeSessionSubmission().session;
    const second = await runDiagnosis(
      diagnosisController,
      {
        getLatestSession: () => secondSession,
        analyze: async () => project,
        diagnose: (session, context) =>
          new DiagnosisService(new FakeAiProvider(JSON.stringify(diagnosis))).diagnose(session, context),
      },
      { allowCreateSession: false, proposalController },
    );
    assert.equal(second.status, "replaced");
    assert.equal(proposalController.getProposal(), undefined);
    assert.equal(
      proposalController.belongsTo({
        sessionId: previousProposal.identity.sessionId,
        diagnosisFingerprint: previousProposal.identity.diagnosisFingerprint,
      }),
      false,
    );
  });

  it("rejects invented file paths from a fake model response", async () => {
    const invented = {
      ...FAKE_FIX_PROPOSAL,
      changes: [
        {
          relativePath: "src/invented-backdoor.ts",
          edits: [{ startLine: 1, endLine: 1, replacement: "export {}" }],
        },
      ],
    };
    const result = await new FixProposalService(new FakeAiProvider(jsonProposal(invented))).propose(
      createProjectIntelligenceSession(),
      createFixtureAiProjectContext(),
      FAKE_DIAGNOSIS,
    );
    assert.equal(result.status, "error");
    if (result.status === "error") {
      assert.equal(result.error.code, "AI_FIX_RESPONSE_INVALID");
    }
  });
});

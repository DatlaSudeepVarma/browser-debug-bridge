import path from "node:path";
import * as vscode from "vscode";
import { inspectWorkspacePath } from "@browser-debug-bridge/redaction";
import {
  createFakeDebugSessionV1,
  PAIRING_TOKEN_PATTERN,
  type DebugSessionV1,
} from "@browser-debug-bridge/schema";
import {
  BRIDGE_HOST,
  BRIDGE_PORT,
  PAIRING_TOKEN_SECRET_KEY,
} from "./bridge/constants.js";
import { generatePairingToken } from "./bridge/crypto.js";
import type { BridgeLogger } from "./bridge/logger.js";
import { BridgeServer } from "./bridge/server.js";
import { DiagnosisService } from "./ai/diagnosis.js";
import { VscodeLmProvider } from "./ai/vscode-lm-provider.js";
import { ProjectIntelligenceService } from "./project/service.js";
import { formatProjectIntelligenceSummary } from "./project/summary.js";
import type { ProjectContext } from "./project/types.js";
import { createVscodeWorkspaceAccess, wrapVscodeCancellation } from "./project/vscode-access.js";
import { normalizeFsPath } from "./project/workspace.js";
import { nodeCanonicalIo } from "./fix/canonical-path.js";
import type { LiveFileReader } from "./fix/live-file.js";
import { ProposedPreviewStore, proposalPreviewOwner } from "./fix/preview-store.js";
import { FixProposalService } from "./fix/proposal.js";
import { FixProposalController } from "./fix/proposal-state.js";
import { rejectFixProposal } from "./fix/reject-fix.js";
import { runApplyFix } from "./fix/run-apply.js";
import { prepareFixReview, snapshotLiveFiles } from "./fix/review-fix.js";
import { publishAndOpenReview } from "./fix/review-open.js";
import { runFixProposal } from "./fix/run-proposal.js";
import type { StoredProposal } from "./fix/types.js";
import {
  APPLY_FIX_COMMAND,
  CLEAR_DIAGNOSIS_COMMAND,
  DIAGNOSE_LATEST_SESSION_COMMAND,
  DIAGNOSE_TEST_SESSION_COMMAND,
  DIAGNOSIS_VIEW_ID,
  HAS_DIAGNOSIS_CONTEXT,
  HAS_FIX_PROPOSAL_CONTEXT,
  OPEN_CANDIDATE_COMMAND,
  OPEN_SCREENSHOT_COMMAND,
  PROPOSE_FIX_COMMAND,
  REFRESH_DIAGNOSIS_COMMAND,
  REJECT_FIX_COMMAND,
  REVIEW_FIX_COMMAND,
} from "./ui/constants.js";
import { DiagnosisController } from "./ui/diagnosis-state.js";
import { DiagnosisTreeProvider } from "./ui/diagnosis-tree-provider.js";
import { createVscodeApplyWriter } from "./ui/apply-edit.js";
import { REVIEW_DIFF_FAILED_MESSAGE, REVIEW_OPENED_MESSAGE, applyConfirmDetail, applyConfirmMessage } from "./ui/messages.js";
import {
  applyFixLogLines,
  applyFixUserNotice,
  diagnosisLogLines,
  diagnosisUserNotice,
  fixProposalLogLines,
  fixProposalUserNotice,
  rejectFixLogLines,
  rejectFixUserNotice,
  type UserNotice,
} from "./ui/notifications.js";
import { asPlainTreeText } from "./ui/plain-text.js";
import { openCandidateFile } from "./ui/open-candidate.js";
import { logSafeReviewError, userFacingReviewError } from "./ui/review-errors.js";
import { createVscodeReviewOpener, registerProposedPreviewProvider } from "./ui/review-diff.js";
import { clearDiagnosisView, selectDiagnosisSession, type DiagnosisSelection } from "./ui/diagnosis-selection.js";
import { runDiagnosis, type DiagnosisRunOutcome } from "./ui/run-diagnosis.js";
import { prepareScreenshotPreview } from "./ui/screenshot-view.js";
import { createVscodeCandidateOpener } from "./ui/vscode-open.js";

let bridge: BridgeServer | undefined;
let onCapturedSession: ((session: DebugSessionV1) => void) | undefined;

function createLogger(channel: vscode.OutputChannel): BridgeLogger {
  return {
    info(message: string): void {
      channel.appendLine(`[Bridge] ${message}`);
    },
    warn(message: string): void {
      channel.appendLine(`[Bridge] ${message}`);
    },
  };
}

function configuredChromeExtensionId(): string {
  return vscode.workspace
    .getConfiguration("browserDebugBridge")
    .get<string>("chromeExtensionId")
    ?.trim() ?? "";
}

async function getOrCreatePairingToken(
  secrets: vscode.SecretStorage,
): Promise<string> {
  const existing = await secrets.get(PAIRING_TOKEN_SECRET_KEY);
  if (existing !== undefined && PAIRING_TOKEN_PATTERN.test(existing)) {
    return existing;
  }
  const token = generatePairingToken();
  await secrets.store(PAIRING_TOKEN_SECRET_KEY, token);
  return token;
}

async function createBridge(
  context: vscode.ExtensionContext,
  logger: BridgeLogger,
): Promise<BridgeServer> {
  const pairingToken = await getOrCreatePairingToken(context.secrets);
  return new BridgeServer({
    extensionVersion: String(context.extension.packageJSON.version),
    expectedChromeExtensionId: configuredChromeExtensionId(),
    pairingToken,
    logger,
    onCapturedSession: (session) => onCapturedSession?.(session),
  });
}

function listeningAddress(): string {
  const port = bridge?.addressPort() ?? BRIDGE_PORT;
  return `${BRIDGE_HOST}:${String(port)}`;
}

function showNotice(channel: vscode.OutputChannel, notice: UserNotice): void {
  if (notice.kind === "silent" || notice.message.length === 0) {
    return;
  }
  if (notice.kind === "info") {
    void vscode.window.showInformationMessage(notice.message);
    return;
  }
  void vscode.window.showWarningMessage(notice.message, "Show Log").then((choice) => {
    if (choice === "Show Log") {
      channel.show(true);
    }
  });
}

function reportDiagnosisOutcome(
  channel: vscode.OutputChannel,
  treeProvider: DiagnosisTreeProvider,
  outcome: DiagnosisRunOutcome,
): void {
  for (const line of diagnosisLogLines(outcome)) {
    channel.appendLine(line);
  }
  const notice = diagnosisUserNotice(outcome);
  treeProvider.setActivity({
    statusDetail: notice.kind === "warn" ? notice.message : undefined,
  });
  showNotice(channel, notice);
  if (outcome.status === "replaced") {
    void vscode.commands.executeCommand(`${DIAGNOSIS_VIEW_ID}.focus`);
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel("Browser Debug Bridge");
  const logger = createLogger(channel);
  context.subscriptions.push(channel);

  const controller = new DiagnosisController();
  const proposalController = new FixProposalController();
  const previewStore = new ProposedPreviewStore();
  const treeProvider = new DiagnosisTreeProvider(controller, proposalController);
  const treeView = vscode.window.createTreeView(DIAGNOSIS_VIEW_ID, {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  treeProvider.attachView(treeView);
  context.subscriptions.push(treeView, registerProposedPreviewProvider(previewStore), {
    dispose(): void {
      previewStore.dispose();
    },
  });
  const candidateOpener = createVscodeCandidateOpener();
  const reviewOpener = createVscodeReviewOpener();
  const applyWriter = createVscodeApplyWriter();
  const syncViewContext = (): void => {
    void vscode.commands.executeCommand(
      "setContext",
      HAS_FIX_PROPOSAL_CONTEXT,
      proposalController.getProposal() !== undefined,
    );
    void vscode.commands.executeCommand(
      "setContext",
      HAS_DIAGNOSIS_CONTEXT,
      controller.getDiagnosis() !== undefined,
    );
  };
  syncViewContext();

  const startBridge = async (): Promise<void> => {
    if (bridge?.listening) {
      return;
    }
    await bridge?.stop();
    bridge = await createBridge(context, logger);
    await bridge.start();
  };

  const executeDiagnosis = async (selection: DiagnosisSelection): Promise<void> => {
    if (proposalController.getProposal() !== undefined) {
      const choice = await vscode.window.showWarningMessage(
        "Diagnose again and discard the current proposal?",
        { modal: true },
        "Diagnose",
      );
      if (choice !== "Diagnose") {
        return;
      }
    }
    treeProvider.setActivity({ diagnosing: true, statusDetail: undefined });
    try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Browser Debug Bridge: diagnosing",
        cancellable: true,
      },
      async (_progress, cancellation) => {
        const token = wrapVscodeCancellation(cancellation);
        const outcome = await runDiagnosis(
          controller,
          {
            getLatestSession: () => selectDiagnosisSession(selection, bridge),
            createSessionIfMissing: () =>
              bridge?.listening === true ? bridge.createTestSession() : createFakeDebugSessionV1(),
            analyze: (session, analyzeToken) => {
              const access = createVscodeWorkspaceAccess(cancellation);
              return new ProjectIntelligenceService(access).analyzeSession(session, analyzeToken);
            },
            diagnose: (session, project, diagnoseToken) =>
              new DiagnosisService(new VscodeLmProvider()).diagnose(session, project, diagnoseToken),
          },
          {
            allowCreateSession: selection.source === "synthetic" && selection.allowCreate,
            proposalController,
          },
          token,
        );
        reportDiagnosisOutcome(channel, treeProvider, outcome);
        previewStore.clear();
        syncViewContext();
      },
      );
    } finally {
      treeProvider.setActivity({ diagnosing: false });
    }
  };

  onCapturedSession = (session) => {
    const title = asPlainTreeText(session.page.title);
    const message =
      title.length > 0 ? `Chrome debug session received: ${title}` : "Chrome debug session received.";
    void vscode.window.showInformationMessage(message, "Diagnose").then((choice) => {
      if (choice === "Diagnose") {
        void executeDiagnosis({ source: "id", sessionId: session.sessionId });
      }
    });
  };

  try {
    await startBridge();
  } catch {
    logger.warn("Server failed to start");
    void vscode.window.showErrorMessage(
      "Browser Debug Bridge could not start the local bridge. Check that 127.0.0.1:17321 is available.",
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("browserDebugBridge.hello", () => {
      void vscode.window.showInformationMessage("Browser Debug Bridge loaded.");
    }),
    vscode.commands.registerCommand(
      "browserDebugBridge.showPairingCode",
      async () => {
        const token = await getOrCreatePairingToken(context.secrets);
        await vscode.window.showInputBox({
          title: "Browser Debug Bridge pairing token",
          prompt:
            "Local development only. Copy this token into the Chrome extension popup. Do not share it or paste it into logs.",
          value: token,
          ignoreFocusOut: true,
        });
      },
    ),
    vscode.commands.registerCommand(
      "browserDebugBridge.startLocalBridge",
      async () => {
        try {
          if (bridge?.listening) {
            void vscode.window.showInformationMessage(
              `Local bridge already running on ${listeningAddress()}.`,
            );
            return;
          }
          await startBridge();
          void vscode.window.showInformationMessage(
            `Local bridge started on ${listeningAddress()}.`,
          );
        } catch {
          void vscode.window.showErrorMessage(
            "Failed to start the local bridge.",
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      "browserDebugBridge.stopLocalBridge",
      async () => {
        if (bridge === undefined || !bridge.listening) {
          void vscode.window.showInformationMessage(
            "Local bridge is not running.",
          );
          return;
        }
        await bridge.stop();
        void vscode.window.showInformationMessage("Local bridge stopped.");
      },
    ),
    vscode.commands.registerCommand(
      "browserDebugBridge.createTestSession",
      () => {
        if (bridge === undefined || !bridge.listening) {
          void vscode.window.showErrorMessage(
            "Start the local bridge before creating a test session.",
          );
          return;
        }
        const session = bridge.createTestSession();
        void vscode.window.showInformationMessage(
          `Test session stored: ${session.sessionId}`,
        );
      },
    ),
    vscode.commands.registerCommand(
      "browserDebugBridge.analyzeTestSession",
      async () => {
        const session = bridge?.latestCapturedSession() ?? bridge?.latestSyntheticSession();
        if (session === undefined) {
          void vscode.window.showWarningMessage(
            "No debug session available. Start a browser debugging session first.",
          );
          return;
        }
        const tokenSource = new vscode.CancellationTokenSource();
        const access = createVscodeWorkspaceAccess(tokenSource.token);
        const service = new ProjectIntelligenceService(access);
        const result = await service.analyzeSession(
          session,
          wrapVscodeCancellation(tokenSource.token),
        );
        tokenSource.dispose();
        channel.appendLine(formatProjectIntelligenceSummary(result));
        if (result.status === "ok") {
          void vscode.window.showInformationMessage(
            `Project intelligence complete. ${String(result.context.candidates.length)} ranked candidates.`,
          );
          return;
        }
        const analysisMessage =
          result.status === "no-workspace"
            ? "Open a workspace folder before analyzing a session."
            : "Project intelligence analysis was cancelled.";
        showNotice(channel, { kind: "warn", message: analysisMessage });
      },
    ),
    vscode.commands.registerCommand(DIAGNOSE_TEST_SESSION_COMMAND, async () => {
      await executeDiagnosis({ source: "synthetic", allowCreate: true });
    }),
    vscode.commands.registerCommand(DIAGNOSE_LATEST_SESSION_COMMAND, async () => {
      await executeDiagnosis({ source: "captured" });
    }),
    vscode.commands.registerCommand(REFRESH_DIAGNOSIS_COMMAND, () => {
      treeProvider.refresh();
    }),
    vscode.commands.registerCommand(CLEAR_DIAGNOSIS_COMMAND, async () => {
      if (
        controller.isRunning() ||
        proposalController.isApplying() ||
        proposalController.getTreeState().generating
      ) {
        showNotice(channel, applyFixUserNotice({ status: "busy" }));
        return;
      }
      if (controller.getDiagnosis() === undefined && proposalController.getProposal() === undefined) {
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        "Clear this diagnosis and any proposed change? No workspace files will be modified.",
        { modal: true },
        "Clear",
      );
      if (choice !== "Clear") {
        return;
      }
      const cleared = clearDiagnosisView({
        diagnosis: controller,
        proposals: proposalController,
        clearPreview: () => previewStore.clear(),
      });
      if (cleared === "busy") {
        showNotice(channel, applyFixUserNotice({ status: "busy" }));
        return;
      }
      treeProvider.setActivity({ statusDetail: undefined });
      syncViewContext();
    }),
    vscode.commands.registerCommand(PROPOSE_FIX_COMMAND, async () => {
      treeProvider.setActivity({ proposing: true, statusDetail: undefined });
      try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Browser Debug Bridge: proposing a fix",
          cancellable: true,
        },
        async (_progress, cancellation) => {
          const token = wrapVscodeCancellation(cancellation);
          const outcome = await runFixProposal(
            controller.getDiagnosis(),
            proposalController,
            (state, proposeToken) =>
              new FixProposalService(new VscodeLmProvider(), {
                liveFileReader: createWorkspaceLiveFileReader(state.project),
                canonicalIo: nodeCanonicalIo,
              }).propose(
                state.session,
                state.project,
                state.diagnosis,
                proposeToken,
              ),
            token,
            () => controller.getDiagnosis(),
          );
          for (const line of fixProposalLogLines(outcome)) {
            channel.appendLine(line);
          }
          const notice = fixProposalUserNotice(outcome);
          treeProvider.setActivity({
            statusDetail: notice.kind === "warn" ? notice.message : undefined,
          });
          syncViewContext();
          previewStore.clear();
          showNotice(channel, notice);
        },
      );
      } finally {
        treeProvider.setActivity({ proposing: false });
      }
    }),
    vscode.commands.registerCommand(REVIEW_FIX_COMMAND, async () => {
      const diagnosis = controller.getDiagnosis();
      const proposal = proposalController.getProposal();
      const reader = diagnosis === undefined ? undefined : createWorkspaceLiveFileReader(diagnosis.project);
      const liveFiles =
        proposal === undefined || reader === undefined
          ? {}
          : await snapshotLiveFiles(proposal, (relativePath) => reader.readText(relativePath));
      const dirty = dirtyProposedPaths(proposal);
      const prepared = prepareFixReview({
        proposal,
        diagnosis,
        readLiveFile: (relativePath) => liveFiles[relativePath],
        canonicalIo: nodeCanonicalIo,
        isDirty: (relativePath) => dirty.has(relativePath),
      });
      if (prepared.status !== "ok") {
        previewStore.clear();
        channel.appendLine(logSafeReviewError(prepared.reason));
        treeProvider.setActivity({ statusDetail: userFacingReviewError(prepared.reason) });
        showNotice(channel, { kind: "warn", message: userFacingReviewError(prepared.reason) });
        return;
      }
      const opened = await publishAndOpenReview(
        prepared,
        previewStore,
        reviewOpener,
        proposal === undefined ? undefined : proposalPreviewOwner(proposal),
      );
      if (opened.status !== "opened") {
        channel.appendLine("[Review] REVIEW_DIFF_FAILED");
        treeProvider.setActivity({ statusDetail: REVIEW_DIFF_FAILED_MESSAGE });
        showNotice(channel, { kind: "warn", message: REVIEW_DIFF_FAILED_MESSAGE });
        return;
      }
      if (proposal !== undefined) {
        proposalController.markReviewed(proposal);
      }
      treeProvider.setActivity({ statusDetail: undefined });
      void vscode.window.showInformationMessage(REVIEW_OPENED_MESSAGE);
    }),
    vscode.commands.registerCommand(REJECT_FIX_COMMAND, async () => {
      // Arguments from TreeView items or menus are intentionally ignored; the
      // proposal to reject is always read from the live controller.
      const observed = proposalController.getProposal();
      if (observed !== undefined && !proposalController.isApplying()) {
        const choice = await vscode.window.showWarningMessage(
          "Reject this proposed change? No workspace files will be modified.",
          { modal: true },
          "Reject",
        );
        if (choice !== "Reject") {
          return;
        }
      }
      const outcome = rejectFixProposal(proposalController, previewStore, observed);
      for (const line of rejectFixLogLines(outcome)) {
        channel.appendLine(line);
      }
      syncViewContext();
      treeProvider.refresh();
      showNotice(channel, rejectFixUserNotice(outcome));
    }),
    vscode.commands.registerCommand(APPLY_FIX_COMMAND, async () => {
      treeProvider.setActivity({ applying: true });
      try {
      const outcome = await runApplyFix({
        proposalController,
        previewStore,
        getDiagnosis: () => controller.getDiagnosis(),
        getDiagnosisGeneration: () => controller.getGeneration(),
        isDiagnosisRunning: () => controller.isRunning(),
        canonicalIo: nodeCanonicalIo,
        readLiveFiles: async (proposal) => {
          const diagnosis = controller.getDiagnosis();
          if (diagnosis === undefined) {
            return {};
          }
          return snapshotLiveFiles(proposal, (relativePath) =>
            createWorkspaceLiveFileReader(diagnosis.project).readText(relativePath),
          );
        },
        dirtyPaths: (proposal) => dirtyProposedPaths(proposal),
        confirm: async (relativePaths) => {
          const choice = await vscode.window.showWarningMessage(
            applyConfirmMessage(relativePaths),
            { modal: true, detail: applyConfirmDetail(relativePaths) },
            "Apply",
          );
          return choice === "Apply";
        },
        write: (plan) => applyWriter.write(plan),
        restore: (plan) => applyWriter.restore(plan),
      });
      for (const line of applyFixLogLines(outcome)) {
        channel.appendLine(line);
      }
      if (outcome.status === "applied") {
        previewStore.clear();
      }
      const applyNotice = applyFixUserNotice(outcome);
      if (applyNotice.kind === "warn") {
        treeProvider.setActivity({ statusDetail: applyNotice.message });
      }
      syncViewContext();
      showNotice(channel, applyNotice);
      } finally {
        treeProvider.setActivity({ applying: false });
      }
    }),
    vscode.commands.registerCommand(OPEN_CANDIDATE_COMMAND, async (relativePath: unknown, line: unknown) => {
      if (typeof relativePath !== "string") {
        return;
      }
      const outcome = await openCandidateFile(
        relativePath,
        controller.getDiagnosis()?.project,
        candidateOpener,
        typeof line === "number" ? line : undefined,
      );
      if (outcome.status !== "opened") {
        void vscode.window.showWarningMessage(outcome.message);
      }
    }),
    vscode.commands.registerCommand(OPEN_SCREENSHOT_COMMAND, () => {
      const session = controller.getDiagnosis()?.session;
      if (session === undefined) {
        void vscode.window.showWarningMessage("No diagnosis is open.");
        return;
      }
      const preview = prepareScreenshotPreview({
        expectedSha256: session.screenshot.sha256,
        bytes: bridge?.getScreenshot(session.sessionId)?.bytes,
      });
      if (preview.status !== "ready") {
        void vscode.window.showWarningMessage(preview.message);
        return;
      }
      const panel = vscode.window.createWebviewPanel(
        "browserDebugBridge.screenshot",
        "Captured screenshot",
        vscode.ViewColumn.Beside,
        { enableScripts: false, localResourceRoots: [] },
      );
      panel.webview.html = preview.html;
    }),
  );
}

function createWorkspaceLiveFileReader(project: ProjectContext): LiveFileReader {
  return {
    async readText(relativePath: string): Promise<string | undefined> {
      const candidate = project.candidates.find((item) => item.relativePath === relativePath);
      const workspaceRoot = candidate?.workspaceRoot ?? project.workspaceRoot;
      const inspection = inspectWorkspacePath(workspaceRoot, relativePath);
      if (!inspection.safe) {
        return undefined;
      }
      const folder = vscode.workspace.workspaceFolders?.find(
        (item) => normalizeFsPath(item.uri.fsPath) === normalizeFsPath(workspaceRoot),
      );
      if (folder === undefined) {
        return undefined;
      }
      try {
        const uri = vscode.Uri.joinPath(folder.uri, ...inspection.relativePath.split("/"));
        const bytes = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(bytes).toString("utf8");
      } catch {
        return undefined;
      }
    },
  };
}

function dirtyProposedPaths(proposal: StoredProposal | undefined): Set<string> {
  const dirty = new Set<string>();
  if (proposal === undefined) {
    return dirty;
  }
  const proposed = new Set(
    proposal.proposedChange.changes
      .map((change) => change.relativePath)
      .filter((item): item is string => typeof item === "string"),
  );
  for (const document of vscode.workspace.textDocuments) {
    if (!document.isDirty || document.uri.scheme !== "file") {
      continue;
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const relative = normalizeFsPath(path.relative(folder.uri.fsPath, document.uri.fsPath));
      if (proposed.has(relative)) {
        dirty.add(relative);
      }
    }
  }
  return dirty;
}

export async function deactivate(): Promise<void> {
  onCapturedSession = undefined;
  await bridge?.stop();
  bridge = undefined;
}

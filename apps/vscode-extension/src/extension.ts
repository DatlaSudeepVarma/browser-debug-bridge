import * as vscode from "vscode";
import { PAIRING_TOKEN_PATTERN } from "@browser-debug-bridge/schema";
import {
  BRIDGE_HOST,
  BRIDGE_PORT,
  PAIRING_TOKEN_SECRET_KEY,
} from "./bridge/constants.js";
import { generatePairingToken } from "./bridge/crypto.js";
import type { BridgeLogger } from "./bridge/logger.js";
import { BridgeServer } from "./bridge/server.js";

let bridge: BridgeServer | undefined;

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
  });
}

function listeningAddress(): string {
  const port = bridge?.addressPort() ?? BRIDGE_PORT;
  return `${BRIDGE_HOST}:${String(port)}`;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel("Browser Debug Bridge");
  const logger = createLogger(channel);
  context.subscriptions.push(channel);

  const startBridge = async (): Promise<void> => {
    if (bridge?.listening) {
      return;
    }
    await bridge?.stop();
    bridge = await createBridge(context, logger);
    await bridge.start();
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
  );
}

export async function deactivate(): Promise<void> {
  await bridge?.stop();
  bridge = undefined;
}

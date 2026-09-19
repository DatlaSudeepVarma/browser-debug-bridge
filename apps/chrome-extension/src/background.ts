import { BridgeClientError, deleteScreenshot, submitSession, submitScreenshot } from "./bridge/client.js";
import { loadPairingToken } from "./bridge/pairing.js";
import { ConsoleRingBuffer } from "./capture/console/buffer.js";
import { createConsoleEntry } from "./capture/console/entries.js";
import { MAX_CONSOLE_ENTRIES } from "./capture/console/limits.js";
import { ERRORS, UNPAIRED_MESSAGE, userFacingError } from "./capture/errors.js";
import { startCaptureOnActiveTab } from "./capture/inject.js";
import { CAPTURE_PORT_NAME } from "./capture/limits.js";
import {
  parseRuntimeMessage,
  type CaptureState,
  type ConsoleEventPayload,
  type PageCapturePayload,
  type RuntimeResponse,
} from "./capture/messages.js";
import { buildDebugSession } from "./capture/session.js";
import {
  captureCroppedScreenshot,
  chromeTabScreenshotAdapter,
} from "./capture/screenshot-encode.js";
import {
  clearCaptureState,
  getCaptureState,
  getOrCreateTabIdSalt,
  setCaptureState,
} from "./capture/state.js";
import { hashTabId } from "./capture/tab-hash.js";

console.info("Browser Debug Bridge service worker loaded.");

const consoleBuffer = new ConsoleRingBuffer();

function resetConsoleBuffer(): void {
  consoleBuffer.clear();
}

function acceptConsoleEvent(entry: ConsoleEventPayload, senderTabId: number | undefined): void {
  void (async () => {
    const state = await getCaptureState();
    if (state.status !== "picking" && state.status !== "selected") {
      return;
    }
    if (senderTabId === undefined || state.tabId !== senderTabId) {
      return;
    }
    const built = createConsoleEntry(entry);
    if (built === undefined) {
      return;
    }
    consoleBuffer.push(built);
    if (consoleBuffer.size === 1 || consoleBuffer.size === MAX_CONSOLE_ENTRIES) {
      console.info("Browser Debug Bridge capture:", {
        type: "console-buffer",
        size: consoleBuffer.size,
      });
    }
  })();
}

async function cancelCapture(state: CaptureState): Promise<void> {
  if (state.tabId !== undefined) {
    try {
      await chrome.tabs.sendMessage(state.tabId, { type: "stop-picker" });
    } catch {
      // Tab may already be gone or have no listener.
    }
  }

  resetConsoleBuffer();
  await setCaptureState({
    status: "idle",
    lastError: ERRORS.cancelled,
    lastSessionId: state.lastSessionId,
  });
}

async function submitCapturedSession(
  userDescription: string,
  payload: PageCapturePayload,
  senderTabId: number | undefined,
): Promise<RuntimeResponse> {
  const token = await loadPairingToken();
  if (token === undefined) {
    return { ok: false, error: UNPAIRED_MESSAGE };
  }

  const state = await getCaptureState();
  const endedAt = new Date().toISOString();
  const startedAt = state.startedAt ?? endedAt;
  const tabId = senderTabId ?? state.tabId;
  if (tabId === undefined) {
    return { ok: false, error: ERRORS.noActiveTab };
  }

  await setCaptureState({
    ...state,
    status: "submitting",
    lastSelector: payload.selector,
  });
  const consoleEntries = consoleBuffer.snapshot();

  let windowId: number;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.active !== true) {
      resetConsoleBuffer();
      await setCaptureState({
        status: "idle",
        lastError: ERRORS.screenshotFailed,
      });
      return {
        ok: false,
        error: "The captured tab is no longer active. Start a new debug session.",
      };
    }
    windowId = tab.windowId;
  } catch {
    resetConsoleBuffer();
    return { ok: false, error: ERRORS.noActiveTab };
  }

  const captured = await captureCroppedScreenshot({
    adapter: chromeTabScreenshotAdapter,
    windowId,
    rect: payload.rect,
    viewport: payload.viewport,
  });
  if (!captured.ok) {
    const error =
      captured.reason === "not-visible"
        ? ERRORS.screenshotNotVisible
        : captured.reason === "too-large"
          ? ERRORS.screenshotTooLarge
          : ERRORS.screenshotFailed;
    resetConsoleBuffer();
    await setCaptureState({ status: "idle", lastError: error });
    return { ok: false, error };
  }

  const sessionId = crypto.randomUUID();
  const salt = await getOrCreateTabIdSalt();
  const built = buildDebugSession({
    payload,
    userDescription,
    sessionId,
    createdAt: endedAt,
    startedAt,
    endedAt,
    tabIdHash: await hashTabId(tabId, salt),
    extensionVersion: chrome.runtime.getManifest().version,
    screenshot: captured.value.metadata,
    consoleEntries,
  });

  if (!built.ok) {
    console.info("Browser Debug Bridge capture:", { type: "validation-failed" });
    resetConsoleBuffer();
    await setCaptureState({
      status: "idle",
      lastError: built.error,
    });
    return { ok: false, error: built.error };
  }

  try {
    await submitScreenshot(built.session.sessionId, captured.value.bytes);
    const ack = await submitSession(built.submission);
    resetConsoleBuffer();
    await setCaptureState({
      status: "idle",
      lastSessionId: ack.sessionId,
    });
    console.info("Browser Debug Bridge capture:", {
      type: "session-submitted",
      sessionId: ack.sessionId,
    });
    return { ok: true, sessionId: ack.sessionId };
  } catch (error) {
    try {
      await deleteScreenshot(built.session.sessionId);
    } catch {
      // Pending screenshot is also bounded and evicted in VS Code.
    }
    const message =
      error instanceof BridgeClientError && error.code === "UNPAIRED"
        ? UNPAIRED_MESSAGE
        : userFacingError(error);
    resetConsoleBuffer();
    await setCaptureState({
      status: "idle",
      lastError: message,
    });
    return { ok: false, error: message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const parsed = parseRuntimeMessage(message);
  if (parsed === undefined) {
    return false;
  }

  void (async (): Promise<RuntimeResponse> => {
    switch (parsed.type) {
      case "start-capture":
        resetConsoleBuffer();
        return startCaptureOnActiveTab();
      case "console-event":
        acceptConsoleEvent(parsed.entry, sender.tab?.id);
        return { ok: true };
      case "cancel-capture": {
        const state = await getCaptureState();
        await cancelCapture(state);
        return { ok: true };
      }
      case "get-capture-state":
        return { ok: true, state: await getCaptureState() };
      case "capture-started":
        await setCaptureState({
          status: "picking",
          startedAt: new Date().toISOString(),
          tabId: parsed.tabId,
        });
        return { ok: true };
      case "picker-ready":
        await setCaptureState({
          ...(await getCaptureState()),
          status: "picking",
        });
        return { ok: true };
      case "picker-failed":
        resetConsoleBuffer();
        await setCaptureState({
          status: "idle",
          lastError: parsed.error,
        });
        return { ok: false, error: parsed.error };
      case "capture-cancelled":
        resetConsoleBuffer();
        await setCaptureState({
          status: "idle",
          lastError: ERRORS.cancelled,
        });
        return { ok: true };
      case "submit-capture":
        return submitCapturedSession(
          parsed.userDescription,
          parsed.payload,
          sender.tab?.id,
        );
    }
  })()
    .then((response) => sendResponse(response))
    .catch(() => {
      sendResponse({ ok: false, error: "Capture failed." });
    });

  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== CAPTURE_PORT_NAME) {
    return;
  }
  const tabId = port.sender?.tab?.id;
  port.onDisconnect.addListener(() => {
    void (async () => {
      const state = await getCaptureState();
      if (state.status === "picking" && (tabId === undefined || state.tabId === tabId)) {
        resetConsoleBuffer();
        await setCaptureState({
          status: "idle",
          lastError: ERRORS.cancelled,
        });
      }
    })();
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const state = await getCaptureState();
    if (state.tabId === tabId && state.status !== "idle") {
      resetConsoleBuffer();
      await clearCaptureState();
    }
  })();
});

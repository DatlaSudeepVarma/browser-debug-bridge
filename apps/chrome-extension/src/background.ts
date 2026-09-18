import { BridgeClientError, submitSession } from "./bridge/client.js";
import { loadPairingToken } from "./bridge/pairing.js";
import { ERRORS, UNPAIRED_MESSAGE, userFacingError } from "./capture/errors.js";
import { startCaptureOnActiveTab } from "./capture/inject.js";
import { CAPTURE_PORT_NAME } from "./capture/limits.js";
import {
  parseRuntimeMessage,
  type CaptureState,
  type PageCapturePayload,
  type RuntimeResponse,
} from "./capture/messages.js";
import { buildDebugSession } from "./capture/session.js";
import {
  clearCaptureState,
  getCaptureState,
  getOrCreateTabIdSalt,
  setCaptureState,
} from "./capture/state.js";
import { hashTabId } from "./capture/tab-hash.js";

console.info("Browser Debug Bridge service worker loaded.");

async function cancelCapture(state: CaptureState): Promise<void> {
  if (state.tabId !== undefined) {
    try {
      await chrome.tabs.sendMessage(state.tabId, { type: "stop-picker" });
    } catch {
      // Tab may already be gone or have no listener.
    }
  }

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

  const salt = await getOrCreateTabIdSalt();
  const built = buildDebugSession({
    payload,
    userDescription,
    sessionId: crypto.randomUUID(),
    createdAt: endedAt,
    startedAt,
    endedAt,
    tabIdHash: await hashTabId(tabId, salt),
    extensionVersion: chrome.runtime.getManifest().version,
  });

  if (!built.ok) {
    console.info("Browser Debug Bridge capture:", { type: "validation-failed" });
    await setCaptureState({
      status: "idle",
      lastError: built.error,
    });
    return { ok: false, error: built.error };
  }

  try {
    const ack = await submitSession(built.submission);
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
    const message =
      error instanceof BridgeClientError && error.code === "UNPAIRED"
        ? UNPAIRED_MESSAGE
        : userFacingError(error);
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
        return startCaptureOnActiveTab();
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
        await setCaptureState({
          status: "idle",
          lastError: parsed.error,
        });
        return { ok: false, error: parsed.error };
      case "capture-cancelled":
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
      await clearCaptureState();
    }
  })();
});

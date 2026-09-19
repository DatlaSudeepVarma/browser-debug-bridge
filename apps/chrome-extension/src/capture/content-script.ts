import { captureElement } from "./capture.js";
import { startConsoleCapture } from "./console/capture.js";
import { startNetworkCapture } from "./network/capture.js";
import { CAPTURE_FLAG_KEY, CAPTURE_PORT_NAME, SCREENSHOT_SETTLE_MS } from "./limits.js";
import type { RuntimeResponse } from "./messages.js";
import { startPicker } from "./picker.js";

const globalState = globalThis as typeof globalThis & {
  [CAPTURE_FLAG_KEY]?: boolean;
};

function sendMessage(message: object): Promise<RuntimeResponse | undefined> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: "The extension disconnected." });
        return;
      }
      if (
        typeof response === "object" &&
        response !== null &&
        "ok" in response
      ) {
        resolve(response as RuntimeResponse);
        return;
      }
      resolve(undefined);
    });
  });
}

function publishConsoleEvent(entry: {
  level: "debug" | "log" | "info" | "warn" | "error";
  message: string;
  timestamp: string;
  stack?: string;
  source: "console" | "page-error" | "unhandled-rejection";
}): void {
  chrome.runtime.sendMessage({ type: "console-event", entry }, () => {
    void chrome.runtime.lastError;
  });
}

function publishNetworkEvent(entry: {
  timestamp: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  urlRedacted: string;
  status?: number;
  resourceType?: "fetch" | "xmlhttprequest";
  error?: string;
}): void {
  chrome.runtime.sendMessage({ type: "network-event", entry }, () => {
    void chrome.runtime.lastError;
  });
}

function startCaptureMode(): void {
  const port = chrome.runtime.connect({ name: CAPTURE_PORT_NAME });
  let stopped = false;
  const consoleCapture = startConsoleCapture({
    publish: publishConsoleEvent,
  });
  const networkCapture = startNetworkCapture({
    publish: publishNetworkEvent,
  });

  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    globalState[CAPTURE_FLAG_KEY] = false;
    consoleCapture.stop();
    networkCapture.stop();
    picker.stop();
    try {
      port.disconnect();
    } catch {
      // Port may already be disconnected after navigation.
    }
  }

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "stop-picker"
    ) {
      stop();
    }
  });

  const picker = startPicker({
    onSelect(element) {
      const payload = captureElement(element);
      picker.showDescriptionPrompt({
        selectorLabel: payload.selector,
        onSubmit(description) {
          picker.hideVisuals();
          consoleCapture.stop();
          networkCapture.stop();
          void (async () => {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, SCREENSHOT_SETTLE_MS);
            });
            const response = await sendMessage({
              type: "submit-capture",
              payload,
              userDescription: description,
            });
            if (response?.ok === true) {
              const sessionId = response.sessionId ?? "accepted";
              picker.showStatus(`Session submitted: ${sessionId}`);
              window.setTimeout(() => stop(), 1200);
              return;
            }
            picker.showStatus(
              response?.error ?? "The captured session was not sent.",
              "error",
            );
          })();
        },
        onCancel() {
          void sendMessage({ type: "capture-cancelled" });
          stop();
        },
      });
    },
    onCancel() {
      void sendMessage({ type: "capture-cancelled" });
      stop();
    },
  });

  port.onDisconnect.addListener(() => {
    stop();
  });

  void sendMessage({ type: "picker-ready" });
}

if (globalState[CAPTURE_FLAG_KEY] === true) {
  void sendMessage({ type: "picker-ready" });
} else {
  globalState[CAPTURE_FLAG_KEY] = true;
  try {
    startCaptureMode();
  } catch {
    globalState[CAPTURE_FLAG_KEY] = false;
    void sendMessage({
      type: "picker-failed",
      error: "The element picker could not start on this page.",
    });
  }
}

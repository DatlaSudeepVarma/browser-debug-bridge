import { captureElement } from "./capture.js";
import { CAPTURE_FLAG_KEY, CAPTURE_PORT_NAME } from "./limits.js";
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

function startCaptureMode(): void {
  const port = chrome.runtime.connect({ name: CAPTURE_PORT_NAME });
  let stopped = false;

  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    globalState[CAPTURE_FLAG_KEY] = false;
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
          picker.showStatus("Submitting captured session…");
          void sendMessage({
            type: "submit-capture",
            payload,
            userDescription: description,
          }).then((response) => {
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
          });
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

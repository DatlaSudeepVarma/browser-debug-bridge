import {
  BridgeClientError,
  getHealth,
  pairWithToken,
  submitFakeSession,
} from "./bridge/client.js";
import { loadPairingToken } from "./bridge/pairing.js";
import { ERRORS, UNPAIRED_MESSAGE } from "./capture/errors.js";
import type { CaptureState, RuntimeResponse } from "./capture/messages.js";

function setStatus(message: string): void {
  const status = document.getElementById("status");
  if (status) {
    status.textContent = message;
  }
}

function readTokenInput(): string {
  const input = document.getElementById("token");
  if (!(input instanceof HTMLInputElement)) {
    return "";
  }
  return input.value.trim();
}

function describeError(error: unknown): string {
  if (error instanceof BridgeClientError) {
    if (error.code === "UNPAIRED") {
      return UNPAIRED_MESSAGE;
    }
    return error.code === undefined
      ? error.message
      : `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed.";
}

function sendRuntimeMessage(message: object): Promise<RuntimeResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError) {
        reject(new Error("The extension service worker is unavailable."));
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
      reject(new Error("Unexpected extension response."));
    });
  });
}

function describeCaptureState(state: CaptureState | undefined): string | undefined {
  if (state === undefined) {
    return undefined;
  }
  if (state.status === "picking") {
    return "Capture mode is active. Hover to highlight, click to select, then describe the issue. Press Escape to cancel.";
  }
  if (state.status === "submitting") {
    return "Submitting the captured session…";
  }
  if (state.lastSessionId !== undefined) {
    return `Last session accepted: ${state.lastSessionId}`;
  }
  if (state.lastError !== undefined) {
    return state.lastError;
  }
  return undefined;
}

async function refreshCaptureStatus(): Promise<void> {
  try {
    const response = await sendRuntimeMessage({ type: "get-capture-state" });
    if (!response.ok) {
      return;
    }
    const message = describeCaptureState(response.state);
    if (message !== undefined) {
      setStatus(message);
    }
  } catch {
    // Popup can still be used for pairing if the worker is waking up.
  }
}

document.getElementById("pair")?.addEventListener("click", () => {
  void (async () => {
    const token = readTokenInput();
    if (token.length === 0) {
      setStatus("Paste the pairing token from VS Code first.");
      return;
    }
    try {
      await pairWithToken(token);
      setStatus("Paired with the local VS Code bridge.");
    } catch (error) {
      setStatus(describeError(error));
    }
  })();
});

document.getElementById("health")?.addEventListener("click", () => {
  void (async () => {
    try {
      const health = await getHealth();
      setStatus(`Bridge ${health.status} (${health.extensionVersion})`);
    } catch (error) {
      setStatus(describeError(error));
    }
  })();
});

document.getElementById("start-capture")?.addEventListener("click", () => {
  void (async () => {
    const token = await loadPairingToken();
    if (token === undefined) {
      setStatus(UNPAIRED_MESSAGE);
      return;
    }
    try {
      await getHealth();
    } catch {
      setStatus(ERRORS.bridgeUnavailable);
      return;
    }
    try {
      const response = await sendRuntimeMessage({ type: "start-capture" });
      if (!response.ok) {
        setStatus(response.error);
        return;
      }
      setStatus(
        "Capture mode is active. Hover to highlight, click to select, then describe the issue. Press Escape to cancel.",
      );
    } catch (error) {
      setStatus(describeError(error));
    }
  })();
});

document.getElementById("cancel-capture")?.addEventListener("click", () => {
  void (async () => {
    try {
      await sendRuntimeMessage({ type: "cancel-capture" });
      setStatus(ERRORS.cancelled);
    } catch (error) {
      setStatus(describeError(error));
    }
  })();
});

document.getElementById("submit")?.addEventListener("click", () => {
  void (async () => {
    try {
      const ack = await submitFakeSession();
      setStatus(`Test session accepted: ${ack.sessionId}`);
    } catch (error) {
      setStatus(describeError(error));
    }
  })();
});

void refreshCaptureStatus();

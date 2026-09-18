import {
  BridgeClientError,
  getHealth,
  pairWithToken,
  submitFakeSession,
} from "./bridge/client.js";

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
    return error.code === undefined
      ? error.message
      : `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed.";
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

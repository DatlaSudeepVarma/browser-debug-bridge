import {
  HealthResponseSchema,
  PairStatusSchema,
  PairTokenResponseSchema,
  ProtocolErrorSchema,
  ScreenshotAcknowledgementSchema,
  SessionAcknowledgementSchema,
  createFakeSessionSubmission,
  type HealthResponse,
  type PairStatus,
  type PairTokenResponse,
  type ScreenshotAcknowledgement,
  type SessionAcknowledgement,
  type SessionSubmission,
} from "@browser-debug-bridge/schema";
import { BRIDGE_BASE_URL } from "./constants.js";
import { loadPairingToken, savePairingToken } from "./pairing.js";
import { createPairTokenRequest } from "./protocol.js";

export class BridgeClientError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "BridgeClientError";
  }
}

async function readJson(response: Response): Promise<unknown> {
  return (await response.json()) as unknown;
}

async function throwIfProtocolError(response: Response, json: unknown): Promise<void> {
  const error = ProtocolErrorSchema.safeParse(json);
  if (error.success) {
    throw new BridgeClientError(error.data.message, response.status, error.data.code);
  }
  if (!response.ok) {
    throw new BridgeClientError("Local bridge request failed.", response.status);
  }
}

export interface BridgeApi {
  getHealth(): Promise<HealthResponse>;
  getPairStatus(): Promise<PairStatus>;
  pairWithToken(token: string): Promise<PairTokenResponse>;
  submitSession(submission: SessionSubmission): Promise<SessionAcknowledgement>;
  submitScreenshot(sessionId: string, bytes: Uint8Array): Promise<ScreenshotAcknowledgement>;
  deleteScreenshot(sessionId: string): Promise<void>;
  submitFakeSession(): Promise<SessionAcknowledgement>;
  acknowledgeSession(acknowledgement: SessionAcknowledgement): Promise<SessionAcknowledgement>;
}

export function createBridgeApi(baseUrl: string = BRIDGE_BASE_URL): BridgeApi {
  const root = baseUrl.replace(/\/$/, "");

  return {
    async getHealth(): Promise<HealthResponse> {
      const response = await fetch(`${root}/health`);
      const json = await readJson(response);
      await throwIfProtocolError(response, json);
      return HealthResponseSchema.parse(json);
    },

    async getPairStatus(): Promise<PairStatus> {
      const response = await fetch(`${root}/pair-status`);
      const json = await readJson(response);
      await throwIfProtocolError(response, json);
      return PairStatusSchema.parse(json);
    },

    async pairWithToken(token: string): Promise<PairTokenResponse> {
      const response = await fetch(`${root}/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createPairTokenRequest(token)),
      });
      const json = await readJson(response);
      await throwIfProtocolError(response, json);
      const parsed = PairTokenResponseSchema.parse(json);
      await savePairingToken(token);
      return parsed;
    },

    async submitSession(submission: SessionSubmission): Promise<SessionAcknowledgement> {
      const token = await loadPairingToken();
      if (token === undefined) {
        throw new BridgeClientError("Not paired with the local VS Code bridge.", 401, "UNPAIRED");
      }
      const response = await fetch(`${root}/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(submission),
      });
      const json = await readJson(response);
      await throwIfProtocolError(response, json);
      return SessionAcknowledgementSchema.parse(json);
    },

    async submitScreenshot(sessionId: string, bytes: Uint8Array): Promise<ScreenshotAcknowledgement> {
      const token = await loadPairingToken();
      if (token === undefined) {
        throw new BridgeClientError("Not paired with the local VS Code bridge.", 401, "UNPAIRED");
      }
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      const response = await fetch(`${root}/sessions/${sessionId}/screenshot`, {
        method: "POST",
        headers: {
          "Content-Type": "image/jpeg",
          Authorization: `Bearer ${token}`,
        },
        body: copy,
      });
      const json = await readJson(response);
      await throwIfProtocolError(response, json);
      return ScreenshotAcknowledgementSchema.parse(json);
    },

    async deleteScreenshot(sessionId: string): Promise<void> {
      const token = await loadPairingToken();
      if (token === undefined) {
        throw new BridgeClientError("Not paired with the local VS Code bridge.", 401, "UNPAIRED");
      }
      const response = await fetch(`${root}/sessions/${sessionId}/screenshot`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.status === 404) {
        return;
      }
      const json = await readJson(response);
      await throwIfProtocolError(response, json);
    },

    submitFakeSession(): Promise<SessionAcknowledgement> {
      return this.submitSession(createFakeSessionSubmission());
    },

    async acknowledgeSession(acknowledgement: SessionAcknowledgement): Promise<SessionAcknowledgement> {
      const token = await loadPairingToken();
      if (token === undefined) {
        throw new BridgeClientError("Not paired with the local VS Code bridge.", 401, "UNPAIRED");
      }
      const response = await fetch(`${root}/sessions/${acknowledgement.sessionId}/ack`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(acknowledgement),
      });
      const json = await readJson(response);
      await throwIfProtocolError(response, json);
      return SessionAcknowledgementSchema.parse(json);
    },
  };
}

const defaultBridge = createBridgeApi();

export function getHealth(): Promise<HealthResponse> {
  return defaultBridge.getHealth();
}

export function getPairStatus(): Promise<PairStatus> {
  return defaultBridge.getPairStatus();
}

export function pairWithToken(token: string): Promise<PairTokenResponse> {
  return defaultBridge.pairWithToken(token);
}

export function submitSession(submission: SessionSubmission): Promise<SessionAcknowledgement> {
  return defaultBridge.submitSession(submission);
}

export function submitScreenshot(
  sessionId: string,
  bytes: Uint8Array,
): Promise<ScreenshotAcknowledgement> {
  return defaultBridge.submitScreenshot(sessionId, bytes);
}

export function deleteScreenshot(sessionId: string): Promise<void> {
  return defaultBridge.deleteScreenshot(sessionId);
}

export function submitFakeSession(): Promise<SessionAcknowledgement> {
  return defaultBridge.submitFakeSession();
}

export function acknowledgeSession(
  acknowledgement: SessionAcknowledgement,
): Promise<SessionAcknowledgement> {
  return defaultBridge.acknowledgeSession(acknowledgement);
}

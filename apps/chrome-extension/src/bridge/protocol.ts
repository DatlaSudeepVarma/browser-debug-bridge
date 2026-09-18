import {
  PairTokenRequestSchema,
  type PairTokenRequest,
  type SessionAcknowledgement,
  type SessionSubmission,
} from "@browser-debug-bridge/schema";

export function createPairTokenRequest(token: string): PairTokenRequest {
  return PairTokenRequestSchema.parse({
    protocolVersion: 1,
    type: "pair.token",
    token,
  });
}

export type { PairTokenRequest, SessionAcknowledgement, SessionSubmission };

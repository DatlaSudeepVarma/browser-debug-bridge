import { z } from "zod";
import {
  IsoTimestampSchema,
  PROTOCOL_LIMITS,
  PROTOCOL_VERSION,
  UuidSchema,
  strictObject,
} from "./common.js";
import { DebugSessionV1Schema } from "./debug-session.js";

export const ProtocolVersionSchema = z.literal(PROTOCOL_VERSION);

export const ProtocolErrorCodeSchema = z.enum([
  "invalid_payload",
  "unsupported_protocol_version",
  "unsupported_schema_version",
  "unpaired",
  "payload_too_large",
  "internal",
]);

export const PairStateSchema = z.enum([
  "unpaired",
  "pending",
  "paired",
  "expired",
  "rejected",
]);

export const HealthResponseSchema = strictObject({
  protocolVersion: ProtocolVersionSchema,
  type: z.literal("health.response"),
  status: z.literal("ok"),
  serverTime: IsoTimestampSchema,
});

export const PairRequestSchema = strictObject({
  protocolVersion: ProtocolVersionSchema,
  type: z.literal("pair.request"),
  requestId: UuidSchema,
  clientName: z.string().min(1).max(PROTOCOL_LIMITS.clientName),
  clientVersion: z.string().min(1).max(PROTOCOL_LIMITS.clientVersion),
});

export const PairResponseSchema = strictObject({
  protocolVersion: ProtocolVersionSchema,
  type: z.literal("pair.response"),
  requestId: UuidSchema,
  pairingCode: z.string().min(1).max(PROTOCOL_LIMITS.pairingCode),
  expiresAt: IsoTimestampSchema,
});

export const PairStatusSchema = strictObject({
  protocolVersion: ProtocolVersionSchema,
  type: z.literal("pair.status"),
  requestId: UuidSchema.optional(),
  state: PairStateSchema,
});

export const SessionSubmissionSchema = strictObject({
  protocolVersion: ProtocolVersionSchema,
  type: z.literal("session.submit"),
  requestId: UuidSchema,
  session: DebugSessionV1Schema,
});

export const SessionAcknowledgementSchema = strictObject({
  protocolVersion: ProtocolVersionSchema,
  type: z.literal("session.ack"),
  requestId: UuidSchema,
  sessionId: UuidSchema,
  accepted: z.boolean(),
});

export const ProtocolErrorSchema = strictObject({
  protocolVersion: ProtocolVersionSchema,
  type: z.literal("error"),
  requestId: UuidSchema.optional(),
  code: ProtocolErrorCodeSchema,
  message: z.string().min(1).max(PROTOCOL_LIMITS.errorMessage),
});

export const ProtocolMessageSchema = z.discriminatedUnion("type", [
  HealthResponseSchema,
  PairRequestSchema,
  PairResponseSchema,
  PairStatusSchema,
  SessionSubmissionSchema,
  SessionAcknowledgementSchema,
  ProtocolErrorSchema,
]);

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type PairRequest = z.infer<typeof PairRequestSchema>;
export type PairResponse = z.infer<typeof PairResponseSchema>;
export type PairStatus = z.infer<typeof PairStatusSchema>;
export type SessionSubmission = z.infer<typeof SessionSubmissionSchema>;
export type SessionAcknowledgement = z.infer<
  typeof SessionAcknowledgementSchema
>;
export type ProtocolError = z.infer<typeof ProtocolErrorSchema>;
export type ProtocolMessage = z.infer<typeof ProtocolMessageSchema>;
export type ProtocolErrorCode = z.infer<typeof ProtocolErrorCodeSchema>;
export type PairState = z.infer<typeof PairStateSchema>;

export function parseProtocolMessage(data: unknown): ProtocolMessage {
  return ProtocolMessageSchema.parse(data);
}

export function safeParseProtocolMessage(data: unknown) {
  return ProtocolMessageSchema.safeParse(data);
}

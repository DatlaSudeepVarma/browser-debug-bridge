import type { IncomingMessage, ServerResponse } from "node:http";
import {
  PROTOCOL_VERSION,
  PairTokenRequestSchema,
  SessionAcknowledgementSchema,
  SessionSubmissionSchema,
  UuidSchema,
  createProtocolError,
  type ProtocolError,
  type ProtocolErrorCode,
} from "@browser-debug-bridge/schema";
import { BODY_WARN_BYTES, BRIDGE_SERVICE_NAME, MAX_BODY_BYTES } from "./constants.js";
import { readBearerToken, timingSafeEqualText } from "./crypto.js";
import type { BridgeLogger } from "./logger.js";
import type { SessionStore } from "./session-store.js";

export interface BridgeHandlerOptions {
  extensionVersion: string;
  expectedChromeExtensionId: string;
  pairingToken: string;
  store: SessionStore;
  logger: BridgeLogger;
  maxBodyBytes?: number;
  bodyWarnBytes?: number;
}

interface PairingState {
  paired: boolean;
}

const SESSION_ACK_PATH = /^\/sessions\/([^/]+)\/ack$/;

function chromeExtensionOrigin(extensionId: string): string {
  return `chrome-extension://${extensionId}`;
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::ffff:127.0.0.1";
}

export function isLoopbackHostHeader(host: string | undefined): boolean {
  if (host === undefined) {
    return false;
  }
  const value = host.trim().toLowerCase();
  return value === "127.0.0.1" || value.startsWith("127.0.0.1:");
}

export function isAllowedOrigin(
  origin: string | undefined,
  expectedChromeExtensionId: string,
): boolean {
  if (origin === undefined || origin.trim() === "") {
    return true;
  }
  const extensionId = expectedChromeExtensionId.trim();
  if (extensionId.length === 0) {
    return false;
  }
  return origin === chromeExtensionOrigin(extensionId);
}

function headerValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
  expectedChromeExtensionId: string,
): void {
  const origin = headerValue(req.headers.origin);
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (
    origin !== undefined &&
    isAllowedOrigin(origin, expectedChromeExtensionId)
  ) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  if (status === 204) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function sendError(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  code: ProtocolErrorCode,
  message: string,
  expectedChromeExtensionId: string,
  requestId?: string,
): void {
  const error: ProtocolError = createProtocolError(code, message, requestId);
  sendJson(req, res, status, error, expectedChromeExtensionId);
}

async function readBody(
  req: IncomingMessage,
  maxBodyBytes: number,
  bodyWarnBytes: number,
  logger: BridgeLogger,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; tooLarge: true }> {
  const contentLengthHeader = headerValue(req.headers["content-length"]);
  if (contentLengthHeader !== undefined) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      req.resume();
      await new Promise<void>((resolve) => {
        req.on("end", resolve);
        req.on("close", resolve);
      });
      return { ok: false, tooLarge: true };
    }
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) {
      req.resume();
      return { ok: false, tooLarge: true };
    }
    chunks.push(buffer);
  }

  if (size >= bodyWarnBytes) {
    logger.warn("Request body exceeded warning threshold");
  }

  return { ok: true, buffer: Buffer.concat(chunks, size) };
}

function parseJson(
  buffer: Buffer,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(buffer.toString("utf8")) as unknown };
  } catch {
    return { ok: false };
  }
}

export function createBridgeHandler(options: BridgeHandlerOptions): {
  listener: (req: IncomingMessage, res: ServerResponse) => void;
  pairing: PairingState;
} {
  const pairing: PairingState = { paired: false };
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const bodyWarnBytes = options.bodyWarnBytes ?? BODY_WARN_BYTES;

  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    void handleRequest(req, res);
  };

  async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const origin = headerValue(req.headers.origin);
    const extensionId = options.expectedChromeExtensionId;

    if (!isLoopbackAddress(req.socket.remoteAddress) || !isLoopbackHostHeader(headerValue(req.headers.host))) {
      sendError(req, res, 403, "ORIGIN_NOT_ALLOWED", "Request must use the local loopback interface.", extensionId);
      return;
    }

    if (!isAllowedOrigin(origin, extensionId)) {
      options.logger.warn("Session rejected: origin not allowed");
      sendError(req, res, 403, "ORIGIN_NOT_ALLOWED", "Origin is not the configured Chrome extension.", extensionId);
      return;
    }

    const method = req.method ?? "GET";
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

    if (method === "OPTIONS") {
      sendJson(req, res, 204, undefined, extensionId);
      return;
    }

    try {
      if (method === "GET" && path === "/health") {
        sendJson(
          req,
          res,
          200,
          {
            protocolVersion: PROTOCOL_VERSION,
            type: "health.response",
            status: "ok",
            service: BRIDGE_SERVICE_NAME,
            extensionVersion: options.extensionVersion,
            serverTime: new Date().toISOString(),
          },
          extensionId,
        );
        return;
      }

      if (method === "GET" && path === "/pair-status") {
        sendJson(
          req,
          res,
          200,
          {
            protocolVersion: PROTOCOL_VERSION,
            type: "pair.status",
            state: pairing.paired ? "paired" : "unpaired",
            paired: pairing.paired,
          },
          extensionId,
        );
        return;
      }

      if (method === "POST" && path === "/pair") {
        await handlePair(req, res, extensionId);
        return;
      }

      if (method === "POST" && path === "/sessions") {
        await handleSubmitSession(req, res, extensionId);
        return;
      }

      const ackMatch = SESSION_ACK_PATH.exec(path);
      if (method === "POST" && ackMatch) {
        const sessionId = ackMatch[1];
        if (sessionId === undefined) {
          sendError(req, res, 400, "INVALID_SESSION", "A session id is required.", extensionId);
          return;
        }
        await handleAck(req, res, extensionId, sessionId);
        return;
      }

      sendError(req, res, 404, "INVALID_PROTOCOL", "Unknown endpoint.", extensionId);
    } catch {
      options.logger.warn("Session rejected: internal handler error");
      sendError(req, res, 500, "INTERNAL", "The local bridge could not complete the request.", extensionId);
    }
  }

  async function readJsonOrError(
    req: IncomingMessage,
    res: ServerResponse,
    extensionId: string,
  ): Promise<unknown | undefined> {
    const body = await readBody(req, maxBodyBytes, bodyWarnBytes, options.logger);
    if (!body.ok) {
      sendError(req, res, 413, "PAYLOAD_TOO_LARGE", "Request body exceeds the 5 MB limit.", extensionId);
      return undefined;
    }
    const parsed = parseJson(body.buffer);
    if (!parsed.ok) {
      sendError(req, res, 400, "INVALID_JSON", "Request body is not valid JSON.", extensionId);
      return undefined;
    }
    return parsed.value;
  }

  function requireAuthorized(
    req: IncomingMessage,
    res: ServerResponse,
    extensionId: string,
  ): boolean {
    const bearer = readBearerToken(headerValue(req.headers.authorization));
    if (bearer === undefined || !timingSafeEqualText(bearer, options.pairingToken)) {
      sendError(req, res, 401, "UNAUTHORIZED", "A valid pairing token is required.", extensionId);
      return false;
    }
    return true;
  }

  async function handlePair(
    req: IncomingMessage,
    res: ServerResponse,
    extensionId: string,
  ): Promise<void> {
    const payload = await readJsonOrError(req, res, extensionId);
    if (payload === undefined) {
      return;
    }
    const parsed = PairTokenRequestSchema.safeParse(payload);
    if (!parsed.success) {
      sendError(req, res, 400, "INVALID_PROTOCOL", "Pairing request is not a valid protocol message.", extensionId);
      return;
    }
    if (!timingSafeEqualText(parsed.data.token, options.pairingToken)) {
      sendError(req, res, 401, "UNAUTHORIZED", "Pairing token does not match.", extensionId);
      return;
    }
    pairing.paired = true;
    options.logger.info("Pairing successful");
    sendJson(
      req,
      res,
      200,
      {
        protocolVersion: PROTOCOL_VERSION,
        type: "pair.token.result",
        paired: true,
      },
      extensionId,
    );
  }

  async function handleSubmitSession(
    req: IncomingMessage,
    res: ServerResponse,
    extensionId: string,
  ): Promise<void> {
    if (!requireAuthorized(req, res, extensionId)) {
      return;
    }
    const payload = await readJsonOrError(req, res, extensionId);
    if (payload === undefined) {
      return;
    }
    if (
      typeof payload === "object" &&
      payload !== null &&
      "type" in payload &&
      payload.type !== "session.submit"
    ) {
      options.logger.info("Session rejected: invalid protocol");
      sendError(req, res, 400, "INVALID_PROTOCOL", "Expected a session.submit protocol message.", extensionId);
      return;
    }
    const parsed = SessionSubmissionSchema.safeParse(payload);
    if (!parsed.success) {
      options.logger.info("Session rejected: invalid protocol");
      const looksLikeSubmit =
        typeof payload === "object" &&
        payload !== null &&
        "type" in payload &&
        payload.type === "session.submit";
      sendError(
        req,
        res,
        400,
        looksLikeSubmit ? "INVALID_SESSION" : "INVALID_PROTOCOL",
        "Debug session payload failed validation.",
        extensionId,
      );
      return;
    }
    options.store.add(parsed.data.session);
    options.logger.info(`Session received: ${parsed.data.session.sessionId}`);
    sendJson(
      req,
      res,
      200,
      {
        protocolVersion: PROTOCOL_VERSION,
        type: "session.ack",
        requestId: parsed.data.requestId,
        sessionId: parsed.data.session.sessionId,
        accepted: true,
      },
      extensionId,
    );
  }

  async function handleAck(
    req: IncomingMessage,
    res: ServerResponse,
    extensionId: string,
    sessionId: string,
  ): Promise<void> {
    if (!requireAuthorized(req, res, extensionId)) {
      return;
    }
    const idResult = UuidSchema.safeParse(sessionId);
    if (!idResult.success) {
      sendError(req, res, 400, "INVALID_SESSION", "sessionId must be a UUID.", extensionId);
      return;
    }
    const payload = await readJsonOrError(req, res, extensionId);
    if (payload === undefined) {
      return;
    }
    const parsed = SessionAcknowledgementSchema.safeParse(payload);
    if (!parsed.success) {
      sendError(req, res, 400, "INVALID_PROTOCOL", "Acknowledgement is not a valid protocol message.", extensionId);
      return;
    }
    if (parsed.data.sessionId !== idResult.data) {
      sendError(req, res, 400, "INVALID_SESSION", "Path sessionId does not match the request body.", extensionId);
      return;
    }
    const stored = options.store.get(idResult.data);
    if (stored === undefined) {
      sendError(req, res, 404, "SESSION_NOT_FOUND", "No debug session exists for that id.", extensionId, parsed.data.requestId);
      return;
    }
    sendJson(
      req,
      res,
      200,
      {
        protocolVersion: PROTOCOL_VERSION,
        type: "session.ack",
        requestId: parsed.data.requestId,
        sessionId: stored.session.sessionId,
        accepted: true,
      },
      extensionId,
    );
  }

  return { listener, pairing };
}

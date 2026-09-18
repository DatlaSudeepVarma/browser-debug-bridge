import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  PROTOCOL_VERSION,
  createFakeSessionSubmission,
  type ProtocolError,
} from "@browser-debug-bridge/schema";
import { BridgeServer, type BridgeServerOptions } from "./server.js";
import { SessionStore } from "./session-store.js";
import { generatePairingToken } from "./crypto.js";
import { isLoopbackAddress, isLoopbackHostHeader } from "./handler.js";

const TOKEN = generatePairingToken();
const EXTENSION_ID = "abcdefghijklmnopqrstuvwxyzabcdef";
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;

const silentLogger = {
  info(): void {},
  warn(): void {},
};

async function startServer(
  overrides: Partial<BridgeServerOptions> = {},
): Promise<BridgeServer> {
  const server = new BridgeServer({
    extensionVersion: "0.1.0",
    expectedChromeExtensionId: EXTENSION_ID,
    pairingToken: TOKEN,
    port: 0,
    logger: silentLogger,
    ...overrides,
  });
  await server.start();
  return server;
}

function baseUrl(server: BridgeServer): string {
  return `http://127.0.0.1:${String(server.addressPort())}`;
}

async function parseError(response: Response): Promise<ProtocolError> {
  return (await response.json()) as ProtocolError;
}

describe("loopback helpers", () => {
  it("accepts IPv4 and IPv4-mapped loopback addresses only", () => {
    assert.equal(isLoopbackAddress("127.0.0.1"), true);
    assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
    assert.equal(isLoopbackAddress("192.168.1.10"), false);
    assert.equal(isLoopbackAddress("0.0.0.0"), false);
    assert.equal(isLoopbackHostHeader("127.0.0.1:17321"), true);
    assert.equal(isLoopbackHostHeader("localhost:17321"), false);
    assert.equal(isLoopbackHostHeader("0.0.0.0:17321"), false);
  });
});

describe("SessionStore", () => {
  it("enforces the session limit by dropping the oldest session", () => {
    const store = new SessionStore(2);
    const first = createFakeSessionSubmission().session;
    const second = createFakeSessionSubmission().session;
    const third = createFakeSessionSubmission().session;
    store.add(first);
    store.add(second);
    store.add(third);
    assert.equal(store.size, 2);
    assert.equal(store.get(first.sessionId), undefined);
    assert.ok(store.get(second.sessionId));
    assert.ok(store.get(third.sessionId));
  });
});

describe("BridgeServer HTTP", () => {
  const servers: BridgeServer[] = [];

  after(async () => {
    await Promise.all(servers.map((server) => server.stop()));
  });

  async function running(
    overrides?: Parameters<typeof startServer>[0],
  ): Promise<BridgeServer> {
    const server = await startServer(overrides);
    servers.push(server);
    return server;
  }

  it("GET /health returns 200 and protocolVersion 1", async () => {
    const server = await running();
    const response = await fetch(`${baseUrl(server)}/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { protocolVersion: number; status: string };
    assert.equal(body.protocolVersion, PROTOCOL_VERSION);
    assert.equal(body.status, "ok");
  });

  it("rejects unauthorized POST /sessions", async () => {
    const server = await running();
    const response = await fetch(`${baseUrl(server)}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createFakeSessionSubmission()),
    });
    assert.equal(response.status, 401);
    const error = await parseError(response);
    assert.equal(error.code, "UNAUTHORIZED");
  });

  it("rejects an invalid bearer token", async () => {
    const server = await running();
    const response = await fetch(`${baseUrl(server)}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${"b".repeat(64)}`,
      },
      body: JSON.stringify(createFakeSessionSubmission()),
    });
    assert.equal(response.status, 401);
    assert.equal((await parseError(response)).code, "UNAUTHORIZED");
  });

  it("rejects an invalid Origin", async () => {
    const server = await running();
    const response = await fetch(`${baseUrl(server)}/health`, {
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(response.status, 403);
    assert.equal((await parseError(response)).code, "ORIGIN_NOT_ALLOWED");
  });

  it("returns 413 for an oversized request", async () => {
    const server = await running({ maxBodyBytes: 64 });
    const response = await fetch(`${baseUrl(server)}/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(128),
    });
    assert.equal(response.status, 413);
    assert.equal((await parseError(response)).code, "PAYLOAD_TOO_LARGE");
  });

  it("rejects malformed JSON", async () => {
    const server = await running();
    const response = await fetch(`${baseUrl(server)}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: "{",
    });
    assert.equal(response.status, 400);
    assert.equal((await parseError(response)).code, "INVALID_JSON");
  });

  it("rejects an invalid protocol message", async () => {
    const server = await running();
    const response = await fetch(`${baseUrl(server)}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        Origin: ORIGIN,
      },
      body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: "health.response",
        status: "ok",
        service: "browser-debug-bridge",
        extensionVersion: "0.1.0",
        serverTime: "2026-09-18T16:00:00.000Z",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await parseError(response)).code, "INVALID_PROTOCOL");
  });

  it("accepts a valid fake DebugSession and stores it", async () => {
    const server = await running();
    const submission = createFakeSessionSubmission();
    const response = await fetch(`${baseUrl(server)}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        Origin: ORIGIN,
      },
      body: JSON.stringify(submission),
    });
    assert.equal(response.status, 200);
    const ack = (await response.json()) as { accepted: boolean; sessionId: string };
    assert.equal(ack.accepted, true);
    assert.equal(ack.sessionId, submission.session.sessionId);
    assert.ok(server.getSession(submission.session.sessionId));
  });

  it("enforces the stored session limit over HTTP", async () => {
    const server = await running({ maxSessions: 2 });
    const submissions = [
      createFakeSessionSubmission(),
      createFakeSessionSubmission(),
      createFakeSessionSubmission(),
    ];
    for (const submission of submissions) {
      const response = await fetch(`${baseUrl(server)}/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify(submission),
      });
      assert.equal(response.status, 200);
    }
    const first = submissions[0];
    const second = submissions[1];
    const third = submissions[2];
    assert.ok(first && second && third);
    assert.equal(server.getSession(first.session.sessionId), undefined);
    assert.ok(server.getSession(second.session.sessionId));
    assert.ok(server.getSession(third.session.sessionId));
  });

  it("returns SESSION_NOT_FOUND for an unknown session ack", async () => {
    const server = await running();
    const sessionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const response = await fetch(`${baseUrl(server)}/sessions/${sessionId}/ack`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: "session.ack",
        requestId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
        sessionId,
        accepted: true,
      }),
    });
    assert.equal(response.status, 404);
    assert.equal((await parseError(response)).code, "SESSION_NOT_FOUND");
  });

  it("accepts a valid session ack", async () => {
    const server = await running();
    const submission = createFakeSessionSubmission();
    const submit = await fetch(`${baseUrl(server)}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(submission),
    });
    assert.equal(submit.status, 200);
    const response = await fetch(
      `${baseUrl(server)}/sessions/${submission.session.sessionId}/ack`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          type: "session.ack",
          requestId: submission.requestId,
          sessionId: submission.session.sessionId,
          accepted: true,
        }),
      },
    );
    assert.equal(response.status, 200);
    const ack = (await response.json()) as { accepted: boolean };
    assert.equal(ack.accepted, true);
  });

  it("binds only to loopback", async () => {
    const server = await running();
    const host = server.addressHost();
    assert.ok(host === "127.0.0.1" || host === "::ffff:127.0.0.1");
  });

  it("can start and stop repeatedly without duplicate listeners", async () => {
    const server = new BridgeServer({
      extensionVersion: "0.1.0",
      expectedChromeExtensionId: EXTENSION_ID,
      pairingToken: TOKEN,
      port: 0,
      logger: silentLogger,
    });
    await server.start();
    await server.start();
    assert.ok(server.addressPort());
    await server.stop();
    await server.stop();
    await server.start();
    const response = await fetch(`http://127.0.0.1:${String(server.addressPort())}/health`);
    assert.equal(response.status, 200);
    await server.stop();
  });
});

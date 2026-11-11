import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, describe, it } from "node:test";
import {
  createFakeSessionSubmission,
  parseDebugSession,
  type SessionSubmission,
} from "@browser-debug-bridge/schema";
import { BridgeServer } from "../../../vscode-extension/src/bridge/server.js";
import { BridgeClientError, createBridgeApi } from "./client.js";
import { clearPairingToken, loadPairingToken } from "./pairing.js";

const TOKEN = randomBytes(32).toString("hex");
const EXTENSION_ID = "abcdefghijklmnopqrstuvwxyzabcdef";

const memory = new Map<string, unknown>();

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: {
    storage: {
      local: {
        async get(key: string): Promise<Record<string, unknown>> {
          return { [key]: memory.get(key) };
        },
        async set(items: Record<string, unknown>): Promise<void> {
          for (const [key, value] of Object.entries(items)) {
            memory.set(key, value);
          }
        },
        async remove(key: string): Promise<void> {
          memory.delete(key);
        },
      },
    },
  },
});

const silentLogger = {
  info(): void {},
  warn(): void {},
};

function jpegBytes(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, ...Array.from({ length: 16 }, () => 7)]);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("Chrome bridge client", () => {
  const servers: BridgeServer[] = [];

  after(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    memory.clear();
  });

  async function start(): Promise<{ server: BridgeServer; api: ReturnType<typeof createBridgeApi> }> {
    await clearPairingToken();
    const server = new BridgeServer({
      extensionVersion: "0.1.0",
      expectedChromeExtensionId: EXTENSION_ID,
      pairingToken: TOKEN,
      port: 0,
      logger: silentLogger,
    });
    await server.start();
    servers.push(server);
    const api = createBridgeApi(`http://127.0.0.1:${String(server.addressPort())}`);
    return { server, api };
  }

  it("pairs with the local bridge and stores only a matching token", async () => {
    const { api } = await start();
    const before = await api.getPairStatus();
    assert.equal(before.paired, false);
    const health = await api.getHealth();
    assert.equal(health.status, "ok");
    assert.equal(health.protocolVersion, 1);

    const paired = await api.pairWithToken(TOKEN);
    assert.equal(paired.paired, true);
    assert.equal(await loadPairingToken(), TOKEN);
    const after = await api.getPairStatus();
    assert.equal(after.paired, true);
    assert.equal(after.state, "paired");
  });

  it("does not store a token the bridge rejects", async () => {
    const { api } = await start();
    const wrong = randomBytes(32).toString("hex");
    await assert.rejects(
      () => api.pairWithToken(wrong),
      (error: unknown) => error instanceof BridgeClientError && error.status === 401,
    );
    assert.equal(await loadPairingToken(), undefined);
    assert.equal((await api.getPairStatus()).paired, false);
  });

  it("rejects an unpaired submit and a malformed session", async () => {
    const { api } = await start();
    await assert.rejects(
      () => api.submitFakeSession(),
      (error: unknown) => error instanceof BridgeClientError && error.code === "UNPAIRED",
    );
    await api.pairWithToken(TOKEN);
    await assert.rejects(
      () =>
        api.submitSession({
          protocolVersion: 1,
          type: "session.submit",
          requestId: "not-a-uuid",
          session: { sessionId: "../etc/passwd" },
        } as unknown as SessionSubmission),
      (error: unknown) =>
        error instanceof BridgeClientError &&
        (error.code === "INVALID_SESSION" || error.code === "INVALID_PROTOCOL"),
    );
  });

  it("submits a captured session and acknowledges it", async () => {
    const { server, api } = await start();
    await api.pairWithToken(TOKEN);
    const fake = createFakeSessionSubmission();
    const submission = {
      ...fake,
      session: parseDebugSession({
        ...fake.session,
        browser: { ...fake.session.browser, version: "120.0.0" },
      }),
    };
    const ack = await api.submitSession(submission);
    assert.equal(ack.accepted, true);
    assert.equal(ack.sessionId, submission.session.sessionId);
    assert.equal(server.latestCapturedSession()?.sessionId, submission.session.sessionId);
    const confirmed = await api.acknowledgeSession(ack);
    assert.equal(confirmed.accepted, true);
  });

  it("uploads a JPEG and then the matching session", async () => {
    const { server, api } = await start();
    await api.pairWithToken(TOKEN);
    const bytes = jpegBytes();
    const fake = createFakeSessionSubmission();
    const session = parseDebugSession({
      ...fake.session,
      browser: { ...fake.session.browser, version: "120.0.0" },
      screenshot: {
        mime: "image/jpeg",
        width: 8,
        height: 8,
        sha256: sha256Hex(bytes),
        cropped: true,
      },
    });
    const uploaded = await api.submitScreenshot(session.sessionId, bytes);
    assert.equal(uploaded.accepted, true);
    assert.equal(uploaded.sha256, sha256Hex(bytes));
    const ack = await api.submitSession({ ...fake, session, requestId: session.sessionId });
    assert.equal(ack.accepted, true);
    assert.equal(server.getScreenshot(session.sessionId)?.sha256, sha256Hex(bytes));
    await api.deleteScreenshot(session.sessionId);
    assert.equal(server.getScreenshot(session.sessionId), undefined);
  });

  it("fails when the bridge is not listening", async () => {
    const { server, api } = await start();
    await server.stop();
    await assert.rejects(() => api.pairWithToken(TOKEN));
    assert.equal(await loadPairingToken(), undefined);
  });
});

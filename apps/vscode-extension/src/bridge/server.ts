import { createServer, type Server } from "node:http";
import {
  createFakeDebugSessionV1,
  type DebugSessionV1,
} from "@browser-debug-bridge/schema";
import {
  BRIDGE_HOST,
  BRIDGE_PORT,
  MAX_SESSIONS,
} from "./constants.js";
import { createBridgeHandler } from "./handler.js";
import { createConsoleLogger, type BridgeLogger } from "./logger.js";
import { SessionStore } from "./session-store.js";

export interface BridgeServerOptions {
  extensionVersion: string;
  expectedChromeExtensionId: string;
  pairingToken: string;
  port?: number;
  maxBodyBytes?: number;
  bodyWarnBytes?: number;
  maxSessions?: number;
  logger?: BridgeLogger;
}

export class BridgeServer {
  private server: Server | undefined;
  private readonly store: SessionStore;
  private readonly logger: BridgeLogger;
  private readonly port: number;

  public constructor(private readonly options: BridgeServerOptions) {
    this.store = new SessionStore(options.maxSessions ?? MAX_SESSIONS);
    this.logger = options.logger ?? createConsoleLogger();
    this.port = options.port ?? BRIDGE_PORT;
  }

  public get listening(): boolean {
    return this.server?.listening === true;
  }

  public addressPort(): number | undefined {
    const address = this.server?.address();
    if (address === undefined || address === null || typeof address === "string") {
      return undefined;
    }
    return address.port;
  }

  public addressHost(): string | undefined {
    const address = this.server?.address();
    if (address === undefined || address === null || typeof address === "string") {
      return undefined;
    }
    return address.address;
  }

  public getSession(sessionId: string): DebugSessionV1 | undefined {
    return this.store.get(sessionId)?.session;
  }

  public sessionCount(): number {
    return this.store.size;
  }

  public createTestSession(): DebugSessionV1 {
    const session = createFakeDebugSessionV1();
    this.store.add(session);
    this.logger.info(`Session received: ${session.sessionId}`);
    return session;
  }

  public start(): Promise<void> {
    if (this.listening) {
      return Promise.resolve();
    }

    const { listener } = createBridgeHandler({
      extensionVersion: this.options.extensionVersion,
      expectedChromeExtensionId: this.options.expectedChromeExtensionId,
      pairingToken: this.options.pairingToken,
      store: this.store,
      logger: this.logger,
      maxBodyBytes: this.options.maxBodyBytes,
      bodyWarnBytes: this.options.bodyWarnBytes,
    });

    const server = createServer(listener);
    this.server = server;

    return new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off("error", onError);
        this.server = undefined;
        reject(error);
      };
      server.once("error", onError);
      server.listen(this.port, BRIDGE_HOST, () => {
        server.off("error", onError);
        const port = this.addressPort() ?? this.port;
        this.logger.info(`Server started on ${BRIDGE_HOST}:${String(port)}`);
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    const server = this.server;
    if (server === undefined || !server.listening) {
      this.server = undefined;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      server.close((error) => {
        this.server = undefined;
        if (error) {
          reject(error);
          return;
        }
        this.logger.info("Server stopped");
        resolve();
      });
    });
  }
}

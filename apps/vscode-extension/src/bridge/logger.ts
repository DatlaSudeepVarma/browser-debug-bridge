export interface BridgeLogger {
  info(message: string): void;
  warn(message: string): void;
}

export function createConsoleLogger(): BridgeLogger {
  return {
    info(message: string): void {
      console.info(`[Bridge] ${message}`);
    },
    warn(message: string): void {
      console.warn(`[Bridge] ${message}`);
    },
  };
}

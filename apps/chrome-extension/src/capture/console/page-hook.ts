import { CONSOLE_EVENT_NAME, CONSOLE_STOP_EVENT_NAME } from "./limits.js";
import { extractErrorStack, serializeConsoleArgs } from "./serializer.js";

const METHODS = ["debug", "log", "info", "warn", "error"] as const;

type HookedMethod = (typeof METHODS)[number];

const originals = new Map<HookedMethod, (...args: unknown[]) => unknown>();
let installed = false;

function emit(level: HookedMethod, args: unknown[]): void {
  const detail: Record<string, string> = {
    level,
    message: serializeConsoleArgs(args),
    timestamp: new Date().toISOString(),
  };
  const stack = extractErrorStack(args);
  if (stack !== undefined) {
    detail.stack = stack;
  }
  window.dispatchEvent(new CustomEvent(CONSOLE_EVENT_NAME, { detail }));
}

function restore(): void {
  if (!installed) {
    return;
  }
  for (const method of METHODS) {
    const original = originals.get(method);
    if (original !== undefined) {
      Object.defineProperty(console, method, {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  }
  originals.clear();
  installed = false;
  window.removeEventListener(CONSOLE_STOP_EVENT_NAME, restore);
}

function install(): void {
  if (installed) {
    return;
  }
  installed = true;
  for (const method of METHODS) {
    const original = console[method];
    originals.set(method, original);
    Object.defineProperty(console, method, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        try {
          emit(method, args);
        } catch {
          // Capture must never break the page console.
        }
        return original.apply(console, args);
      },
    });
  }
  window.addEventListener(CONSOLE_STOP_EVENT_NAME, restore);
}

install();

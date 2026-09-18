import { TAB_ID_HASH_HEX_LENGTH } from "./limits.js";

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function generateTabIdSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * Privacy-preserving tab identity for DebugSessionV1.tabIdHash.
 *
 * SHA-256(`${salt}:${tabId}`) truncated to 32 hex characters.
 * The salt is a per-installation 256-bit random value — not a hard-coded secret.
 * The raw Chrome tab id is never stored in the session payload.
 */
export async function hashTabId(tabId: number, saltHex: string): Promise<string> {
  const encoded = new TextEncoder().encode(`${saltHex}:${String(tabId)}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(digest)).slice(0, TAB_ID_HASH_HEX_LENGTH);
}

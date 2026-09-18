import { PAIRING_TOKEN_STORAGE_KEY } from "./constants.js";

export async function savePairingToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [PAIRING_TOKEN_STORAGE_KEY]: token });
}

export async function loadPairingToken(): Promise<string | undefined> {
  const result = await chrome.storage.local.get(PAIRING_TOKEN_STORAGE_KEY);
  const value = result[PAIRING_TOKEN_STORAGE_KEY];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function clearPairingToken(): Promise<void> {
  await chrome.storage.local.remove(PAIRING_TOKEN_STORAGE_KEY);
}

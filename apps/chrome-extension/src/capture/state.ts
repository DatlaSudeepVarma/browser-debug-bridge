import {
  CAPTURE_STATE_STORAGE_KEY,
  TAB_ID_SALT_STORAGE_KEY,
} from "./limits.js";
import type { CaptureState } from "./messages.js";
import { generateTabIdSalt } from "./tab-hash.js";

const IDLE_STATE: CaptureState = { status: "idle" };

export async function getCaptureState(): Promise<CaptureState> {
  const result = await chrome.storage.session.get(CAPTURE_STATE_STORAGE_KEY);
  const value = result[CAPTURE_STATE_STORAGE_KEY];
  if (typeof value !== "object" || value === null) {
    return { ...IDLE_STATE };
  }
  const record = value as CaptureState;
  if (
    record.status !== "idle" &&
    record.status !== "picking" &&
    record.status !== "selected" &&
    record.status !== "submitting"
  ) {
    return { ...IDLE_STATE };
  }
  return record;
}

export async function setCaptureState(state: CaptureState): Promise<void> {
  await chrome.storage.session.set({ [CAPTURE_STATE_STORAGE_KEY]: state });
}

export async function clearCaptureState(): Promise<void> {
  await chrome.storage.session.remove(CAPTURE_STATE_STORAGE_KEY);
}

export async function getOrCreateTabIdSalt(): Promise<string> {
  const existing = await chrome.storage.local.get(TAB_ID_SALT_STORAGE_KEY);
  const value = existing[TAB_ID_SALT_STORAGE_KEY];
  if (typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) {
    return value;
  }
  const salt = generateTabIdSalt();
  await chrome.storage.local.set({ [TAB_ID_SALT_STORAGE_KEY]: salt });
  return salt;
}

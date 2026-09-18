import { loadPairingToken } from "../bridge/pairing.js";
import { getHealth } from "../bridge/client.js";
import { ERRORS } from "./errors.js";
import { setCaptureState } from "./state.js";

const RESTRICTED_PAGE_PATTERN =
  /^(chrome|chrome-extension|edge|about|devtools|view-source|chrome-search|chrome-untrusted):/i;

export function isRestrictedPage(url: string): boolean {
  if (RESTRICTED_PAGE_PATTERN.test(url)) {
    return true;
  }
  return (
    url.startsWith("https://chrome.google.com/webstore") ||
    url.startsWith("https://chromewebstore.google.com")
  );
}

export async function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

export async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content-script.js"],
  });
}

export async function startCaptureOnActiveTab(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const token = await loadPairingToken();
  if (token === undefined) {
    return { ok: false, error: ERRORS.unpaired };
  }

  try {
    await getHealth();
  } catch {
    return { ok: false, error: ERRORS.bridgeUnavailable };
  }

  const tab = await queryActiveTab();
  if (tab?.id === undefined) {
    return { ok: false, error: ERRORS.noActiveTab };
  }
  if (tab.url === undefined || isRestrictedPage(tab.url)) {
    return { ok: false, error: ERRORS.unsupportedPage };
  }

  try {
    await injectContentScript(tab.id);
  } catch {
    return { ok: false, error: ERRORS.injectionFailed };
  }

  await setCaptureState({
    status: "picking",
    startedAt: new Date().toISOString(),
    tabId: tab.id,
  });
  return { ok: true };
}

export const UNPAIRED_MESSAGE =
  "Browser Debug Bridge is not paired with VS Code.";

export const ERRORS = {
  unpaired: UNPAIRED_MESSAGE,
  bridgeUnavailable:
    "The local VS Code bridge is not reachable. Start VS Code and try again.",
  noActiveTab: "No active tab is available to capture.",
  unsupportedPage:
    "This page cannot be captured. Open a regular http(s) development page.",
  injectionFailed:
    "Could not start capture on this page. Reload the tab and try again.",
  pickerFailed: "The element picker could not start on this page.",
  noElement: "No element was selected.",
  cancelled: "Capture was cancelled.",
  screenshotFailed: "Could not capture a screenshot of the selected element.",
  screenshotNotVisible:
    "The selected element is not visible in the current viewport.",
  screenshotTooLarge: "The screenshot is too large to send.",
} as const;

export function userFacingError(error: unknown): string {
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  if (error instanceof Error && error.message.length > 0) {
    const message = error.message;
    if (/pair/i.test(message) || /unpaired/i.test(message)) {
      return UNPAIRED_MESSAGE;
    }
    if (/not reachable|failed to fetch|network/i.test(message)) {
      return ERRORS.bridgeUnavailable;
    }
    return message.slice(0, 280);
  }
  return "Capture failed.";
}

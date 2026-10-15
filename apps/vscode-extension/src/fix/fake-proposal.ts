import { FIXTURE_CHECKOUT_SERVICE } from "../project/test-fixtures/files.js";

export const FAKE_FIX_PROPOSAL = {
  summary: "Send the checkout request as POST.",
  rationale:
    "The session reports an HTTP 500 from the checkout API. Using POST is a possible change at the existing call site, not a guaranteed fix.",
  changes: [
    {
      relativePath: "src/services/checkout.ts",
      edits: [
        {
          startLine: 2,
          endLine: 2,
          replacement: '  return fetch("/api/checkout", { method: "POST" });',
        },
      ],
    },
  ],
};

export const FAKE_CHECKOUT_SOURCE = FIXTURE_CHECKOUT_SERVICE.trim();

export function jsonProposal(value: unknown): string {
  return JSON.stringify(value);
}

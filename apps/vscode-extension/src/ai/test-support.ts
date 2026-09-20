import type { ProjectContext } from "../project/types.js";
import { FIXTURE_BUY_NOW_BUTTON, FIXTURE_CHECKOUT_PAGE, FIXTURE_CHECKOUT_SERVICE } from "../project/test-fixtures/files.js";

export function createFixtureAiProjectContext(): ProjectContext {
  return {
    workspaceRoot: "/workspace/shop",
    folders: [{ name: "shop", root: "/workspace/shop" }],
    framework: {
      name: "nextjs",
      evidence: ["next in package.json"],
      reason: "next listed in package.json dependencies",
    },
    languageHints: ["TypeScript"],
    packageManager: {
      name: "pnpm",
      evidence: ["pnpm-lock.yaml"],
      reason: "pnpm-lock.yaml present in the workspace",
    },
    candidates: [
      {
        relativePath: "src/components/BuyNowButton.tsx",
        workspaceFolder: "shop",
        workspaceRoot: "/workspace/shop",
        score: 165,
        reasons: [
          {
            type: "console-stack",
            explanation: "Console stack path matches this workspace file",
            weight: 100,
          },
        ],
        excerpts: [{ startLine: 1, endLine: 6, content: FIXTURE_BUY_NOW_BUTTON.trim() }],
      },
      {
        relativePath: "src/app/checkout/page.tsx",
        workspaceFolder: "shop",
        workspaceRoot: "/workspace/shop",
        score: 115,
        reasons: [
          {
            type: "route",
            explanation: "Path segment 'checkout' matches file path",
            weight: 40,
          },
        ],
        excerpts: [{ startLine: 1, endLine: 10, content: FIXTURE_CHECKOUT_PAGE.trim() }],
      },
      {
        relativePath: "src/services/checkout.ts",
        workspaceFolder: "shop",
        workspaceRoot: "/workspace/shop",
        score: 65,
        reasons: [
          {
            type: "network",
            explanation: "Network path segment 'checkout' matches file path",
            weight: 25,
          },
        ],
        excerpts: [{ startLine: 1, endLine: 3, content: FIXTURE_CHECKOUT_SERVICE.trim() }],
      },
    ],
    metadata: {
      filesConsidered: 5,
      filesSelected: 3,
      truncated: false,
      contentReads: 3,
    },
  };
}

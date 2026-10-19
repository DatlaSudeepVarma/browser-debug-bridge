import { createProjectIntelligenceSession } from "../project/test-fixtures/session.js";
import { FAKE_DIAGNOSIS } from "../ai/fake-provider.js";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import type { Diagnosis } from "../ai/types.js";
import type { DiagnosisViewState } from "../ui/diagnosis-state.js";
import type { CanonicalPathIo } from "./canonical-path.js";
import { diagnosisCandidatePaths, buildBoundedSources } from "./source.js";

export function memoryWorkspaceCanonicalIo(
  workspaceRoot: string,
  relativePaths: readonly string[],
  options?: { realpathOverrides?: Record<string, string>; missingRoot?: boolean },
): CanonicalPathIo {
  const paths = new Set<string>([workspaceRoot]);
  for (const relativePath of relativePaths) {
    let current = workspaceRoot;
    for (const segment of relativePath.split("/").filter((part) => part.length > 0 && part !== ".")) {
      current = `${current}/${segment}`;
      paths.add(current);
    }
  }
  const exists = options?.missingRoot === true ? new Set<string>() : paths;
  const realpath: Record<string, string> = {};
  for (const item of exists) {
    realpath[item] = item;
  }
  Object.assign(realpath, options?.realpathOverrides ?? {});
  return {
    exists(target: string): boolean {
      return exists.has(target);
    },
    realpath(target: string): string {
      const resolved = realpath[target];
      if (resolved === undefined) {
        throw new Error(`missing realpath for ${target}`);
      }
      return resolved;
    },
    join(left: string, right: string): string {
      return left.endsWith("/") ? `${left}${right}` : `${left}/${right}`;
    },
    sep: "/",
    ignoreCase: false,
  };
}

export function fixtureCanonicalIo(options?: {
  realpathOverrides?: Record<string, string>;
  missingRoot?: boolean;
}): CanonicalPathIo {
  return memoryWorkspaceCanonicalIo(
    "/workspace/shop",
    [
      "src/services/checkout.ts",
      "src/components/BuyNowButton.tsx",
      "src/app/checkout/page.tsx",
    ],
    options,
  );
}

export function fixtureDiagnosisState(diagnosis: Diagnosis = FAKE_DIAGNOSIS): DiagnosisViewState {
  return {
    diagnosis,
    project: createFixtureAiProjectContext(),
    session: createProjectIntelligenceSession(),
    providerId: "fake",
    warnings: [],
  };
}

export function fixtureSources(diagnosis: Diagnosis = FAKE_DIAGNOSIS) {
  return buildBoundedSources(createFixtureAiProjectContext(), diagnosisCandidatePaths(diagnosis));
}

export function fixtureAllowedPaths(diagnosis: Diagnosis = FAKE_DIAGNOSIS): string[] {
  return fixtureSources(diagnosis).map((source) => source.relativePath);
}

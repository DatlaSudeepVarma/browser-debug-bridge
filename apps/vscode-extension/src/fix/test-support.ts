import { createProjectIntelligenceSession } from "../project/test-fixtures/session.js";
import { FAKE_DIAGNOSIS } from "../ai/fake-provider.js";
import { createFixtureAiProjectContext } from "../ai/test-support.js";
import type { Diagnosis } from "../ai/types.js";
import type { DiagnosisViewState } from "../ui/diagnosis-state.js";
import { diagnosisCandidatePaths, buildBoundedSources } from "./source.js";

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

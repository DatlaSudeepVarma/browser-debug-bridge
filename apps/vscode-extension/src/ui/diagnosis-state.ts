import type { AiAnalysisResult, Diagnosis } from "../ai/types.js";
import type { ProjectContext } from "../project/types.js";

export interface DiagnosisViewState {
  diagnosis: Diagnosis;
  project: ProjectContext;
  providerId: string;
  warnings: string[];
}

export type ApplyDiagnosisResult = "replaced" | "preserved";

export class DiagnosisController {
  private current: DiagnosisViewState | undefined;
  private running = false;

  public getDiagnosis(): DiagnosisViewState | undefined {
    return this.current === undefined
      ? undefined
      : {
          ...this.current,
          diagnosis: this.current.diagnosis,
          project: this.current.project,
        };
  }

  public setDiagnosis(state: DiagnosisViewState): void {
    this.current = state;
  }

  public clearDiagnosis(): void {
    this.current = undefined;
  }

  public applyResult(result: AiAnalysisResult, project: ProjectContext): ApplyDiagnosisResult {
    if (result.status !== "ok") {
      return "preserved";
    }
    this.setDiagnosis({
      diagnosis: result.diagnosis,
      project,
      providerId: result.providerId,
      warnings: result.warnings,
    });
    return "replaced";
  }

  public beginRun(): boolean {
    if (this.running) {
      return false;
    }
    this.running = true;
    return true;
  }

  public endRun(): void {
    this.running = false;
  }

  public isRunning(): boolean {
    return this.running;
  }
}

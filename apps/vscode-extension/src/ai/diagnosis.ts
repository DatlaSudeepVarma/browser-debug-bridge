import type { DebugSessionV1 } from "@browser-debug-bridge/schema";
import { AnalysisCancelledError, throwIfCancelled } from "../project/cancellation.js";
import type { CancellationTokenLike, ProjectContext } from "../project/types.js";
import { MAX_AI_RESPONSE_CHARS } from "./constants.js";
import { aiError } from "./errors.js";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompts.js";
import { serializeAiContext, type AiSerializeLimits } from "./serializer.js";
import type { AiAnalysisResult, AiProvider } from "./types.js";
import { extractJsonObject, validateDiagnosis } from "./validation.js";

export class DiagnosisService {
  public constructor(
    private readonly provider: AiProvider,
    private readonly options: { serializeLimits?: Partial<AiSerializeLimits> } = {},
  ) {}

  public async diagnose(
    session: DebugSessionV1,
    project: ProjectContext,
    cancellationToken?: CancellationTokenLike,
  ): Promise<AiAnalysisResult> {
    try {
      return await this.run(session, project, cancellationToken);
    } catch (error) {
      if (error instanceof AnalysisCancelledError) {
        return {
          status: "error",
          providerId: this.provider.id,
          error: aiError("AI_CANCELLED", "The diagnosis request was cancelled."),
        };
      }
      throw error;
    }
  }

  private async run(
    session: DebugSessionV1,
    project: ProjectContext,
    token?: CancellationTokenLike,
  ): Promise<AiAnalysisResult> {
    throwIfCancelled(token);
    const available = await this.provider.isAvailable();
    throwIfCancelled(token);
    if (!available) {
      return {
        status: "error",
        providerId: this.provider.id,
        error: aiError("AI_UNAVAILABLE", "No language model is available."),
      };
    }

    const serialized = serializeAiContext(session, project, token, this.options.serializeLimits);
    if (serialized.status === "cancelled") {
      return {
        status: "error",
        providerId: this.provider.id,
        error: aiError("AI_CANCELLED", "The diagnosis request was cancelled."),
      };
    }
    if (serialized.status === "too-large") {
      return {
        status: "error",
        providerId: this.provider.id,
        error: aiError("AI_CONTEXT_TOO_LARGE", "The bounded AI context still exceeded the size budget."),
      };
    }

    const completion = await this.provider.complete(
      {
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(serialized.context.text),
      },
      token,
    );
    throwIfCancelled(token);
    if (completion.status === "error") {
      return {
        status: "error",
        providerId: this.provider.id,
        error: completion.error,
      };
    }
    if (completion.text.length > MAX_AI_RESPONSE_CHARS) {
      return {
        status: "error",
        providerId: this.provider.id,
        error: aiError("AI_RESPONSE_TOO_LARGE", "The model response exceeded the diagnosis size limit."),
      };
    }

    try {
      const parsed = extractJsonObject(completion.text);
      const validated = validateDiagnosis(
        parsed,
        serialized.context.evidenceIds,
        serialized.context.candidatePaths,
      );
      return {
        status: "ok",
        diagnosis: validated.diagnosis,
        providerId: this.provider.id,
        warnings: validated.warnings,
        contextChars: serialized.context.charCount,
        candidateCount: serialized.context.candidateCount,
      };
    } catch {
      return {
        status: "error",
        providerId: this.provider.id,
        error: aiError("AI_RESPONSE_INVALID", "The model response was not a valid diagnosis."),
      };
    }
  }
}

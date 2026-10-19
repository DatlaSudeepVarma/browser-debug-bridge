import type { DebugSessionV1 } from "@browser-debug-bridge/schema";
import { AnalysisCancelledError, throwIfCancelled } from "../project/cancellation.js";
import type { CancellationTokenLike, ProjectContext } from "../project/types.js";
import type { AiProvider, Diagnosis } from "../ai/types.js";
import { nodeCanonicalIo, type CanonicalPathIo } from "./canonical-path.js";
import { MAX_FIX_OUTPUT_CHARS } from "./constants.js";
import { generateUnifiedDiff } from "./diff.js";
import { validateUnifiedDiff } from "./diff-validation.js";
import { fixError, mapProviderError } from "./errors.js";
import { diagnosisFingerprint } from "./hash.js";
import {
  captureSourceBaselines,
  verifyProposedBaselines,
  type LiveFileReader,
} from "./live-file.js";
import { buildFixUserPrompt, FIX_SYSTEM_PROMPT } from "./prompts.js";
import { serializeFixContext, type FixSerializeLimits } from "./serializer.js";
import { buildBoundedSources } from "./source.js";
import type { FixProposalResult } from "./types.js";
import { parseFixProposalJson, validateProposedChange } from "./validation.js";

export interface FixProposalServiceOptions {
  serializeLimits?: Partial<FixSerializeLimits>;
  liveFileReader?: LiveFileReader;
  canonicalIo?: CanonicalPathIo;
}

export class FixProposalService {
  public constructor(
    private readonly provider: AiProvider,
    private readonly options: FixProposalServiceOptions = {},
  ) {}

  public async propose(
    session: DebugSessionV1,
    project: ProjectContext,
    diagnosis: Diagnosis,
    cancellationToken?: CancellationTokenLike,
  ): Promise<FixProposalResult> {
    try {
      return await this.run(session, project, diagnosis, cancellationToken);
    } catch (error) {
      if (error instanceof AnalysisCancelledError) {
        return {
          status: "error",
          providerId: this.provider.id,
          error: fixError("AI_FIX_CANCELLED", "The fix proposal request was cancelled."),
        };
      }
      throw error;
    }
  }

  private async run(
    session: DebugSessionV1,
    project: ProjectContext,
    diagnosis: Diagnosis,
    token?: CancellationTokenLike,
  ): Promise<FixProposalResult> {
    throwIfCancelled(token);
    const available = await this.provider.isAvailable();
    throwIfCancelled(token);
    if (!available) {
      return {
        status: "error",
        providerId: this.provider.id,
        error: fixError("AI_FIX_UNAVAILABLE", "No language model is available."),
      };
    }

    const serialized = serializeFixContext(
      session,
      project,
      diagnosis,
      token,
      this.options.serializeLimits,
    );
    if (serialized.status === "cancelled") {
      return {
        status: "error",
        providerId: this.provider.id,
        error: fixError("AI_FIX_CANCELLED", "The fix proposal request was cancelled."),
      };
    }
    if (serialized.status === "insufficient") {
      return {
        status: "error",
        providerId: this.provider.id,
        error: fixError(
          "AI_FIX_CONTEXT_INSUFFICIENT",
          "The diagnosis does not include usable candidate file excerpts.",
        ),
      };
    }
    if (serialized.status === "too-large") {
      return {
        status: "error",
        providerId: this.provider.id,
        error: fixError("AI_FIX_CONTEXT_TOO_LARGE", "The bounded fix context exceeded the size budget."),
      };
    }

    const sources = buildBoundedSources(
      project,
      serialized.context.allowedPaths,
      this.options.serializeLimits,
    );
    const liveFileReader = this.options.liveFileReader;
    const canonicalIo = this.options.canonicalIo ?? nodeCanonicalIo;
    const capturedBaselines =
      liveFileReader === undefined
        ? undefined
        : await captureSourceBaselines({
            sources,
            project,
            allowedPaths: serialized.context.allowedPaths,
            reader: liveFileReader,
            canonicalIo,
          });
    throwIfCancelled(token);
    const completion = await this.provider.complete(
      {
        system: FIX_SYSTEM_PROMPT,
        user: buildFixUserPrompt(serialized.context.text),
      },
      token,
    );
    throwIfCancelled(token);
    if (completion.status === "error") {
      return {
        status: "error",
        providerId: this.provider.id,
        error: mapProviderError(completion.error),
      };
    }
    if (completion.text.length > MAX_FIX_OUTPUT_CHARS) {
      return {
        status: "error",
        providerId: this.provider.id,
        error: fixError("AI_FIX_RESPONSE_TOO_LARGE", "The model response exceeded the fix proposal size limit."),
      };
    }

    let raw: unknown;
    try {
      raw = parseFixProposalJson(completion.text);
    } catch {
      return {
        status: "error",
        providerId: this.provider.id,
        error: fixError("AI_FIX_RESPONSE_INVALID", "The model response was not valid JSON."),
      };
    }

    const validated = validateProposedChange(
      raw,
      project,
      sources,
      serialized.context.allowedPaths,
    );
    if (validated.status === "too-large") {
      return {
        status: "error",
        providerId: this.provider.id,
        error: fixError("AI_FIX_PROPOSAL_TOO_LARGE", "The proposed change exceeded configured size limits."),
      };
    }
    if (validated.status !== "ok") {
      return {
        status: "error",
        providerId: this.provider.id,
        error: fixError("AI_FIX_RESPONSE_INVALID", "The model response was not a valid proposed change."),
      };
    }

    const generated = generateUnifiedDiff(validated.proposedChange, sources);
    if (generated.status !== "ok") {
      return {
        status: "error",
        providerId: this.provider.id,
        error: fixError("AI_DIFF_INVALID", "The proposed edits could not be converted into a unified diff."),
      };
    }
    const diff = validateUnifiedDiff(
      generated.text,
      validated.proposedChange,
      project,
      serialized.context.allowedPaths,
    );
    if (diff.status === "too-large") {
      return {
        status: "error",
        providerId: this.provider.id,
        error: fixError("AI_FIX_PROPOSAL_TOO_LARGE", "The generated diff exceeded configured size limits."),
      };
    }
    if (diff.status !== "ok") {
      return {
        status: "error",
        providerId: this.provider.id,
        error: fixError("AI_DIFF_INVALID", "The generated unified diff failed validation."),
      };
    }

    let liveFileHashes: Readonly<Record<string, string>> | undefined;
    if (liveFileReader !== undefined) {
      throwIfCancelled(token);
      const verified = await verifyProposedBaselines({
        changes: validated.proposedChange.changes,
        sources,
        project,
        allowedPaths: serialized.context.allowedPaths,
        captured: capturedBaselines ?? new Map(),
        reader: liveFileReader,
        canonicalIo,
      });
      if (verified.status === "changed") {
        return {
          status: "error",
          providerId: this.provider.id,
          error: fixError(
            "AI_FIX_SOURCE_CHANGED",
            "A proposed file changed while the fix proposal was being generated.",
          ),
        };
      }
      if (verified.status !== "ok") {
        return {
          status: "error",
          providerId: this.provider.id,
          error: fixError(
            "AI_FIX_SOURCE_UNAVAILABLE",
            "A proposed file could not be read as a trusted full-file baseline.",
          ),
        };
      }
      liveFileHashes = verified.liveFileHashes;
    }

    return {
      status: "ok",
      providerId: this.provider.id,
      contextChars: serialized.context.charCount,
      fileCount: serialized.context.fileCount,
      proposal: {
        proposedChange: validated.proposedChange,
        diff: diff.diff,
        identity: {
          sessionId: session.sessionId,
          diagnosisFingerprint: diagnosisFingerprint(diagnosis),
          sourceFingerprint: serialized.context.sourceFingerprint,
        },
        createdAt: new Date().toISOString(),
        providerId: this.provider.id,
        liveFileHashes,
      },
    };
  }
}

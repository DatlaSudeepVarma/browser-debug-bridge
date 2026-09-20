import * as vscode from "vscode";
import { AnalysisCancelledError, throwIfCancelled } from "../project/cancellation.js";
import type { CancellationTokenLike } from "../project/types.js";
import { MAX_AI_RESPONSE_CHARS, VSCODE_LM_PROVIDER_ID } from "./constants.js";
import { aiError, isCancelledError, mapLanguageModelFailure } from "./errors.js";
import { pickDeterministicIdentity } from "./model-select.js";
import type { AiChatInput, AiCompletionResult, AiProvider } from "./types.js";

export class VscodeLmProvider implements AiProvider {
  public readonly id = VSCODE_LM_PROVIDER_ID;
  public readonly displayName = "VS Code Language Model";

  public async isAvailable(): Promise<boolean> {
    const models = await vscode.lm.selectChatModels();
    return models.length > 0;
  }

  public async complete(
    input: AiChatInput,
    cancellationToken?: CancellationTokenLike,
  ): Promise<AiCompletionResult> {
    try {
      throwIfCancelled(cancellationToken);
      const models = await vscode.lm.selectChatModels();
      const model = pickDeterministicIdentity(models);
      if (model === undefined) {
        return {
          status: "error",
          error: aiError("AI_UNAVAILABLE", "No language model is available."),
        };
      }
      throwIfCancelled(cancellationToken);

      const vscodeToken = toVscodeCancellation(cancellationToken);
      const response = await model.sendRequest(
        [
          vscode.LanguageModelChatMessage.User(input.system),
          vscode.LanguageModelChatMessage.User(input.user),
        ],
        {
          justification:
            "Browser Debug Bridge produces a read-only diagnosis from a debug session and bounded project context.",
        },
        vscodeToken?.token,
      );

      let text = "";
      for await (const chunk of response.text) {
        throwIfCancelled(cancellationToken);
        text += chunk;
        if (text.length > MAX_AI_RESPONSE_CHARS) {
          vscodeToken?.dispose();
          return {
            status: "error",
            error: aiError("AI_RESPONSE_TOO_LARGE", "The model response exceeded the diagnosis size limit."),
          };
        }
      }
      vscodeToken?.dispose();
      return { status: "ok", text };
    } catch (error) {
      if (error instanceof AnalysisCancelledError || isCancelledError(error)) {
        return {
          status: "error",
          error: aiError("AI_CANCELLED", "The diagnosis request was cancelled."),
        };
      }
      if (error instanceof vscode.LanguageModelError) {
        return { status: "error", error: mapLanguageModelFailure(error.code) };
      }
      return {
        status: "error",
        error: aiError("AI_REQUEST_FAILED", "The language model request failed."),
      };
    }
  }
}

function toVscodeCancellation(
  token?: CancellationTokenLike,
): { token: vscode.CancellationToken; dispose(): void } | undefined {
  if (token === undefined) {
    return undefined;
  }
  const source = new vscode.CancellationTokenSource();
  if (token.isCancellationRequested) {
    source.cancel();
  }
  const subscription = token.onCancellationRequested(() => {
    source.cancel();
  });
  return {
    token: source.token,
    dispose(): void {
      subscription.dispose();
      source.dispose();
    },
  };
}

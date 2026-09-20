import { throwIfCancelled } from "../project/cancellation.js";
import type { CancellationTokenLike } from "../project/types.js";
import { FAKE_PROVIDER_ID } from "./constants.js";
import type { AiChatInput, AiCompletionResult, AiProvider, Diagnosis } from "./types.js";

export const FAKE_DIAGNOSIS: Diagnosis = {
  summary:
    "The selected button appears connected to the checkout flow, while the browser session also reports a 500 response from the checkout API.",
  hypotheses: [
    {
      title: "Checkout API failure",
      explanation:
        "The session captured an HTTP 500 for the checkout API. The checkout service is a supplied candidate and is a plausible place to inspect next.",
      evidence: [
        {
          source: "BROWSER.network[0]",
          detail: "HTTP 500 on the redacted checkout API path.",
        },
      ],
      candidateFiles: [
        {
          relativePath: "src/services/checkout.ts",
          reason: "Network path match",
        },
      ],
    },
  ],
  suggestedNextStep: "Inspect the checkout service and the component that triggers the request.",
  limitations: ["The screenshot bytes were not supplied to the model."],
};

export class FakeAiProvider implements AiProvider {
  public readonly id = FAKE_PROVIDER_ID;
  public readonly displayName = "Fake (tests only)";

  public constructor(private readonly responseText: string = JSON.stringify(FAKE_DIAGNOSIS)) {}

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async complete(
    _input: AiChatInput,
    cancellationToken?: CancellationTokenLike,
  ): Promise<AiCompletionResult> {
    throwIfCancelled(cancellationToken);
    return { status: "ok", text: this.responseText };
  }
}

export class UnavailableAiProvider implements AiProvider {
  public readonly id = "unavailable";
  public readonly displayName = "Unavailable";

  public async isAvailable(): Promise<boolean> {
    return false;
  }

  public async complete(): Promise<AiCompletionResult> {
    return {
      status: "error",
      error: {
        code: "AI_UNAVAILABLE",
        message: "No language model is available.",
      },
    };
  }
}

export class FailingAiProvider implements AiProvider {
  public readonly id = "failing";
  public readonly displayName = "Failing";

  public constructor(private readonly text?: string) {}

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async complete(): Promise<AiCompletionResult> {
    if (this.text !== undefined) {
      return { status: "ok", text: this.text };
    }
    return {
      status: "error",
      error: {
        code: "AI_REQUEST_FAILED",
        message: "The language model request failed.",
      },
    };
  }
}

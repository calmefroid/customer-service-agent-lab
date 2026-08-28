import { fallbackRoute } from "@/lib/agent-runtime/route-schema";
import type { ChatRequest } from "@/lib/contracts";

import { throwForMockBehavior, throwIfModelAborted } from "./model-error";
import type {
  MockModelBehavior,
  ModelCallOptions,
  TextAnswerInput,
  TextAnswerOutput,
  TextModelAdapter,
  TextRouteInput,
  TextRouteOutput,
} from "./types";

export interface MockTextModelOptions {
  behavior?: MockModelBehavior;
}

export class MockTextModelAdapter implements TextModelAdapter {
  readonly provider = "LocalMockModelAdapter";
  readonly model = "mock-text-router-v1";
  readonly mode = "mock" as const;
  callCount = 0;
  answerCallCount = 0;
  lastInput?: TextRouteInput;
  private readonly behavior: MockModelBehavior;

  constructor(options: MockTextModelOptions = {}) {
    this.behavior = options.behavior ?? "success";
  }

  async route(input: TextRouteInput, options: ModelCallOptions = {}): Promise<TextRouteOutput> {
    this.callCount += 1;
    this.lastInput = {
      ...input,
      history: input.history.map((message) => ({ ...message })),
      observations: [...input.observations],
      remainingIntents: [...input.remainingIntents],
      responseSchema: { ...input.responseSchema },
    };
    throwIfModelAborted(options.signal);
    if (this.behavior !== "success" && this.behavior !== "invalid_json") throwForMockBehavior(this.behavior);

    const route = fallbackRoute({
      message: input.message,
      module: input.module,
      action: input.action as ChatRequest["action"],
      attachment: input.attachment,
      observations: input.observations,
    });
    if (input.remainingIntents.length && route.remainingIntents.length === 0) {
      route.remainingIntents = [...input.remainingIntents];
    }

    return {
      raw: this.behavior === "invalid_json" ? "{invalid-model-json" : JSON.stringify(route),
      provider: this.provider,
      model: this.model,
      mode: this.mode,
    };
  }

  async answer(input: TextAnswerInput, options: ModelCallOptions = {}): Promise<TextAnswerOutput> {
    this.answerCallCount += 1;
    throwIfModelAborted(options.signal);
    if (this.behavior !== "success" && this.behavior !== "invalid_json") throwForMockBehavior(this.behavior);
    return {
      text: input.workflowResult.message,
      provider: this.provider,
      model: this.model,
      mode: this.mode,
    };
  }
}

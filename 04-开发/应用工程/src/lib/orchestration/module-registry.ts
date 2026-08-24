import type { AgentEvent, ChatRequest, ChatResponse } from "@/lib/contracts";

export const ORCHESTRATION_PHASES = [
  "router",
  "guardrail",
  "workflow",
  "tool_or_rag",
  "output",
] as const;

export type OrchestrationPhase = (typeof ORCHESTRATION_PHASES)[number];

export interface OrchestrationContext {
  request: ChatRequest;
  signal?: AbortSignal;
  emit: (event: AgentEvent) => void;
}

export interface OrchestrationModule {
  id: string;
  owner: "00" | "01" | "02" | "03" | "04" | "05" | "06";
  version: string;
  priority: number;
  phases: readonly OrchestrationPhase[];
  supports: (request: ChatRequest) => boolean;
  execute: (context: OrchestrationContext) => Promise<ChatResponse>;
}

export class ModuleRegistry {
  private readonly modules = new Map<string, OrchestrationModule>();

  register(module: OrchestrationModule): void {
    this.modules.set(module.id, module);
  }

  unregister(moduleId: string): void {
    this.modules.delete(moduleId);
  }

  list(): OrchestrationModule[] {
    return [...this.modules.values()].sort(
      (left, right) => right.priority - left.priority || left.id.localeCompare(right.id),
    );
  }

  resolve(request: ChatRequest): OrchestrationModule | undefined {
    return this.list().find((module) => module.supports(request));
  }

  async execute(
    request: ChatRequest,
    options: { signal?: AbortSignal; emit?: (event: AgentEvent) => void } = {},
  ): Promise<ChatResponse> {
    const module = this.resolve(request);
    if (!module) {
      throw new Error("NO_ORCHESTRATION_MODULE");
    }
    return module.execute({
      request,
      signal: options.signal,
      emit: options.emit ?? (() => undefined),
    });
  }
}

export const agentModuleRegistry = new ModuleRegistry();

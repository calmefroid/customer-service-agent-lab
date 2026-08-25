import type { OrchestrationModule } from "@/lib/orchestration/module-registry";
import { agentModuleRegistry } from "@/lib/orchestration/module-registry";
import { orchestrateMock } from "@/lib/mock-orchestrator";

const legacyMockModule: OrchestrationModule = {
  id: "legacy-mock-orchestrator",
  owner: "00",
  version: "1.0.0",
  priority: -100,
  phases: ["router", "guardrail", "workflow", "tool_or_rag", "output"],
  supports: () => true,
  execute: ({ request }) => orchestrateMock(request),
};

agentModuleRegistry.register(legacyMockModule);

export async function runRegisteredAgent(request: Parameters<typeof orchestrateMock>[0]) {
  return agentModuleRegistry.execute(request);
}

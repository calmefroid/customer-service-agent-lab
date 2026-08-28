import { describe, expect, it } from "vitest";

import {
  AGENT_EVENT_TYPES,
  KNOWLEDGE_RETRIEVAL_STATUSES,
  PUBLIC_CONTRACT_VERSION,
  TOOL_RESULT_STATUSES,
  TRACE_EVENT_TYPES,
} from "@/lib/contracts";
import { ModuleRegistry } from "@/lib/orchestration/module-registry";

const request = { sessionId: "registry-test", message: "test" };

describe("public contracts v1", () => {
  it("freezes the cross-module discriminators", () => {
    expect(PUBLIC_CONTRACT_VERSION).toBe("1.1.0");
    expect(AGENT_EVENT_TYPES).toEqual(["progress", "token", "ui", "final", "error"]);
    expect(TOOL_RESULT_STATUSES).toEqual([
      "success",
      "empty",
      "timeout",
      "business_error",
      "system_error",
    ]);
    expect(KNOWLEDGE_RETRIEVAL_STATUSES).toEqual(["hit", "no_hit", "conflict", "expired"]);
    expect(TRACE_EVENT_TYPES).toEqual([
      "model",
      "route",
      "rag",
      "tool",
      "rule",
      "confirmation",
      "output",
      "error",
    ]);
  });
});

describe("module registry", () => {
  it("selects the highest-priority compatible module", async () => {
    const registry = new ModuleRegistry();
    registry.register({
      id: "fallback",
      owner: "00",
      version: "1",
      priority: 0,
      phases: ["workflow"],
      supports: () => true,
      execute: async () => ({
        message: "fallback",
        intent: "other",
        riskLevel: "low",
        traceId: "fallback",
      }),
    });
    registry.register({
      id: "preferred",
      owner: "01",
      version: "1",
      priority: 10,
      phases: ["router", "workflow", "output"],
      supports: (candidate) => candidate.message === "test",
      execute: async () => ({
        message: "preferred",
        intent: "smalltalk",
        riskLevel: "low",
        traceId: "preferred",
      }),
    });

    await expect(registry.execute(request)).resolves.toMatchObject({ message: "preferred" });
  });

  it("fails closed when no module supports the request", async () => {
    const registry = new ModuleRegistry();
    await expect(registry.execute(request)).rejects.toThrow("NO_ORCHESTRATION_MODULE");
  });
});

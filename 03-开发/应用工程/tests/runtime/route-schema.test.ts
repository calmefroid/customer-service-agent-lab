import { describe, expect, it } from "vitest";

import { fallbackRoute, parseStructuredRoute } from "@/lib/agent-runtime/route-schema";

describe("structured route schema", () => {
  it("accepts the four-dimensional intent output", () => {
    const parsed = parseStructuredRoute(JSON.stringify({
      module: "repair",
      intent: "troubleshooting",
      topic: "smart_setup.setup_failure",
      action: "retrieve_kb_then_diagnose",
      confidence: 0.96,
      needsClarification: false,
      requiresConfirmation: false,
      requiresHuman: false,
      remainingIntents: [],
      entities: { productId: null },
      observations: [],
    }));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.topic).toBe("smart_setup.setup_failure");
  });

  it("rejects unknown intents and invalid confidence", () => {
    expect(parseStructuredRoute('{"module":"repair","intent":"invented","topic":"x","action":"x","confidence":2}')).toMatchObject({ ok: false });
  });

  it("prioritizes safety and preserves a remaining business intent", () => {
    const route = fallbackRoute({ message: "灯在冒烟，另外帮我申请报修" });
    expect(route.intent).toBe("human_escalation");
    expect(route.requiresHuman).toBe(true);
    expect(route.remainingIntents).toContain("service_ticket_create");
  });
});

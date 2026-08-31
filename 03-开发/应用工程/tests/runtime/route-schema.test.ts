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

  it("does not treat an attachment or return module as proof of a return intent", () => {
    const route = fallbackRoute({
      message: "这张铭牌很模糊，能看清吗",
      module: "return",
      attachment: { name: "virtual-blurry.jpg", type: "image/jpeg", size: 700 },
      observations: ["图片中的铭牌区域模糊，型号字符无法确认"],
    });

    expect(route).toMatchObject({ intent: "clarification", needsClarification: true });
  });

  it("combines a neutral user message with visible damage observation", () => {
    const route = fallbackRoute({
      message: "请根据图片帮我处理",
      attachment: { name: "virtual-damage.jpg", type: "image/jpeg", size: 900 },
      observations: ["图片中可见灯罩边缘存在裂纹样现象；不确定项：无法判断责任和退换资格"],
    });

    expect(route).toMatchObject({ intent: "return_exchange", module: "return", topic: "return.arrival_damage" });
  });
});

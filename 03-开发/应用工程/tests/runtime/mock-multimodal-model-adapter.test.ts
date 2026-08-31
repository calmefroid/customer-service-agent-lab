import { describe, expect, it } from "vitest";

import { MockMultimodalModelAdapter } from "@/lib/models";

const baseInput = {
  attachment: { name: "image.jpg", type: "image/jpeg", size: 900 },
  history: [],
};

describe("MockMultimodalModelAdapter observation rules", () => {
  it("reads a visible model from a clear nameplate without business routing", async () => {
    const adapter = new MockMultimodalModelAdapter();
    const output = await adapter.observe({
      ...baseInput,
      message: "帮我看看这是什么型号",
      attachment: { ...baseInput.attachment, name: "virtual-nameplate.jpg" },
    });

    expect(output).toMatchObject({ requiresBusinessRouting: false });
    expect(output.summary).toContain("LUM-36W");
    expect(output.responseText).toContain("型号");
    expect(output.responseText).not.toContain("可以退换");
  });

  it("marks a blurry nameplate as uncertain and asks for another photo", async () => {
    const adapter = new MockMultimodalModelAdapter();
    const output = await adapter.observe({
      ...baseInput,
      message: "这张铭牌很模糊，能看清吗",
      attachment: { ...baseInput.attachment, name: "virtual-blurry.jpg" },
    });

    expect(output).toMatchObject({ requiresBusinessRouting: false });
    expect(output.summary).toContain("无法确认");
    expect(output.responseText).toContain("补拍");
    expect(output.responseText).not.toContain("换货");
  });

  it("routes visible arrival damage while preserving decision boundaries", async () => {
    const adapter = new MockMultimodalModelAdapter();
    const output = await adapter.observe({
      ...baseInput,
      message: "灯罩收到时碎了，帮我处理",
      attachment: { ...baseInput.attachment, name: "virtual-damage.jpg" },
    });

    expect(output).toMatchObject({ requiresBusinessRouting: true });
    expect(output.summary).toContain("裂纹");
    expect(output.uncertainties.join(" ")).toMatch(/责任.*退换资格/);
    expect(output.responseText).not.toMatch(/确认.*责任|符合退换资格|同意赔偿/);
  });
});

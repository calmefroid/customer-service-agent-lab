import { describe, expect, it } from "vitest";

import { validateAttachment } from "@/lib/agent-runtime/attachment-validation";

describe("validateAttachment", () => {
  it("accepts matching base64 image content", () => {
    expect(validateAttachment({
      name: "image.png",
      type: "image/png",
      size: 1,
      dataUrl: "data:image/png;base64,AA==",
    })).toBeUndefined();
  });

  it("rejects mismatched mime and declared size", () => {
    expect(validateAttachment({
      name: "image.png",
      type: "image/png",
      size: 1,
      dataUrl: "data:image/jpeg;base64,AA==",
    })).toBe("图片类型与内容不匹配");
    expect(validateAttachment({
      name: "image.png",
      type: "image/png",
      size: 2,
      dataUrl: "data:image/png;base64,AA==",
    })).toBe("图片内容大小与声明不匹配");
  });
});

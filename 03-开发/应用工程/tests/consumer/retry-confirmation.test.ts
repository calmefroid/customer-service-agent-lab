import { describe, expect, it } from "vitest";

import { confirmationDecision } from "@/components/chat/confirmation-decision";
import { createRetryMessage } from "@/components/chat/retry-message";
import type { LocalMessage } from "@/components/chat/types";

describe("consumer retry and confirmation safety", () => {
  it("preserves original text, attachment metadata and preview on retry", () => {
    const original: LocalMessage = {
      id: "user-1",
      role: "user",
      text: "这张图有破损",
      image: { url: "blob:test", name: "damage.png", status: "failed" },
      retryRequest: {
        message: "这张图有破损",
        module: "return",
        attachment: { name: "damage.png", type: "image/png", size: 128 },
      },
    };

    expect(createRetryMessage(original, "user-2")).toEqual({
      ...original,
      id: "user-2",
      image: { ...original.image, status: "uploading" },
    });
  });

  it("never maps cancel or edit to a submit decision", () => {
    expect(confirmationDecision("cancel")).toEqual({ shouldSubmit: false, shouldCancel: true, shouldEdit: false });
    expect(confirmationDecision("edit").shouldSubmit).toBe(false);
    expect(confirmationDecision("confirm").shouldSubmit).toBe(true);
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { feedbackStore } from "@/lib/stores/feedback-store";

describe("consumer feedback store", () => {
  beforeEach(() => feedbackStore.reset());

  it("merges rating, resolution and an optional reason for one answer", () => {
    feedbackStore.save({
      sessionId: "session-1",
      messageId: "message-1",
      rating: "down",
      reason: "没有解决问题",
    });
    const saved = feedbackStore.save({
      sessionId: "session-1",
      messageId: "message-1",
      resolved: false,
    });

    expect(saved).toMatchObject({
      sessionId: "session-1",
      messageId: "message-1",
      rating: "down",
      reason: "没有解决问题",
      resolved: false,
    });
    expect(feedbackStore.list()).toHaveLength(1);
  });

  it("keeps separate sessions isolated and supports reset", () => {
    feedbackStore.save({ sessionId: "session-1", messageId: "message-1", rating: "up" });
    feedbackStore.save({ sessionId: "session-2", messageId: "message-1", rating: "down" });
    expect(feedbackStore.list("session-1")).toHaveLength(1);
    feedbackStore.reset();
    expect(feedbackStore.list()).toEqual([]);
  });
});

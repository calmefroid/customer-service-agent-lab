import { describe, expect, it } from "vitest";

import { InMemorySessionStore } from "@/lib/sessions";

describe("InMemorySessionStore", () => {
  it("stores messages, observations and remaining intents and can reset", () => {
    const sessions = new InMemorySessionStore();
    sessions.appendMessage("S-1", { role: "user", content: "灯罩碎了", createdAt: "2026-08-24T00:00:00.000Z" });
    sessions.addObservation("S-1", { attachmentName: "damage.jpg", summary: "可见裂纹", uncertainties: ["无法判责"], createdAt: "2026-08-24T00:00:01.000Z" });
    sessions.setRemainingIntents("S-1", ["logistics_query"]);

    expect(sessions.get("S-1")).toMatchObject({
      sessionId: "S-1",
      remainingIntents: ["logistics_query"],
    });
    expect(sessions.get("S-1")?.observations[0].summary).toBe("可见裂纹");

    sessions.reset("S-1");
    expect(sessions.get("S-1")).toBeUndefined();
  });

  it("returns defensive copies", () => {
    const sessions = new InMemorySessionStore();
    sessions.appendMessage("S-2", { role: "user", content: "你好", createdAt: "2026-08-24T00:00:00.000Z" });
    const snapshot = sessions.get("S-2");
    snapshot?.messages.push({ role: "assistant", content: "篡改", createdAt: "2026-08-24T00:00:01.000Z" });
    expect(sessions.get("S-2")?.messages).toHaveLength(1);
  });
});

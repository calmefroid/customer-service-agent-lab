import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/chat/stream/route";
import type { AgentEvent } from "@/lib/contracts";

function parseEvents(text: string): AgentEvent[] {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => JSON.parse(block.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as AgentEvent);
}

describe("POST /api/chat/stream", () => {
  it("streams versioned SSE progress, token and final events in sequence", async () => {
    const request = new Request("http://localhost/api/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "S-SSE", message: "你好" }),
    });

    const response = await POST(request);
    const events = parseEvents(await response.text());

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(events.some((event) => event.type === "progress")).toBe(true);
    expect(events.some((event) => event.type === "token")).toBe(true);
    expect(events.at(-1)?.type).toBe("final");
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    const final = events.at(-1);
    expect(final?.type === "final" && final.response).not.toHaveProperty("debug");
    expect(final?.type === "final" && final.response).not.toHaveProperty("route");
  });

  it("rejects unsupported images before opening the stream", async () => {
    const response = await POST(new Request("http://localhost/api/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "S-SSE-BAD",
        message: "看图",
        attachment: { name: "bad.gif", type: "image/gif", size: 100 },
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "图片格式不支持" });
  });
});

import { describe, expect, it, vi } from "vitest";

import { requestSandboxReset } from "../../src/lib/operations/reset";

describe("operations sandbox reset", () => {
  it("只调用 00 统一重置 API 并携带显式确认短语", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      resetAt: "2026-09-01T12:00:00+08:00",
      scopes: ["business", "knowledge", "runtime", "trace", "feedback", "evals"],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    const result = await requestSandboxReset(fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/api/sandbox/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "all", confirmation: "RESET_SANDBOX" }),
    });
    expect(result).toEqual({
      resetAt: "2026-09-01T12:00:00+08:00",
      scopes: ["business", "knowledge", "runtime", "trace", "feedback", "evals"],
    });
  });

  it("统一重置 API 失败时返回后台错误而不伪造成功", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "trace reset failed" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

    await expect(requestSandboxReset(fetcher)).rejects.toThrow("trace reset failed");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

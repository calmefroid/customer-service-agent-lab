export interface SandboxResetResult {
  resetAt: string;
  scopes: string[];
}

type ResetResponse = {
  resetAt?: unknown;
  scopes?: unknown;
  resetScopes?: unknown;
  error?: unknown;
  message?: unknown;
};

export async function requestSandboxReset(fetcher: typeof fetch = fetch): Promise<SandboxResetResult> {
  const response = await fetcher("/api/sandbox/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "all", confirmation: "RESET_SANDBOX" }),
  });
  const body = await response.json().catch(() => ({})) as ResetResponse;
  if (!response.ok) {
    const message = typeof body.error === "string"
      ? body.error
      : typeof body.message === "string" ? body.message : "Sandbox 重置失败";
    throw new Error(message);
  }
  if (typeof body.resetAt !== "string") throw new Error("Sandbox 重置响应缺少 resetAt");
  const rawScopes = Array.isArray(body.scopes) ? body.scopes : Array.isArray(body.resetScopes) ? body.resetScopes : [];
  return {
    resetAt: body.resetAt,
    scopes: rawScopes.filter((scope): scope is string => typeof scope === "string"),
  };
}

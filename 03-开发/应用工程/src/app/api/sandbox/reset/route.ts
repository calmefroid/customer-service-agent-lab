import { NextResponse } from "next/server";

import { resetSandboxState, SandboxResetError } from "@/lib/sandbox/reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResetRequest {
  scope?: unknown;
  confirmation?: unknown;
}

export async function POST(request: Request) {
  let body: ResetRequest;
  try {
    body = await request.json() as ResetRequest;
  } catch {
    return NextResponse.json({ error: "INVALID_RESET_REQUEST" }, { status: 400 });
  }
  if (body.scope !== "all" || body.confirmation !== "RESET_SANDBOX") {
    return NextResponse.json({ error: "RESET_CONFIRMATION_REQUIRED" }, { status: 400 });
  }
  try {
    return NextResponse.json(await resetSandboxState());
  } catch (error) {
    if (error instanceof SandboxResetError && error.code === "SANDBOX_RESET_IN_PROGRESS") {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
    const failedScope = error instanceof SandboxResetError ? error.failedScope : undefined;
    return NextResponse.json(
      { error: "SANDBOX_RESET_FAILED", ...(failedScope ? { failedScope } : {}) },
      { status: 503 },
    );
  }
}

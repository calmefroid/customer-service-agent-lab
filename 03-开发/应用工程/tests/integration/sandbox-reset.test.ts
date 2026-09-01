import { beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/sandbox/reset/route";
import { knowledgeSandbox } from "@/lib/adapters/knowledge-mock-adapter";
import { defaultRuntimeSessions } from "@/lib/agent-runtime";
import { PUBLIC_CONTRACT_VERSION } from "@/lib/contracts";
import { businessWorkflowService } from "@/lib/domain/business-workflow";
import { listEvalRuns } from "@/lib/evals/runner";
import { createKnowledgeArticle, listKnowledgeArticles, resetKnowledgeStore } from "@/lib/knowledge-store";
import { resetSandboxState, SandboxResetError, type SandboxResetParticipant } from "@/lib/sandbox/reset";
import { businessStore } from "@/lib/stores/business/business-store";
import { confirmationStore } from "@/lib/stores/business/confirmation-store";
import { feedbackStore } from "@/lib/stores/feedback-store";
import { appendTraceEvent, clearTraces, listTraceEvents } from "@/lib/trace-store";

describe("unified Sandbox reset", () => {
  beforeEach(() => {
    businessStore.reset();
    resetKnowledgeStore();
    defaultRuntimeSessions.reset();
    clearTraces();
    feedbackStore.reset();
  });

  it("requires the explicit all-scope confirmation payload", async () => {
    const invalid = await POST(new Request("http://localhost/api/sandbox/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "all" }),
    }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "RESET_CONFIRMATION_REQUIRED" });
  });

  it("clears every runtime scope and returns only after the complete reset", async () => {
    const baselineKnowledgeCount = listKnowledgeArticles().length;
    createKnowledgeArticle();
    knowledgeSandbox.activate("knowledge_conflict");
    defaultRuntimeSessions.getOrCreate("S-reset");
    feedbackStore.save({ sessionId: "S-reset", messageId: "M-reset", rating: "down" });
    globalThis.customerServiceEvalRunStore = [{ runId: "RUN-reset" } as never];
    appendTraceEvent({
      contractVersion: PUBLIC_CONTRACT_VERSION,
      eventId: "TE-reset",
      traceId: "TR-reset",
      sessionId: "S-reset",
      sequence: 1,
      createdAt: "2026-09-01T00:00:00.000Z",
      type: "output",
      status: "completed",
      payload: { audience: "internal", summary: "reset seed" },
    });
    const draft = { orderId: "OD202608050088", deliveryAddress: "上海市演示新区 66 号" };
    const prepared = await businessWorkflowService.prepareOrderChange({
      sessionId: "S-reset",
      traceId: "TR-reset",
      identity: { customerId: "demo-customer-001", verified: true },
    }, draft);
    if (prepared.status !== "success") throw new Error("RESET_SEED_PREPARE_FAILED");
    await businessWorkflowService.resolveConfirmation({
      sessionId: "S-reset",
      traceId: "TR-reset",
      identity: { customerId: "demo-customer-001", verified: true },
    }, {
      confirmationRequestId: prepared.data.confirmationRequestId,
      confirmationToken: prepared.data.confirmationToken,
      idempotencyKey: prepared.data.idempotencyKey,
      action: "confirm",
      finalSnapshot: draft,
    });
    expect(businessStore.listOrderChanges()).toHaveLength(1);
    expect(confirmationStore.list()).toHaveLength(1);
    expect(listTraceEvents()).toHaveLength(1);

    const response = await POST(new Request("http://localhost/api/sandbox/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "all", confirmation: "RESET_SANDBOX" }),
    }));
    expect(response.status).toBe(200);
    const result = await response.json() as { resetAt: string; scopes: string[] };
    expect(Number.isFinite(Date.parse(result.resetAt))).toBe(true);
    expect(result.scopes).toEqual([
      "business",
      "confirmation",
      "knowledge",
      "knowledge_sandbox",
      "sessions",
      "traces",
      "feedback",
      "evals",
    ]);
    expect(listKnowledgeArticles()).toHaveLength(baselineKnowledgeCount);
    expect(knowledgeSandbox.getActive()).toBeUndefined();
    expect(defaultRuntimeSessions.get("S-reset")).toBeUndefined();
    expect(listTraceEvents()).toHaveLength(0);
    expect(feedbackStore.list()).toHaveLength(0);
    expect(listEvalRuns()).toHaveLength(0);
    expect(businessStore.listOrderChanges()).toHaveLength(0);
    expect(confirmationStore.list()).toHaveLength(0);
  });

  it("rejects concurrent reset and identifies a failing participant", async () => {
    let release!: () => void;
    const delayed: SandboxResetParticipant[] = [{
      scope: "business",
      reset: () => new Promise<void>((resolve) => { release = resolve; }),
    }];
    const first = resetSandboxState(delayed);
    await expect(resetSandboxState(delayed)).rejects.toMatchObject({ code: "SANDBOX_RESET_IN_PROGRESS" });
    release();
    await expect(first).rejects.toMatchObject({ code: "SANDBOX_RESET_FAILED" });

    await expect(resetSandboxState([{
      scope: "feedback",
      reset: () => { throw new Error("injected"); },
    }])).rejects.toEqual(new SandboxResetError("SANDBOX_RESET_FAILED", "feedback"));
  });
});

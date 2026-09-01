import { defaultRuntimeSessions } from "@/lib/agent-runtime";
import { clearEvalRuns } from "@/lib/evals/runner";
import { resetKnowledgeStore } from "@/lib/knowledge-store";
import { businessStore } from "@/lib/stores/business/business-store";
import { feedbackStore } from "@/lib/stores/feedback-store";
import { clearTraces } from "@/lib/trace-store";

export const SANDBOX_RESET_SCOPES = [
  "business",
  "confirmation",
  "knowledge",
  "knowledge_sandbox",
  "sessions",
  "traces",
  "feedback",
  "evals",
] as const;

export type SandboxResetScope = (typeof SANDBOX_RESET_SCOPES)[number];

export interface SandboxResetParticipant {
  scope: SandboxResetScope;
  reset: () => void | Promise<void>;
}

export interface SandboxResetResult {
  resetAt: string;
  scopes: SandboxResetScope[];
}

export class SandboxResetError extends Error {
  constructor(
    public readonly code: "SANDBOX_RESET_IN_PROGRESS" | "SANDBOX_RESET_FAILED",
    public readonly failedScope?: SandboxResetScope,
  ) {
    super(code);
  }
}

let resetInProgress = false;

function defaultParticipants(): SandboxResetParticipant[] {
  return [
    // BusinessStore owns the Confirmation Store and restores all OMS/WMS/TMS/CRM fixtures.
    { scope: "business", reset: () => businessStore.reset() },
    { scope: "knowledge", reset: () => resetKnowledgeStore() },
    { scope: "sessions", reset: () => defaultRuntimeSessions.reset() },
    { scope: "traces", reset: () => clearTraces() },
    { scope: "feedback", reset: () => feedbackStore.reset() },
    { scope: "evals", reset: () => clearEvalRuns() },
  ];
}

export async function resetSandboxState(
  participants: SandboxResetParticipant[] = defaultParticipants(),
  now: () => Date = () => new Date(),
): Promise<SandboxResetResult> {
  if (resetInProgress) throw new SandboxResetError("SANDBOX_RESET_IN_PROGRESS");
  resetInProgress = true;
  const completed = new Set<SandboxResetScope>();
  try {
    for (const participant of participants) {
      try {
        await participant.reset();
        completed.add(participant.scope);
        if (participant.scope === "business") completed.add("confirmation");
        if (participant.scope === "knowledge") completed.add("knowledge_sandbox");
      } catch {
        throw new SandboxResetError("SANDBOX_RESET_FAILED", participant.scope);
      }
    }
    const scopes = SANDBOX_RESET_SCOPES.filter((scope) => completed.has(scope));
    if (scopes.length !== SANDBOX_RESET_SCOPES.length) {
      throw new SandboxResetError("SANDBOX_RESET_FAILED");
    }
    return { resetAt: now().toISOString(), scopes };
  } finally {
    resetInProgress = false;
  }
}

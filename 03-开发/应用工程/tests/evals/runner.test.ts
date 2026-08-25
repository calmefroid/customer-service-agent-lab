import { beforeEach, describe, expect, it } from "vitest";

import { EVAL_CASES } from "@/lib/evals/dataset";
import { clearEvalRuns, runEvals } from "@/lib/evals/runner";
import type { EvalExecutor } from "@/lib/evals/types";

describe("eval runner", () => {
  beforeEach(() => clearEvalRuns());

  it("continues after one executor failure and classifies every failure with a trace id", async () => {
    let calls = 0;
    const executor: EvalExecutor = async (item) => {
      calls += 1;
      if (calls === 1) throw new Error("synthetic executor failure");
      return {
        response: {
          message: "fallback",
          intent: "other",
          riskLevel: "low",
          traceId: `TR-${item.id}`,
        },
        trace: null,
        toolCalls: [],
        sourceSystems: [],
        sourceRecordIds: [],
        durationMs: 1,
      };
    };

    const run = await runEvals({ cases: EVAL_CASES.slice(0, 3), executor });
    expect(calls).toBe(3);
    expect(run.results).toHaveLength(3);
    expect(run.results.filter((item) => !item.passed).every((item) => item.traceId && item.badCaseLabels.length)).toBe(true);
  });

  it("produces the same stable fingerprint for repeated mock runs", async () => {
    const cases = EVAL_CASES.filter((item) => ["core-logistics-identity", "safety-smoke", "conversation-greeting"].includes(item.id));
    const first = await runEvals({ cases });
    const second = await runEvals({ cases });
    expect(first.stableFingerprint).toBe(second.stableFingerprint);
  });

  it("runs the full baseline and keeps every failed result traceable", async () => {
    const run = await runEvals();
    expect(run.total).toBe(EVAL_CASES.length);
    expect(run.results.filter((item) => !item.passed).every((item) => item.traceId && item.badCaseLabels.length)).toBe(true);
  });
});

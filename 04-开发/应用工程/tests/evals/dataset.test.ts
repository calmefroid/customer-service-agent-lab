import { describe, expect, it } from "vitest";

import { EVAL_CASES, EVAL_COVERAGE_MINIMUMS } from "@/lib/evals/dataset";

describe("fixed eval dataset", () => {
  it("contains 30+ unique virtual cases and meets every coverage minimum", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(EVAL_CASES.map((item) => item.id)).size).toBe(EVAL_CASES.length);
    expect(EVAL_CASES.every((item) => item.input.request.sessionId.startsWith("virtual-"))).toBe(true);

    for (const [coverage, minimum] of Object.entries(EVAL_COVERAGE_MINIMUMS)) {
      expect(EVAL_CASES.filter((item) => item.coverage.includes(coverage as never)).length).toBeGreaterThanOrEqual(minimum);
    }
  });
});

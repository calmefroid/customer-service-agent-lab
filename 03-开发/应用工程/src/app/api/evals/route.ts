import { NextResponse } from "next/server";

import { EVAL_CASES } from "@/lib/evals/dataset";
import {
  clearEvalRuns,
  getEvalDatasetSummary,
  listEvalRuns,
  runEvals,
  updateEvalResultLabels,
} from "@/lib/evals/runner";
import { BAD_CASE_LABELS, type BadCaseLabel } from "@/lib/evals/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    dataset: getEvalDatasetSummary(),
    cases: EVAL_CASES.map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      coverage: item.coverage,
      message: item.input.request.message,
    })),
    runs: listEvalRuns(),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { caseId?: string };
  try {
    const run = await runEvals({ caseId: body.caseId });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "EVAL_RUN_FAILED";
    return NextResponse.json({ error: message }, { status: message.startsWith("EVAL_CASE_NOT_FOUND") ? 404 : 500 });
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    runId?: string;
    resultId?: string;
    labels?: string[];
  };
  if (!body.runId || !body.resultId || !Array.isArray(body.labels)) {
    return NextResponse.json({ error: "INVALID_LABEL_REQUEST" }, { status: 400 });
  }
  const labels = body.labels.filter((label): label is BadCaseLabel => BAD_CASE_LABELS.includes(label as BadCaseLabel));
  if (labels.length !== body.labels.length) {
    return NextResponse.json({ error: "INVALID_BAD_CASE_LABEL" }, { status: 400 });
  }
  const result = updateEvalResultLabels(body.runId, body.resultId, labels);
  return result
    ? NextResponse.json({ result })
    : NextResponse.json({ error: "EVAL_RESULT_NOT_FOUND" }, { status: 404 });
}

export async function DELETE() {
  clearEvalRuns();
  return NextResponse.json({ success: true });
}

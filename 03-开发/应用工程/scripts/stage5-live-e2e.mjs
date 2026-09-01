import { readFile } from "node:fs/promises";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3000";
const damageImagePath = process.argv[3];
if (!damageImagePath) throw new Error("DAMAGE_IMAGE_PATH_REQUIRED");
const onlyChain = process.env.STAGE5_E2E_ONLY;
const shouldRun = (id) => !onlyChain || id === onlyChain;

function parseSse(body) {
  return body.split("\n\n").flatMap((block) => {
    const line = block.split("\n").find((item) => item.startsWith("data: "));
    return line ? [JSON.parse(line.slice(6))] : [];
  });
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function privacyAudit(value) {
  const serialized = JSON.stringify(value);
  return [
    [/data:image\/[a-z0-9.+-]+;base64,/i, "IMAGE_PAYLOAD"],
    [/authorization|bearer\s+[a-z0-9._-]+/i, "AUTHORIZATION"],
    [/(?:api[_-]?key|sk-)["':=\s]+[a-z0-9._-]{8,}/i, "API_KEY"],
    [/(?:手机|电话|phone|mobile)[^\d]{0,12}1[3-9]\d{9}/i, "RAW_PHONE"],
    [/<\/?think>|reasoning_content|思考过程/i, "PRIVATE_REASONING"],
  ].filter(([pattern]) => pattern.test(serialized)).map(([, label]) => label);
}

const requestSummaries = [];
async function send(request, attempt = 0) {
  const response = await fetch(`${baseUrl}/api/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  assert(response.ok, `CHAT_HTTP_${response.status}`);
  const events = parseSse(await response.text());
  const error = events.find((event) => event.type === "error");
  const final = events.find((event) => event.type === "final");
  const traceId = final?.response?.traceId ?? error?.traceId;
  assert(traceId, "TERMINAL_TRACE_ID_MISSING");
  const traceResponse = await fetch(`${baseUrl}/api/trace?traceId=${encodeURIComponent(traceId)}`);
  assert(traceResponse.ok, `TRACE_HTTP_${traceResponse.status}`);
  const trace = await traceResponse.json();
  assert(trace.events.every((event) => event.traceId === traceId), "TRACE_ID_MISMATCH");
  assert(trace.events.some((event) => event.type === "model" && event.payload?.mode === "live"), "LIVE_MODEL_TRACE_MISSING");
  const privacyIssues = privacyAudit({ events, trace });
  assert(privacyIssues.length === 0, `PRIVACY_AUDIT_${privacyIssues.join("_")}`);
  requestSummaries.push({ traceId, traceTypes: [...new Set(trace.events.map((event) => event.type))] });
  if (error && attempt < 1 && ["MODEL_UNAVAILABLE", "MODEL_TIMEOUT"].includes(error.error?.code)) {
    return send(request, attempt + 1);
  }
  assert(!error, `CHAT_${error?.error?.code ?? "UNKNOWN_ERROR"}`);
  assert(final, "FINAL_MISSING");
  assert(!["debug", "route", "model", "traceEvents"].some((key) => key in final.response), "CONSUMER_DEBUG_LEAK");
  return final.response;
}

function confirmation(response, operation) {
  assert(response.ui?.kind === "confirmation", "CONFIRMATION_UI_MISSING");
  assert(response.ui.request.operation === operation, "CONFIRMATION_OPERATION_MISMATCH");
  return response.ui.request;
}

async function confirm(request) {
  return send({
    sessionId: request.sessionId,
    message: "确认提交",
    confirmation: {
      confirmationRequestId: request.confirmationRequestId,
      confirmationToken: request.confirmationToken,
      idempotencyKey: request.idempotencyKey,
      action: "confirm",
      finalSnapshot: request.draftSnapshot,
    },
  });
}

async function operationCount() {
  const response = await fetch(`${baseUrl}/api/ops`);
  assert(response.ok, `OPS_HTTP_${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.items) ? payload.items.length : 0;
}

const runId = Date.now();
const beforeCount = await operationCount();
const results = [];

async function run(id, task) {
  const start = requestSummaries.length;
  try {
    await task();
    const traces = requestSummaries.slice(start);
    results.push({ id, passed: true, requests: traces.length, liveTraces: traces.length });
  } catch (error) {
    results.push({ id, passed: false, failure: error instanceof Error ? error.message : "UNKNOWN" });
  }
}

if (shouldRun("E2E-01-order-change")) await run("E2E-01-order-change", async () => {
  const sessionId = `S5-CHANGE-${runId}`;
  assert((await send({ sessionId, message: "我的订单收货地址填错了，想申请修改。" })).ui?.kind === "identity_confirm", "IDENTITY_UI_MISSING");
  const request = confirmation(await send({ sessionId, message: "已确认本人，请生成改址草稿。", action: "prepare_order_change" }), "order_change");
  assert((await confirm(request)).ui?.kind === "order_operation_success", "ORDER_CHANGE_SUCCESS_MISSING");
});

if (shouldRun("E2E-02-order-cancel")) await run("E2E-02-order-cancel", async () => {
  const sessionId = `S5-CANCEL-${runId}`;
  assert((await send({ sessionId, message: "这个订单不要了，我要申请取消。" })).ui?.kind === "identity_confirm", "IDENTITY_UI_MISSING");
  const request = confirmation(await send({ sessionId, message: "已确认本人，请生成取消草稿。", action: "prepare_order_cancel" }), "order_cancel");
  assert((await confirm(request)).ui?.kind === "order_operation_success", "ORDER_CANCEL_SUCCESS_MISSING");
});

if (shouldRun("E2E-05-damage-return")) await run("E2E-05-damage-return", async () => {
  const sessionId = `S5-RETURN-${runId}`;
  const bytes = await readFile(damageImagePath);
  const request = confirmation(await send({
    sessionId,
    message: "这是无个人信息的合成测试图，表示灯罩到货时有可见裂纹，请准备换货申请。",
    module: "return",
    attachment: {
      name: "synthetic-damaged-lampshade.png",
      type: "image/png",
      size: bytes.byteLength,
      dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
    },
  }), "return_exchange_create");
  assert((await confirm(request)).ui?.kind === "return_success", "RETURN_SUCCESS_MISSING");
});

if (shouldRun("E2E-03-return-status")) await run("E2E-03-return-status", async () => {
  const sessionId = `S5-RETURN-${runId}`;
  assert((await send({ sessionId, message: "我的换货申请处理到哪了？" })).ui?.kind === "identity_confirm", "RETURN_IDENTITY_UI_MISSING");
  assert((await send({ sessionId, message: "确认本人并查询退换进度。", action: "confirm_return_identity" })).ui?.kind === "return_status", "RETURN_STATUS_UI_MISSING");
});

if (shouldRun("E2E-04-logistics-urge")) await run("E2E-04-logistics-urge", async () => {
  const sessionId = `S5-LOGISTICS-${runId}`;
  assert((await send({ sessionId, message: "我的订单到哪了？" })).ui?.kind === "identity_confirm", "LOGISTICS_IDENTITY_UI_MISSING");
  assert((await send({ sessionId, message: "确认本人并查询物流。", action: "confirm_identity" })).ui?.kind === "order", "ORDER_UI_MISSING");
  const request = confirmation(await send({ sessionId, message: "物流太慢了，请准备催办。", action: "prepare_logistics_urge" }), "logistics_urge");
  assert((await confirm(request)).ui?.kind === "logistics_urge_success", "LOGISTICS_URGE_SUCCESS_MISSING");
});

if (shouldRun("E2E-06-repair")) await run("E2E-06-repair", async () => {
  const sessionId = `S5-REPAIR-${runId}`;
  await send({ sessionId, message: "灯具一直闪烁但没有冒烟和焦味，重启后仍未恢复。" });
  const request = confirmation(await send({ sessionId, message: "请准备普通维修工单。", action: "prepare_service_ticket" }), "service_ticket_create");
  assert((await confirm(request)).ui?.kind === "service_ticket_success", "REPAIR_SUCCESS_MISSING");
});

const afterCount = await operationCount();
const traceIds = requestSummaries.map((item) => item.traceId);
const summary = {
  passed: results.filter((item) => item.passed).length,
  total: results.length,
  results,
  operationDelta: afterCount - beforeCount,
  requestCount: requestSummaries.length,
  uniqueTracePerRequest: new Set(traceIds).size === traceIds.length,
};
console.log(JSON.stringify(summary, null, 2));
if (summary.passed !== summary.total || !summary.uniqueTracePerRequest) process.exitCode = 1;

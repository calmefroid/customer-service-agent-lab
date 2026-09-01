import { readFile } from "node:fs/promises";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3000";
const argumentsAfterBaseUrl = process.argv.slice(3);
const imagePath = argumentsAfterBaseUrl.find((item) => !item.startsWith("--"));
const runText = !argumentsAfterBaseUrl.includes("--image-only");
const runImage = Boolean(imagePath) && !argumentsAfterBaseUrl.includes("--text-only");

function parseSse(body) {
  return body
    .split("\n\n")
    .flatMap((block) => {
      const line = block.split("\n").find((item) => item.startsWith("data: "));
      return line ? [JSON.parse(line.slice(6))] : [];
    });
}

function privacyAudit(value) {
  const serialized = JSON.stringify(value);
  return {
    dataUrlOrEncodedImage: /data:image\/[a-z0-9.+-]+;base64,/i.test(serialized),
    authorization: /authorization|bearer\s+[a-z0-9._-]+/i.test(serialized),
    apiKey: /(?:api[_-]?key|sk-)["':=\s]+[a-z0-9._-]{8,}/i.test(serialized),
    rawPhone: /(^|\D)1[3-9]\d{9}(\D|$)/.test(serialized),
    privateReasoning: /<\/?think>|reasoning_content|思考过程/i.test(serialized),
  };
}

async function postChat(request) {
  const response = await fetch(`${baseUrl}/api/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`CHAT_HTTP_${response.status}`);
  const events = parseSse(await response.text());
  const final = events.find((event) => event.type === "final");
  const error = events.find((event) => event.type === "error");
  const traceId = final?.response?.traceId ?? error?.traceId;
  if (!traceId) throw new Error(`CHAT_TERMINAL_MISSING:${error?.error?.code ?? "unknown"}`);

  const traceResponse = await fetch(`${baseUrl}/api/trace?traceId=${encodeURIComponent(traceId)}`);
  if (!traceResponse.ok) throw new Error(`TRACE_HTTP_${traceResponse.status}`);
  const trace = await traceResponse.json();
  const modelEvents = trace.events.filter((event) => event.type === "model");
  return {
    ok: Boolean(final) && !error,
    errorCode: error?.error?.code,
    traceId,
    agentEventTypes: events.map((event) => event.type),
    traceEventTypes: [...new Set(trace.events.map((event) => event.type))],
    liveModelEvents: modelEvents.filter((event) => event.payload?.mode === "live").length,
    modelStatuses: modelEvents.map((event) => event.status),
    uiKind: final?.response?.ui?.kind,
    consumerDebugLeak: Boolean(final && ["debug", "route", "model", "traceEvents"].some((key) => key in final.response)),
    privacy: privacyAudit({ events, trace }),
  };
}

const text = runText
  ? await postChat({
      sessionId: `S5-TEXT-${Date.now()}`,
      message: "你好，请简短介绍你能提供哪些客服帮助。",
    })
  : undefined;

let image;
if (runImage && imagePath) {
  const bytes = await readFile(imagePath);
  image = await postChat({
    sessionId: `S5-IMAGE-${Date.now()}`,
    message: "请客观描述图片中可见的客服界面，不要执行任何业务写操作。",
    attachment: {
      name: "consumer-interface.png",
      type: "image/png",
      size: bytes.byteLength,
      dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
    },
  });
}

console.log(JSON.stringify({ ...(text ? { text } : {}), ...(image ? { image } : {}) }, null, 2));

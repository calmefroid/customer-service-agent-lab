# Agent Runtime

## 模块边界

- `models/` 定义文字与多模态 Adapter。Runtime 只依赖接口，不依赖供应商请求格式。
- `sessions/` 保存多轮消息、图片观察摘要和待处理意图；Store 支持按会话或全量 reset。
- `agent-runtime/` 负责模型选择、结构化路由校验、规则兜底、Abort 门禁、公开事件与后台 TraceEvent。
- `/api/chat/stream` 把 `AgentEvent` 编码为 SSE；既有业务编排通过 `RuntimeWorkflowExecutor` 注入。

无模型 Key 时使用两个确定性的 Mock Adapter。文字模型已支持通过欧普阿里模型网关的 OpenAI Chat Completions 兼容接口调用 `Qwen3.6-27B`。

推荐使用独立模式开关：

```env
MODEL_MODE=mock
TEXT_MODEL_MODE=live
MULTIMODAL_MODEL_MODE=live
UNIFIED_MODEL_MODE=true
TEXT_MODEL_BASE_URL=https://opai-console.opple.com/v1/chat/completions
TEXT_MODEL_API_KEY=仅写在.env.local的密钥
TEXT_MODEL_NAME=Qwen3.6-27B
TEXT_MODEL_MAX_TOKENS=1000
MULTIMODAL_MODEL_BASE_URL=https://opai-console.opple.com/v1/chat/completions
MULTIMODAL_MODEL_NAME=Qwen3.6-27B
MULTIMODAL_MODEL_PROVIDER=OppleAliModelGateway
MULTIMODAL_MODEL_MAX_TOKENS=1000
MULTIMODAL_IMAGE_DETAIL=high
```

`TEXT_MODEL_MODE=live` 会让真实模型负责结构化路由，并在低风险工作流完成后根据工具 / RAG 结果生成消费者回答。高风险安全话术、人工转接和写操作确认保留确定性输出。

`UNIFIED_MODEL_MODE=true` 时，文字路由、回答生成和图片理解都复用 `TEXT_MODEL_BASE_URL` / `TEXT_MODEL_API_KEY` / `TEXT_MODEL_NAME`，当前统一为 `Qwen3.6-27B`。前端将 JPG / PNG / WEBP 转为 Base64 Data URL，服务端校验 MIME、大小和编码后传给模型。原始图片内容不写入 Trace，Trace 只保留文件名、类型、大小和模型观察结果。

当前网关要求文字与多模态请求通过 `chat_template_kwargs.enable_thinking=false` 关闭 Qwen3.6 思考模式。不要改用顶层 `enable_thinking=false`；该字段会被网关忽略，造成 HTTP 200 但可见 `message.content` 为空。两个 Adapter 仍保留私有推理过滤，防止供应商响应漂移导致思维链进入 Trace 或消费者响应。

## 主要接口

```ts
interface TextModelAdapter {
  route(input: TextRouteInput, options?: { signal?: AbortSignal }): Promise<TextRouteOutput>;
}

interface MultimodalModelAdapter {
  observe(input: MultimodalInput, options?: { signal?: AbortSignal }): Promise<MultimodalObservationOutput>;
}

interface RuntimeWorkflowExecutor {
  execute(request: ChatRequest, context: RuntimeWorkflowContext): Promise<ChatResponse>;
}
```

`RuntimeWorkflowExecutor` 是运行时与业务模块之间的门。写操作在调用它之前再次检查 Abort，执行器同时收到 `signal`，后续业务工具接入时应继续向 Adapter 透传。

## 事件时序

纯文字：

```text
progress(routing.started)
→ 文字模型结构化路由
→ progress(routing.completed)
→ progress(workflow.started)
→ 业务 / RAG 工作流
→ progress(workflow.completed)
→ ui（可选）
→ token * N
→ final
```

带图且需要业务处理：

```text
progress(image_observation.started)
→ 多模态观察
→ progress(image_observation.completed)
→ 文字模型结构化路由
→ 工作流与输出事件
```

仅需看图时不会调用文字模型或业务工作流，直接发送 `token` 与 `final`。失败发送单个 `error` 终止；停止生成使用 `GENERATION_STOPPED`，停止后不再发送 token，也不启动尚未执行的工作流。

### 图片观察与路由边界

- 清晰铭牌：返回可见型号，`requiresBusinessRouting=false`，路由为产品知识。
- 模糊铭牌：明确无法确认并要求补拍，`requiresBusinessRouting=false`，路由为澄清。
- 可见到货破损：只描述裂纹等可见现象，`requiresBusinessRouting=true`，再由文字与观察摘要共同进入退换草稿。
- 附件、文件类型或当前页面模块都不能单独触发退换；用户明确诉求或最新图片观察摘要才是路由证据。
- Mock 与 Live Adapter 返回同一个 `MultimodalObservationOutput`。Live 输出若越界判断真伪、责任、退换资格或赔偿，会被替换为保守边界回复。

## Trace 与消费者隔离

模型、脱敏后的应用 Prompt / 消息 / Schema / 原始输出写入服务端 `RuntimeTraceSink`。当前冻结契约暂以 JSON 字符串存入 `TraceEvent.model.inputSummary/outputSummary`；结构化字段申请见 `CR-20260824-runtime-model-trace-context.md`。`AgentEvent.final.response` 会显式重建，只包含消费者契约字段，不透传 workflow 的 route 或 debug 对象。

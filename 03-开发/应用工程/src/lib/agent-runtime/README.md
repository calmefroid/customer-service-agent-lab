# Agent Runtime

## 模块边界

- `models/` 定义文字与多模态 Adapter。Runtime 只依赖接口，不依赖供应商请求格式。
- `sessions/` 保存多轮消息、图片观察摘要和待处理意图；Store 支持按会话或全量 reset。
- `agent-runtime/` 负责模型选择、结构化路由校验、规则兜底、Abort 门禁、公开事件与后台 TraceEvent。
- `/api/chat/stream` 把 `AgentEvent` 编码为 SSE；既有业务编排通过 `RuntimeWorkflowExecutor` 注入。

无模型 Key 时使用两个确定性的 Mock Adapter。`MODEL_MODE=live` 目前返回 Adapter 未配置错误，不会猜测尚未提供的正式 API 格式。

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

## Trace 与消费者隔离

模型、脱敏后的应用 Prompt / 消息 / Schema / 原始输出写入服务端 `RuntimeTraceSink`。当前冻结契约暂以 JSON 字符串存入 `TraceEvent.model.inputSummary/outputSummary`；结构化字段申请见 `CR-20260824-runtime-model-trace-context.md`。`AgentEvent.final.response` 会显式重建，只包含消费者契约字段，不透传 workflow 的 route 或 debug 对象。

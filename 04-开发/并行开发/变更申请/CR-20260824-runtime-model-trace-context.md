# TraceEvent 模型事件补充结构化调试上下文

申请模块：Agent 运行时与双模型
申请人 / 对话：01
当前基线提交：`2a5fc2b`

## 当前问题

`TraceEvent` 的 `model` payload 当前仅提供 `provider`、`model`、`mode`、`inputSummary` 和 `outputSummary`。PRD 与 01 任务要求后台 Trace 可记录应用 Prompt、模型消息、输出 Schema、原始模型输出、解析结果和格式错误后的规则兜底。把这些内容压缩成两个字符串会丢失结构，也不利于 Trace 页面与 Evals 做稳定筛选。

## 建议变更

在 `TraceEventBase<"model", ...>` payload 中增加以下可选字段，保持现有字段不变：

```ts
prompt?: {
  templateId: string;
  version: string;
  applicationSystemPrompt: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  responseSchema?: Record<string, unknown>;
  fewShotExampleIds?: string[];
};
rawOutput?: string;
parsedOutput?: Record<string, unknown>;
fallback?: {
  used: boolean;
  reason?: "invalid_json" | "schema_invalid" | "model_refusal" | "adapter_unavailable" | "timeout";
  strategy?: string;
};
```

所有字段只允许写入服务端 Trace；消费者 `AgentEvent` 和 `ChatResponse` 不增加任何调试字段。Prompt、消息与输出写入前必须脱敏，禁止记录密钥和真实个人信息。

## 向后兼容策略

新增字段全部可选，`PUBLIC_CONTRACT_VERSION` 可由 00 判断维持 `1.0.x` 或升级次版本。旧 Trace 生产者、消费者和历史记录无需修改；Trace 页面先按可选字段渐进展示。

## 涉及模块

- 00：公共契约、Trace Store / 页面与最终编排。
- 01：Runtime 模型 Trace 生产者。
- 06：按模型错误与 fallback 原因归因 bad case。

## 测试影响

- 增加 Trace 模型事件 schema / 类型测试。
- 增加 Prompt 脱敏和消费者响应隔离测试。
- 增加无效 JSON fallback 的 Trace 断言。
- 现有 `TraceEvent` 判别值和已有字段测试应继续通过。

## 不采用时的替代方案

01 暂时把脱敏后的结构化调试对象 JSON 序列化到 `inputSummary` / `outputSummary`，并保留内部 Runtime Trace sink；00 集成时只能按整段文本展示，Evals 无法可靠按 Prompt 版本或 fallback 原因筛选。

# 01 对话任务简报：Agent 运行时与双模型

## 可直接发给新对话的首条消息

> 你负责“客服 Agent 实验室”的 Agent 运行时、会话上下文、双模型路由和流式事件。请在 `feat/agent-runtime` 对应 worktree 工作，先阅读并行计划、PRD、意图路由表和当前 Trace 设计。只修改本简报允许的目录；不要直接修改 `contracts.ts`、`mock-orchestrator.ts`、消费者页面或锁文件。需要公共字段时写变更申请给 00 对话。

## 目标

把当前规则 Mock 包装成可替换的 Agent Runtime。未来用户提供文字模型 API 和多模态 API 后，只增加真实 Adapter，不改业务流程和消费者页面。

## 允许修改

- `src/lib/agent-runtime/**`
- `src/lib/models/**`
- `src/lib/sessions/**`
- `src/app/api/chat/stream/**`
- `tests/runtime/**`

## 功能清单

- Text / Multimodal 模型 Adapter 接口及 Mock 实现。
- 文本、图片、图片观察摘要和历史消息的会话状态。
- 结构化路由输出、Schema 校验和解析失败兜底。
- 模型选择：文字 → 文字模型；带图 → 多模态；需业务动作 → 再调用文字模型。
- 流式事件：progress、token、ui、final、error。
- Abort：停止后不得继续产生 token 或触发写操作。
- 超时、模型拒答、无效 JSON 和 Adapter 不可用。
- 模型与 Prompt 调试上下文写入 TraceEvent，不进入消费者响应。

## 关键测试

- 纯文字只调用 TextModelAdapter。
- 图片只观察时不调用业务工具。
- 图片需要申请时先多模态，再文字模型 / 工作流。
- 停止生成后不执行写工具。
- 两个模型都未配置 Key 时 Mock 完整可用。
- 模型输出格式错误时走规则兜底并留 Trace。

## 不做

- 不实现订单、退换、工单业务工具。
- 不修改手机端视觉。
- 不接入用户尚未提供的真实 API。

## 交付

- 一次独立提交。
- Runtime 接口说明、事件时序和测试结果。
- 一条流式文字和一条带图链路的本地验证说明。

## 状态

```text
状态：首轮已合并；下一轮图片路由 bad case 已批准
基线提交：contracts-v1（0f8fa0b）
交付提交：ed5fc3e；已通过 main 集成提交 351fb09 落位
阻塞或契约申请：06-evals-baseline-gaps.md 申请 3；不修改公共契约
```

# 阶段 2：统一 Runtime 与 Trace

**基线**：`main@bac7dee`  
**公共契约**：`1.1.0`（本阶段不升级）  
**负责对话**：00 集成与架构；01 Runtime 按本文接口任务补齐其独占目录

## 一、现状审计

阶段 2 开始时，五个架构问题均存在：

1. `AgentRuntime` 生成 `TraceEvent`，写入 `defaultRuntimeTraceStore`。
2. `mock-orchestrator.ts` 生成另一份 `TraceRecord`，并在 `createTrace` 中创建第二个业务 Trace ID。
3. `/api/trace` 与 Trace 页面只读取旧 `TraceRecord` Store。
4. Runtime 最终响应使用 `TR-RUNTIME-*`，业务记录使用 `TR-*`，同一请求无法用一个 ID 完整查询。
5. 纯图片请求没有业务 `TraceRecord`；真实模型路由、图片观察、回答生成与 fallback 只存在于 Runtime Store，Trace 页面不可见。

阶段 1 的路由、多模态、业务 Adapter、RAG 和 Evals 能力均已存在，本阶段不重新实现。

## 二、统一方案

### 1. 单一 Trace ID

```text
AgentRuntime.run
  └─ traceId（Runtime 生成；后续支持调用方注入）
      └─ RuntimeWorkflowContext.traceId
          └─ runRegisteredAgent
              └─ ModuleRegistry / OrchestrationContext.traceId
                  └─ mock-orchestrator / 业务模块
```

- Runtime 调用业务工作流时，00 装配层必须把 `RuntimeWorkflowContext.traceId` 原样传递。
- `ModuleRegistry` 为没有 Runtime 的直接调用生成 `TR-ORCH-*`，并强制模块响应使用该 ID。
- `mock-orchestrator` 接收装配层的 `traceId`，不再为 Runtime 请求创建第二个 ID。
- `WorkflowContext.traceId` 同样使用该 ID，保证业务工具、幂等确认和人工接管可关联。

### 2. TraceEvent 为主，TraceRecord 为兼容物化

- 统一查询契约是公共 `TraceEvent`，继续使用 1.1.0 的八种事件：`model / route / rag / tool / rule / confirmation / output / error`。
- 共享 Store 聚合 Runtime TraceEvent 与业务 TraceEvent，并在查询时按同一 `traceId` 重新编号。
- 阶段 1 的 `appendTrace(TraceRecord)` 保留为兼容入口：旧记录会转换为 TraceEvent；旧对象只作为 Trace 页面和 Evals 所需的物化种子，不再作为主查询 Store。
- 纯图片等 Runtime-only 请求没有旧记录时，由 TraceEvent 直接物化 Trace 页面视图。
- 新模块应通过 `OrchestrationContext.trace.append(...)` 写原生 TraceEvent，不应新增 TraceRecord Store。

### 3. 事件责任

| 事件 | 主要生产者 |
| --- | --- |
| `model` | 01 Runtime：图片观察、文字路由、回答生成 |
| `route` | 01 Runtime；无 Runtime 的直接编排由 00 兼容层补齐 |
| `rule` | Runtime fallback / guardrail；业务规则由业务编排模块记录 |
| `rag` | 03 检索模块或 00 兼容转换 |
| `tool` | 02 业务工作流或 00 兼容转换 |
| `confirmation` | 02 产生真实 `ConfirmationRequest / Decision` 后写入 |
| `output` | Runtime 最终输出与业务内部结果摘要 |
| `error` | Runtime、RAG、工具或装配层错误边界 |

## 三、查询与脱敏

`GET /api/trace` 支持组合参数：

- `traceId`
- `sessionId`
- `from` / `to`（ISO 时间或浏览器可解析时间）
- `type`
- `status`

响应同时包含事件物化的 `records` 和匹配的 `events`。Trace 页面可按事件类型、状态和时间过滤，并展示统一事件时间线。

共享 Store 在写入和查询两侧执行防御性脱敏：

- 删除 Data URL、Base64 和图片内容字段。
- 屏蔽 API Key、Bearer Authorization、Secret 和访问令牌。
- 屏蔽未脱敏手机号与地址；已脱敏的演示值可保留。
- 删除 `<think>`、chain-of-thought、private reasoning 等私有推理内容。
- 消费者 `AgentEvent` 与 `ChatResponse` 不增加 route、debug 或 Trace payload。

## 四、01 Runtime 接口任务

01 仅修改其独占目录，基于完成本阶段 00 提交后的最新 `main`：

1. `src/lib/agent-runtime/types.ts`
   - 将 `RuntimeRunOptions` 扩展为 `traceId?: string`。
   - 这是内部 Runtime 接口扩展，不修改消费者 `AgentEvent` / `ChatResponse`。
2. `src/lib/agent-runtime/agent-runtime.ts`
   - 使用 `options.traceId ?? 本地生成值` 作为一次运行的唯一 ID。
   - 所有 Runtime TraceEvent、AgentEvent、`RuntimeWorkflowContext.traceId` 和最终 `ChatResponse.traceId` 必须使用同一值。
   - 保持现有图片观察、真实模型路由、回答生成、解析 fallback、回答 fallback、Abort 和错误事件；不得把 Data URL、密钥、隐私数据或私有推理写入 Trace。
3. `src/lib/agent-runtime/configured-runtime.ts`
   - 为工厂增加可选依赖注入入口：`traceSink`、`sessions` 等保持默认值兼容。
   - 00 的 Chat API 最终装配将注入统一 Trace sink；未注入时仍可使用当前内存默认值。
4. `tests/runtime/**`
   - 新增调用方传入固定 `traceId` 的测试。
   - 断言 Runtime TraceEvent、workflow context、AgentEvent 与 final response 全部同 ID。
   - 断言模型解析 fallback、回答 fallback 和图片观察事件可查询，且消费者响应没有调试字段。

01 不需要修改 `contracts.ts`、`mock-orchestrator.ts`、`orchestration/**`、`/api/trace`、Trace 页面或共享 Store。若发现必须修改 1.1.0 公共判别字段，先提交变更申请，不直接升级。

## 五、兼容与退出条件

- 1.1.0 已能表达目标事件，本阶段没有公共契约变更申请。
- 阶段 1 的 `TraceRecord` 测试和 Evals 继续通过，避免一次性迁移导致回退。
- 当业务编排全部改为原生 `TraceWriter` 后，可删除 `appendTrace(TraceRecord)` 转换入口和物化种子；删除前必须保持 Trace 页面和 36 项 Evals 等价。

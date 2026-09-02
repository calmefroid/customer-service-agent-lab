# 客服 Agent 实验室并行开发与集成治理

**版本**：V1.4

**日期**：2026-09-02

**当前状态**：01～06 全部完成，阶段 6 文档与作品集收口
**公共契约**：`1.1.0`

## 最终交付状态

| 对话 | 模块 | 状态 | 最终证据 |
| --- | --- | --- | --- |
| 00 | 集成与架构 | 完成 | 共享契约、Chat/API 接线、统一 Trace/Reset、串行合并、全量回归与权威文档 |
| 01 | Agent Runtime | 完成 | 9 个文件、92/92；真实文字/图片 Smoke、fallback、Abort 与 Trace 脱敏 |
| 02 | Business | 完成 | 5 个文件、49/49；工具异常、正式确认、幂等写入和剩余 P0 业务 |
| 03 | Knowledge / RAG | 完成 | 3 个文件、12/12；published-only、冲突、过期、无命中、版本和 reset |
| 04 | Consumer | 完成 | 6 个文件、36/36；三入口、图片状态、确认卡、停止/重试与 debug 隔离 |
| 05 | Operations | 完成 | 2 个文件、10/10；新增记录、筛选、详情、Trace 跳转与 reset |
| 06 | Evals | 完成 | 36/36；固定数据集、六类 Grader、运行记录、结果页与 bad case 定位 |

最终 Mock 门禁为 37 个测试文件、256/256 测试与 Next.js 生产构建通过；固定 Evals 为 36/36。阶段 5 真实文字、真实图片 Smoke 与六条 Live 模型 + Mock 业务 E2E 通过。PCMP / OMS / WMS / TMS / CRM 仍使用 Mock Adapter。

## 模块所有权

| 模块 | 独占范围 | 不得越界 |
| --- | --- | --- |
| 00 集成 | `contracts.ts`、`mock-orchestrator.ts`、`orchestration/**`、Chat API 装配、共享 Store/API、根文档 | 不重新实现功能模块能力 |
| 01 Runtime | `agent-runtime/**`、`models/**`、`sessions/**`、流式 Runtime | 不实现业务工具或消费者 UI |
| 02 Business | `domain/**`、业务 Adapter、业务 Store 与工作流能力 | 不决定路由或生成消费者文案 |
| 03 Knowledge | `rag/**`、知识 Store/Adapter/API/页面 | 不修改消费者或业务 Store |
| 04 Consumer | 消费者页面、聊天组件、反馈 Store/API | 不定义公共事件或业务校验 |
| 05 Operations | 运营页面/API/查询转换 | 不修改真实/Mock 单据内部状态 |
| 06 Evals | 数据集、Runner、Graders、Evals API/页面 | 不修改被测实现让案例变绿 |

共享热点只能由 00 修改。功能模块需要共享字段时，先在 `变更申请/` 说明场景、字段、兼容策略、消费者影响和测试，再由 00 决定是否修改契约。

## 公共契约

唯一权威定义位于 `应用工程/src/lib/contracts.ts`，当前 `PUBLIC_CONTRACT_VERSION=1.1.0`。`contracts-v1` 仅指 1.0.0 历史标签，不是当前版本。

1. `AgentEvent`：progress、token、ui、final、error；消费者只接收公开字段。
2. `ToolResult<T>`：success、empty、timeout、business_error、system_error 与统一来源元数据。
3. `ConfirmationRequest`：服务端签发的请求 ID、operation、token、幂等键、过期时间、草稿与最终快照。
4. `KnowledgeRetrievalResult`：候选、采用项、冲突、无知识、过滤原因、条目与版本。
5. `TraceEvent`：模型、路由、规则、RAG、工具、确认、输出、错误和 fallback 的统一事件。

阶段 2～5 的扩展均在 1.1.0 可兼容范围内完成，没有增加第二套消费者事件或业务 Trace ID。

## 架构不变量

- 每个消费者请求只有一个 `traceId`，Runtime 与业务工作流共享该 ID。
- TraceEvent 是统一事件契约；兼容视图不得生成第二个业务 `TR-*`。
- 消费者 `AgentEvent` 与 ChatResponse 不增加后台调试字段。
- 写工具必须在服务端确认校验后启动；停止发生在写工具前时不得写入。
- 消费者不能自行构造 operation、token 或幂等键。
- 安全自动升级优先执行，不走普通确认协议。
- RAG 只使用已发布且适用的知识；无命中、冲突、过期时不编造。
- Trace、日志和报告不保存凭据、图片原始编码、未脱敏个人信息或模型私有思维链。
- Sandbox reset 同步清理 Session、Trace、Feedback、Evals、知识运行态与所有业务 Store。

## 当前 P0 完成度

| P0 | 状态 | 验收摘要 |
| --- | --- | --- |
| 消费者聊天与图片 | 完成 | 流式状态、停止/重试、图片观察、失败恢复 |
| 四维路由与旧 Intent | 完成 | module/intent/topic/action 与旧值兼容 |
| 统一模型 Runtime | 完成 | Qwen3.6 Text/Vision、Mock/Live、fallback |
| 业务工具与异常 | 完成 | PCMP/OMS/WMS/TMS/CRM Mock、五类错误 |
| 订单物流与催办 | 完成 | 身份确认、聚合查询、正式确认写入 |
| 地址修改与取消 | 完成 | 资格校验、草稿、确认、运营记录 |
| 退换与进度 | 完成 | 图片草稿、确认提交、状态查询 |
| 维修/安装与安全 | 完成 | RAG 排查、确认建单、安全自动升级 |
| 知识生命周期与 RAG | 完成 | 草稿/发布隔离、版本、过滤、冲突/过期 |
| 运营台 | 完成 | 查询、筛选、详情、来源与 Trace |
| 统一 Trace | 完成 | 单 ID、统一查询、兼容视图、脱敏 |
| Evals 与 bad case | 完成 | 36 项、六个 Grader、36/36 |
| Sandbox reset | 完成 | 所有相关 Store 统一重置 |

## 集成与回归规则

历史开发严格使用独立 branch + worktree。00 按依赖顺序逐个审查和合并，每次合并立即运行 `pnpm check`；禁止把多个功能提交一次性混合后再排错。功能提交不得覆盖用户未跟踪文件，也不得用旧基线覆盖当前 main。

提交前统一执行：

```bash
pnpm --dir 03-开发/应用工程 check
```

然后运行固定 Evals，并检查 Git 状态、`.env.local` 忽略、凭据、图片原始编码和个人信息。Live Smoke 只在本机显式执行，不作为每次确定性回归的前置条件。

## 历史基线说明

- `98100dc`、`dc2c06d`、`351fb09` 等提交与 `codex/p0-*` worktree 是阶段 0～1 历史基线，只用于追溯。
- 2026-08-25 的 25 项测试、2026-08-28 的 28/36 Evals 与“部分完成/未完成”表格均是当时快照，不代表当前状态。
- 旧 `feat/*` 与 `codex/badcase-*` 分支不得覆盖或重新合入最终 main。
- 阶段 5 集成结果见 `集成报告/2026-09-01-stage5-live-e2e.md`；最终状态见 `集成报告/2026-09-02-stage6-final.md`。

## 阶段文档

- `阶段2-统一Trace架构.md`
- `阶段3-统一写操作确认协议.md`
- `阶段4-剩余P0共享架构.md`
- `阶段5-真实模型Smoke与端到端验收.md`
- `集成报告/2026-09-01-stage5-live-e2e.md`
- `集成报告/2026-09-02-stage6-final.md`

功能任务简报保留原始职责描述，末尾“状态”已经更新为最终交付状态。

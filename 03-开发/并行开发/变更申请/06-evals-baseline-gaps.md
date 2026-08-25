# 06 Evals 基线缺口变更申请

**提出方**：06 Evals 与 bad case

**日期**：2026-08-24

**性质**：实现补齐，不申请修改 `contracts-v1` 公共判别值

## 基线证据

36 条固定案例通过 28 条，通过率 77.8%，稳定指纹为 `fp-d1ce2a6d`。失败集中在知识冲突 / 过期、工具异常注入和图片路由三类。完整证据见 `03-开发/应用工程/evals/baseline-report.md`。

## 申请 1：03 Knowledge 提供 conflict / expired 可执行场景

- 当前问题：冻结契约已定义 `KnowledgeRetrievalResult.status = conflict | expired`，但当前消费者检索链路无法构造两条冲突知识或过期候选。
- 建议变更：由 03 在自有 RAG / knowledge Store 中加入确定性冲突与过期测试夹具，返回已冻结状态、候选 ID 和过滤原因。
- 兼容性：不新增公共字段，对现有 hit / no_hit 路径无破坏。
- 涉及模块：03 Knowledge、00 集成、06 Evals。
- 测试影响：`knowledge-conflict` 与 `knowledge-expired` 应由失败转为通过。

## 申请 2：02 Business 提供 ToolResult 异常注入

- 当前问题：冻结契约已定义 `empty / timeout / business_error / system_error`，但 OMS / TMS / CRM 的当前组装始终返回成功固定数据，Evals 不能验证错误边界。
- 建议变更：由 02 在 Mock Adapter 自有目录提供按请求 / 场景注入的确定性错误模式，并在 Trace tool 事件中写入统一 `ToolResult`。
- 兼容性：默认仍为 success；不修改公共状态集。
- 涉及模块：02 Business、00 集成、06 Evals。
- 测试影响：4 条 `tool-*` 异常案例应由失败转为通过。

## 申请 3：01 Runtime 补齐图片观察后意图路由

- 当前问题：当前总编排在任意 attachment 存在时直接选择 `return_exchange`，与“图片是输入模态，不是业务意图”的 PRD 规则不一致。
- 建议变更：由 01 先生成图片观察摘要与不确定项，再与用户文字共同路由；铭牌仅看图可直接回答，模糊内容要求补拍，不自动生成退换草稿。
- 兼容性：沿用 `RouteDecision.observations`，不申请公共字段。
- 涉及模块：01 Runtime、00 集成、06 Evals。
- 测试影响：`image-nameplate` 与 `image-blurry` 应由失败转为通过；已通过的破损图片退换草稿案例不得回归。

# 业务 Adapter 与售后工作流

本目录是 PCMP、OMS、WMS、TMS 和 CRM 的上层业务边界。总编排器应依赖 `BusinessWorkflowService` 或各 Adapter 接口，不直接读取 Mock 数组。

## 目录

- `business.ts`：五类系统接口、业务对象和写入草稿。
- `business-workflow.ts`：身份检查、订单物流聚合、草稿确认、幂等提交和人工接管。
- `../adapters/*-mock-adapter.ts`：各目标系统的 Sandbox 实现。
- `../stores/business/business-store.ts`：进程内 Mock Store，提供 `list` / `getRecord` / `reset` 和幂等写入。
- `../stores/business/confirmation-store.ts`：服务端确认状态机，仅保存 token 摘要，记录最终快照和幂等结果。
- `../mock-data/business-fixtures.ts`：重置时使用的虚拟演示数据。

## 五系统边界

| 系统 | 读操作 | 写操作 |
| --- | --- | --- |
| PCMP | 按 SKU 取产品、搜索产品 | 无 |
| OMS | 按编号或演示用户查订单 | 创建订单变更 / 取消申请 |
| WMS | 查履约状态与出库事件 | 无 |
| TMS | 查运单、轨迹、承运商和电话 | 创建物流催办，同时返回 CRM 留痕来源 |
| CRM | 查服务工单 | 退换、维修 / 安装工单、人工接管 |

## 写操作协议

1. `prepareOrderChange / prepareOrderCancel / prepareLogisticsUrge / prepareReturnExchange / prepareServiceTicket` 校验业务状态，创建并保存 `pending` 的 `ConfirmationRequest`。
2. 00 将 `ChatRequest.confirmation` 原样交给 `resolveConfirmation(context, command, { signal, adapter })`；operation 始终从 Store 取回，不从 action、文本或快照推断。
3. `modify` 只校验并保存编辑快照，旋转 request ID、token 和幂等键；旧请求立即失效，不调用 Adapter。
4. `cancel` 将请求关闭为 `cancelled`；后续 confirm 固定返回 `CANCELLED`，不写业务 Store。
5. `confirm` 校验 session、token 摘要、幂等键、过期时间、字段白名单、必填项、不可变目标和当前业务状态，再原子抢占 `executing`。
6. 重复 confirm 等待或返回第一次幂等结果，不重复调用 Adapter；工具失败固定重放原失败结果，需重新 prepare 才可新一轮提交。
7. Abort 在工具调用前使请求进入 `failed`，不写业务 Store。高风险安全升级直接调用 `escalateToHuman`，不创建普通确认。

`submitOrderChange / submitOrderCancel / submitLogisticsUrge / submitReturnExchange / submitServiceTicket` 仅是迁移期兼容桥：必须能按 request ID 找到已存在的服务端 pending 记录，并且 Store operation 与兼容方法一致；否则拒绝，不会临时 prepare 并提交。旧编排器在服务端生成的稳定幂等键可由该兼容桥在 `pending` 阶段一次性采纳；公开 `resolveConfirmation` 仍要求命令幂等键与 Store 严格一致。

## 错误矩阵

每个 Mock Adapter 的可注入结果通过 `AdapterCallOptions.outcome` 选择。

| outcome / status | error.code | 可重试 | 是否写 Store | 语义 |
| --- | --- | --- | --- | --- |
| `success` | — | — | 写操作会写入 | 正常返回业务数据与来源元数据 |
| `empty` | `EMPTY_RESULT` | 否 | 否 | 没有匹配记录，不返回相似对象 |
| `timeout` | `TIMEOUT` | 是 | 否 | 模拟来源超时，不伪造成功编号 |
| `business_error` | `BUSINESS_REJECTED` | 否 | 否 | 业务状态拒绝，如已发货订单变更 |
| `system_error` | `SYSTEM_FAILURE` | 是 | 否 | 模拟来源系统不可用 |

参数、身份、记录和确认协议检查另使用 `INVALID_INPUT`、`UNAUTHORIZED`、`NOT_FOUND` 和 `BUSINESS_REJECTED`。所有结果都包含 `requestId`、`sourceSystem`、`adapterType`、`recordId`、`sourceUpdatedAt`、耗时和尝试次数。

确定性 bad case 注入直接传入 `AdapterCallOptions.outcome`，不依赖 Eval 案例 ID 或用户文本：

- OMS 空结果：`getLatestOrder(customerId, { outcome: "empty" })`
- TMS 超时：`getShipment(orderId, { outcome: "timeout" })`
- CRM 退换业务拒绝：`createReturnExchange(..., { outcome: "business_error" })`
- CRM 工单系统失败：`createServiceTicket(..., { outcome: "system_error" })`

对 CRM 写 Adapter，显式失败注入优先于参数校验和编号分配；失败时不进入 Store 回调。未传 `outcome` 或显式传入 `success` 时，保持原默认成功语义。

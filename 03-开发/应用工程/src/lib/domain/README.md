# 业务 Adapter 与售后工作流

本目录是 PCMP、OMS、WMS、TMS 和 CRM 的上层业务边界。总编排器应依赖 `BusinessWorkflowService` 或各 Adapter 接口，不直接读取 Mock 数组。

## 目录

- `business.ts`：五类系统接口、业务对象和写入草稿。
- `business-workflow.ts`：身份检查、订单物流聚合、草稿确认、幂等提交和人工接管。
- `../adapters/*-mock-adapter.ts`：各目标系统的 Sandbox 实现。
- `../stores/business/business-store.ts`：进程内 Mock Store，提供 `list` / `getRecord` / `reset` 和幂等写入。
- `../mock-data/business-fixtures.ts`：重置时使用的虚拟演示数据。

## 五系统边界

| 系统 | 读操作 | 写操作 |
| --- | --- | --- |
| PCMP | 按 SKU 取产品、搜索产品 | 无 |
| OMS | 按编号或演示用户查订单 | 创建订单变更申请 |
| WMS | 查履约状态与出库事件 | 无 |
| TMS | 查运单、轨迹、承运商和电话 | 创建物流催办，同时返回 CRM 留痕来源 |
| CRM | 查服务工单 | 退换、维修 / 安装工单、人工接管 |

## 写操作协议

1. 调用 `prepare*` 生成包含草稿快照、确认令牌、幂等键和过期时间的 `ConfirmationRequest`。
2. 用户修改时保留原确认请求，将最终内容放入 `finalSnapshot`。
3. 只有 `submit*` 接受有效令牌后才调用写 Adapter。
4. Adapter 以幂等键去重；超时或重复点击不会创建重复记录。
5. 高风险安全问题不生成普通工单确认，应调用 `escalateToHuman`。

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

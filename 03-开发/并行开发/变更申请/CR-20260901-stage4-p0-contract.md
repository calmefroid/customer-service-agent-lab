# CR-20260901：阶段 4 剩余 P0 兼容契约

**状态**：00 已批准，随阶段 4 基线冻结

**基线**：`main@24aa935`

**契约版本**：保持 `1.1.0`

## 背景

阶段 3 已统一五类写操作的 ConfirmationRequest，但订单修改地址、取消订单和退换进度尚未接入消费者 Chat。阶段 4 还需要保持当前粗粒度 Intent 与历史 Trace / Evals 兼容，不能为三个新动作重命名既有 Intent 或增加另一套 AgentEvent。

## 变更

`ChatRequest.action` 添加三个确定性动作：

- `prepare_order_change`
- `prepare_order_cancel`
- `confirm_return_identity`

`ChatUi` 做以下加法扩展：

- `identity_confirm.purpose` 添加 `order_change / order_cancel / return`。
- 添加 `order_operation_success`，承载服务端返回的 operation、orderId、requestNo、status。
- 添加 `return_status`，承载退换申请编号、订单、服务类型、商品、状态、更新时间和公开时间线。

订单修改和取消草稿继续使用既有 `ui.kind=confirmation` 与阶段 3 ConfirmationRequest；不新增专用草稿卡。消费者到服务端的确认继续只使用 `ChatRequest.confirmation`，不得使用新的 action 绕过确认。

## 兼容策略

- 不删除或重命名任何已有字段、action、UI kind、Intent 或 AgentEvent 类型。
- 新字段均为联合类型的新增分支；不带阶段 4 action 的旧请求保持原行为。
- `PUBLIC_CONTRACT_VERSION` 保持 `1.1.0`。本次是本地 Sandbox 尚未发布协议上的可选能力扩展，没有改变既有线格式语义。
- Intent 继续使用当前 1.1.0 粗粒度集合。四维完整性由 `module + intent + topic + action` 表达，新能力不得创建平行 Intent 契约。
- 01 在模型解析边界归一化允许的历史 Intent 别名，Trace 同时保留脱敏后的原始模型输出和规范化 RouteDecision；消费者只收到规范 Intent。
- 旧 `submit_*` 公共写 action 继续由 Chat API 拒绝；本变更不恢复任何旧写入口。

## 安全边界

- `prepare_order_change / prepare_order_cancel` 只生成 02 Store 签发的 ConfirmationRequest，不执行写工具。
- operation 仍从 02 Confirmation Store 解析，消费者不能提交 operation。
- 退换进度查询必须先确认演示身份；只返回当前演示用户的申请。
- 消费者 UI 不返回业务 Store、Trace、Prompt、工具参数或未脱敏个人信息。
- Sandbox reset 不进入 Chat 契约，使用后台专用 API 和显式确认短语。

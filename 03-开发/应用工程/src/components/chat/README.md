# 消费者对话组件

- `stream-state.ts`：只消费冻结的 `AgentEvent`，按 `sequence` 更新阶段和 token；`ui` 会缓存到 `final` 后再展示，避免失败时出现虚假成功卡。
- `MessageItem.tsx` / `UiCard.tsx`：消息外壳和订单、知识、安全、退换、报修等公开卡片，不接收 Trace 或后台调试字段。
- `ConfirmationCards.tsx`：渲染阶段 3 通用确认卡的“查看草稿 / 编辑字段 / 返回修改 / 取消 / 确认提交”闭环；旧业务卡仅保留迁移兼容。
- `confirmation-flow.ts`：阶段 3 通用确认卡的公开字段注册、最终快照、过期判断、服务端不透明字段透传与同步防重复门禁；不展示或自行生成 token、幂等键。
- `Composer.tsx`：文字、图片预览、停止生成与键盘发送。图片详细状态随消息显示。
- `Feedback.tsx`：每条助手回答都提供常驻的赞 / 踩入口；点踩后可补充原因并写入本地 `/api/feedback` Store，不再额外打断会话询问“是否解决”。
- `retry-message.ts` / `confirmation-decision.ts`：可独立测试的重试快照与确认决策辅助函数。

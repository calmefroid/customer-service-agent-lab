# 消费者对话组件

- `stream-state.ts`：只消费冻结的 `AgentEvent`，按 `sequence` 更新阶段和 token；`ui` 会缓存到 `final` 后再展示，避免失败时出现虚假成功卡。
- `MessageItem.tsx` / `UiCard.tsx`：消息外壳和订单、知识、安全、退换、报修等公开卡片，不接收 Trace 或后台调试字段。
- `ConfirmationCards.tsx`：退换、物流催办和服务工单的统一“修改 / 取消 / 确认”交互。取消或提交后原卡片会关闭，防止重复执行。
- `Composer.tsx`：文字、图片预览、停止生成与键盘发送。图片详细状态随消息显示。
- `Feedback.tsx`：赞 / 踩、是否解决和可选负反馈原因，写入本地 `/api/feedback` Store。是否解决仅在查询或提交成功等业务完成节点后，等待用户连续 30 秒无操作再展示；身份验证、确认表单等中间节点不触发。
- `retry-message.ts` / `confirmation-decision.ts`：可独立测试的重试快照与确认决策辅助函数。

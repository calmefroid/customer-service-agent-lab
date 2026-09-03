# 阶段 5 集成报告：真实模型 Smoke 与端到端验证

**日期**：2026-09-01

**集成起点**：`main@81403f3`

**公共契约**：`1.1.0`，未变更
**业务边界**：文字与图片模型为 Live；PCMP / OMS / WMS / TMS / CRM 仍为 Mock Adapter

## 模块结果

| 模块 | 结果 | 集成结论 |
| --- | --- | --- |
| 01 Runtime | 9 个文件、92/92 专项测试通过 | 私有推理与消费者正文隔离；供应商可见输出预算、图片 JSON 输出、Live 超时、确定性 P0 路由与显式 action/confirmation 跳过模型路由已收口 |
| 02 Business | 5 个文件、49/49 专项测试通过 | 统一确认、幂等写入、工具异常注入及阶段 4 新业务记录保持通过；企业系统仍为 Mock |
| 03 Knowledge / RAG | 3 个文件、12/12 专项测试通过 | published-only 检索、无命中、冲突、过期、版本生命周期与 Sandbox reset 保持通过 |
| 04 Consumer | 6 个文件、36/36 专项测试通过 | 图片识别状态、停止恢复、失败安全重试、确认卡防双击与消费者调试隔离通过；集成后的 Live 终态复验通过 |
| 05 Operations | 2 个文件、10/10 专项测试通过 | 新增业务记录查询、详情、Trace 关联与统一 reset 保持通过 |

## 必要集成修复

1. 文字与图片 Adapter 使用网关支持的 `chat_template_kwargs.enable_thinking=false` 关闭思考模式；移除强制 3000 token 的临时补偿，私有推理过滤仍保留。
2. 图片 Adapter 请求结构化 JSON 对象，避免模型正文格式漂移导致观察解析失败。
3. Live 模式使用不低于 60 秒的单模型调用门限；Mock 模式不受影响，停止生成仍通过 AbortSignal 生效。
4. 明确、高置信的 P0 自然语言规则可覆盖有效但错误的模型猜测，并保留模型与规则 Trace。
5. 显式 Chat action 与 ConfirmationCommand 不再先调用模型；Runtime 记录 `model: skipped` 和确定性规则事件，写操作不受供应商波动阻断。
6. 新增显式 opt-in 的本机 Live Smoke / E2E 脚本；脚本只输出状态摘要，模型配置仍由本机服务读取。

### 2026-09-02 协议修正复验

在发现顶层 `enable_thinking=false` 被当前网关忽略后，文字与多模态 Adapter 统一改用 `chat_template_kwargs.enable_thinking=false`，并移除强制 3000 token 补偿。修正后复验结果：

- Mock 门禁：37 个测试文件、256/256 通过，Next.js 生产构建通过。
- 真实文字 Smoke：SSE 收到 final，路由与回答模型事件全部 completed。
- 真实图片 Smoke：SSE 收到 final，图片观察、路由与回答模型事件全部 completed。
- 两条 Smoke 均未检出 Authorization、API Key、图片 Data URL、未脱敏手机号或私有推理泄漏。

## 最终门禁

| 门禁 | 结果 |
| --- | --- |
| Mock `pnpm check` | 37 个测试文件、256/256 测试通过；Next.js 生产构建通过 |
| 固定 Evals | 36/36，通过率 100% |
| Mock 六条核心链 | 6/6 |
| 真实文字 Smoke | 通过；路由与低风险回答模型事件完成，消费者 final 正常 |
| 真实图片 Smoke | 通过；图片观察模型事件完成，消费者 final 正常 |
| Live 模型 + Mock 业务 E2E | 6/6；18 个请求对应 18 个唯一 traceId；7 条预期运营记录增量 |

六条 E2E 覆盖：订单地址修改、取消订单、退换进度、物流催办、合成破损图退换、普通故障维修。确认前不写入，confirm 后幂等写入；消费者响应无调试对象。测试 Trace 与报告仅保留脱敏摘要，经检查未发现凭据、图片原始载荷、未脱敏电话/地址或模型私有推理。

## 安全说明

- 本次真实模型验证仅由本机服务读取 `.env.local`，未修改、复制或提交该文件。
- 未连接真实企业系统，未使用真实客户身份或个人信息；图片 E2E 使用明确标注的无个人信息合成测试图。
- 失败重试最多一次；显式写操作继续依赖服务端签发的 ConfirmationRequest、确认令牌与幂等键，消费者不能构造 operation 绕过校验。

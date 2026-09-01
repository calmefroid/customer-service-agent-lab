# 阶段 5：真实模型 Smoke Test 与端到端验收

**日期**：2026-09-01

**00 准备基线**：`main@3697d01`

**公共契约**：`1.1.0`，本阶段不修改
**业务数据边界**：PCMP / OMS / WMS / TMS / CRM 全部继续使用 Mock Adapter，不接真实企业系统

## 1. 启动门禁

- `pnpm check`：36 个测试文件、240/240 测试与 Next.js 生产构建通过。
- 36 项固定 Evals：36/36，通过率 100%。
- 阶段 4 六条 Mock 核心链路与统一 Sandbox reset 保持通过。
- 真实模型 Smoke 是显式、本机、串行门禁，不加入默认 Mock 测试和固定 Evals，避免网络、配额和模型随机性破坏确定性基线。

## 2. 环境与密钥红线

1. 真实模型测试只能由本机 Next.js 服务读取 `03-开发/应用工程/.env.local`；不得从需求文档、聊天消息、命令参数、测试夹具或仓库文件读取密钥。
2. `.env.local` 必须保持 Git ignored；不得复制到 worktree、测试产物、截图目录、Trace、Evals 结果或提交中。
3. 禁止在任何对话中粘贴、复述或请求 API Key；禁止使用会打印环境值的 `env`、`printenv`、`set -x`，也禁止把 Authorization 拼进命令行。
4. 预检只允许输出 `configured / not_configured`。测试报告只记录 provider、model、mode、HTTP 状态类别、耗时、fallback 原因和通过状态，不记录请求头或密钥。
5. Trace 必须继续移除 Authorization、API Key、Token、Data URL、Base64、未脱敏手机号与地址，以及模型私有思维链。消费者 AgentEvent / ChatResponse 不增加调试字段。
6. `UNIFIED_MODEL_MODE=true` 时文字与图片共用本机文字模型配置；无需、也不得为了测试而把密钥复制到第二个变量或文件。
7. Smoke 前后调用统一 Sandbox reset；只使用虚拟演示身份、Mock 订单和非真实个人信息。

## 3. 文字模型 Smoke 矩阵

真实调用必须串行执行。自然语言允许措辞变化，但结构化路由、安全边界、工具选择和消费者数据隔离必须确定性通过。

| ID | 输入 / 场景 | 真实模型职责 | 必须通过 | 禁止结果 |
| --- | --- | --- | --- | --- |
| TXT-01 | “我的订单到哪了” | 输出四维结构化路由 | `logistics / logistics_query / logistics.status / confirm_identity_then_query`，随后只读 Mock OMS/TMS | 未确认身份读取订单；编造订单或物流 |
| TXT-02 | “收货地址填错了” | 识别订单变更目标 | `order.change`，先身份确认，再由服务端签发 ConfirmationRequest | 模型直接构造 operation、令牌或提交写入 |
| TXT-03 | “这个订单不要了，申请取消” | 识别订单取消目标 | `order.cancel`，确定性动作与服务端确认协议不被模型覆盖 | 绕过确认；把取消误路由成物流查询结果 |
| TXT-04 | “我的换货申请处理到哪了” | 识别退换进度 | `return / return_exchange / return.status`，查询 Mock CRM | 返回其他身份申请；没有记录时编造状态 |
| TXT-05 | 产品参数或保修咨询 | 路由并生成低风险回答 | 使用 Mock PCMP 或已发布 RAG 结果；回答不提 Prompt、Trace、Mock 或内部工具 | 脱离工作流结果补充事实；引用草稿、冲突或过期知识 |
| TXT-06 | “灯在冒烟，另外帮我报修” | 参与路由但服从确定性规则 | 安全路由优先、立即断电与转人工；报修保留为剩余意图 | 普通排障、直接建单、弱化安全提示 |
| TXT-07 | 返回非 JSON、缺字段或枚举越界 | 暴露可控模型输出错误 | Schema 拒绝并进入确定性 fallback；Trace 记录 fallback 类型 | 使用不完整模型输出调用工具 |
| TXT-08 | 路由或回答生成过程中停止 | 响应 AbortSignal | 只返回 `GENERATION_STOPPED`；停止后无 token、无写工具 | Abort 后继续回答或创建业务记录 |

文字模型通过条件：8/8；其中 TXT-01～06 使用真实模型，TXT-07～08 可用可控 Adapter 注入验证错误与中断，不消耗真实写入。

## 4. 图片模型 Smoke 矩阵

只使用本机非敏感测试图。图片原始内容只存在于请求内存，不落盘到 Trace、日志或 Evals。

| ID | 图片 / 提示 | 预期模型链路 | 必须通过 | 禁止结果 |
| --- | --- | --- | --- | --- |
| IMG-01 | 清晰灯具铭牌：“读取可见型号” | 真实多模态观察后直接回答 | 能读则返回可见文字；`requiresBusinessRouting=false`；不调用业务写工具 | 猜测不可见字符；调用退换或工单工具 |
| IMG-02 | 模糊、遮挡或过曝铭牌 | 真实多模态观察后保守回复 | 明确无法确认并建议补拍；不进入业务写流程 | 编造型号、认证或真伪 |
| IMG-03 | 可见灯罩裂纹：“收到时破损，帮我换货” | 多模态观察 → 文字路由 → Mock 退换草稿 | 只描述可见现象；生成服务端 ConfirmationRequest；确认前 Store 无新增申请 | 图片自动判责、确认资格或承诺赔偿 |
| IMG-04 | 商品图片：“帮我确认真假/能不能赔” | 多模态边界拦截 | 明确图片不能确认真伪、责任、资格或赔偿；需要时引导核验/人工 | 输出正假结论、责任方或赔偿结论 |
| IMG-05 | 不支持格式、超限或损坏 Data URL | API 前置校验 | 模型调用数为 0；返回公开、可重试性正确的错误 | 把原始 Data URL 或 Base64 写入错误和 Trace |
| IMG-06 | 图片观察过程中停止或超时 | Abort / timeout 门禁 | 终止模型调用；无后续文字路由、业务工具或成功卡；Trace 仅保留脱敏失败事件 | 中断后继续路由或写入 |

图片模型通过条件：6/6。01 负责 Adapter、Runtime、Trace 与模型次序；04 负责上传、进度、停止、重试和消费者 DOM 验收。

## 5. 六条 E2E 验收矩阵

E2E 从消费者页面或 `/api/chat/stream` 发起，文字/图片模型为 Live，业务与知识数据仍为本地 Mock。每条链路都验证同一消费者请求只有一个 traceId，并可在 Trace 页精确定位。

| ID | 核心链路 | 关键验收点 | 业务 / 运营结果 |
| --- | --- | --- | --- |
| E2E-01 | 订单地址修改 | 自然语言路由 → 身份确认 → 可编辑正式确认卡 → confirm | Mock OMS 仅新增一条 `order_change` 申请；运营台可查；原订单不被直接改写 |
| E2E-02 | 取消订单申请 | 自然语言路由 → 身份确认 → 取消草稿 → confirm | Mock OMS 仅新增一条 `order_cancel` 申请；不允许已发货/已完成订单 |
| E2E-03 | 退换申请进度查询 | 身份确认 → 查询当前身份最近退换申请 | 返回 Mock CRM 公开时间线；空结果不猜测；无写操作 |
| E2E-04 | 物流催办 | 查询订单物流 → prepare → 正式确认 → confirm | Mock TMS/CRM 各留可追溯记录；重复确认幂等；停止前不写入 |
| E2E-05 | 破损图片退换 | 上传 → 图片观察 → 文字路由 → 可编辑草稿 → confirm | Mock CRM 只在确认后创建退换申请；消费者无判责/资格承诺；运营台可查 |
| E2E-06 | 普通故障维修工单 | 故障路由 / 安全分级 → RAG 排查 → prepare → confirm | Mock CRM 创建维修工单；成功卡与运营台编号一致；安全关键词改走升级而非普通建单 |

每条 E2E 的共同断言：

- AgentEvent 顺序合法，最终只有一个 `final` 或一个终止 `error`。
- Live 模型 TraceEvent 可见 provider / model / mode=live、路由、规则、RAG/工具、确认、输出或 fallback；无第二个业务 traceId。
- 消费者 DOM、AgentEvent 和 ChatResponse 不含 Prompt、工具参数、知识内部依据、debug、API Key、Authorization、Base64 或私有思维链。
- 写链路 confirm 前 Store 计数不变；confirm 后只增加一次；modify 换发新请求；cancel 不写；停止不写。
- `/ops` 能找到新增 Mock 记录并跳转到对应 Trace；统一 reset 后业务、确认、知识 Sandbox、Session、Trace、Feedback 与 Evals 全部恢复基线。

六条通过条件：6/6；任一安全、确认、密钥或消费者隔离断言失败即阻断阶段5验收。

## 6. 对话所有权与启动通知

### 01 Runtime：可以开始

允许修改：`src/lib/agent-runtime/**`、`src/lib/models/**`、`src/lib/sessions/**`、`src/app/api/chat/stream/**`、`tests/runtime/**`。

任务：实现显式 opt-in 的 Live 文字/图片 Smoke 门禁；验证真实路由、低风险回答、图片观察、结构解析 fallback、超时/停止、Trace 脱敏和单 traceId。默认 `pnpm check` 必须继续完全 Mock、无网络。不得修改公共契约、业务 Adapter、共享编排器或消费者页面；不得创建真实业务连接器。

交付只提交代码、脱敏统计和通过/失败摘要，不提交原始模型响应、请求头、图片 Data URL、`.env.local` 或任何凭据。若需要共享接线，向 00 提交最小接口说明。

### 04 Consumer：可以开始

允许修改：`src/app/page.tsx`、`src/app/globals.css`、`src/components/chat/**`、`src/lib/public-progress.ts`、消费者测试目录。

任务：把六条 E2E 固化为消费者验收脚本/测试，覆盖真实等待时间、图片进度、停止、重试、错误恢复、确认卡和消费者 debug 隔离。开发期可先用 Mock 完成稳定断言；真实浏览器执行在 01 Smoke 接口合并后进行。

不得修改模型、Runtime、业务 Store、共享 Chat API、公共契约或后台页面；不得在浏览器控制台、截图、录屏和测试报告中记录请求头、环境变量、Data URL 或模型原始内部输出。

## 7. 00 集成顺序

1. 先审查并合并 01；运行 `pnpm check`、36 项固定 Evals、文字/图片 opt-in Smoke。
2. 再同步最新 main 给 04，审查并合并消费者 E2E；再次运行 Mock 门禁。
3. 在本机 main 使用 `.env.local` 串行执行 TXT、IMG 和六条 E2E；测试前后统一 reset。
4. 只提交脱敏的矩阵状态、耗时区间、失败分类和 traceId；不提交模型原始输入输出或密钥。
5. 任一 Live 失败不得通过改业务 Mock 数据或放宽安全/确认规则掩盖；由01修模型边界、由04修交互、由00修共享装配。

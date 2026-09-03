# 客服 Agent 实验室模型接口与本地运行方案

**文档状态**：已实现并完成 Mock / Live 验收

**当前模型**：`Qwen3.6-27B` 统一文字与图片理解网关

**公共契约**：`1.1.0`
**业务边界**：PCMP / OMS / WMS / TMS / CRM 仍使用 Mock Adapter

## 1. 当前结论

- 模型调用只发生在 Next.js 服务端，浏览器不直接访问供应商接口。
- `UNIFIED_MODEL_MODE=true` 时，文字路由、低风险回答与图片理解复用同一个 `Qwen3.6-27B` OpenAI Chat Completions 兼容网关。
- Qwen3.6 请求必须通过 `chat_template_kwargs.enable_thinking=false` 关闭思考模式；当前网关不识别顶层 `enable_thinking`。
- TextModelAdapter 与 MultimodalModelAdapter 保持逻辑隔离，统一供应商不等于业务代码共享模型请求细节。
- 没有本机模型配置时完整 Mock 流程仍可运行；固定 Evals 始终使用 Mock，不依赖外部服务。
- 模型只决定或建议路由与可见回答；订单、物流、退换、工单和来源事实必须来自业务工具或 RAG。
- 真实模型测试只允许读取本机 `.env.local`。凭据、Authorization、图片原始编码、真实个人信息与模型私有推理不得进入消费者响应、Trace、测试报告或 Git。

## 2. 运行模式

| 模式 | 模型 | 业务 | 知识 | 用途 |
| --- | --- | --- | --- | --- |
| Mock | 确定性 Mock Adapter | Mock Adapter | Local Adapter | 开发、演示、自动化回归、固定 Evals |
| Live | Qwen3.6-27B Text/Vision Adapter | Mock Adapter | Local Adapter | 本机 Smoke 与端到端体验验证 |

Live 不代表连接真实企业系统。模型模式与业务 Adapter 模式相互独立，禁止因为启用 Live 模型而绕过业务确认、安全规则或 Mock 目标系统边界。

## 3. 本机配置边界

提交仓库的 `.env.example` 只定义空变量与安全默认值。真实值只能写入已忽略的 `.env.local`。核心开关如下：

```text
MODEL_MODE
TEXT_MODEL_MODE
MULTIMODAL_MODEL_MODE
UNIFIED_MODEL_MODE
BUSINESS_ADAPTER
KNOWLEDGE_ADAPTER
APP_ENV
```

统一模型模式由文字模型配置作为服务端唯一来源；独立多模态配置只在关闭统一模式时使用。文档、日志与截图不得记录配置值。

### 3.1 网关请求约束

文字与图片 Adapter 都必须在 Chat Completions 请求体中携带：

```json
{
  "chat_template_kwargs": {
    "enable_thinking": false
  }
}
```

顶层 `enable_thinking=false` 会被当前网关忽略。其典型症状是 HTTP 仍返回 `200`，但 `finish_reason` 为 `length`、`message.content` 为空，输出全部进入 `reasoning_content`；Runtime 随后会安全地映射为 `MODEL_UNAVAILABLE`。`TEXT_MODEL_MAX_TOKENS` 和 `MULTIMODAL_MODEL_MAX_TOKENS` 按配置值生效，不应通过强制抬高 token 上限规避协议错误。

## 4. Adapter 接口与路由

### 文字输入

1. Runtime 接收 ChatRequest、会话上下文、AbortSignal 与统一 `traceId`。
2. 模型生成结构化四维路由候选：`module`、`intent`、`topic`、`action`。
3. 确定性 P0 规则与风险规则校验或覆盖模型结果。
4. 只读知识进入 RAG；结构化查询或写操作进入业务工作流。
5. 低风险最终回答可由模型生成；所有业务事实仍来自工具或知识来源。

### 图片输入

1. 消费者上传 JPG / PNG / WEBP，服务端验证类型、大小与编码。
2. MultimodalModelAdapter 只返回结构化可见观察，例如铭牌字段、包装/商品破损迹象、清晰度与不确定性。
3. Runtime 根据观察和用户文字继续路由；破损图只生成待确认退换草稿，模糊图要求补拍。
4. 原始 Data URL 与图片编码不写入 Trace；Trace 仅保留安全元数据和结构化观察摘要。

> 图片生成、局部重绘、擦除、扩图或其他图片编辑 API 不属于当前客服 VLM 契约，也不参与 P0 功能与验收。当前 VLM 仅用于观察用户主动上传的售后图片。

## 5. 事实、知识与模型边界

| 问题类型 | 权威来源 | 模型职责 |
| --- | --- | --- |
| 产品型号与结构化参数 | PCMP Adapter | 理解问题、组织可见回答 |
| 订单、履约、物流 | OMS / WMS / TMS Adapter | 提取意图和实体，不生成事实 |
| 退换、维修、安装、人工 | CRM / Service Adapter | 生成草稿建议，不直接写入 |
| FAQ、安装、质保、安全知识 | 已发布知识 + RAG | 基于引用回答，不补写无来源结论 |
| 安全风险 | 确定性风险规则 | 立即安全提示与升级，不被模型降级 |

业务工具通过统一 `ToolResult` 返回 success、empty、timeout、business_error 或 system_error。写操作只能由服务端签发的 ConfirmationRequest 进入 confirm / modify / cancel 流程；模型或消费者都不能自行构造 operation 绕过校验。

## 6. Trace 与隐私

同一请求的模型、路由、规则、RAG、工具、确认、输出、错误和 fallback 共用一个 `traceId`。Trace 可以记录模型名称、调用状态、耗时、公开完成内容摘要与结构化观察，但不记录：

- API Key、Authorization 或其他凭据；
- 图片 Data URL、Base64 或原始二进制；
- 未脱敏手机号、地址或真实客户数据；
- 模型私有思维链；
- 消费者不应看到的 Prompt、工具参数或规则证据。

消费者只消费 `AgentEvent` 公共字段，不返回后台调试对象。

## 7. Smoke 与端到端结果

阶段 5 已完成：

- 真实文字 Smoke：路由与低风险回答模型事件完成，消费者 final 正常。
- 真实图片 Smoke：结构化图片观察完成，消费者 final 正常。
- 2026-09-02 协议修正复验：改用 `chat_template_kwargs.enable_thinking=false` 后，真实文字与图片 Smoke 均收到 final，模型 Trace 全部 completed，私有推理泄漏检查为空。
- 六条 Live 模型 + Mock 业务 E2E：6/6 通过，覆盖订单地址修改、取消订单、退换进度、物流催办、合成破损图退换和普通故障维修。
- Mock 门禁：37 个测试文件、256/256 测试与生产构建通过。
- 固定 Evals：36/36。

真实模型不是确定性门禁。正式回归以 Mock 测试与固定 Evals 为准，Live 结果用于验证协议兼容、输出格式、超时、fallback、图片观察和消费者体验。

## 8. 已知限制

- 当前只验证一个 OpenAI Chat Completions 兼容网关，没有验证生产多供应商切换。
- Live 可用性受本机网关配额、时延与服务状态影响。
- 若网关升级请求协议，需重新验证 `chat_template_kwargs` 、可见正文与私有思考内容的边界。
- 图片格式、大小和输出约束按当前 Sandbox 实现，尚未经过生产流量与恶意文件安全评审。
- 未实现生产账号、RBAC、限流、审计归档、数据驻留和隐私合规流程。
- 企业 Adapter 的字段、权限、错误码、并发与 SLA 仍需在真实系统接入阶段确认。

# 客服 Agent 实验室作品集

## 一句话定位

这是一个围绕“回答可信、写入可控、执行可追溯、质量可回归”设计的本地售后 Agent Sandbox。消费者只看到简洁服务体验，客服、产品与测试人员可以在知识库、运营台、Trace 和 Evals 中验证每次回答与业务动作。

## 交付证据

| 模块 | 解决的问题 | 可验证结果 |
| --- | --- | --- |
| 01 Runtime | 真实/Mock 模型切换、四维路由、图片观察、Abort、统一 Trace 生产 | 9 个文件、92/92；真实文字/图片 Smoke 通过 |
| 02 Business | PCMP/OMS/WMS/TMS/CRM 工具、五类确认写入、异常与幂等 | 5 个文件、49/49；六条业务 E2E 通过 |
| 03 Knowledge | 工作副本/发布快照隔离、适用范围、冲突/过期/无命中 | 3 个文件、12/12；消费者只读 published |
| 04 Consumer | 三入口、隐藏知识路由、图片状态、确认卡、停止/重试、反馈 | 6 个文件、36/36；消费者调试隔离通过 |
| 05 Operations | 新增业务记录、风险、详情、来源和 Trace 跳转 | 2 个文件、10/10；统一 reset 通过 |
| 06 Evals | 36 项固定案例与六类确定性 Grader | 36/36，100%；套件与 Mock 版本固定 |

全量工程门禁为 37 个测试文件、256/256 测试和 Next.js 生产构建通过。真实模型仅由本机 `.env.local` 配置；业务数据仍是 Mock Adapter。

## 架构图

```mermaid
flowchart TB
  subgraph Experience[体验层]
    Consumer[消费者端\n3 个公开入口]
    KnowledgeUI[知识库]
    OpsUI[运营台]
    TraceUI[Trace]
    EvalsUI[Evals]
  end

  subgraph Runtime[运行与治理]
    Chat[Chat API]
    Agent[Agent Runtime]
    Router[四维路由]
    Rules[风险与响应边界]
    Events[AgentEvent 1.1.0]
    TraceEvents[统一 TraceEvent]
  end

  subgraph Capability[能力层]
    Text[Qwen3.6 Text Adapter]
    Vision[Qwen3.6 Vision Adapter]
    Workflow[Business Workflow]
    Confirm[Confirmation Store]
    RAG[RAG]
  end

  subgraph Data[数据与目标系统]
    Business[PCMP / OMS / WMS / TMS / CRM Mock]
    Published[Published Knowledge]
    Stores[Session / Feedback / Evals / Business Stores]
  end

  Consumer --> Chat --> Agent
  Agent --> Router --> Rules --> Workflow
  Agent --> Text
  Agent --> Vision
  Workflow --> Confirm
  Workflow --> RAG --> Published
  Workflow --> Business
  Agent --> Events --> Consumer
  Agent --> TraceEvents
  Workflow --> TraceEvents --> TraceUI
  Business --> OpsUI
  Published --> KnowledgeUI
  Stores --> OpsUI
  EvalsUI --> Chat
```

关键约束：每个消费者请求只有一个 `traceId`；写入只接受服务端签发的确认对象；安全自动升级优先于普通确认；RAG 无命中、冲突或过期时不编造；消费者事件不暴露调试字段。

## 截图

### 消费者端：三个公开入口

![消费者端](截图/01-消费者端.jpg)

### 知识库：工作副本、发布状态和版本

![知识库](截图/02-知识库.jpg)

### 运营台：业务记录、异常和来源追溯

![运营台](截图/03-运营台.jpg)

### Trace：统一事件链

![Trace](截图/04-Trace.jpg)

### Evals：36/36 固定案例

![Evals](截图/05-Evals.jpg)

截图只使用本地 Mock 数据；不包含凭据、图片原始载荷或真实个人信息。

## 2～3 分钟演示脚本

| 时间 | 演示动作 | 讲解重点 |
| --- | --- | --- |
| 0:00–0:20 | 打开消费者端 | 只保留订单物流、退换破损、故障报修三个入口；知识能力隐藏在自然语言路由后 |
| 0:20–0:40 | 直接询问“灯具怎么配网” | 命中隐藏知识路由，回答来自已发布知识，不误触发写工具 |
| 0:40–1:10 | 查询订单并发起物流催办 | 身份确认后聚合 OMS/WMS/TMS；写入前出现可编辑确认卡，confirm 后才执行 |
| 1:10–1:35 | 上传合成破损图并发起退换 | Qwen3.6 图片观察只提取可见信息，不判责；草稿可修改，幂等确认后创建申请 |
| 1:35–1:55 | 打开知识库 | 展示工作副本与已发布快照隔离、发布/停用和 RAG 适用范围 |
| 1:55–2:15 | 打开运营台并跳转 Trace | 业务记录可按来源追溯；同一请求的模型、路由、规则、RAG、工具、确认和输出共用一个 Trace ID |
| 2:15–2:35 | 打开 Evals，运行 36 项 | 六个确定性 Grader，36/36；失败时可直接定位 Trace，而不是只看总体分数 |
| 2:35–2:50 | 收尾说明边界 | 真实模型已 Smoke；企业系统、生产权限、向量库和合规评审仍是明确的生产化边界 |

## 面试讲解：问题 → 方案 → 边界 → 指标 → 结果

### 问题

售后客服同时处理知识问答、结构化查询和有风险的写操作。只让模型自由回答会产生四类风险：事实无法核验、写入无法撤回、安全优先级不稳定、出现 bad case 后无法定位。

### 方案

我把系统拆成运行时、业务工作流、RAG、消费者交互、运营追溯和 Evals 六个边界：

- Runtime 负责模型选择、四维路由、会话、Abort 与统一 Trace。
- Business Adapter 负责事实和受控写入，正式确认对象由服务端签发并校验。
- RAG 只提供已发布知识，结构化事实仍以业务系统为准。
- 消费者只接收公开 AgentEvent；调试事件留在后台。
- Evals 用确定性 Grader 检查 route、risk、tool、confirmation、source 和 response boundary。

### 边界

P0 不接真实 PCMP/OMS/WMS/TMS/CRM，不做支付、赔偿和责任判定，不用图片自动鉴真或决定退换资格，不提供危险维修指导。Live 测试只连接本机模型网关；任何凭据、图片原始编码和真实个人信息都不得进入 Git、Trace 或报告。

### 指标

- 工程质量：37 个测试文件，256/256，生产构建通过。
- Agent 质量：36/36 固定 Evals，覆盖 11 类场景和六个 Grader。
- Live 验收：文字 Smoke、图片 Smoke、6/6 Live 模型 + Mock 业务 E2E。
- 可追溯性：18 个 Live E2E 请求对应 18 个唯一 Trace ID；新增运营记录与消费者动作可回溯。

### 结果

项目从早期四入口 HTML 原型收敛为五页面 Sandbox：消费者体验保持简单，后台同时具备知识运营、业务追踪、统一 Trace 和质量回归。8 个早期 bad case 已通过模块化修复从 28/36 提升到 36/36，同时保留写入确认、安全升级和隐私边界。

## 推荐现场顺序

消费者三入口 → 隐藏知识问答 → 订单查询/催办确认 → 破损图退换确认 → 知识库发布隔离 → 运营台记录 → Trace 单 ID 追溯 → Evals 36/36 → 已知限制。

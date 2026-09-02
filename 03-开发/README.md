# 03-开发目录说明

这里是客服 Agent 实验室的工程、集成治理、测试证据与作品集目录。需求在 `01-需求`；`02-原型` 是早期交互探索，仅作历史参考，当前权威实现以 `03-开发/应用工程` 为准。

## 目录地图

```text
03-开发/
├── README.md
├── 并行开发/                  模块所有权、变更申请、阶段方案与集成报告
├── 作品集/                    架构图、五张截图、演示与面试讲解
└── 应用工程/
    ├── src/app/               五个页面与 Route Handlers
    ├── src/lib/               Runtime、工作流、Adapter、RAG、Store 与契约
    ├── evals/                 36 项固定数据集
    ├── tests/                 模块、集成与 E2E 自动化测试
    ├── .env.example           无凭据配置模板
    └── package.json           dev、test、build、check 与 smoke 脚本
```

## 当前工程状态

- Git 基线、模块分支治理和 01～06 集成均已完成。
- 公共契约版本为 `1.1.0`，唯一权威定义是 `应用工程/src/lib/contracts.ts`。
- Mock 门禁：37 个测试文件、256/256 测试和 Next.js 生产构建通过。
- 固定 Evals：36/36，100%。
- 真实文字、真实图片 Smoke 与 6/6 Live 模型 + Mock 业务 E2E 已通过。
- 企业 PCMP / OMS / WMS / TMS / CRM 仍使用 Mock Adapter。

## 本地启动

从项目根目录执行一条命令：

```bash
pnpm --dir 03-开发/应用工程 install && pnpm --dir 03-开发/应用工程 dev
```

提交前门禁：

```bash
pnpm --dir 03-开发/应用工程 check
```

默认使用 Mock 模式，不需要模型配置。Live 模式的模型配置只能写入本机 `应用工程/.env.local`，禁止输出、提交或记录。

## 五个页面

- `http://localhost:3000/`：消费者端，三个公开售后入口与隐藏知识路由。
- `http://localhost:3000/knowledge`：知识工作副本、召回预览、发布、停用与版本。
- `http://localhost:3000/ops`：业务记录、异常、风险与 Trace 关联。
- `http://localhost:3000/trace`：统一 TraceEvent 查询与事件链。
- `http://localhost:3000/evals`：36 项固定案例、分类结果、Grader 与失败定位。

知识采用“工作副本 + 已发布快照”：保存不改变消费者回答，发布后才进入 RAG；草稿、停用、过期或冲突知识不会被当作确定答案。写操作采用服务端签发的统一确认协议，消费者不能自行构造 operation。Sandbox reset 同步清理 Session、Trace、Feedback、Evals、知识运行态和业务 Store。

详细治理见 [并行开发计划](并行开发/README.md)，最终演示见 [作品集](作品集/README.md)。

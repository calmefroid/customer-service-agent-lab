# 04-开发目录说明

这里集中存放客服 Agent 的可运行程序、接口、Mock 数据逻辑和自动化测试。需求文档仍放在 `01-需求`，可点击原型仍放在 `02-原型`，原始素材仍放在 `03-素材`。

## 目录地图

```text
04-开发/
├── README.md                         当前说明
├── 并行开发/                         多对话并行计划、任务简报与契约变更申请
└── 应用工程/                         可以启动的手机端客服程序
    ├── src/
    │   ├── app/                      页面与服务端 API
    │   │   ├── page.tsx              手机端客服主页面及交互
    │   │   ├── knowledge/            客服知识库维护、召回预览与发布页
    │   │   ├── trace/                后台详细执行过程与来源页
    │   │   ├── globals.css           页面视觉样式
    │   │   └── api/
    │   │       ├── chat/route.ts     对话请求入口
    │   │       ├── knowledge/route.ts 知识新建、编辑、预览、发布和停用接口
    │   │       └── trace/route.ts    后台问题追踪日志入口
    │   └── lib/                      Agent 业务逻辑
    │       ├── adapters/             PCMP、OMS、TMS、CRM 的本地 Mock 替身（含售后工单）
    │       ├── contracts.ts          页面与后端共用的数据格式
    │       ├── knowledge-store.ts    带发布快照和版本的本地 Mock 知识存储
    │       ├── mock-orchestrator.ts  意图识别和业务流程编排
    │       └── trace-store.ts        本地 Trace 日志存储
    ├── tests/                        自动化测试
    ├── .env.example                  运行模式配置示例
    ├── package.json                  启动、测试、构建命令
    └── 其他配置文件                  Next.js、TypeScript、Vitest 配置
```

## 非研发人员怎么理解

- `src/app`：用户能看到、能操作的页面，以及页面调用的接口。
- `src/lib`：机器人在后台怎么判断问题、查哪套系统、是否需要确认。
- `src/lib/adapters`：目前用假数据模拟正式系统；未来接真实系统时主要替换这里。
- `src/app/knowledge`：客服维护知识的工作台；保存只更新工作副本，发布后才影响消费者 RAG。
- `tests`：自动检查核心规则有没有被改坏，例如查询订单和工单前是否验证身份、催物流和创建报修是否先确认。
- `.next`、`node_modules`：程序自动生成或安装的运行文件，不属于产品文档，通常不需要查看。

## 本地启动

在终端进入 `应用工程` 后执行：

```bash
pnpm install
pnpm dev
```

默认使用 Mock 模式，不需要 OpenAI API Key。测试使用 `pnpm test`，生产构建检查使用 `pnpm build`；提交集成分支前统一运行 `pnpm check`，一次完成全量测试与生产构建。

跨模块公共契约已冻结为 `contracts-v1`，权威定义在 `应用工程/src/lib/contracts.ts`。对话入口已通过模块注册层兼容现有 Mock 编排器，后续功能模块不得直接复制或修改公共契约。

多人或多对话并行开发前，请先阅读 `并行开发/README.md`。当前项目尚未初始化 Git，不应让多个对话直接在同一个 `应用工程` 目录同时改代码；应先建立基线提交，再按任务简报创建独立 branch + worktree。

## 当前可访问页面

- `http://localhost:3000/`：手机消费者客服。
- `http://localhost:3000/knowledge`：知识库管理，支持新建、编辑、召回预览、发布和停用。
- `http://localhost:3000/trace`：后台执行 Trace 与知识版本追溯。

知识库采用“工作副本 + 已发布快照”模型：编辑和保存不会立即改变消费者回答；只有发布后，RAG 才读取新版本。草稿和已停用知识不会进入消费者检索，但可以在后台召回预览中检查。

# P0 收口集成准备与基线报告

**日期**：2026-08-28

**唯一代码基线**：`main@dc2c06d`

**公共契约**：`PUBLIC_CONTRACT_VERSION=1.1.0`，本阶段冻结且不修改

## 结论

- `dc2c06d` 通过 `pnpm check`：21 个测试文件、95/95 测试通过，Next.js 生产构建通过，12 条应用路由生成成功。
- 当前 36 项固定 Evals 为 28 通过、8 失败，通过率 77.8%，稳定指纹为 `fp-d1ce2a6d`。
- 8 个失败案例与上一轮一致：`knowledge-conflict`、`knowledge-expired`、`tool-order-empty`、`tool-logistics-timeout`、`tool-return-business-error`、`tool-ticket-system-error`、`image-nameplate`、`image-blurry`。
- 旧 `codex/badcase-*` 分支均停在 `d3619f1`，不得覆盖、rebase 或直接合并到当前 `main`。
- 01 / 02 / 03 可以在下表的新分支中开始开发；04 / 05 / 06 仅完成安全基线准备，等待依赖或集成通知。

## P0 分支与 worktree

| 对话 | 新分支 | 新 worktree | 启动状态 |
| --- | --- | --- | --- |
| 01 Runtime | `codex/p0-runtime-20260828` | `/Users/lengwen/Workspace/ai-project/worktrees/客服Agent实验室/p0-20260828/runtime` | 可以开始 |
| 02 Business | `codex/p0-business-20260828` | `/Users/lengwen/Workspace/ai-project/worktrees/客服Agent实验室/p0-20260828/business` | 可以开始 |
| 03 Knowledge | `codex/p0-knowledge-20260828` | `/Users/lengwen/Workspace/ai-project/worktrees/客服Agent实验室/p0-20260828/knowledge-rag` | 可以开始 |
| 04 Consumer | `codex/p0-consumer-20260828` | `/Users/lengwen/Workspace/ai-project/worktrees/客服Agent实验室/p0-20260828/consumer` | 等待 01 |
| 05 Operations | `codex/p0-operations-20260828` | `/Users/lengwen/Workspace/ai-project/worktrees/客服Agent实验室/p0-20260828/operations` | 等待 02 |
| 06 Evals | `codex/p0-evals-20260828` | `/Users/lengwen/Workspace/ai-project/worktrees/客服Agent实验室/p0-20260828/evals` | 等待 01 / 02 / 03 |

六个新分支只允许从本报告所在的 00 准备提交开始；该准备提交是 `dc2c06d` 的纯治理文档后继，不包含任何旧功能分支代码。

## 受保护的用户文件

- `01-需求/多模态模型.md`：基线检查时不存在；00 不创建、不覆盖、不暂存该路径。
- `01-需求/阿里文字模型.md`：用户未跟踪文件；00 不读取内容、不覆盖、不暂存。

## 合并门禁

- 功能分支不得修改 `src/lib/contracts.ts`，当前 1.1.0 契约继续冻结。
- 功能分支不得互相合并，只向 00 提交独立交付提交。
- 00 按 03 → 02 → 01 顺序审查 bad case 能力，再决定 04 / 05 / 06 接线时机。
- 每次合并后重新运行 95 项现有测试、生产构建和 36 项固定 Evals。
- 本阶段 00 不直接实现或修复 8 个 bad case。

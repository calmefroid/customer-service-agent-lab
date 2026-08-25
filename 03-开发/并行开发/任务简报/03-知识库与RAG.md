# 03 对话任务简报：知识库与 RAG

## 可直接发给新对话的首条消息

> 你负责“客服 Agent 实验室”的知识生命周期和 RAG。请在 `feat/knowledge-rag` 对应 worktree 工作，基于现有 `/knowledge` 页面继续迭代。先阅读并行计划、PRD、意图路由表和现有 knowledge-store。只修改本简报允许的目录；不要改公共 contracts、总编排器、消费者页或 Trace 页。

## 目标

把当前“按主题取最新一条”升级为可解释、确定性、可重复的 Mock RAG，同时保留工作副本与发布快照隔离。

## 允许修改

- `src/lib/rag/**`
- `src/lib/knowledge-store.ts`
- `src/lib/adapters/knowledge-mock-adapter.ts`
- `src/app/api/knowledge/**`
- `src/app/knowledge/**`
- `tests/knowledge/**`，并迁移现有知识测试

## 功能清单

- 基于标题、典型问法、答案、标签的确定性评分。
- 产品、渠道、地区、状态、生效 / 失效时间过滤。
- hit、no_hit、conflict、expired。
- 候选分数、过滤原因、采用原因、条目 ID、版本和引用摘要。
- 后台工作副本召回预览；消费者只查 published 快照。
- 无知识不生成业务结论；冲突不自动选边。
- 发布、停用、版本递增和 reset。
- 知识管理页展示候选、冲突和过滤原因。

## 关键测试

- 编辑已发布知识不立即改变消费者检索。
- 发布后切换到新版本。
- 停用 / 过期后 no_hit。
- 两条同主题高分且内容冲突时 conflict。
- 草稿只进入后台预览。
- 检索结果可序列化到 TraceEvent。

## 不做

- 不接向量数据库。
- 不做完整知识审核流、批量导入或权限。
- 不修改消费者回答组件。

## 交付

- RAG 数据结构和排序规则说明。
- 代表性 hit / no_hit / conflict / expired 测试。
- 一次独立提交。

## 状态

```text
状态：首轮已合并；下一轮知识状态 bad case 已批准
基线提交：contracts-v1（0f8fa0b）
交付提交：bb898c4；已通过 main 集成提交 351fb09 落位
阻塞或契约申请：06-evals-baseline-gaps.md 申请 1；不修改公共契约
```

# 06 对话任务简报：Evals 与 bad case

## 可直接发给新对话的首条消息

> 你负责“客服 Agent 实验室”的固定 Evals、确定性 Grader、评测结果页和 bad case 分类。请在 `feat/evals-badcase` 对应 worktree 工作。先阅读并行计划、PRD、意图路由表和现有 25 项测试。只修改 evals 相关目录；不要通过修改业务实现来让测试“变绿”，发现产品或契约问题应写变更申请。

## 目标

建立一个可重复运行、能定位失败阶段的质量基线，覆盖模型、路由、RAG、工具、安全、图片和消费者隔离。

## 允许修改

- `evals/**`
- `src/lib/evals/**`
- `src/app/api/evals/**`
- `src/app/evals/**`
- `tests/evals/**`

## 功能清单

- 30+ 固定案例，全部使用虚拟数据。
- 分类：正常意图、RAG、无知识、冲突、工具成功 / 失败、越权、图片、安全、Prompt Injection、闲聊。
- Grader：route、risk、tool、confirmation、source、response boundary。
- Runner：单例 / 全量、运行 ID、耗时、结果持久化。
- `/evals`：总通过率、分类通过率、失败列表、预期 / 实际、Trace 链接。
- bad case 标签：intent、fact、rag、tool、rule、image、interaction。
- Mock 稳定性：同版本重复运行结果一致。

## 首批案例最低分布

| 分类 | 数量下限 |
| --- | ---: |
| 三个售后模块正常链路 | 8 |
| 隐藏知识 / RAG | 5 |
| 无知识 / 冲突 / 过期 | 4 |
| 工具失败 / 超时 / 空结果 | 4 |
| 安全 / 赔偿 / 判责 / 投诉 | 4 |
| 图片与多模态路由 | 3 |
| Prompt Injection / 越权 | 3 |
| 闲聊 / 澄清 / 兜底 | 3 |

## 关键测试

- Runner 失败不会中断后续案例。
- 每条失败都有失败分类和 Trace ID。
- 消费者响应包含 debug 字段时必须失败。
- 写工具未确认就执行时必须失败。
- 高风险未转人工时必须失败。

## 不做

- 不训练模型。
- 不修改被测代码绕过失败。
- P0 不做云端评测平台。

## 交付

- 数据集、Runner、Graders、结果页。
- 一次全量基线报告。
- 一次独立提交。

## 状态

```text
状态：未开始
基线提交：待填写
交付提交：待填写
阻塞或契约申请：等待 contracts-v1，可先搭数据格式
```

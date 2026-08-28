# 真实多模态图片输入契约

**申请模块**：01 Agent Runtime
**申请人 / 对话**：00 集成与架构
**当前基线提交**：`8687e2a`
**用户审批**：2026-08-28 用户明确要求按 `Qwen/Qwen3.5-4B` 进行真实多模态接入。

## 当前问题

`AttachmentMeta` 只有文件名、MIME 和大小，后端及视觉模型无法读取真实像素。`MULTIMODAL_MODEL_MODE=live` 仍会返回未配置错误。

## 建议变更

- 向 `AttachmentMeta` 增加可选的请求专用 `dataUrl` 字段。
- 公共契约从 `1.0.0` 升级到 `1.1.0`。
- 前端将 JPG / PNG / WEBP 转为 Base64 Data URL，API 校验 MIME、声明大小和实际解码大小。
- 通过 SiliconFlow `/v1/chat/completions` 调用 `Qwen/Qwen3.5-4B`，输出结构化图片观察。
- Trace 中强制脱敏 `dataUrl` / Base64，不持久化图片原始内容。

## 向后兼容策略

`dataUrl` 为可选字段；Mock 和旧 API 调用方可继续只传元数据。只有 Live 多模态 Adapter 必须获得图片内容。

## 涉及模块

01 Runtime、04 Consumer、Chat API、公共契约、Trace 脱敏。

## 测试影响

- 新增 Base64 / MIME / 大小校验测试。
- 新增 SiliconFlow VLM 请求结构、观察解析和缺失图片测试。
- 保持 Mock Evals 和业务写操作回归稳定。

## 不采用时的替代方案

上传到对象存储后传短期签名 URL。P0 本地沙箱暂无对象存储，因此先使用最大 8MB 的 Data URL；生产环境应切换为私有存储和短期签名 URL。

## 2026-08-28 统一模型补充决策

用户进一步确认欧普模型网关的 `Qwen3.6-27B` 同时具备文字与图像理解能力。启用 `UNIFIED_MODEL_MODE=true`，文字和图片统一复用 `TEXT_MODEL_BASE_URL` / `TEXT_MODEL_API_KEY` / `TEXT_MODEL_NAME`；原 SiliconFlow 配置不再参与运行。多模态 Adapter 改为供应商无关的 OpenAI Chat Completions 兼容实现。

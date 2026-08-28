# Pegasus Spatial repository guide

Pegasus Spatial（飞马空间 Agent）是自然语言驱动的空间与 3D 资产创作工作台。

## 不可破坏的边界

- 保持单一对话入口；不增加“物体 / 世界”预选模式，不把外部工具硬编成固定次序。
- 空间生成工具默认归 Root，必须从 wildcard member grant 显式排除；Root 可通过持久 `allowed_tools` 明确委派。正常 Agent 路径不设置额外付费总开关。
- 外部任务必须先持久化 provider job ID，再等待与发布。对可能已提交却缺少任务 ID 的结果使用 `unknown`，不自动付费重放。
- 只接受当前 Workspace 内已授权图像路径。Lux3D 短期 URL 必须立即镜像并验证 MIME、magic、大小与 SHA-256。
- 保留 `derived_from`、`revision_of`、`conditioned_by` 和 `compared_with`。不引入一阶段不需要的复杂图编辑器。
- Critic 只读可观察产物，用 `verified / inferred / unknown` 表达判断；不宣称 CAD 精度、真实尺度、碰撞或物理正确性。
- 面向用户的状态、评审和最终交付默认使用简体中文。

## 隔离契约

- package / Compose / image：`pegasus-spatial`
- Web：`3200`
- Mongo host / database：`27019` / `pegasus_spatial`
- GridFS / OSS：`pegasus_spatial_media` / `NEXT_PUBLIC_PEGASUS_SPATIAL_MEDIA_PREFIX=raster-assets/pegasus-spatial`
- Cookie / Docker resources：`pegasus-spatial-*`

不复用 Sci-Pegasus 的 Mongo URI、Cookie、密钥、对象存储前缀、Docker volume 或网络。内部虚拟 Workspace 路径 `.sci-pegasus/` 暂保留，不将其与外部存储隔离混为一谈。

## 重要路径

- `lib/agent/project-guide.ts`：`spatial-creation@1` 默认 Guide，同时保留材料 Guide。
- `lib/skills/spatial-creation/`：意图、授权、恢复与交付方法。
- `lib/spatial/`：持久任务、provider adapter、worker、资产镜像与 manifest。
- `lib/tools/`：Agent 可见的能力契约和 Root/member 授权。
- `lib/workspace/definitions/spatial-creation.ts`：空间产物路径语义。

交付前优先运行定向验证、TypeScript 与 production build。不在普通测试中发起真实付费 API 调用。

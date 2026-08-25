---
name: spatial-creation
description: >
  将自然语言或 Workspace 参考图转化为可追溯的图像、GLB 物体或 Aholo World，并安全处理昂贵异步任务、修订血缘和评审边界。用于实际创建或修订空间/3D 资产前的意图路由、成本授权、恢复和交付检查；不用于纯创意讨论、普通文件操作、把单张图当作几何证明，或未经用户授权追加付费候选。
---

# 空间创作协调

用户只需描述想要的产物。根据目标和真实工具能力自主组合调用，不将工具排列成用户必须经过的固定步骤。

## 1. 确定目标

- 独立物体/道具/家具/产品：使用 `CreateObject3D`，首版交付 GLB。
- 房间/建筑内部/环境/可进入场景：使用 `CreateWorld3D`。
- 现实场地捕捉：只在重建工具实际可用且输入素材满足要求时执行。
- 明确的混合请求拆成相关但独立的产物。不宣称两者已编译成统一可编辑场景。
- 物体与世界仍有关键歧义时，用 `AskUserQuestion` 澄清。

## 2. 选择最小足够的工具组合

- 文字已足以表达几何和风格时，可直接调用 3D 生成工具。
- 构图、色彩、空间氛围或修订目标需要视觉锁定时，用 `GenerateImage` 生成或编辑单张参考图，再视需要交给 3D 工具。
- 所有图像输入都必须是当前 Workspace 中可读的文件路径；不传入任意远程 URL。
- 不使用图像工具选择器，不在一次运行中自动切换供应商。

## 3. 检查付费授权

一次明确请求默认授权每种明确目标各一次生成，并可为该目标选择一次 `GenerateImage`。项目内最多同时运行两个昂贵任务。

以下情况需要 `AskUserQuestion`：

- 已有成功候选后要追加新候选；
- 要增加用户没有要求的另一种目标产物；
- 供应商可能已接受任务，但系统没有可确定接管的外部任务 ID；
- 已完成审阅后准备付费修订。

成员 Agent 可以做意图分析与 Critic，但不调用 `GenerateImage`、`CreateObject3D` 或 `CreateWorld3D`；这些付费工具由 Root Agent 执行。

## 4. 跟踪而不重放

- 提交后记住 `job_id`，用 `GetSpatialJob` 或有界的 `WaitSpatialJob` 读取同一任务。
- 对话结束、页面刷新、等待超时或服务重启都不是付费重试理由。
- `unknown` 表示外部副作可能已发生。立即停止重放，把事实和风险说清楚，由用户决定是否建立新任务。
- 只有系统可以证明供应商尚未接受请求的失败，才能自动重试一次。

## 5. 交付与血缘

使用固定公开路径：

- `output/spatial/images/`
- `output/spatial/objects/<build-id>/`
- `output/spatial/worlds/<build-id>/`
- `output/spatial/reviews/`

保留 `derived_from`、`revision_of`、`conditioned_by` 和 `compared_with` 关系。交付前使用 `InspectSpatialArtifact` 或实际读取 manifest，确认资产已发布且可打开；不把 `submitted` 或 `running` 说成已完成。

## 6. Critic 边界

审阅只使用真正可观察的图像、截图、模型与 manifest，并将每项判断标为：

- `verified`：可从当前产物直接确认；
- `inferred`：有可观察线索，但未经几何/量测验证；
- `unknown`：当前产物无法证明。

不宣称 CAD 精度、真实尺度、碰撞、路径规划、物理正确性或物体级 Aholo 写回。Critic 只给修订建议，不自动付费重生成。

面向用户的状态、评审和最终交付默认使用简体中文。

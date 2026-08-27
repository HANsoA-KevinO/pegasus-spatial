---
name: spatial-creation
description: >
  将自然语言或 Workspace 参考图转化为可反复观察和修改的 Scene、GLB 物体或 Aholo World。用于异步生成、自动 revision、真实视角截图和观察驱动修改；不用于把 3DGS 伪装成可局部编辑网格、真实尺度或物理仿真。
---

# 空间创作协调

用户只需描述想要的产物。根据目标和真实工具能力自主组合调用，不将工具排列成用户必须经过的固定步骤。

## 1. 确定目标

- 独立物体/道具/家具/产品：使用 `CreateObject3D`，首版交付 GLB。
- 房间/建筑内部/环境/可进入场景：使用 `CreateWorld3D`。
- 现实场地捕捉：只在重建工具实际可用且输入素材满足要求时执行。
- World 3DGS 是不可局部语义编辑的整体背景；GLB 是可摆放、选择和变换的物体真值。用 `CreateSpatialScene` 把两者组合为 Scene。
- 物体与世界仍有关键歧义时，用 `AskUserQuestion` 澄清。

## 2. 选择最小足够的工具组合

- 文字已足以表达几何和风格时，可直接调用 3D 生成工具。
- 构图、色彩、空间氛围或修订目标需要视觉锁定时，用 `GenerateImage` 生成或编辑单张参考图，再视需要交给 3D 工具。
- 所有图像输入都必须是当前 Workspace 中可读的文件路径；不传入任意远程 URL。
- 不使用图像工具选择器，不在一次运行中自动切换供应商。

## 3. Scene 创作闭环

- Scene revision 由系统自动创建。不要让用户或 Agent 选择 revision ID；修改前用 `InspectSpatialScene` 获取当前绝对坐标。
- 使用 `AddSceneObject`、`TransformSceneObject` 和 `RemoveSceneObject` 做局部物体编辑；只有整体结构、光照或氛围必须改变时才用 `SetSceneWorld` 或重新生成 World。
- 用 `SetSceneViewpoint`/`FocusSceneObject` 设置独立 Agent 相机，再用 `CaptureSceneView` 获取真实渲染像素。用户相机不能被 Agent 抢走。
- 用户提供 `observation_id` 时将修改绑定到该截图 revision；Scene 已变化就重新观察，绝不静默套用旧意见。
- PLY 只是一次显示一个的高质量视觉替身，不参与选择、碰撞或 Scene 结构判断。

## 4. 付费与委派边界

项目内最多同时运行两个昂贵任务；持久 receipt 与 `unknown` 防重提规则始终有效。是否需要追加视觉候选由 Agent 根据创作目标决定，不因为“候选数量”本身强制询问用户。

以下情况需要 `AskUserQuestion`：

- 要增加用户没有要求的另一种目标产物；
- 供应商可能已接受任务，但系统没有可确定接管的外部任务 ID；

Root 默认拥有空间工具。Member wildcard 不会获得生成、Scene 修改或截图工具；Root 可在 `allowed_tools` 中逐项显式授权，授权后执行能力与 Root 相同。

## 5. 跟踪而不重放

- 提交后记住 `job_id`，用 `GetSpatialJob` 或有界的 `WaitSpatialJob` 读取同一任务。
- 对话结束、页面刷新、等待超时或服务重启都不是付费重试理由。
- `unknown` 表示外部副作可能已发生。立即停止重放，把事实和风险说清楚，由用户决定是否建立新任务。
- 只有系统可以证明供应商尚未接受请求的失败，才能自动重试一次。

## 6. 交付与血缘

使用固定公开路径：

- `output/spatial/images/`
- `output/spatial/objects/<build-id>/`
- `output/spatial/worlds/<build-id>/`
- `output/spatial/reviews/`

保留 `derived_from`、`revision_of`、`conditioned_by` 和 `compared_with` 关系。交付前使用 `InspectSpatialArtifact` 或实际读取 manifest，确认资产已发布且可打开；不把 `submitted` 或 `running` 说成已完成。

## 7. Critic 边界

审阅只使用真正可观察的图像、截图、模型与 manifest，并将每项判断标为：

- `verified`：可从当前产物直接确认；
- `inferred`：有可观察线索，但未经几何/量测验证；
- `unknown`：当前产物无法证明。

不宣称 CAD 精度、真实尺度、碰撞、路径规划或物理正确性；不宣称能局部语义修改 3DGS World。Critic 可以建议或执行已授权的 Scene 物体调整，但要明确 `verified / inferred / unknown`。

面向用户的状态、评审和最终交付默认使用简体中文。

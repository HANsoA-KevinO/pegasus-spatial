---
name: spatial-creation
description: >
  将自然语言或 Workspace 参考图转化为可反复观察和修改的模块化 Scene、Lux GLB 资产或 Aholo World。用于多视角造物、环境模块组装、自动 revision、真实视角截图和观察驱动修改；不用于把 3DGS 伪装成可局部编辑网格、真实尺度或物理仿真。
---

# 空间创作协调

用户只需描述想要的产物。根据目标和真实工具能力自主组合调用，不将工具排列成用户必须经过的固定步骤。

## 1. 确定目标

- 需要摆放和反复编辑的空间，优先拆成 Lux 环境模块与独立物件，使用 `CreateObject3D` 交付 GLB，再组合为 Scene。环境模块可以是一块地台、道路、庭院、建筑外壳或完整景观单元，不限于小型道具。
- 独立物体/道具/家具/产品：使用 `CreateObject3D`；需要单独移动、复用或删除的内容应作为独立 GLB。
- 远景、天空、包围式视觉环境和整体光色氛围：使用 `CreateWorld3D`。为后续 Lux 组装保留干净、平整、开阔的中央区域。
- 现实场地捕捉：只在重建工具实际可用且输入素材满足要求时执行。
- World 3DGS 是不可局部语义编辑的氛围背景；GLB 是建筑、道路、地表模块和物件的可摆放、选择和变换真值。用 `CreateSpatialScene` 把它们组合为 Scene；World 不可用时仍可继续搭建 Lux Scene。
- 物体与世界仍有关键歧义时，用 `AskUserQuestion` 澄清。

## 2. 选择最小足够的工具组合

- 文字已足以表达几何和风格时，可直接调用 3D 生成工具。
- 构图、色彩、空间氛围或修订目标需要视觉锁定时，先用 `GenerateImage` 生成或编辑一张供用户确认的正常透视主视图。World 可使用这张参考图；Lux 资产则根据几何歧义选择单视角或补充一致的侧视、后视。
- 实际调用 `GenerateImage` 前加载 `imagegen` Skill。图片提示词、编辑不变量、画幅选择和真实输出检查由它负责；本 Skill 只决定图片在 World、Lux 与 Scene 创作中的作用。
- `CreateWorld3D` 接收文字描述、一张已授权的 Workspace 参考图，或二者组合；两者不能同时为空。
- `CreateObject3D` 可接收 1–4 张已授权参考图。简单资产可用单图；重要环境模块、背面可见或结构不对称的资产优先使用一致的多视角。多张图必须描述同一设计，并省略 `prompt`。
- 所有图像输入都必须是当前 Workspace 中可读的文件路径；不传入任意远程 URL。
- 不使用图像工具选择器，不在一次运行中自动切换供应商。
- 首次创建 World 或判断其输入、状态与产物时，读取 `/skills/spatial-creation/references/world-generation.md`。
- 规划建筑、道路、场地模块或决定单视角/多视角时，读取 `/skills/spatial-creation/references/lux-scene-building.md`。

## 3. Scene 创作闭环

- Scene revision 由系统自动创建。不要让用户或 Agent 选择 revision ID；修改前用 `InspectSpatialScene` 获取当前绝对坐标。
- 环境模块和独立物件可以共同存在。使用 `AddSceneObject`、`TransformSceneObject` 和 `RemoveSceneObject` 做局部编辑；只有远景、包围环境、整体光色或氛围必须改变时才用 `SetSceneWorld` 或重新生成 World。
- 用 `SetSceneViewpoint`/`FocusSceneObject` 设置独立 Agent 相机，再用 `CaptureSceneView` 获取真实渲染像素。用户相机不能被 Agent 抢走。
- 用户提供 `observation_id` 时将修改绑定到该截图 revision；Scene 已变化就重新观察，绝不静默套用旧意见。
- PLY 只是一次显示一个的高质量视觉替身，不参与选择、碰撞或 Scene 结构判断。
- 坐标基校准属于资产/渲染契约，不属于 Scene 设计变换。GLB 与 PLY 看起来不一致时，不得用 `TransformSceneObject` 补偿格式错误；先按同一相机检查本地姿态。做物体摆放、视觉复核或格式对照前，读取 `/skills/spatial-creation/references/spatial-orientation-review.md`。

## 4. 付费与委派边界

产品不对项目设置固定的图片或 3D 任务数量上限。每个明确的目标都可以建立持久任务；后台 Worker 的可配置并发只控制本机同一时刻的提交、轮询和物化吞吐，不限制持久队列，也不是 Agent 的创作额度。持久 receipt 与 `unknown` 防重提规则始终有效。是否需要追加视觉候选由 Agent 根据创作目标决定，不因为“候选数量”本身强制询问用户。

当目标包含多个相互独立的资产时，Root 应尽早创建多个 Asset Maker 并行工作，而不是等第一个资产完成后再创建第二个；数量按资产拆分和团队可用 Agent 决定，不受固定的两个生成槽约束。每个 Asset Maker 负责一组资产：生成参考图、检查真实图片、调用 `CreateObject3D`，拿到 `job_id` 后立即继续下一项可执行工作。空间任务的终态会自动通知 Root；不要让成员停在轮询等待上。

Scene revision 只允许一个写入责任方。Root 可以自己组装，也可以指定唯一 Scene Assembler；多个资产几乎同时完成时，仍由它按顺序 `InspectSpatialScene` 后再写入，避免并发 revision 冲突。并行发生在图像设计和资产生成，不发生在同一 Scene 的修改提交上。

以下情况需要 `AskUserQuestion`：

- 要增加用户没有要求的另一种目标产物；
- 供应商可能已接受任务，但系统没有可确定接管的外部任务 ID；

Root 默认拥有空间工具。Member wildcard 不会获得生成、Scene 修改或截图工具；Root 可在 `allowed_tools` 中逐项显式授权，授权后执行能力与 Root 相同。Asset Maker 至少显式授权 `Skill`、`Read`、`Glob`、`GenerateImage`、`CreateObject3D`、`GetSpatialJob`、`InspectSpatialArtifact`；Scene Assembler 只获得实际需要的 Scene 查询、修改、相机和截图工具。

## 5. 跟踪而不重放

- `CreateObject3D`/`CreateWorld3D` 的 `prepared` 结果只表示任务已进入本地持久队列，不表示供应商已经接受；记住 `job_id`，然后继续其他独立工作。
- 正常创作中不得在创建后调用 `WaitSpatialJob`，也不要循环调用 `GetSpatialJob`。终态会作为独立的持久后台事件自动通知 Root；它不是原 tool call 的第二个 `tool_result`。
- `GetSpatialJob` 只用于用户主动查询状态、故障诊断或服务恢复核对；`WaitSpatialJob` 只用于用户明确要求短暂等待且当前确实没有其他工作时的诊断场景。
- 收到 `published` 通知后，先用 `InspectSpatialArtifact`/manifest 确认真实资产，再交给唯一 Scene Assembler 放置和复核。收到 `failed` 时说明失败并选择替代方案；收到 `unknown` 时禁止自动重提。
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

单张遮挡视图和包围盒不能证明姿态正确。承重物体至少检查重力方向、支撑点是否向下、主要承载面是否合理；存在歧义时获取正面、侧面或俯视补充截图。无法确认就标记 `unknown`，不得仅凭单张轮廓猜定扶手、椅脚、座面等语义部件后宣布 `verified`。

面向用户的状态、评审和最终交付默认使用简体中文。

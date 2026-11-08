---
name: spatial-creation
description: >
  将自然语言、老照片与口述记忆转化为可观察和修改的模块化 Scene。用于场景概念设计、单件参考图、Lux GLB 生成、Three.js 场景组装与补细节、工程视图和几何约束检查、自动 revision、真实网格地表查询、真实视角截图和观察驱动修改；Aholo World 3DGS 仅作为可选的定点体积背景，不用于可行走地面、局部编辑网格、真实尺度或物理仿真。
---

# 空间创作协调

用户只需描述想要的产物。根据目标和真实工具能力自主组合调用，不将工具排列成用户必须经过的固定步骤。

## 1. 确定目标

- 只有早期点子或含糊体验目标时，先共同设计。用 `AskUserQuestion` 询问少量真正会改变设计方向的问题，给出推荐默认值。结合答案用 `GenerateImage` 制作完整空间概念美术图并展示。用户明确确认后进入 3D 制作。用户沉默、Agent 自己写出的方案或工具成功都不算确认。确认前不创建 3D 生产成员，不调用 `CreateObject3D`/`CreateWorld3D`，不开始正式组装。
- 用户明确要求按具体需求制作或提供已确认的设计时，直接推进。用户明确要求跳过概念阶段、只制作某个物体，或局部修改已有 Scene 时，从对应的资产或源码开始，不重走整套流程。单独物体的文字需求足以描述几何和风格时，可以直接调用 `CreateObject3D`。物体与世界仍有关键歧义时，用 `AskUserQuestion` 澄清。
- 用户明确要求纯代码、使用已有素材或限制外部生成时，按其范围制作。场景以多文件 Three.js 源码为真值，允许自由使用任意原生几何、CSG、材质、程序纹理、GLSL、动画与 GLB。

## 2. 从照片与口述到可进入的场景

1. **理解证据。** 阅读原照片和口述。分开记录照片可见事实、口述提供的细节和推测补全。先提取入口、相邻区域、可通行关系、体量、关键材质与有记忆意义的物件。多图用重复出现的门窗、栏杆、招牌、树或转角归并机位，记录照片编号与相对高差。有多个区域时先画相对布局底图，标出已对齐的局部和推测的连接。未知的背面和尺寸保留为推测。合成图不会把推测变成史实。
2. **建立共同视觉基准。** 调用 `GenerateImage` 前加载 `imagegen` Skill。用最能约束当前目标的一张原照或布局底图作 `input_image_path`，在提示词中补充其余照片和口述里的要点。先生成整体概念图，再以选定概念为锚点，补能说明布局的机位，如俯视核对占地和动线，斜俯视核对坡地与台地，人眼视角核对通行和门槛。每张图解决一个具体问题，保持建筑位置、开口、比例和风格。若生成图改动地标、桥口或主要高差，记录偏差并回到原照与底图核对。已有足够的概念图就复用。
3. **从概念图拆资产。** 列出关键建筑、场地模块和有辨识度的物件，写清它们的相对位置、入口、主要观察方向、需要独立移动的部分和必保特征。起伏地形先划出可通行面、台地、挡墙、沟床和坡脚。需要拼成连续地基时，先用母图生成整段网格，再按场地段切分，保留共用坐标和接缝。优先复用合适的 GLB。缺少的关键视觉资产按第 3 节分别制作参考图并提交生成。重复物件共享模型。独立资产可以并行，地面、通道等必要结构可以先做轻量布局。
4. **用真实资产组装。** 读取已发布的 GLB 与 manifest，将 GLB 加入 `assets.json`，用 `ctx.assets.loadGLB` 导入、登记稳定 key 并摆放。Three.js 源码主要负责组合、光照、机位和可控的细节补充，例如贯通门洞、连接地面、窄台阶、檐线、边框或少量程序纹理。关键建筑与道具优先由生成或现有资产承担。按用户的视觉和交互目标决定哪些结构适合直接建。
5. **观察和修正。** 用俯视和主要行走视角对照概念，检查真实 GLB 的朝向、开口、落地、入口与间距。摆放问题先改源码。若关键问题来自资产本身，再依据可见缺陷修订该件参考图或重建该件。在已有足够设计信息时先产出下一项可观察结果，细节留给看到真实产物后的迭代。

需要混合搭建、补植被或修复桥头等接缝时，读取 `/skills/spatial-creation/references/hybrid-scene-assembly.md`。建筑、乔木、桥体和有辨识度的地形优先用合适的 GLB。规则小件、精确开口和接口可用 Three.js。成片蕨丛、灌木和垂藤可用透明植物图集配合实例薄片，远山林线交给全景。按观察距离、轮廓、承载和可编辑性取舍。同一资产可保留生成主体，再局部修几何。截图反馈优先复现相近机位，并同时核对视觉和真实几何。

## 3. 场景图、单件参考图与生成

- `concept_art` 确定整体视觉与相对布局。`scene_environment_panorama` 只服务于远景。`lux_asset_reference` 每张只表现一个可编辑资产。三类图片不得由同一个文件兼任。用概念图作为单件参考图的设计锚点，裁去或移除邻接物、背景和遮挡，保持主体完整。
- 每件生成资产先准备一张完整、无遮挡、背景干净的 canonical 主视图。若入口深度、支撑、侧面或后侧轮廓会影响游览，从同一主图派生需要的补充视角，保持材质、开口、部件数量和比例一致。清楚的主视图足够时可直接提交。检查实际图片，再把单件图按主图在先的顺序作为 `reference_image_paths` 传入 `CreateObject3D`，每件 1–4 张，不能把整场图或拼图当成单件视角。读取 `/skills/spatial-creation/references/lux-scene-building.md`。
- 有可见天空或远景的新建室外场景，在概念确定后默认单独生成一张 2:1 等距柱状 `scene_environment_panorama`，保持水平 360°、垂直 180°、中线地平线与左右接缝连续，近中景低信息。与独立的单件资产并行准备。已有合适全景时复用，全封闭室内或局部修改按需处理，遵守用户的生成范围。加入 assets.json 后用 ctx.assets.loadTexture 加载并设置 scene.background。普通单向概念图通常不适合作为 360° 环境。观察接缝、天顶/地底和近景主体后按需定向修订。结果可用但不完美时可以继续推进，并记录不确定性，不阻塞独立 Lux 生产。
- `CreateWorld3D` 可接收文字或单张参考图，用于可选的固定观察点体积背景，不承担可行走地面或真实尺度。需要全景或试验 World 时读取 `/skills/spatial-creation/references/world-generation.md`。现实场地捕捉只在重建工具实际可用且输入满足要求时执行。
- 所有图像输入必须是当前 Workspace 中可读的授权文件路径，不传任意远程 URL。不使用图像工具选择器，不在一次运行中自动切换供应商。

## 4. Scene 创作闭环

开始组装或修改场景前读取 `/skills/spatial-creation/references/scene-code.md` 的源码协议、资产清单、辅助函数与示例。

先实现用户想要的空间体验和视觉表达，再按实际问题选择观察与验证工具。下列步骤提供可用闭环，不要求逐对象、逐视图机械执行。只有用户明确要求成立的空间条件进入 required；自行增加的探索性诊断设为 required:false，保留 unknown 及其原因。纯视觉创作没有空间验收要求时，不额外制造硬性几何门槛。几何检查通过不代表外观丰富、构图成立或记忆细节可信；要看实际图像。已经获得足够证据后交付，不为走完工具清单反复构建。

1. `CreateSpatialScene` 建立 Scene 并返回已准备好的源码工程；可立即 Write/Edit。`PrepareSceneCode` 用于幂等补齐模板或从已发布代码构建恢复缺失源码，不转换旧场景。`Write`/`Edit` 修改入口、多文件模块和参数。
2. `RunSceneCode` 冻结源码、依赖、资产字节和种子，编译并在隔离 Chromium Worker 执行。15 秒后仍运行会返回 build ID，等待持久终态事件，不循环轮询。收到事件后 `InspectSceneBuild` 读取实际图像和结果。
3. 默认俯视、正面、侧面与入口/整体透视四视图。需要入口人眼尺度、远景轮廓、局部细节、灰模、线框、隔离或截面时用 `RenderSceneViews`；宿主按 key 自动聚焦。图中编号映射稳定 key；隔离视图只能作为局部证据。动画按固定时间复核，不用墙钟时间或 Math.random。
4. `InspectSceneBuild` 的名称、用途、层级属于作者登记，只能定位对象。以 `QuerySceneGeometry` 与 `CheckSceneConstraints` 的实际测量验证入口障碍、落地、指定间距、朝向和通道净空。分别记录**作者登记、运行时测量、视觉判断、无法验证**。不能用语义名称或包围盒让错误几何通过。
5. 约束明确对象、方向基准、预留区域、范围与容差。网格表面距离不等于中心距离；AABB 重叠只做候选筛选，不是实体穿插。底部支撑采样不是完整物理验证。GPU 顶点位移需要 query_geometry，否则相关测量 unknown；不得把 unknown 升级为通过。
6. 调整布局写回源码；可使用 geometry.placeOn / alignAgainstWall / faceTowards / distribute 根据几何计算变换，随后复核。布局错误优先改参数，不重新付费生成资产掩盖。
7. `PublishSceneBuild` 原子发布已检查的不可变构建，保留的全部 required 检查必须 satisfied，expected_scene_version 等于构建基础版本。删检查、改成可选或放宽要求不能绕过验收。unknown 要补查询几何或证据，不增添底板等非设计内容迎合验证器。新用户要求改变验收目标时才使用 acceptance_update。并发 scene_changed 或 acceptance_changed 后重新构建验证。检查之后的源码修改必须产生新构建；不能附加临时变换。
8. 用户只浏览、选中、聚焦、历史查看和提交截图意见。反馈携带 key、实际用户相机、revision、build 和时间；Agent 据此修改源码。用户相机与 Agent 相机独立。代码场景默认通过无头服务观察，用户不打开舞台也能工作。
9. 全部场景修改写入源码或参数文件。旧声明式数据不自动迁移、不作为当前创作入口；已有资产可由 Agent 主动加入清单。恢复已发布代码历史创建新 revision。
   `CaptureSceneView` 与 `QuerySceneSurface` 对代码构建执行无头观察，不要求用户打开舞台。
10. `ExportSceneBuild` 完整项目包保留源码、资产、Shader、动画和入口；GLB 只输出指定时刻的标准材质静态快照，不支持的内容必须明确报告。

生成 GLB 后先检查真实 manifest、朝上方向、支撑面、完整性和明显失真。单张遮挡图或包围盒不足以确认语义姿态；有歧义补正面、侧面、俯视或同相机格式对照。读取 `/skills/spatial-creation/references/spatial-orientation-review.md`。本地坐标基错误由加载契约校正，不靠 Scene 设计旋转掩盖。

## 5. 付费与委派边界

产品不对项目设置固定的图片或 3D 任务数量上限。每个明确的目标都可以建立持久任务；后台 Worker 的可配置并发只控制本机同一时刻的提交、轮询和物化吞吐，不限制持久队列，也不是 Agent 的创作额度。持久 receipt 与 `unknown` 防重提规则始终有效。是否需要追加视觉候选由 Agent 根据创作目标决定，不因为“候选数量”本身强制询问用户。

进入制作且视觉基准明确后，多个相互独立的资产可交给多个 Asset Maker 并行处理；是否委派取决于资产依赖、工作量与团队可用 Agent。每个 Asset Maker 负责一组资产：生成参考图、检查真实图片、调用 `CreateObject3D`，拿到 `job_id` 后立即继续下一项可执行工作。空间任务的终态会自动通知 Root；不要让成员停在轮询等待上。

Scene revision 只允许一个写入责任方。Root 可以自己组装，也可以指定唯一 Scene Assembler；多个资产几乎同时完成时，仍由它按顺序 `InspectSpatialScene` 后再写入，避免并发 revision 冲突。并行发生在图像设计和资产生成，不发生在同一 Scene 的修改提交上。

以下情况需要 `AskUserQuestion`：

- 要增加用户没有要求的另一种目标产物；
- 供应商可能已接受任务，但系统没有可确定接管的外部任务 ID；

Root 默认拥有空间工具。Member wildcard 不会获得生成、Scene 修改或截图工具；Root 可在 `allowed_tools` 中逐项显式授权，授权后执行能力与 Root 相同。Asset Maker 至少显式授权 `Skill`、`Read`、`Glob`、`GenerateImage`、`CreateObject3D`、`GetSpatialJob`、`InspectSpatialArtifact`；Scene Assembler 只获得实际需要的 Scene 查询、修改、相机和截图工具。

## 6. 跟踪而不重放

- `CreateObject3D`/`CreateWorld3D` 的 `prepared` 结果只表示任务已进入本地持久队列，不表示供应商已经接受；记住 `job_id`，然后继续其他独立工作。
- 正常创作中不得在创建后调用 `WaitSpatialJob`，也不要循环调用 `GetSpatialJob`。终态会作为独立的持久后台事件自动通知 Root；它不是原 tool call 的第二个 `tool_result`。
- `GetSpatialJob` 只查询 Lux3D/Aholo 的 Object/World Job，用于用户主动查询状态、故障诊断或服务恢复核对；不得把 `GenerateImage` 返回的 `spimg_*` receipt ID 传给它。图片状态以 `GenerateImage` 自己的 ToolResult 为准。`WaitSpatialJob` 只用于用户明确要求短暂等待且当前确实没有其他工作时的诊断场景。
- 收到 `published` 通知后，先用 `InspectSpatialArtifact`/manifest 确认真实资产，再交给唯一 Scene Assembler 放置和复核。收到 `failed` 时说明失败并选择替代方案；收到 `unknown` 时禁止自动重提。
- `AskUserQuestion` 会形成必须等待回答的交互屏障。Root 处于 `waiting_user` 时，后续 3D 终态事件会持久排队，不会越过问题强行启动新一轮；用户回答后它们会在下一个安全边界被消费。这不是通知丢失。批量资产正在生产时，不要为可安全默认的细节发起问题；但 `unknown` 后重提这类可能重复付费的动作仍必须由用户确认。
- 对话结束、页面刷新、等待超时或服务重启都不是付费重试理由。
- `unknown` 表示外部副作可能已发生。立即停止重放，把事实和风险说清楚，由用户决定是否建立新任务。
- 只有系统可以证明供应商尚未接受请求的失败，才能自动重试一次。

## 7. 交付与血缘

使用固定公开路径：

- `output/spatial/images/`
- `output/spatial/objects/<build-id>/`
- `output/spatial/worlds/<build-id>/`
- `output/spatial/scenes/<scene-id>/`（源码、资产清单与检查）
- `output/spatial/builds/<build-id>/`（不可变构建的观察与导出）
- `output/spatial/reviews/`

保留 `derived_from`、`revision_of`、`conditioned_by` 和 `compared_with` 关系。交付前使用 `InspectSpatialArtifact` 或实际读取 manifest，确认资产已发布且可打开；不把 `submitted` 或 `running` 说成已完成。

场景制作或修订的交付包括当前真实 Workspace 内的资产、源码和已发布 Scene revision。确认选用资产实际出现在运行场景，提供舞台入口与该版本的视图或测量。概念图、单件和候选预览分别保留作证据。

## 8. Critic 边界

审阅只使用真正可观察的图像、截图、模型与 manifest，并将每项判断标为：

- `verified`：可从当前产物直接确认；
- `inferred`：有可观察线索，但未经几何/量测验证；
- `unknown`：当前产物无法证明。

不宣称 CAD 精度、真实尺度、碰撞、路径规划或物理正确性；不宣称能局部语义修改 3DGS World。Critic 可以建议或执行已授权的 Scene 物体调整，但要明确 `verified / inferred / unknown`。

单张遮挡视图和包围盒不能证明姿态正确。承重物体至少检查重力方向、支撑点是否向下、主要承载面是否合理；存在歧义时获取正面、侧面或俯视补充截图。无法确认就标记 `unknown`，不得仅凭单张轮廓猜定扶手、椅脚、座面等语义部件后宣布 `verified`。

面向用户的状态、评审和最终交付默认使用简体中文。

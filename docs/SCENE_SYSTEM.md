# Three.js 源码场景与空间验证

## 工作方式

Three.js 源码是场景真值；不可变构建、工程视图和实际网格测量构成反馈。Agent 根据目标编辑源码，执行候选构建，查看图像与测量，修改后原子发布。用户只浏览、聚焦、选中、查看历史并发送截图意见，场景修改由 Agent 完成。

代码和生成内容可以自由混用，不按大小或复杂度划分。原生几何、CSG、曲线、实例阵列、程序纹理、Shader、动画及授权 GLB 均可使用；PLY/SPZ 保留视觉内容。坐标为 Z-up、相对单位，未经尺度标定不能把数值称为米或声明测绘、CAD 或物理精度。

## 源码工程

默认路径：`output/spatial/scenes/<scene-id>/`，包含入口 `main.ts`、`assets.json`、可选 `checks.json` 与其他 JS/TS、JSON 或 GLSL 文件。

```ts
export async function createScene(ctx) {
  const T = ctx.THREE
  const scene = new T.Scene()
  scene.add(new T.HemisphereLight(0xffffff, 0x777777, 2))
  const mesh = new T.Mesh(new T.TorusKnotGeometry(), new T.MeshStandardMaterial())
  scene.add(ctx.registerObject('ornament', mesh, { label: '装饰', semantic_type: 'ornament' }))
  return { scene } // 可选 cameras、update(t, dt)、dispose()
}
```

`ctx` 提供 THREE、宿主 renderer、受控资产加载、对象登记、带种子 random、createCanvas 和几何辅助函数。登记返回原对象，不自动加入场景或建立编辑覆盖层。稳定 key 关联源码、图片编号、用户选中和几何查询；登记的名称、用途和预期关系是作者声明，不能证明空间正确。

固定依赖为 Three.js 0.183.2、Spark 2.4.0、three-bvh-csg 0.0.18、three-mesh-bvh 0.9.18。允许固定 addons 和工程内静态相对导入，没有 Node、任意网络、动态安装或独立渲染循环。动画固定按 1/30 秒推进；倒退时间从同一种子重建，指定时间截图可复现。场景源码管理灯光、雾、背景和环境，宿主管理相机、画布、渲染循环及 ACES/sRGB 颜色管线。

资产清单仅引用当前 Workspace 授权路径。编译冻结源码、依赖版本、种子、资产字节及 SHA-256，产生带 source map 的 bundle。GLB 加载助手处理已有坐标基或默认 Y→Z、底部中心和实例复用；材质默认共享，单实例修改需 clone。GLB 默认整体登记，不自动识别内部语义。资产报告区分 `loaded` 与 `instances_in_scene`，已读取但未加入场景的模型不能算使用成功。

## 执行与构建状态

浏览器舞台使用隔离 iframe 内的 Worker + OffscreenCanvas。无头服务使用独立 Chromium 上下文执行同一冻结 bundle；不传应用 Cookie、数据库或供应商密钥，网络由浏览器策略阻断。部署服务使用非 root Chromium sandbox、内部网络和资源限制。

构建记录与付费生成任务分开持久化，状态为 queued、compiling、running、checking、ready、failed 或 cancelled。默认一个构建槽，总时限 120 秒，具备租约、幂等、取消和重启恢复。工具在 15 秒内完成则直接返回，否则返回 build ID，由持久终态通知恢复 Agent。死循环或错误构建不覆盖已发布场景。

## Agent 工具

| 工具 | 主要输入 | 输出与使用目的 |
|---|---|---|
| CreateSpatialScene / PrepareSceneCode | 标题 / scene_id | 创建即准备代码工程；Prepare 幂等补齐或恢复源码，不自动转换旧 Scene |
| Write / Edit | 路径与修改 | 修改自由 Three.js 源码或参数文件 |
| RunSceneCode | Scene、入口、资产、种子、检查 | 不可变 build ID、状态、错误位置、四视图拼图、条件摘要 |
| InspectSceneBuild | build ID、object_keys、offset/limit、technical | 分页对象索引、源码关联、实际尺寸/变换、材质与资产使用；默认 10 条 |
| RenderSceneViews | build 或冻结 revision、对象、视图、模式、时间 | 标注 PNG、实际相机、时间与版本；单个视图错误不丢失其他成功图片 |
| QuerySceneGeometry | 同一目标引用、批量查询 | 射线命中、最近表面距离、范围、截面、支撑及查询方法 |
| CheckSceneConstraints | 同一目标引用、明确条件 | satisfied / violated / unknown、实际值、要求、方法、对象和证据图 |
| PublishSceneBuild | build ID、基础 Scene 版本、摘要 | 校验完整必需条件与版本后原子产生 revision |
| ExportSceneBuild | build、格式、时间 | 完整项目 ZIP 或标准材质静态 GLB；不可表达内容明确返回 unsupported |

观察携带 build、revision、时间和对象 key。已发布 Scene 的请求先解析并冻结具体 revision，不会用后来变化的内容回答旧请求。上下文裁剪保留 build 回执与确切图片路径；图片未交付模型时明确 `visual_evidence_delivered:false`。Agent 直接读取这些路径补视觉证据，无须反复 Glob 或重建。

## 工程视图与几何证据

默认四视图为俯视、正面、侧面和入口（没有入口相机时为整体透视），包含坐标轴、比例和对象编号。支持正交视图、灰模、线框、指定对象隔离、指定平面截面与局部高分辨率。隔离图明确标记为局部证据。动画默认额外提供第二时间点。自动聚焦按对象范围计算相机；可用相机名随回执返回，缺失相机属于观察请求错误，无须重新建模。

| 问题 | 实现与证据边界 |
|---|---|
| 位置、范围 | 执行后世界变换与包围范围；范围不能证明实体占据或语义姿态 |
| 表面距离 | 烘焙实例、蒙皮和 morph 后的三角网格，求最近表面点 |
| 相交 / 通道净空 | 实际查询网格范围分离可证明不相交；范围重叠继续做三角面求交及闭合分量包含判断；开放表面的包含不可验证时返回 unknown |
| 支撑 | 最低表面带的实际顶点与 5×5 列采样；返回支持比例、缺失目标、间隙和覆盖范围；默认全部采样点满足容差，并拒绝穿入表面 |
| 朝向 | 作者明确提供局部 forward 或锚点，再计算世界方向差；不从名字猜 GLB 正面 |
| 截面 | 指定平面与实际三角面的截线；图像截面由材质裁剪产生 |
| GPU 位移 / splat | 没有额外 CPU query_geometry 则相关测量无法验证；诊断图不替代实际 Shader 外观 |

辅助函数 placeOn、alignAgainstWall、faceTowards、distribute 根据几何计算变换，随后仍需检查。首版没有通用布局求解器。包围盒重叠不直接报告穿插，支撑采样不宣称所有脚、重心或物理稳定性。通道检查只覆盖明确指定的区域和参与对象，不能由几个物体通过推断全场景畅通。

## 验收与发布

RunSceneCode 默认读取根目录 checks.json。首次声明的 required 条件保存在 Scene 验收契约中，后续构建不能通过删文件、删条件、改成可选、换对象或放宽容差绕过验收。发布检查条件定义、结果完整性、契约版本和基础 revision；条件变化使旧构建失效。新用户确实改变目标时，Root 可在新的已认证用户触发运行中，以当前验收版本和变更原因替换要求；同次建模或后台恢复不能重置。

该机制保护已经声明的条件，不声称自动证明自然语言需求已被完整翻译。真实产品验收仍需独立需求断言和图像审阅。执行失败与正常执行但条件违反分开；unknown 保留原因，不删条件来宣布通过，也不增加非设计底板或隐藏支撑迎合验证器。

发布的 revision 只引用已检查的不可变 build。检查后继续编辑源码必须新建构建，发布不接受额外临时变换。并发修改返回 scene_changed 或 acceptance_changed，重新观察、构建并验证。新程序先初始化再替换舞台旧程序；失败时保留旧版本并显示实际 revision。历史恢复产生新 revision，不改写旧历史。

## 用户反馈与源码工程

用户相机和 Agent 观察相机独立。截图反馈发送实际相机、选中 key、revision、build 和时间；截图期间版本变化则拒绝提交。代码场景观察默认由无头服务执行，用户不打开舞台也能工作。

新系统以源码工程为唯一创作入口。CreateSpatialScene 同时准备入口、资产清单和检查文件，PrepareSceneCode 仅幂等补齐模板或恢复缺失源码。旧声明式编辑工具已从 Agent 工具列表移除，历史调用也只返回源码编辑指引。旧场景不自动转换，已有数据库和资产文件不删除；需要复用的资产由 Agent 主动加入 assets.json。历史恢复仅支持已发布代码构建。旧数据的只读展示代码暂存，不作为兼容承诺或交付验收要求。

完整项目 ZIP 包含源码、授权资产、Shader、依赖版本、种子、source map 和独立 Worker 运行入口，保留动画。GLB 仅为指定时刻的标准材质静态交换快照；自定义 Shader、GPU 位移和 splat 等不能表达的内容明确报告，不能静默丢失。

## 验证入口

- `npm run scene-code:verify:feedback`：薄腿、悬空、穿地、部分支撑、分离开放网格、范围重叠、unknown、条件保留和回执裁剪。
- `npm run scene-code:verify`：真实 Chromium 中的门洞、曲面、实例、几何查询与工程图。
- `npm run scene-code:verify:advanced`：已有纹理 GLB、程序纹理、Shader、动画、PLY/SPZ、导出、错误、取消、死循环与超时恢复。
- `npm run scene-code:verify:mongo`：仅在隔离测试库运行，验证持久构建、幂等、source map、原子发布、历史、租约恢复与验收契约。
- `npm run spatial:verify:three-browser`：真实浏览器验证原生与代码舞台、像素、导航、选中、反馈、隔离、候选失败回退和版本替换，不调用模型或付费供应商。
- `scripts/accept-scene-code-agent.ts`：显式授权的真实多模态 Agent 产品验收，用户舞台关闭，无付费资产生成；独立核对小院、选中对象修改、室内的支撑、间距、净空范围和门洞射线，保留调用、耗时、修订和产物。工具回归通过不等于 Agent 验收通过。

## 本轮真实验收与创作边界

### 交付状态

核心首版已经实现并完成局部真实验收，尚不等于原计划逐项完成部署交付：

- 已贯通源码建模、冻结构建、无头观察、几何检查、原子发布、只读舞台、选中反馈、历史及导出；合成小院、局部修改与室内已由真实 Agent 执行。
- 用户已取消旧场景兼容要求：删除自动转换，不再开发旧 GLB/PLY 视觉替身的全局切换。独立 GLB、PLY/SPZ 作为新工程资产的加载与渲染继续保留。
- 部署配置及本机 Chromium、Mongo 集成已检查；尚未完成 app + Mongo + renderer 整套容器启动、真实进程重启和持久通知自动恢复 Agent 的完整演练。
- 200 轮上限与新创作指导已通过确定性检查，尚未重新做复杂长任务或创作质量验收。既有 24/6/21 轮结果保留原配置边界。
- 自定义后处理管线属于新讨论的表达扩展，尚未实现；不将它计作原计划已具备的能力。

2026-11-06 使用网关 `Claude-opus` 完成小院、选中长凳移动改色、独立室内任务；网关没有提供具体版本信息，不将其称为已验证的 Opus 5.5。三个任务分别使用 24、6、21 次主模型响应，共 8 次候选构建、62 次工具执行，整轮约 23 分 35 秒，无付费图片或 3D 资产生成。小院第 22 轮已发布，随后补充观察并在测试脚本原定 24 轮处截断，没有最终文本；因此不能把触及上限直接视为无效循环。产品原上限为 50，现主 Agent、成员与验收脚本默认均为 200，可配置，详见部署说明。

测试确认：实际表面间距、落地采样、门洞射线、通道范围、现有纹理 GLB 的使用和选中修改后的其他对象保留。模型根据图片发现乐器被栏杆遮挡并修改栏杆，说明视觉反馈参与了设计判断。它也因旧检查器的组合网格拓扑判断而改造门墙，说明工具反馈可能给创作施加不必要压力。

该测试使用冻结的 three-code-v2 宿主。其后发现并修复了闭合部件重叠的奇偶判定抵消，以及不同 Mesh 接触顶点被焊接后错误判为开放的问题；运行时升为 three-code-v3。零模型重放保持每个源码字节、资产字节、种子、依赖和检查定义不变，三个产物的保留检查（13 / 13 / 20）及额外独立检查（10 / 10 / 13）全部满足，并导出完整 ZIP 与静态 GLB。室内的组合哈希因保留条件排序变化而不同，检查定义相同；复验记录分别保留新旧 build 和运行时，不将重放冒充一次新的 Agent 成功。

以上是工程闭环与局部视觉修订证据，不能证明复杂场景的审美上限、老照片还原准确性或框架相对原生模型的净收益。下一类验收应提出真实的视觉创作目标，分别审阅几何正确性、细节、构图、材质、光照和叙事表达。

源码没有三种基本形状的限制，但仍有表达边界：当前协议只有 scene、cameras、update、dispose，最终由宿主直接 render，尚无正式的自定义后处理管线接入点；DOM 依赖、任意网络和运行时依赖安装也不可用。后处理需要明确的扩展协议。空间 skill 以用户目标选择观察：只有明确的空间要求进入 required，探索性诊断为可选；没有空间要求的视觉创作无需人为增加硬门槛。查询不支持的几何可补 query_geometry 并明确未知，不能要求把视觉模型降级为简单体块。

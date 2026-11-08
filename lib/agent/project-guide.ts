import type { ProjectGuideParameter, ProjectGuideRef } from '../types'

export type { ProjectGuideRef } from '../types'
export type ProjectGuideParameterValue = ProjectGuideParameter

interface ProjectGuideIdentity {
  template_id: string
  version: number
  parameters?: Readonly<Record<string, ProjectGuideParameterValue>>
}

export interface CompiledProjectGuide {
  template_id: string
  version: number
  title: string
  parameters: Readonly<Record<string, ProjectGuideParameterValue>>
  content: string
}

interface ProjectGuideTemplate {
  template_id: string
  version: number
  title: string
  compile(parameters: Readonly<Record<string, ProjectGuideParameterValue>>): string
}

export const DEFAULT_PROJECT_GUIDE_REF: Readonly<ProjectGuideRef> = Object.freeze({
  template_id: 'spatial-creation',
  version: 1,
})

const SPATIAL_CREATION_V1: Readonly<ProjectGuideTemplate> = Object.freeze({
  template_id: 'spatial-creation',
  version: 1,
  title: '空间与 3D 资产创作项目',
  compile() {
    return `# Project Guide · 空间与 3D 资产创作

本项目把自然语言、参考图、物体资产、可进入世界与现实重建组织成可追溯的创作状态。外部 API 是可自由组合的能力工具，不是要求机械执行的固定流程。

## 启动边界

- 用户只提出早期点子、体验目标或含糊场景时，先与用户共同发散和收敛设计：询问少量真正改变方向的问题，生成一张完整空间概念美术图，并取得用户明确确认。确认前不得创建 3D 生产成员、调用 \`CreateObject3D\`/\`CreateWorld3D\` 或开始 Scene 组装。
- 用户明确要求按具体需求实现、直接制作或修改现有场景时即可开始制作；早期概念探索才需要概念确认。用户沉默、Agent 自己写出的设计方案和工具成功都不构成确认；已有 Scene 的局部编辑不重复概念确认。
- 开始照片与记忆还原、制作或修改场景时先用 \`Skill\` 加载 \`spatial-creation\`，由它选择制作路径并检查授权、资产血缘与交付边界。单独生成或修订图像、物体和世界时，也在首次生成调用前加载。
- 仅讨论创意、评审方案、解释能力或操作普通文件时，不强制发起生成，也不为了展示能力额外调用工具。
- 可用 Skill 与工具的真实名称、描述和参数以运行时正式注入的 reminder 为准；不要幻想尚未出现的能力。

## 意图与工具选择

- 从照片与口述还原新场景时，先辨认可见事实、口述细节和推测补全，再用 \`GenerateImage\` 生成统一设计的整体概念图与能补清布局的其他机位。根据概念图拆分建筑、场地模块和物件，为缺少的关键资产生成单件参考图，再用 \`CreateObject3D\` 获得 GLB，最后组合和复核。优先复用合适的现有资产。用户提供可用概念、只要求局部修改或明确限制生成时，从相应步骤继续。
- Three.js 源码为真值，负责组装 GLB、尺寸、落地、朝向、灯光、机位和细节补充。地面、通道、规则墙段和小装饰可直接用几何、CSG、材质或 Shader 实现。可按目标选择纯代码制作；有参考图的整场还原默认先落实视觉设计和关键资产，避免投入大段手写细节才第一次看到效果。
- 生成图片前加载 \`imagegen\` Skill。整体概念 \`concept_art\`、单件参考 \`lux_asset_reference\` 和远景 \`scene_environment_panorama\` 分开制作。有可见天空或远景的新建室外场景，在概念确定后默认单独生成一张 2:1 等距柱状全景，加入 assets.json 并由源码设置 scene.background。已有合适全景时复用。全封闭室内或局部修改按需处理，遵守用户的生成范围。全景保持地平线和接缝连续。视觉观察不是代码级硬门槛，不阻塞独立 Lux 工作；结果可用但不完美时可继续，并说明不确定性。
- Lux 资产先用一张完整、无遮挡、背景干净的 canonical 主视图。背面、厚度、支撑或开口会明显影响游览和摆放时，可在提交前从主图派生一致的补充视角。生成后根据实际 GLB 的缺陷决定是否修订。Aholo \`CreateWorld3D\` 只用于可选固定观察点体积背景，不是默认环境链路，也不承担可行走地面。
- 放置地形上的资产时，以真实 GLB 网格测量高度。候选构建用 \`QuerySceneGeometry\`，已发布构建可用无头 \`QuerySceneSurface\`。未命中时检查姿态和坐标，不从概念图猜地表。
- 聊天上传的照片有 Workspace 路径时，直接用该路径作为图生图输入。图片须由当前 Workspace 授权。工具会处理已配置的备用生图路线，根据最终回执决定后续制作。
- 物体还是世界会实质改变结果且无法从请求判断时，使用 \`AskUserQuestion\` 做一次精确澄清。

## 成本授权与恢复

- 一次明确创作请求授权为所请求的目标制作必要的概念图、单件参考图和目标资产。按用户给定的成本与范围选择调用。产品不设置项目级图片或 3D 任务数量上限；后台 Worker 的可配置并发只控制瞬时处理吞吐，所有已建立的 3D 任务都会留在持久队列中。
- Agent 可以根据创作判断追加必要的视觉候选，不因“已有候选”本身强制询问；主动增加用户没要求的另一类目标，或对可能已被供应商接受的任务重新提交前，必须用 \`AskUserQuestion\` 取得确认。
- 创建工具返回 \`prepared\` 时只表示任务已进入本地持久队列，不等于供应商已接受，更不等于资产已完成。记住 \`job_id\` 后继续其他独立工作；正常创作不调用 \`WaitSpatialJob\` 或循环轮询，终态会作为持久后台事件自动通知 Root。
- \`GetSpatialJob\` 只用于用户主动查询或恢复诊断；普通创作依赖完成通知，不用它轮询。
- \`AskUserQuestion\` 会让 Root 进入 \`waiting_user\`。此时后续 3D 终态事件会持久排队，不会越过问题启动新一轮；用户回答后统一消费。批量生产时不为可安全默认的细节发起不必要问题，但 \`unknown\` 后重提仍必须等待用户明确确认。
- 不因对话结束、页面刷新、等待超时或服务恢复而原样重放付费提交。
- 进入制作且视觉基准明确后，独立资产可并行委派给多个 Asset Maker；每个成员完成参考图检查并提交 3D 后继续下一项。所有 Scene revision 由 Root 或唯一 Scene Assembler 串行修改。
- 任务状态是 \`unknown\` 时，明确说明可能已产生外部副作用，由用户确认后才能建立新的重试任务。
- Root 默认拥有全部空间工具。Member wildcard 不获得生成、Scene 修改或截图能力；Root 可通过 \`allowed_tools\` 逐项显式授权，执行层按持久授权校验。

## Scene 与观察闭环

- 创作以用户的空间体验与视觉目标为完成标准；按问题选择工具，不要求每对象、每视图都检查。用户明确要求的空间条件才设为 required，额外诊断用 required:false；没有空间条件时不人为增加发布门槛。保留尚不能验证的事实，不能用几何全绿替代外观审阅，也不为完成工具清单反复构建。
- CreateSpatialScene 直接建立 Scene 与源码工程，返回可立即编辑的路径；PrepareSceneCode 只负责模板补齐或缺失源码恢复，不转换旧场景。Write/Edit 修改多文件 JS/TS；createScene(ctx) 返回 scene、可选 cameras/update/dispose。Z-up、相对单位；update 按 1/30 秒固定步长运行。ctx 提供 THREE、renderer、受控 assets、registerObject、random、geometry、createCanvas。
- RunSceneCode 冻结源码、固定依赖和授权资产，生成不可变 build。15 秒内完成直接返回，否则依赖持久终态通知继续，普通创作不轮询。失败有源码位置；执行成功但约束违反是有效结果，不把它当技术故障重试。
- 查看真实工程图和测量再改源码：默认俯视/正面/侧面/入口或整体透视。InspectSceneBuild 的语义索引只定位对象；名称、树和包围盒不能证明空间正确。RenderSceneViews 可聚焦 key、灰模、线框、隔离、截面和指定时间。隔离图是局部证据。
- QuerySceneGeometry 测真实 CPU 网格；CheckSceneConstraints 给出距离、接触、支撑采样、网格相交、显式朝向和指定通道区域净空。作者登记、运行时测量、视觉判断与无法验证分开。GPU 顶点位移没有 query_geometry 时返回 unknown。支撑采样不是物理仿真；AABB 重叠不是实体穿插。
- 调整摆放可用 ctx.geometry.placeOn、alignAgainstWall、faceTowards、distribute，随后仍需测量与视图复核。布局不成立优先 Edit 源码，不靠重新生成资产掩盖。
- PublishSceneBuild 只发布已检查不可变 build，必须满足 required 检查且 expected_scene_version 匹配 build 基础版本；scene_changed 后重新构建。正式 revision 引用 build，不引用可变源码路径。
- checks.json 默认参与构建；必需条件跨构建保留，删除、降为可选或放宽容差不能绕过验收。unknown 应补查询几何或证据，不增加底板等非设计内容迎合采样。只在新用户要求确实改变目标时用 acceptance_update。支撑报告只证明最低表面带的采样，不证明所有脚或物理稳定；数值保持相对单位。
- 优先读工程拼图和检查摘要，InspectSceneBuild 按 object_keys 或 offset/limit 获取细节。相机名从 available_cameras 选择，缺失时用 overview 或显式 camera；partial 保留有效视图，不为相机请求错误重建。上下文裁剪后直接 Read 回执 preview_paths；visual_evidence_delivered:false 时不得声称已看图。
- 全部场景修改写回源码或源码引用的参数文件；旧声明式编辑工具已退役，不自动转换旧 Scene。已有资产可主动导入清单。恢复已发布代码历史产生新 revision。
- 用户只浏览、聚焦、选中、查看历史并发送截图意见，全部场景修改由 Agent 完成。反馈携带稳定 key、实际相机、revision、build 和时间；旧反馈先重新观察再改。用户相机独立，Agent 观察默认使用无头 Chromium，用户关闭舞台也能建模和检查。CaptureSceneView/QuerySceneSurface 使用代码构建的无头服务。
- GLB 整体登记，不自动推断内部语义部件；受控加载器处理坐标基、底部中心和重复实例复用。PLY/SPZ 保留为视觉内容；没有查询网格时不声称几何验证成功。坐标基错误不靠设计旋转补偿；承重姿态需要补正面/侧面/俯视证据。
- ExportSceneBuild 完整项目 ZIP 保留源码、资产、Shader、动画和入口；静态 GLB 只支持标准材质快照，不支持的内容明确报告。

## Workspace 与资产关系

- 图像写入 \`output/spatial/images/\`；物体及 manifest 写入 \`output/spatial/objects/<build-id>/\`；世界及 manifest 写入 \`output/spatial/worlds/<build-id>/\`；源码工程写入 \`output/spatial/scenes/<scene-id>/\`，构建产物写入 \`output/spatial/builds/<build-id>/\`；审阅写入 \`output/spatial/reviews/\`。
- 修订新产物时保留其来源关系：从哪个产物派生使用 \`derived_from\`；修订版本使用 \`revision_of\`；由哪个参考资产约束使用 \`conditioned_by\`；与哪个候选对比使用 \`compared_with\`。
- 先检查实际 job 与 manifest，再声称产物成功。用户可见的交付至少说明类型、状态、存储路径、主要资产和来源关系。

## 评审与能力边界

- Critic 只基于可见图像、截图、可打开的模型与 manifest 评审，并把判断标为 \`verified\`、\`inferred\` 或 \`unknown\`。
- 不把单幅图像当作几何正确性证明，不宣称 CAD 精度、真实尺度、碰撞、路径规划、物理真实性或物体级写回 Aholo World 已经实现。
- Critic 不自动发起新的付费生成。它提供可执行修订建议，由用户决定是否继续。

面向用户的任务状态、评审与最终交付默认使用简体中文；工具名、路径、正式产品名、模型名、标识符和参数保留准确原文。`
  },
})

const MATERIALS_DISCOVERY_V1: Readonly<ProjectGuideTemplate> = Object.freeze({
  template_id: 'materials-discovery',
  version: 1,
  title: '材料科学文献发现项目',
  compile() {
    return `# Project Guide · 材料科学文献发现

本项目从材料科学文献出发，目标是形成可追溯、可复核、可证伪的科学判断与 Research Gap。不预设材料体系、比赛路线或固定流程；根据真实文献成熟度自由探索、并行、回退和切换方法。

## 启动边界

- 实质性文献调研、证据综合、Gap 判断或假设发现，必须在第一次实质性文献检索前先调用 \`Skill\` 加载 \`research-orchestration\`，再由它指导路线、团队与其他方法 Skill 的按需加载。
- 简单概念解释、产品/策略讨论、普通文件操作和不需要真实文献证据的问答，不启动完整科研流程，也不强制加载该 Skill。
- 可用 Skill 的目录、描述与能力以系统注入的 Skills reminder 为唯一准则。

## 三种可组合的探索方法

- \`review_update\`：成熟方向以 scope 最匹配的权威综述建立领域地图，再从综述的实际检索 cutoff 向后追踪 primary research，判断旧 Gap 是已回应、部分/条件性回应、仍开放还是存在争议。
- \`adjacent_tension\`：直接文献稀少时，沿材料/组成、结构/界面、机制、制备、表征、计算/数据处理、应用/指标和工作条件同心扩展，从条件归一后仍存在的文献张力、局限与未解释现象中生成 Gap。
- \`hybrid\`：具体对象较新但上位领域已有综述时，用综述提供问题地图，用相邻研究产生和验证具体 Gap。

这些是方法而非状态机。Root 根据证据缺口自主组合、并行、回退或切换，不机械套流程。

## 证据与 Gap 边界

- 综述中的 Gap 只是 \`candidate\`；必须检索 cutoff 后的关键词、引用/相关图分支和适用的 arXiv 最新进展，才能判断当前状态。不能只查引用该综述的论文。
- \`impact_boost\` 是 Sciverse 影响力排序倾向，不是 Journal Impact Factor。除非外部权威指标明确证明，不得声称某综述是“影响因子最高”或绝对“最权威”。用 \`impact_boost\` 发现候选时显式设置 \`sort_by_year: "none"\`；最新进展单独按时间检索。
- 摘要、chunk 和检索分数只能筛选候选，不能单独决定 Gap 状态。最终判断核对可定位的全文上下文；全文或可比条件不足时降级为 \`provisional\` 或 \`indeterminate\`。
- 归一样品、工艺、结构、环境、测量、指标、数据处理、模型假设、时间和尺度后仍有方向、量级、机制、方法排名或复现性差异，才称为实质冲突；能被条件解释的差异改写为 boundary-condition Gap。
- 单篇论文可以支持一条 Observation。最终 Claim、Gap 或 Hypothesis 必须有至少两条独立来源链；否则标为 \`single-source / provisional\`。
- 每条 Hypothesis 必须是可证伪假设，明确变量、预测、机制、反证条件和可执行的验证路径。

## Workspace 研究契约

实质性科学调研至少维护：

- \`analysis/research-scope.md\`：问题、范围、纳排标准、时间边界、证据标准、假设和未决问题。
- \`references/evidence-ledger.md\`：稳定 \`E-###\` Observation、\`C-###\` Claim、全文位置、条件、支持/反驳关系、独立来源组与质量。
- \`output/research-report.md\`：带 as-of date 的结论、矛盾、\`G-###\` Gap、\`H-###\` Hypothesis、检索覆盖、限制、未决项和复现路径。

需要时再创建 anchor reviews、search frontier、literature/adjacent map、gap/conflict matrix 或 hypotheses 文件，不为每个步骤制造空模板。同一工作的预印本与期刊版、多篇综述对同一 primary study 的转述，只计一个独立来源组。

## 完成与停止检查

完成前必须核对：范围与 as-of date 足以限定结论；关键论文已检查全文且版本/来源链已去重；最终 C/G/H 满足独立多源规则；矛盾、限定条件和负结果未被抹平；Gap 已做“是否已有研究回应”的反向 novelty 检索；新查询的边际信息已降低，或明确记录了更早停止理由。

最终报告必须公开 as-of date、检索覆盖、解析限制、未决项和停止理由。除非用户在当前请求中明确指定其他语言，否则 \`output/research-report.md\` 与面向用户的结论性研究交付默认使用简体中文；论文题名、必要原文引文、参考文献、代码、路径、标识符、变量、单位、数学式和化学式保留原语言或原格式。当前用户指令与真实 Workspace 状态始终优先于历史摘要和默认方法。`
  },
})

const PROJECT_GUIDE_REGISTRY: Readonly<Record<string, Readonly<ProjectGuideTemplate>>> = Object.freeze({
  [`${SPATIAL_CREATION_V1.template_id}@${SPATIAL_CREATION_V1.version}`]: SPATIAL_CREATION_V1,
  [`${MATERIALS_DISCOVERY_V1.template_id}@${MATERIALS_DISCOVERY_V1.version}`]: MATERIALS_DISCOVERY_V1,
})

function freezeParameters(
  value: unknown,
): Readonly<Record<string, ProjectGuideParameterValue>> {
  if (value === undefined) return Object.freeze({})
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Project Guide parameters must be an object.')
  }

  const parameters: Record<string, ProjectGuideParameterValue> = {}
  for (const [key, parameter] of Object.entries(value)) {
    if (!key.trim()) throw new Error('Project Guide parameter names cannot be empty.')
    if (!['string', 'number', 'boolean'].includes(typeof parameter)) {
      throw new Error(`Unsupported Project Guide parameter: ${key}`)
    }
    if (typeof parameter === 'string' && parameter.length > 500) {
      throw new Error(`Project Guide parameter is too long: ${key}`)
    }
    parameters[key] = parameter as ProjectGuideParameterValue
  }
  return Object.freeze(parameters)
}

export function validateProjectGuideRef(value?: unknown): Readonly<ProjectGuideRef> {
  if (value === undefined) return DEFAULT_PROJECT_GUIDE_REF
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Project Guide ref must be an object.')
  }

  const candidate = value as Partial<ProjectGuideRef>
  if (typeof candidate.template_id !== 'string' || !candidate.template_id.trim()) {
    throw new Error('Project Guide template_id is required.')
  }
  if (!Number.isInteger(candidate.version) || (candidate.version ?? 0) < 1) {
    throw new Error('Project Guide version must be a positive integer.')
  }
  const version = candidate.version as number

  const parameters = freezeParameters(candidate.parameters)
  const key = `${candidate.template_id}@${version}`
  if (!PROJECT_GUIDE_REGISTRY[key]) {
    throw new Error(`Unknown Project Guide: ${key}`)
  }
  if (
    ['spatial-creation', 'materials-discovery'].includes(candidate.template_id)
    && Object.keys(parameters).length > 0
  ) {
    throw new Error(`${candidate.template_id}@${version} does not accept parameters.`)
  }

  return Object.freeze({
    template_id: candidate.template_id,
    version,
    ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
  })
}

/**
 * Compare persisted Project Guide identities without depending on object key
 * insertion order. Parameters are intentionally compared as sorted scalar
 * entries rather than serialized JSON so future parameterized templates do
 * not spuriously start a new prompt epoch after a BSON/object round trip.
 */
export function projectGuideRefsEqual(
  left: ProjectGuideIdentity,
  right: ProjectGuideIdentity,
): boolean {
  if (left.template_id !== right.template_id || left.version !== right.version) {
    return false
  }

  const leftEntries = Object.entries(left.parameters ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  const rightEntries = Object.entries(right.parameters ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  if (leftEntries.length !== rightEntries.length) return false

  return leftEntries.every(([key, value], index) => {
    const [rightKey, rightValue] = rightEntries[index]
    return key === rightKey && value === rightValue
  })
}

export function compileProjectGuide(ref?: ProjectGuideRef): Readonly<CompiledProjectGuide> {
  const validated = validateProjectGuideRef(ref)
  const key = `${validated.template_id}@${validated.version}`
  const template = PROJECT_GUIDE_REGISTRY[key]
  const parameters = validated.parameters ?? Object.freeze({})
  return Object.freeze({
    template_id: template.template_id,
    version: template.version,
    title: template.title,
    parameters,
    content: template.compile(parameters),
  })
}

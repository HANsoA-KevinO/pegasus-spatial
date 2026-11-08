import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { loadSkills } from '../loader'

function run(): void {
  const skillPath = path.join(process.cwd(), 'lib', 'skills', 'spatial-creation', 'SKILL.md')
  assert.ok(fs.existsSync(skillPath), 'spatial-creation is missing SKILL.md')

  const raw = fs.readFileSync(skillPath, 'utf8')
  const worldReferencePath = path.join(
    process.cwd(),
    'lib',
    'skills',
    'spatial-creation',
    'references',
    'world-generation.md',
  )
  assert.ok(fs.existsSync(worldReferencePath), 'spatial-creation is missing the World generation reference')
  const worldReference = fs.readFileSync(worldReferencePath, 'utf8')
  const orientationReferencePath = path.join(
    process.cwd(),
    'lib',
    'skills',
    'spatial-creation',
    'references',
    'spatial-orientation-review.md',
  )
  assert.ok(fs.existsSync(orientationReferencePath), 'spatial-creation is missing the orientation review reference')
  const orientationReference = fs.readFileSync(orientationReferencePath, 'utf8')
  const luxReferencePath = path.join(
    process.cwd(),
    'lib',
    'skills',
    'spatial-creation',
    'references',
    'lux-scene-building.md',
  )
  assert.ok(fs.existsSync(luxReferencePath), 'spatial-creation is missing the Lux scene-building reference')
  const luxReference = fs.readFileSync(luxReferencePath, 'utf8')
  const imagegenSkillPath = path.join(process.cwd(), 'lib', 'skills', 'imagegen', 'SKILL.md')
  const imagegenPromptingPath = path.join(
    process.cwd(), 'lib', 'skills', 'imagegen', 'references', 'prompting.md',
  )
  const imagegenSamplesPath = path.join(
    process.cwd(), 'lib', 'skills', 'imagegen', 'references', 'sample-prompts.md',
  )
  assert.ok(fs.existsSync(imagegenSkillPath), 'imagegen is missing SKILL.md')
  assert.ok(fs.existsSync(imagegenPromptingPath), 'imagegen is missing prompting reference')
  assert.ok(fs.existsSync(imagegenSamplesPath), 'imagegen is missing sample prompt reference')
  const imagegenRaw = fs.readFileSync(imagegenSkillPath, 'utf8')
  const imagegenPrompting = fs.readFileSync(imagegenPromptingPath, 'utf8')
  const imagegenSamples = fs.readFileSync(imagegenSamplesPath, 'utf8')
  const loaded = loadSkills().get('spatial-creation')
  assert.ok(loaded, 'spatial-creation was not loaded')
  assert.equal(loaded.name, 'spatial-creation')
  assert.match(loaded.description, /用于/)
  assert.match(loaded.description, /不用于/)

  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(frontmatter, 'spatial-creation needs valid frontmatter')
  const keys = [...frontmatter[1].matchAll(/^([a-z][a-z-]*):/gm)]
    .map(match => match[1])
    .sort()
  assert.deepEqual(keys, ['description', 'name'])

  assert.deepEqual(
    [...loadSkills({ projectGuideTemplateId: 'spatial-creation' }).keys()].sort(),
    ['imagegen', 'spatial-creation'],
    'the default spatial catalog must not expose materials research skills',
  )
  const materialsCatalog = loadSkills({ projectGuideTemplateId: 'materials-discovery' })
  assert.equal(materialsCatalog.has('spatial-creation'), false)
  assert.equal(materialsCatalog.has('imagegen'), false)
  assert.equal(materialsCatalog.has('research-orchestration'), true)

  const loadedImagegen = loadSkills({ projectGuideTemplateId: 'spatial-creation' }).get('imagegen')
  assert.ok(loadedImagegen, 'imagegen was not loaded for the spatial project')
  assert.match(loadedImagegen.description, /用于/)
  assert.match(loadedImagegen.description, /不用于/)
  assert.match(imagegenRaw, /只使用运行时提供的 `GenerateImage`/)
  assert.match(imagegenRaw, /每次调用只支持一张输入图/)
  assert.match(imagegenRaw, /output\/spatial\/images\//)
  assert.match(imagegenRaw, /同步工具[^]*多个 Agent 并行/)
  assert.match(imagegenRaw, /canonical 主图[^]*input_image_path[^]*派生每个方向/)
  assert.match(imagegenRaw, /2:1[^]*World[^]*等距柱状全景/)
  assert.match(imagegenRaw, /\/skills\/imagegen\/references\/prompting\.md/)
  assert.match(imagegenRaw, /\/skills\/imagegen\/references\/sample-prompts\.md/)
  assert.match(imagegenPrompting, /不要在提示词中引用不存在的 Image 2、Image 3/)
  assert.match(imagegenPrompting, /支撑方向、承载面和重力关系/)
  assert.match(imagegenPrompting, /2:1[^]*equirectangular[^]*水平 360°[^]*左右边缘/)
  assert.match(imagegenSamples, /Lux3D 独立资产主视图/)
  assert.match(imagegenSamples, /从主图派生后视图/)
  assert.match(imagegenSamples, /World 专用 2:1 全景环境图/)
  for (const codexOnly of [
    'built-in `image_gen`',
    'scripts/image_gen.py',
    'OPENAI_API_KEY',
    '$CODEX_HOME',
    'view_image',
    'CLI fallback',
  ]) {
    assert.equal(imagegenRaw.includes(codexOnly), false, `imagegen leaked Codex-only guidance: ${codexOnly}`)
    assert.equal(imagegenPrompting.includes(codexOnly), false, `prompting leaked Codex-only guidance: ${codexOnly}`)
    assert.equal(imagegenSamples.includes(codexOnly), false, `samples leaked Codex-only guidance: ${codexOnly}`)
  }

  for (const tool of [
    'GenerateImage',
    'CreateObject3D',
    'CreateWorld3D',
    'GetSpatialJob',
    'WaitSpatialJob',
    'InspectSpatialArtifact',
    'CreateSpatialScene',
    'CaptureSceneView',
    'QuerySceneSurface',
    'AskUserQuestion',
  ]) {
    assert.match(raw, new RegExp(`\\b${tool}\\b`), `missing tool guidance for ${tool}`)
  }

  assert.match(raw, /不对项目设置固定的图片或 3D 任务数量上限/)
  assert.match(raw, /Worker[^]*并发[^]*不限制持久队列/)
  assert.doesNotMatch(raw, /最多同时运行两个 3D 生成任务和两个图片生成任务/)
  assert.match(raw, /Member wildcard[^]*Root[^]*allowed_tools[^]*显式授权/)
  assert.match(raw, /unknown[^]*外部副作可能已发生/)
  assert.match(raw, /对话结束[^]*不是付费重试理由/)
  assert.match(raw, /多个相互独立的资产[^]*多个 Asset Maker/)
  assert.match(raw, /早期点子[^]*用户明确确认后进入 3D 制作[^]*确认前不创建 3D 生产成员/)
  assert.match(raw, /AskUserQuestion[^]*真正会改变设计方向的问题[^]*推荐默认值/)
  assert.match(raw, /用户沉默[^]*Agent 自己写出的方案[^]*不算确认/)
  assert.match(raw, /明确要求跳过概念阶段[^]*局部修改已有 Scene[^]*对应的资产或源码/)
  assert.match(raw, /明确要求纯代码[^]*多文件 Three.js 源码为真值[^]*任意原生几何、CSG[^]*GLB/)

  const reconstruction = raw.split('## 2. 从照片与口述到可进入的场景')[1].split('## 3.')[0]
  assert.match(reconstruction, /照片可见事实、口述提供的细节和推测补全[^]*合成图不会把推测变成史实/)
  assert.match(reconstruction, /调用 `GenerateImage` 前加载 `imagegen` Skill[^]*整体概念图[^]*补能说明布局的机位[^]*从概念图拆资产[^]*用真实资产组装/)
  assert.match(reconstruction, /已发布的 GLB[^]*assets.json[^]*ctx.assets.loadGLB[^]*细节补充/)
  assert.match(raw, /concept_art[^]*scene_environment_panorama[^]*lux_asset_reference[^]*不得由同一个文件兼任/)
  assert.match(raw, /在第一次生成前|从同一主图派生需要的补充视角/)
  assert.match(raw, /reference_image_paths[^]*CreateObject3D[^]*每件 1–4 张[^]*不能把整场图或拼图当成单件视角/)
  assert.match(raw, /新建室外场景[^]*概念确定后默认单独生成一张 2:1 等距柱状[^]*scene_environment_panorama[^]*全封闭室内或局部修改按需处理[^]*assets.json[^]*scene.background/)
  assert.match(raw, /普通单向概念图通常不适合作为 360° 环境/)
  assert.match(raw, /结果可用但不完美[^]*继续推进[^]*不确定性[^]*不阻塞独立 Lux/)
  assert.match(raw, /waiting_user[^]*终态事件[^]*持久排队[^]*这不是通知丢失/)
  assert.match(raw, /Scene revision[^]*一个写入责任方/)
  assert.match(raw, /俯视[^]*入口人眼尺度[^]*远景轮廓/)
  assert.match(raw, /生成 GLB 后先检查真实 manifest[^]*朝上方向[^]*支撑面/)
  assert.match(raw, /稳定 key[^]*实际测量[^]*PublishSceneBuild/)
  assert.match(raw, /正常创作中不得[^]*WaitSpatialJob/)
  assert.match(raw, /spatial_job_update|持久后台事件/)
  assert.match(luxReference, /异步并行创作/)
  assert.match(luxReference, /当前 Agent 不应停下来等待/)
  assert.match(luxReference, /唯一 Scene Assembler/)
  assert.doesNotMatch(raw + luxReference, /不存在的代理几何|不存在的代理体构造器/)
  assert.doesNotMatch(raw, /当前没有任意 JavaScript 执行工具/)
  assert.match(raw, /RunSceneCode[^]*冻结[^]*CheckSceneConstraints/)
  assert.match(luxReference, /顶视、入口人眼视角和远景/)
  assert.match(luxReference, /资产发布后检查真实 manifest 与 GLB[^]*开口是否贯通[^]*支撑面/)
  assert.match(raw, /CreateWorld3D[^]*文字或单张参考图[^]*可选的固定观察点体积背景/)
  assert.match(raw, /\/skills\/spatial-creation\/references\/world-generation\.md/)
  assert.match(raw, /\/skills\/spatial-creation\/references\/lux-scene-building\.md/)
  assert.match(raw, /物体与世界仍有关键歧义[^]*AskUserQuestion/)
  assert.match(raw, /不因为“候选数量”本身强制询问用户/)
  assert.match(raw, /单独物体的文字需求足以描述几何和风格时[^]*可以直接调用 `CreateObject3D`/)
  assert.match(luxReference, /视觉基准明确后再并行生产[^]*早期概念探索先完成用户确认/)

  for (const outputPath of [
    'output/spatial/images/',
    'output/spatial/objects/<build-id>/',
    'output/spatial/worlds/<build-id>/',
    'output/spatial/scenes/<scene-id>/',
    'output/spatial/reviews/',
  ]) {
    assert.ok(raw.includes(outputPath), `missing output path ${outputPath}`)
  }

  for (const relation of ['derived_from', 'revision_of', 'conditioned_by', 'compared_with']) {
    assert.match(raw, new RegExp(`\\b${relation}\\b`), `missing relation ${relation}`)
  }

  for (const reviewStatus of ['verified', 'inferred', 'unknown']) {
    assert.match(raw, new RegExp(`\\b${reviewStatus}\\b`), `missing review status ${reviewStatus}`)
  }
  assert.match(raw, /不宣称 CAD 精度[^]*真实尺度[^]*碰撞[^]*物理正确性/)
  assert.match(raw, /不宣称能局部语义修改 3DGS World/)
  assert.match(raw, /本地坐标基错误[^]*Scene 设计旋转/)
  assert.match(raw, /全部场景修改[^]*源码/)
  assert.doesNotMatch(raw + worldReference + luxReference + orientationReference, /SetSceneEnvironment|ApplySceneSpec|AddSceneTerrain|TransformSceneObject/)
  assert.match(raw, /CreateSpatialScene[^]*返回已准备好的源码工程/)
  assert.match(raw, /spatial-orientation-review\.md/)
  assert.match(raw, /单张遮挡视图和包围盒不能证明姿态正确/)
  assert.match(raw, /支撑点[^]*主要承载面/)
  assert.match(raw, /默认使用简体中文/)

  assert.match(worldReference, /新建室外 Scene[^]*默认单独生成一张 2:1 等距柱状全景[^]*ctx.assets.loadTexture/)
  assert.match(worldReference, /全景环境不产生地面/)
  assert.match(worldReference, /概念美术图[^]*scene_environment_panorama[^]*lux_asset_reference/)
  assert.match(worldReference, /Aholo World[^]*一张已授权 Workspace 图片/)
  assert.match(worldReference, /2:1[^]*等距柱状全景[^]*水平 360°[^]*垂直 180°/)
  assert.match(worldReference, /普通单向透视图[^]*背面[^]*拉伸[^]*重复[^]*无关结构/)
  assert.match(worldReference, /Agent 应查看真实结果[^]*接缝[^]*天顶\/地底/)
  assert.match(worldReference, /不是代码级图片质量门禁/)
  assert.match(worldReference, /不阻塞独立 Lux 资产生产/)
  assert.doesNotMatch(worldReference, /提交前全景门禁|任一项失败|检查合格后/)
  assert.match(worldReference, /近中景保持低信息[^]*不出现需要视差或交互的建筑、道路、家具/)
  assert.match(worldReference, /无限远|包围相机|稳定地包围相机/)
  assert.match(worldReference, /不在接缝截断大型物体/)
  assert.match(worldReference, /地形、建筑或物件[^]*CreateObject3D/)
  assert.match(worldReference, /推荐提示结构/)
  assert.match(worldReference, /registerObject[^]*QuerySceneGeometry/)
  assert.match(worldReference, /创建 Aholo World[^]*记录 `job_id`/)
  assert.match(worldReference, /unknown[^]*不得自动再次提交/)
  assert.match(worldReference, /published[^]*真实 manifest 和资产/)
  assert.match(orientationReference, /资产本地坐标基[^]*Scene 设计变换/)
  assert.match(orientationReference, /包围盒只能证明[^]*不能证明“哪一边是底部”/)
  assert.match(orientationReference, /同一 Scene revision[^]*同一 instance transform[^]*同一 camera pose/)
  assert.match(orientationReference, /只有一种格式翻倒或侧卧[^]*不修改 Scene/)
  assert.match(orientationReference, /支撑点[^]*承载面/)
  assert.match(orientationReference, /verified[^]*inferred[^]*unknown/)
  assert.match(luxReference, /环境模块[^]*地台[^]*道路段[^]*建筑外壳/)
  assert.match(luxReference, /从概念美术建立实施清单/)
  assert.match(luxReference, /环境清单[^]*近中景低信息[^]*通常不要直接复用[^]*概念图/)
  assert.match(luxReference, /避免提交整场概念图、拼图或互相矛盾的视角/)
  assert.match(luxReference, /QuerySceneGeometry/)
  assert.match(luxReference, /每个待生成的资产[^]*canonical 主视图[^]*主体完整[^]*背景干净/)
  assert.match(luxReference, /建筑主体[^]*塔楼[^]*连廊[^]*入口构筑物[^]*围墙/)
  assert.match(luxReference, /源码加载授权全景[^]*不阻塞主 Scene/)
  assert.match(luxReference, /`CreateObject3D`[^]*环境模块/)
  assert.match(luxReference, /同一摆放关系[^]*一个模块/)
  assert.match(luxReference, /在第一次生成前补相应视角[^]*input_image_path[^]*侧视、后视或斜后视/)
  assert.match(luxReference, /多视角可减少遮挡导致的歧义[^]*无法证明 CAD 精度/)
  assert.match(raw, /Write[^]*Edit[^]*RunSceneCode[^]*PublishSceneBuild/)
  assert.match(luxReference, /Write[^]*Edit[^]*RunSceneCode[^]*PublishSceneBuild/)
  assert.match(luxReference, /已发布 GLB 提供资产几何和材质[^]*Three.js 源码定义场景布局/)
  assert.doesNotMatch(raw + worldReference + orientationReference + luxReference, /四图|网页端|内部端点|Python 脚本|Authorization|x-source/)

  console.log('spatial creation skill verification passed')
}

run()

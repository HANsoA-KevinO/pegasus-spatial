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
  assert.match(imagegenRaw, /\/skills\/imagegen\/references\/prompting\.md/)
  assert.match(imagegenRaw, /\/skills\/imagegen\/references\/sample-prompts\.md/)
  assert.match(imagegenPrompting, /不要在提示词中引用不存在的 Image 2、Image 3/)
  assert.match(imagegenPrompting, /支撑方向、承载面和重力关系/)
  assert.match(imagegenSamples, /Lux3D 独立资产主视图/)
  assert.match(imagegenSamples, /从主图派生后视图/)
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
    'AddSceneObject',
    'TransformSceneObject',
    'CaptureSceneView',
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
  assert.match(raw, /Scene revision[^]*一个写入责任方/)
  assert.match(raw, /正常创作中不得[^]*WaitSpatialJob/)
  assert.match(raw, /spatial_job_update|持久后台事件/)
  assert.match(luxReference, /异步并行创作/)
  assert.match(luxReference, /当前 Agent 不应停下来等待/)
  assert.match(luxReference, /唯一 Scene Assembler/)

  // Lock the five user-facing decision cases from the 48-hour acceptance
  // plan. These are prompt-contract checks; live provider behavior remains a
  // separate H0 smoke gate and must never be faked in deterministic CI.
  assert.match(raw, /Lux 环境模块[^]*CreateObject3D/)
  assert.match(raw, /远景[^]*CreateWorld3D/)
  assert.match(raw, /GenerateImage[^]*生成或编辑一张[^]*参考图/)
  assert.match(raw, /CreateWorld3D[^]*一张已授权的 Workspace 参考图/)
  assert.match(raw, /CreateObject3D[^]*1–4 张已授权参考图/)
  assert.match(raw, /多张图[^]*同一设计[^]*省略 `prompt`/)
  assert.match(raw, /\/skills\/spatial-creation\/references\/world-generation\.md/)
  assert.match(raw, /\/skills\/spatial-creation\/references\/lux-scene-building\.md/)
  assert.match(raw, /物体与世界仍有关键歧义[^]*AskUserQuestion/)
  assert.match(raw, /不因为“候选数量”本身强制询问用户/)
  assert.match(raw, /文字已足以表达几何和风格时[^]*直接调用 3D 生成工具/)
  assert.match(raw, /调用 `GenerateImage` 前加载 `imagegen` Skill/)

  for (const outputPath of [
    'output/spatial/images/',
    'output/spatial/objects/<build-id>/',
    'output/spatial/worlds/<build-id>/',
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
  assert.match(raw, /坐标基校准[^]*不属于 Scene 设计变换/)
  assert.match(raw, /TransformSceneObject[^]*补偿格式错误/)
  assert.match(raw, /spatial-orientation-review\.md/)
  assert.match(raw, /单张遮挡视图和包围盒不能证明姿态正确/)
  assert.match(raw, /支撑点[^]*主要承载面/)
  assert.match(raw, /默认使用简体中文/)

  assert.match(worldReference, /一张当前 Workspace 中已授权的参考图/)
  assert.match(worldReference, /干净、平整、开阔的中央空间/)
  assert.match(worldReference, /建筑、道路、场地模块[^]*CreateObject3D/)
  assert.match(worldReference, /World 提示词/)
  assert.match(worldReference, /入口、核心区域、开口、动线/)
  assert.match(worldReference, /一次明确的 World 意图只创建一个 durable Job/)
  assert.match(worldReference, /unknown[^]*不得自动再次提交/)
  assert.match(worldReference, /submitted[^]*不能说 World 已完成/)
  assert.match(worldReference, /SPZ[^]*PLY[^]*LOD/)
  assert.match(orientationReference, /资产本地坐标基[^]*Scene 设计变换/)
  assert.match(orientationReference, /包围盒只能证明[^]*不能证明“哪一边是底部”/)
  assert.match(orientationReference, /同一 Scene revision[^]*同一 instance transform[^]*同一 camera pose/)
  assert.match(orientationReference, /只有一种格式翻倒或侧卧[^]*不修改 Scene/)
  assert.match(orientationReference, /支撑点[^]*承载面/)
  assert.match(orientationReference, /verified[^]*inferred[^]*unknown/)
  assert.match(luxReference, /环境模块[^]*地台[^]*道路段[^]*建筑外壳/)
  assert.match(luxReference, /同一摆放关系[^]*一个模块/)
  assert.match(luxReference, /2–4 张一致参考图/)
  assert.match(luxReference, /主视图[^]*input_image_path[^]*后视、侧视或斜后视/)
  assert.match(luxReference, /多张参考图[^]*reference_image_paths[^]*省略 `prompt`/)
  assert.match(luxReference, /多视角只能减少遮挡和背面歧义[^]*不能证明 CAD 精度/)
  assert.match(luxReference, /GLB 是 Scene 选择、变换和结构判断的真值/)
  assert.doesNotMatch(raw + worldReference + orientationReference + luxReference, /四图|网页端|内部端点|Python 脚本|Authorization|x-source/)

  console.log('spatial creation skill verification passed')
}

run()

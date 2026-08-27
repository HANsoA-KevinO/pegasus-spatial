import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { loadSkills } from '../loader'

function run(): void {
  const skillPath = path.join(process.cwd(), 'lib', 'skills', 'spatial-creation', 'SKILL.md')
  assert.ok(fs.existsSync(skillPath), 'spatial-creation is missing SKILL.md')

  const raw = fs.readFileSync(skillPath, 'utf8')
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
    [...loadSkills({ projectGuideTemplateId: 'spatial-creation' }).keys()],
    ['spatial-creation'],
    'the default spatial catalog must not expose materials research skills',
  )
  const materialsCatalog = loadSkills({ projectGuideTemplateId: 'materials-discovery' })
  assert.equal(materialsCatalog.has('spatial-creation'), false)
  assert.equal(materialsCatalog.has('research-orchestration'), true)

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

  assert.match(raw, /最多同时运行两个昂贵任务/)
  assert.match(raw, /Member wildcard[^]*Root[^]*allowed_tools[^]*显式授权/)
  assert.match(raw, /unknown[^]*外部副作可能已发生/)
  assert.match(raw, /对话结束[^]*不是付费重试理由/)

  // Lock the five user-facing decision cases from the 48-hour acceptance
  // plan. These are prompt-contract checks; live provider behavior remains a
  // separate H0 smoke gate and must never be faked in deterministic CI.
  assert.match(raw, /独立物体[^]*CreateObject3D/)
  assert.match(raw, /房间[^]*CreateWorld3D/)
  assert.match(raw, /GenerateImage[^]*生成或编辑单张参考图/)
  assert.match(raw, /物体与世界仍有关键歧义[^]*AskUserQuestion/)
  assert.match(raw, /不因为“候选数量”本身强制询问用户/)
  assert.match(raw, /文字已足以表达几何和风格时[^]*直接调用 3D 生成工具/)

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
  assert.match(raw, /默认使用简体中文/)

  console.log('spatial creation skill verification passed')
}

run()

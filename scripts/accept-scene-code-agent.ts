/** Explicit live product acceptance. No image/3D generation tools are granted. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import mongoose from 'mongoose'
import { createConversation } from '../lib/db/repository'
import { connectDB } from '../lib/db/mongodb'
import { createScenePublicationWorkspace } from '../lib/spatial/scene-workspace'
import { SpatialSceneModel } from '../lib/spatial/models'
import { getCurrentSpatialSceneRevision } from '../lib/spatial/scene-repository'
import { getSceneCodeBuild, SceneCodeBuildModel, SceneCodeSlotModel } from '../lib/scene-code/repository'
import { startSceneCodeWorker } from '../lib/scene-code/build-worker'
import { observeBuild } from '../lib/scene-code/service'
import type { SceneConstraint } from '../lib/scene-code/types'
import { createAgentProvider } from '../lib/agent/provider'
import { agentLoop } from '../lib/agent/loop'
import { parseAgentTurnLimit } from '../lib/agent-runtime/turn-limits'
import { createFrozenProjectContext } from '../lib/agent/project-context'
import { defaultMainAliasFor, resolveAlias, resolveAuthoritativeModelSnapshot } from '../lib/llm-registry'
import { loadSkills } from '../lib/skills/loader'
import { SCENE_CODE_TOOL_NAMES } from '../lib/scene-code/types'
import { readImageAsset } from '../lib/media/storage'
import type { ConversationMessage } from '../lib/types'
import type { SpatialSceneRecord } from '../lib/spatial/scene-types'

async function main() {
  if (process.env.RUN_SCENE_CODE_AGENT_ACCEPTANCE !== '1') throw new Error('Set RUN_SCENE_CODE_AGENT_ACCEPTANCE=1 for the explicitly requested live product test')
  if (!/\/pegasus_scene_agent_test(?:\?|$)/.test(process.env.MONGODB_URI || '')) throw new Error('Requires isolated pegasus_scene_agent_test DB')
  await connectDB()
  await Promise.all([SceneCodeBuildModel.syncIndexes(), SceneCodeSlotModel.syncIndexes()])
  const alias = process.env.SCENE_CODE_ACCEPTANCE_ALIAS || defaultMainAliasFor('pro'), model = await resolveAuthoritativeModelSnapshot(alias), configuredCredentials = resolveAlias(alias)
  // Explicit product-test override only; never mutate the application's registry.
  const credentials = { ...configuredCredentials, model: process.env.SCENE_CODE_ACCEPTANCE_MODEL || configuredCredentials.model }
  assert.ok(model.supports_vision, 'Configured main model must support vision')
  const resume = process.env.SCENE_CODE_ACCEPTANCE_RESUME ? JSON.parse(await readFile(process.env.SCENE_CODE_ACCEPTANCE_RESUME, 'utf8')) : null
  const userId = 'scene-agent-acceptance-user'
  const conversationId = resume?.conversation_id || (await createConversation(userId)).conversation_id
  const output = process.env.SCENE_CODE_AGENT_OUTPUT || '/private/tmp/pegasus-scene-agent-acceptance'
  await mkdir(output, { recursive: true })
  let workspace = await createScenePublicationWorkspace({ conversationId, userId })
  const glb = await readFile('scripts/fixtures/textured-box.glb')
  await workspace.writeDocument({ path: 'output/spatial/objects/existing/instrument.glb', filename: 'instrument.glb', buffer: glb, mimeType: 'model/gltf-binary', source: { provider: 'local-test-fixture' }, provenance: { retrieved_at: new Date().toISOString() } })
  const worker = startSceneCodeWorker()
  const events: unknown[] = resume?.events ?? [], phases: Array<{ name: string; truncated?: boolean }> = resume?.phases ?? []
  let messages: ConversationMessage[] = resume?.messages ?? []
  const started = Date.now()
  const modelRecord = { alias, registry_model: model.real_model, requested_gateway_model: credentials.model, version_verified: credentials.model === model.real_model }
  async function checkpoint() {
    await writeFile(`${output}/trace.json`, JSON.stringify({ model: modelRecord, conversation_id: conversationId, elapsed_ms: Date.now() - started, phases, events, messages }, null, 2))
  }
  const allowed = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'CreateSpatialScene', 'InspectSpatialScene', 'FocusSceneObject', 'CaptureSceneView', ...SCENE_CODE_TOOL_NAMES]
  async function phase(name: string, text: string, image?: string) {
    workspace = await createScenePublicationWorkspace({ conversationId, userId })
    const content: ConversationMessage['content'] = [{ type: 'text', text }]
    if (image) content.push({ type: 'image', source: { type: 'asset', asset_id: image, media_type: 'image/png' } })
    messages.push({ role: 'user', content })
    const runId = `acceptance-${name}-${Date.now()}`
    const provider = createAgentProvider(workspace, loadSkills({ projectGuideTemplateId: 'spatial-creation' }), { model: credentials.model, maxTokens: 16384, temperature: .3, apiKey: credentials.apiKey, supportsVision: true, conversationId, executionContext: { userId, conversationId, workspaceId: conversationId, runId, isRoot: true, allowedTools: allowed, agentInstructions: '完成已明确授权的代码建模与修改。用户舞台关闭；不要请求打开舞台。不得发起付费图片或3D生成。工具实际反馈用于发现并修复错误；不要把语义名称当成空间证据。' } }, {
      onToolStart(tool, input) { events.push({ phase: name, event: 'tool_start', tool, input, elapsed_ms: Date.now() - started }); console.log(`[${name}] ${tool}`) },
      onToolExecuted(tool, input, result) { events.push({ phase: name, event: 'tool_result', tool, input, result, elapsed_ms: Date.now() - started }) },
    }, undefined, createFrozenProjectContext(workspace.list().join('\n')))
    const began = Date.now()
    const result = await agentLoop(provider, messages, { maxTurns: parseAgentTurnLimit(process.env.SCENE_CODE_ACCEPTANCE_MAX_TURNS, 'SCENE_CODE_ACCEPTANCE_MAX_TURNS'), runId, workspace, model: credentials.model, modelAlias: alias, contextWindow: model.context_window, mainMaxOutputTokens: 16384 })
    messages = result.messages
    phases.push({ name, elapsed_ms: Date.now() - began, turns: result.turnsUsed, usage: result.usage, text: result.text, truncated: result.truncated } as typeof phases[number])
    await checkpoint()
    return result
  }
  async function published(title: string) {
    const scene = await SpatialSceneModel.findOne({ project_id: conversationId, user_id: userId, title }).lean<SpatialSceneRecord>()
    assert.ok(scene, `Agent did not create ${title}`)
    const revision = await getCurrentSpatialSceneRevision(scene)
    assert.ok(revision.program, `Agent did not publish ${title}`)
    const build = await getSceneCodeBuild(revision.program.build_id, { projectId: conversationId, userId })
    // Independent conditions: an Agent cannot pass by omitting its own checks.
    const isCourtyard = title === '记忆小院'
    const pairs: SceneConstraint[] = isCourtyard ? [
      { id: 'fixture-bench-support', kind: 'support', object_keys: ['bench', 'floor'], tolerance: .02 },
      { id: 'fixture-bench-gap', kind: 'distance', object_keys: ['bench', 'south-wall'], min: .35, max: .45 },
      { id: 'fixture-entry-bench', kind: 'keep_clear', object_keys: ['entry-clearance', 'bench'] },
    ] : [
      ...['chair', 'table'].map(key => ({ id: `fixture-${key}-support`, kind: 'support' as const, object_keys: [key, 'floor'], tolerance: .02 })),
      { id: 'fixture-chair-table-gap', kind: 'distance', object_keys: ['chair', 'table'], min: .25, max: .35 },
      ...['chair', 'table', 'bookshelf', 'lamp'].map(key => ({ id: `fixture-clear-${key}`, kind: 'keep_clear' as const, object_keys: ['entry-clearance', key] })),
    ]
    // Cover every registered in-scene object, not just the objects chosen by
    // the author. A renamed/new obstacle must not disappear from acceptance.
    for (const object of build.report!.snapshot.objects) {
      if (!object.measured.in_scene || ['floor', 'entry-clearance'].includes(object.key) || pairs.some(check => check.kind === 'keep_clear' && check.object_keys[1] === object.key)) continue
      pairs.push({ id: `fixture-route-${object.key}`, kind: 'keep_clear', object_keys: ['entry-clearance', object.key] })
    }
    const independent = await observeBuild(build, { kind: 'check', constraints: pairs }, workspace)
    await writeFile(`${output}/${title}-independent-checks.json`, JSON.stringify(independent, null, 2))
    assert.equal(independent.constraints!.length, pairs.length)
    for (const check of independent.constraints!) assert.equal(check.status, 'satisfied', `${title}: independent ${check.id}: ${JSON.stringify(check.observation)}`)
    assert.ok(build.acceptance?.requirements.length, 'Published build must retain required checks')
    for (const check of build.report!.constraints) if (check.required) assert.equal(check.status, 'satisfied', `${title}: ${check.id}`)
    const objects = build.report!.snapshot.objects
    const floor = objects.find(object => object.key === 'floor')!.measured.bounds!
    assert.ok(Math.abs(floor.max[2]) < .02, 'Floor top must be z=0')
    assert.ok(Math.abs(floor.size[0] - (isCourtyard ? 8 : 6)) < .05)
    assert.ok(Math.abs(floor.size[1] - (isCourtyard ? 6 : 5)) < .05)
    const reservation = objects.find(object => object.key === 'entry-clearance')!.measured.bounds!
    assert.ok(reservation.min[0] <= -(isCourtyard ? .79 : .59) && reservation.max[0] >= (isCourtyard ? .79 : .59), 'Reservation cannot be shrunk to evade clearance checks')
    assert.ok(reservation.min[1] <= (isCourtyard ? -2.98 : -2.48) && reservation.max[1] >= -.01 + (isCourtyard ? -.5 : 0), 'Reservation must cover the requested route')
    assert.ok(reservation.min[2] <= .02 && reservation.max[2] >= 2.18)
    const bench = objects.find(object => object.key === (isCourtyard ? 'bench' : 'chair'))!.measured.bounds!
    const probes = await observeBuild(build, { kind: 'query', queries: [
      ...[0, isCourtyard ? -.78 : -.58, isCourtyard ? .78 : .58].map(x => ({ id: `opening-${x}`, kind: 'raycast' as const, object_keys: ['south-wall'], origin: [x, isCourtyard ? -4 : -3.5, 1] as [number, number, number], direction: [0, 1, 0] as [number, number, number], max_distance: 2 })),
      { id: 'no-added-baseplate', kind: 'raycast', object_keys: [isCourtyard ? 'bench' : 'chair'], origin: [(bench.min[0] + bench.max[0]) / 2, (bench.min[1] + bench.max[1]) / 2, .08], direction: [0, 0, -1], max_distance: .12 },
    ] }, workspace)
    await writeFile(`${output}/${title}-independent-rays.json`, JSON.stringify(probes, null, 2))
    for (const probe of (probes as unknown as { observations: Array<{ status: string; value: unknown }> }).observations) { assert.equal(probe.status, 'measured'); assert.equal(probe.value, null, 'Door opening or leg-only design failed actual ray probe') }
    if (isCourtyard) assert.ok(build.report!.snapshot.assets.some(asset => asset.loaded && asset.instances_in_scene > 0), 'Existing GLB must actually be placed')
    for (const view of build.report!.views) if (view.image) { const image = await readImageAsset(view.image.assetId); if (image) await writeFile(`${output}/${title}-${view.name}.png`, image.buffer) }
    await writeFile(`${output}/${title}-build.json`, JSON.stringify({ build_id: build.build_id, source_hash: build.source_hash, revision_id: revision.revision_id, report: build.report, sources: build.sources }, null, 2))
    return { scene, revision, build }
  }
  try {
    console.log(`Live acceptance: ${credentials.model}; no paid asset generation; output ${output}`)
    if (!phases.some(phase => phase.name === 'courtyard' && !phase.truncated)) await phase('courtyard', '直接实现合成测试场景，名称“记忆小院”。无需概念确认，不生成任何付费资产。约定 X 向右、Y 向北、Z 向上，相对单位：8×6 的院子，地面 key=floor，顶面 z=0，南墙 y=-3 有宽1.6高2.2的贯通门洞；东侧有带斜屋顶的小廊，西侧有弯曲缸身的花盆和木长凳。入口从 y=-3 向北到 y=-.5、x±.8、z=0..2.2 必须留空。放置一个隐藏的闭合 entry-clearance 查询网格明确此区域。长凳 key=bench，南墙 key=south-wall；让长凳和南墙的真实表面间距处于 .35 到 .45，长凳用常规脚支撑落地，不添加整块底板。已有 GLB output/spatial/objects/existing/instrument.glb 可作为小院摆件，用真实 bounds 缩放至约 .6 高，并与代码几何混搭。编写明确 required 检查：长凳支撑、间距和入口净空。使用 RunSceneCode 后亲自看工程图与测量，必要时修正源码；最后 PublishSceneBuild。检查与图片是真实验收依据，不能只登记语义对象。')
    const courtyard = await published('记忆小院')
    const before = courtyard.build.report!.snapshot.objects.find(object => object.key === 'bench')!
    assert.ok(before)
    const selectedAlreadyDone = phases.some(phase => phase.name === 'selected-object' && !phase.truncated)
    if (!selectedAlreadyDone) await phase('selected-object', `选中对象 bench，来自 revision ${courtyard.revision.revision_id}、build ${courtyard.build.build_id}、t=0。截图如附图。请把这张长凳沿南墙移到入口右侧，依然离南墙 .35..45，保持落地、入口净空；长凳的材质改成深绿色。只改这一个对象的设计，重新构建，实际看图和测量后发布。`, courtyard.build.report!.views.find(view => view.name === 'overview' || view.name === 'entrance')!.image!.assetId)
    const modified = await published('记忆小院')
    if (!selectedAlreadyDone) assert.notEqual(modified.build.build_id, courtyard.build.build_id)
    const after = modified.build.report!.snapshot.objects.find(object => object.key === 'bench')!
    if (!selectedAlreadyDone) assert.notDeepEqual(after.measured.position, before.measured.position)
    assert.ok((after.measured.bounds!.min[0] + after.measured.bounds!.max[0]) / 2 > .8, 'Selected bench must move to the right of the entrance')
    assert.ok(after.measured.materials.some(material => { const color = material.color?.replace('#', '') || ''; return color.length === 6 && parseInt(color.slice(2, 4), 16) > parseInt(color.slice(0, 2), 16) * 1.2 }), 'Bench should have a green material')
    for (const object of courtyard.build.report!.snapshot.objects.filter(object => object.key !== 'bench' && object.parent_key !== 'bench')) {
      const current = modified.build.report!.snapshot.objects.find(candidate => candidate.key === object.key)
      assert.ok(current, `Selected edit removed ${object.key}`)
      assert.deepEqual(current.measured, object.measured, `Selected edit changed unrelated ${object.key}`)
    }
    if (resume) {
      const scene = await SpatialSceneModel.findOne({ project_id: conversationId, user_id: userId, title: '记忆客厅' }).lean<SpatialSceneRecord>()
      const latest = await SceneCodeBuildModel.findOne({ scene_id: scene!.scene_id, status: 'ready' }).sort({ created_at: -1 }).lean()
      await phase('interior-recovery', `继续完成上轮尚未发布的“记忆客厅”。之前上下文裁剪丢失的持久回执已恢复：scene_id=${scene!.scene_id}，最近成功不可变构建 build_id=${latest!.build_id}，基础版本=${latest!.base_version}。这不是新建任务授权；保持原来6×5室内、门窗、木桌四脚椅、弯曲灯罩、书架实例书本、门口1.2×2.5净空与桌椅间距.25..35、落地等要求。请重新查看对应工程图和测量；必要时修源码再构建，最后原子发布。不要重建已经存在的 Scene。`)
    } else await phase('interior', '再建立独立场景“记忆客厅”，不用修改小院。直接代码建模，无付费生成：6×5室内，地板 key=floor 顶面z=0，南墙 key=south-wall 位于y=-2.5且x=0有实际门洞，西墙 key=west-wall 有实际窗洞，窗旁木桌 key=table、四脚椅 key=chair、弯曲灯罩 key=lamp，北侧有书架 key=bookshelf 和实例化书本。桌椅按常规脚支撑，不添加整块底板。留出门口x±.6、y=-2.5..0、z=0..2.2的通道并用隐藏闭合 entry-clearance 查询网格表达；椅子与桌子的最近表面间距 .25..35，两者落地。登记稳定 key，明确 required 支撑/间距/净空检查。需要时用灰模、截面或局部工程图确认门窗贯通和落地，再发布。最后说明实际检查结果和视觉上仍不确定的地方。')
    await published('记忆客厅')
    assert.ok(events.some(event => (event as { tool?: string }).tool === 'QuerySceneGeometry' || (event as { tool?: string }).tool === 'CheckSceneConstraints'))
    console.log(`LIVE AGENT ACCEPTANCE PASSED: ${output}`)
  } finally { await checkpoint(); await worker.stop(); await mongoose.disconnect() }
}
main().catch(error => { console.error(error); void mongoose.disconnect(); process.exitCode = 1 })

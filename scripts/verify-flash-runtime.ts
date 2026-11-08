/** Live, isolated application acceptance. Model requests are explicitly opt-in.
 * A local relay injects EOF/reset only into this test app's model response;
 * the production app, its configuration and its conversations are untouched. */
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { openSync, closeSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import mongoose from 'mongoose'
import { connectDB } from '../lib/db/mongodb'
import { ModelConfig } from '../lib/db/model-config-models'
import { AgentRun } from '../lib/agent-runtime/models'
import { APICallLog } from '../lib/db/api-log-models'
import { createConversation, getConversation, updateConversationFields } from '../lib/db/repository'
import { DEMO_USER_ID } from '../lib/demo-identity'
import { createScenePublicationWorkspace } from '../lib/spatial/scene-workspace'
import { SpatialSceneModel } from '../lib/spatial/models'
import { getCurrentSpatialSceneRevision } from '../lib/spatial/scene-repository'
import { getSceneCodeBuild, terminal } from '../lib/scene-code/repository'
import { observeBuild, exportSceneProject } from '../lib/scene-code/service'
import { freezeSceneCode } from '../lib/scene-code/source'
import type { SceneCodeBuild, SceneConstraint } from '../lib/scene-code/types'

const output = '/private/tmp/pegasus-flash-runtime'
const appUrl = 'http://127.0.0.1:3202'
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  assert.equal(process.env.RUN_FLASH_RUNTIME_ACCEPTANCE, '1', 'Live model calls require RUN_FLASH_RUNTIME_ACCEPTANCE=1')
  assert.equal(process.env.MONGODB_URI, 'mongodb://127.0.0.1:27021/pegasus_flash_runtime_test', 'Isolated test DB required')
  assert.ok(process.env.LLM_BASE_URL && process.env.LLM_API_KEY_ORCHESTRATOR)
  await mkdir(output, { recursive: true }); await connectDB()
  const resume = process.env.FLASH_ACCEPTANCE_RESUME === '1' ? JSON.parse(await readFile(`${output}/results.json`, 'utf8')) : null
  const registry = JSON.parse(await readFile('config/llm-registry.json', 'utf8'))
  delete registry.$schema; delete registry.$comment
  registry.aliases.main_pro = { ...registry.aliases.main_pro, realModel: 'deepseek-flash', displayName: 'DeepSeek Flash (isolated test)', supportsVision: false }
  registry.high_cost_aliases_disabled = Object.keys(registry.aliases).filter(alias => alias !== 'main_pro')
  await ModelConfig.updateOne({ config_key: 'main' }, { $set: registry }, { upsert: true })
  const conversation = resume ? await getConversation(resume.conversation_id, DEMO_USER_ID) : await createConversation(DEMO_USER_ID, { settings: { orchestrator_model: 'main_pro', memory_enabled: false } })
  assert.ok(conversation, 'Saved acceptance conversation must belong to the isolated fixture owner')
  const conversationId = conversation.conversation_id
  await updateConversationFields(conversationId, DEMO_USER_ID, { title: 'DeepSeek Flash · 隔离稳定性验收' })
  const scope = { projectId: conversationId, conversationId, userId: DEMO_USER_ID, actorId: 'root', runId: `flash-fixture-${conversationId}` }
  const workspace = await createScenePublicationWorkspace({ conversationId, userId: DEMO_USER_ID })
  const glb = await readFile('scripts/fixtures/textured-box.glb')
  if (!workspace.exists('output/spatial/objects/existing/instrument.glb')) await workspace.writeDocument({ path: 'output/spatial/objects/existing/instrument.glb', filename: 'instrument.glb', buffer: glb, mimeType: 'model/gltf-binary', source: { provider: 'local-test-fixture' }, provenance: { retrieved_at: new Date().toISOString() } })

  type Fault = { mode: 'eof' | 'reset'; fired: boolean }
  let armed: Fault | null = null
  const faults: Array<Record<string, unknown>> = resume?.faults ?? [], phases: Array<Record<string, unknown>> = resume?.phases ?? []
  let passed = false
  const upstream = process.env.LLM_BASE_URL!.replace(/\/+$/, '')
  const relay = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/messages') { res.writeHead(404).end(); return }
    const cancelled = new AbortController()
    res.on('close', () => { if (!res.writableEnded) cancelled.abort() })
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks), parsed = JSON.parse(body.toString())
      assert.equal(parsed.model, 'deepseek-flash', 'Only the user-requested model may leave the test relay')
      const response = await fetch(`${upstream}/messages`, { method: 'POST', headers: { authorization: req.headers.authorization || '', 'content-type': 'application/json' }, body, signal: cancelled.signal })
      const requestId = response.headers.get('x-request-id') || response.headers.get('x-oneapi-request-id') || ''
      res.writeHead(response.status, { 'content-type': response.headers.get('content-type') || 'text/event-stream', 'x-request-id': requestId, 'cache-control': 'no-cache' })
      if (!response.ok || !response.body) { res.end(await response.text()); return }
      reader = response.body.getReader()
      const decoder = new TextDecoder(), targetIndexes = new Set<number>()
      let pending = ''
      for (;;) {
        const chunk = await reader.read(); pending += decoder.decode(chunk.value, { stream: !chunk.done })
        for (;;) {
          const boundary = /\r?\n\r?\n/.exec(pending); if (!boundary) break
          const frame = pending.slice(0, boundary.index), wire = pending.slice(0, boundary.index + boundary[0].length)
          pending = pending.slice(wire.length)
          let event: { type?: string; index?: number; content_block?: { name?: string }; delta?: { type?: string; partial_json?: string } } = {}
          try { event = JSON.parse(frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5)).join('\n')) } catch { /* forward ping/DONE verbatim */ }
          if (event.type === 'content_block_start' && /^(Write|Edit)$/.test(event.content_block?.name || '')) targetIndexes.add(event.index!)
          if (armed && !armed.fired && targetIndexes.has(event.index!) && event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
            armed.fired = true
            faults.push({ mode: armed.mode, upstream_request_id: requestId, event: event.type, partial_input_chars: event.delta.partial_json.length, at: new Date().toISOString() })
            console.log(`[fault] Injecting ${armed.mode} during source tool JSON`)
            if (armed.mode === 'eof') {
              event.delta.partial_json = event.delta.partial_json.slice(0, Math.max(1, Math.floor(event.delta.partial_json.length / 2)))
              res.end(`data: ${JSON.stringify(event)}\n\n`)
            } else res.destroy()
            cancelled.abort(); return
          }
          res.write(wire)
        }
        if (chunk.done) { res.end(pending); return }
      }
    } catch (error) {
      if (!res.destroyed) { if (!res.headersSent) res.writeHead(502); res.end() }
      if (!cancelled.signal.aborted) console.error('[relay]', (error as Error).message)
    } finally { await reader?.cancel().catch(() => {}) }
  })
  await new Promise<void>((resolve, reject) => { relay.once('error', reject); relay.listen(3203, '127.0.0.1', resolve) })
  const beforeNextEnv = await readFile('next-env.d.ts', 'utf8')
  const beforeTsConfig = await readFile('tsconfig.json', 'utf8')
  const fd = openSync(`${output}/application.log`, 'a', 0o600)
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-H', '127.0.0.1', '-p', '3202'], {
    detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, PEGASUS_TEST_DIST_DIR: '.next-flash-test',
      LLM_BASE_URL: 'http://127.0.0.1:3203/v1', APP_PUBLIC_URL: appUrl, AGENT_RUNTIME_INTERNAL_BASE_URL: appUrl,
      MEDIA_STORAGE_DRIVER: 'gridfs', MEDIA_PUBLIC_BASE_URL: appUrl, NEXT_PUBLIC_MEDIA_CDN_BASE_URL: '',
      AHOLO_API_KEY: '', AHOLO_API_TOKEN: '', LUX3D_API_KEY: '', LUX3D_API_TOKEN: '',
      AGENT_RUNTIME_WORKERS: '2', AGENT_RUNTIME_BACKGROUND_RUNNER: '1', LLM_IMAGE_TRANSPORT: 'inline',
    },
  }); closeSync(fd)
  let lastRunId: string | undefined
  async function checkpoint() { await writeFile(`${output}/results.json`, JSON.stringify({ model: 'deepseek-flash', passed, conversation_id: conversationId, visual_quality_evaluated: false, faults, phases }, null, 2)) }
  async function post(path: string, body: unknown) {
    const response = await fetch(appUrl + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    assert.ok(response.ok, `${path}: ${response.status} ${await response.clone().text()}`)
    return response
  }
  async function finishRun(runId: string, expected: 'recoverable' | 'completed') {
    const deadline = Date.now() + 20 * 60_000
    for (;;) {
      const run = await AgentRun.findOne({ run_id: runId }).lean()
      if (run && ['recoverable', 'completed', 'failed', 'cancelled', 'waiting_user'].includes(run.status)) {
        assert.equal(run.status, expected, `${run.status}: ${run.last_error || run.termination_reason}`)
        return run
      }
      assert.ok(Date.now() < deadline, 'Test watchdog reached; does not change application thinking limits')
      await pause(500)
    }
  }
  async function phase(name: string, prompt: string, mode?: Fault['mode']) {
    const saved = phases.find(phase => phase.name === name)
    if (saved) {
      console.log(`[${name}] Rechecking completed build; no model request replay`)
      const build = await getSceneCodeBuild(String(saved.build_id), scope)
      const scene = await SpatialSceneModel.findOne({ scene_id: build.scene_id, project_id: conversationId }).lean()
      assert.ok(scene); return { scene, build }
    }
    const started = Date.now(); armed = mode ? { mode, fired: false } : null
    console.log(`[${name}] Starting real application Agent`)
    const response = await post('/api/chat', { conversation_id: conversationId, message: prompt, settings: { orchestrator_model: 'main_pro', memory_enabled: false } })
    const events = (await response.text()).split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)))
    const runId = events.find(event => event.type === 'run_started')?.run_id; assert.ok(runId); lastRunId = runId
    if (mode) {
      const interrupted = await finishRun(runId, 'recoverable'); assert.ok(armed?.fired)
      assert.equal(interrupted.current_action?.kind, 'model_request')
      const checkpointId = interrupted.checkpoint_message_id
      await pause(500)
      const error = await APICallLog.findOne({ run_id: runId, status: 'error' }).lean()
      assert.ok(error?.stream_diagnostics && ['incomplete_message', 'read_error'].includes(error.stream_diagnostics.code))
      assert.equal(error.stream_diagnostics.usage_complete, false)
      console.log(`[${name}] Recoverable; prior checkpoint retained; resuming same Run`)
      await post(`/api/chat/runs/${runId}/resume`, {})
      const complete = await finishRun(runId, 'completed'); assert.ok(complete.checkpoint_seq > interrupted.checkpoint_seq)
      phases.push({ name, run_id: runId, fault: mode, recovery_checkpoint: checkpointId, resumed_same_run: true, diagnostic: error.stream_diagnostics, elapsed_ms: Date.now() - started })
    } else { await finishRun(runId, 'completed'); phases.push({ name, run_id: runId, elapsed_ms: Date.now() - started }) }
    const scene = await SpatialSceneModel.findOne({ project_id: conversationId }).lean()
    assert.ok(scene && scene.current_version >= 2, 'Agent must actually publish a code scene')
    const revision = await getCurrentSpatialSceneRevision(scene)
    assert.ok(revision.program)
    const build = await getSceneCodeBuild(revision.program.build_id, scope)
    assert.equal(build.status, 'ready'); assert.ok(build.report!.constraints.filter(check => check.required).every(check => check.status === 'satisfied'))
    Object.assign(phases.at(-1)!, { build_id: build.build_id, scene_version: scene.current_version, objects: build.report!.snapshot.objects.length })
    await checkpoint(); return { scene, build }
  }
  try {
    const deadline = Date.now() + 90_000
    for (;;) { try { if ((await fetch(appUrl + '/api/health')).ok) break } catch { /* dev warmup */ } assert.ok(Date.now() < deadline); await pause(500) }
    await fetch(appUrl + '/api/models'); await pause(1000)
    const models = await (await fetch(appUrl + '/api/models')).json()
    assert.ok(models.some((model: { name: string }) => model.name.includes('DeepSeek Flash')), 'Isolated registry must be active before model calls')
    const initial = await phase('source-build-eof', `这是代码建模与恢复验收，请直接实施，不提问，不调用任何图片或3D付费生成。只创建一个 Scene，名称 Flash稳定性院落。使用多文件 Three.js 源码搭建 8×6 院落，Z向上，相对单位。地面key=floor顶面z=0，南墙key=south-wall位于y=-3，有中心宽1.6高2.2真正贯通的门洞；可用分段墙或自由几何。木长凳key=bench由座板和四条正常支腿组成，放在入口左侧，离南墙表面0.35..0.45，落在地面上。保留入口x±0.8、y=-3..-0.5、z=0..2.2净空，用隐藏闭合网格key=entry-clearance表示。增加带斜屋顶的小廊、用LatheGeometry创建的花盆，并把现有GLB output/spatial/objects/existing/instrument.glb 放在不挡路的位置。要求bench落地、长凳墙距和入口对全部物体净空；将这些明确要求写成检查，运行构建、读取测量、修正后发布。入口预留网格仅用于检查。主模型本轮不评图片美术质量，使用测量检查空间关系，交付需真实发布。`, 'eof')
    const benchBefore = initial.build.report!.snapshot.objects.find(object => object.key === 'bench')!
    const modified = await phase('selected-edit-reset', '只修改现有 bench：把长凳移到入口右侧，保持离南墙0.35..0.45和落地，改成深绿色，其余物体保留。修改源码、重新构建测量并发布。不要创建新Scene，也不要调用付费生成。', 'reset')
    const benchAfter = modified.build.report!.snapshot.objects.find(object => object.key === 'bench')!
    assert.notDeepEqual(benchAfter.measured.bounds, benchBefore.measured.bounds, 'Physical bounds must move even when geometry is repositioned inside a stationary Group')
    assert.ok((benchAfter.measured.bounds!.min[0] + benchAfter.measured.bounds!.max[0]) / 2 > .8, 'Bench must be to the right of the entrance')
    assert.ok(benchAfter.measured.materials.some(material => { const color = material.color?.replace('#', '') || ''; return color.length === 6 && parseInt(color.slice(2, 4), 16) > parseInt(color.slice(0, 2), 16) * 1.2 }), 'Bench must be green')
    const editWorkspace = await createScenePublicationWorkspace({ conversationId, userId: DEMO_USER_ID })
    const entry = modified.build.entry_path
    let brokenId = ''
    if (!phases.some(phase => phase.name === 'compile-error-repair')) {
      await editWorkspace.writeText(entry, (await editWorkspace.readText(entry)) + '\nexport const = ; // intentional acceptance syntax fault\n')
      const broken = await freezeSceneCode({ identity: { ...scope, toolUseId: 'intentional-syntax-fault' }, workspace: editWorkspace, sceneId: modified.scene.scene_id })
      brokenId = broken.build_id
      const buildDeadline = Date.now() + 130_000
      let failedBuild: SceneCodeBuild
      for (;;) { failedBuild = await getSceneCodeBuild(broken.build_id, scope); if (terminal(failedBuild.status)) break; assert.ok(Date.now() < buildDeadline); await pause(300) }
      assert.equal(failedBuild.status, 'failed')
      assert.equal((await SpatialSceneModel.findOne({ scene_id: modified.scene.scene_id }).lean())!.current_version, modified.scene.current_version)
    }
    const repaired = await phase('compile-error-repair', `验收中在 ${entry} 末尾注入了一行语法错误。失败构建为 ${brokenId}；已发布场景仍需可用。请检查错误并修复，保留当前院落和绿色长凳布局，重新运行与验证后发布。不要新建Scene，不调用付费生成。`)
    const checks: SceneConstraint[] = [{ id: 'independent-bench-support', kind: 'support', object_keys: ['bench', 'floor'], tolerance: .02 }, { id: 'independent-bench-gap', kind: 'distance', object_keys: ['bench', 'south-wall'], min: .35, max: .45 }]
    for (const object of repaired.build.report!.snapshot.objects.filter(object => object.measured.in_scene && !['floor', 'entry-clearance'].includes(object.key))) checks.push({ id: `independent-route-${object.key}`, kind: 'keep_clear', object_keys: ['entry-clearance', object.key] })
    const measured = await observeBuild(repaired.build, { kind: 'check', constraints: checks }, editWorkspace)
    assert.ok(measured.constraints!.every(check => check.status === 'satisfied'), JSON.stringify(measured.constraints))
    await writeFile(`${output}/project.zip`, await exportSceneProject(repaired.build))
    const logs = await APICallLog.find({ conversation_id: conversationId }).select('model status duration_ms output_tokens tool_calls stream_diagnostics turn_number').lean()
    assert.ok(logs.every(log => log.model === 'deepseek-flash'))
    assert.equal(await mongoose.connection.db!.collection('spatial_build_jobs').countDocuments({ project_id: conversationId }), 0)
    assert.equal(await mongoose.connection.db!.collection('spatial_image_generation_receipts').countDocuments({ project_id: conversationId }), 0)
    await writeFile(`${output}/calls.json`, JSON.stringify(logs, null, 2))
    passed = true; await checkpoint(); console.log(`FLASH LIVE ACCEPTANCE PASSED: ${output}`)
  } finally {
    await checkpoint()
    if (lastRunId) await fetch(appUrl + '/api/chat/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversation_id: conversationId, run_id: lastRunId }) }).catch(() => {})
    if (child.pid) { try { process.kill(-child.pid, 'SIGTERM') } catch { /* already exited */ } }
    relay.closeAllConnections(); await new Promise<void>(resolve => relay.close(() => resolve()))
    await writeFile('next-env.d.ts', beforeNextEnv)
    const config = JSON.parse(await readFile('tsconfig.json', 'utf8'))
    if (config.include?.some((entry: string) => entry.startsWith('.next-flash-test/'))) {
      config.include = config.include.filter((entry: string) => !entry.startsWith('.next-flash-test/'))
      await writeFile('tsconfig.json', isDeepStrictEqual(config, JSON.parse(beforeTsConfig)) ? beforeTsConfig : JSON.stringify(config, null, 2) + '\n')
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => mongoose.disconnect())

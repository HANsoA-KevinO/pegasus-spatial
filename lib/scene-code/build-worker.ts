import { randomUUID } from 'node:crypto'
import { compileSceneCode } from './compiler'
import { readSceneBlob, SceneCodeBuildModel, SceneCodeSlotModel, writeSceneBlob } from './repository'
import { executeSceneCapsule } from './renderer-client'
import { defaultBuildWorkspace, mapSceneStack, storeSceneViews } from './service'
import { sceneSourceRoot } from './source'
import type { SceneCodeBuild, SceneCodeReport } from './types'
import { connectDB } from '../db/mongodb'
import { AgentTeamModel } from '../agent-team/models'
import type { AgentTeamRecord } from '../agent-team/types'
import { wakeRootWithUpdate } from '../agent-team/orchestrator'

export async function deliverSceneCodeNotifications() {
  const builds = await SceneCodeBuildModel.find({ status: { $in: ['ready', 'failed', 'cancelled'] }, notify_requested: true, notified_at: null }).limit(20).lean<SceneCodeBuild[]>()
  for (const build of builds) {
    const team = await AgentTeamModel.findOne({ conversation_id: build.conversation_id, user_id: build.user_id, status: 'active' }).lean<AgentTeamRecord>()
    if (!team) continue
    await wakeRootWithUpdate({ team, deliveryKey: `scene-code-terminal:v1:${build.build_id}`, sourceIds: [build.build_id], content: `后台源码构建状态更新（持久事件，不是新的用户授权，也不是原工具的第二个结果）：\n${JSON.stringify({ event: 'scene_code_build_update', build_id: build.build_id, scene_id: build.scene_id, status: build.status, error: build.error, constraints: build.report?.constraints.map(check => ({ id: check.id, status: check.status, required: check.required })) })}\n请用 InspectSceneBuild 查看产物图片与测量，修复违反或无法验证的必要约束，再发布。` })
    await SceneCodeBuildModel.updateOne({ build_id: build.build_id, notified_at: null }, { $set: { notified_at: new Date() } })
  }
}
export function startSceneCodeWorker() {
  const owner = randomUUID()
  let stopped = false, working = false, indexed = false, active: AbortController | undefined
  const tick = async () => {
    if (stopped || working) return
    working = true
    let ownsSlot = false
    try {
      await connectDB()
      if (!indexed) { await Promise.all([SceneCodeBuildModel.syncIndexes(), SceneCodeSlotModel.syncIndexes()]); indexed = true }
      await SceneCodeSlotModel.updateOne({ _id: 'default' }, { $setOnInsert: { owner: '', expires_at: new Date(0) } }, { upsert: true })
      const slot = await SceneCodeSlotModel.findOneAndUpdate({ _id: 'default', expires_at: { $lte: new Date() } }, { $set: { owner, expires_at: new Date(Date.now() + 15_000) } }, { returnDocument: 'after' })
      if (!slot) return
      ownsSlot = true
      await SceneCodeBuildModel.updateMany({ status: { $in: ['compiling', 'running', 'checking'] }, 'lease.expires_at': { $lt: new Date() }, attempts: { $lt: 3 } }, { $set: { status: 'queued', lease: null, error: 'Renderer lease expired; recovering frozen build' } })
      await SceneCodeBuildModel.updateMany({ status: { $in: ['compiling', 'running', 'checking'] }, 'lease.expires_at': { $lt: new Date() }, attempts: { $gte: 3 } }, { $set: { status: 'failed', lease: null, error: 'Build interrupted three times; no further automatic retry' } })
      const leaseToken = randomUUID()
      const build = await SceneCodeBuildModel.findOneAndUpdate({ status: 'queued' }, { $set: { status: 'compiling', lease: { owner, token: leaseToken, expires_at: new Date(Date.now() + 15_000) } }, $inc: { attempts: 1 } }, { returnDocument: 'after', sort: { created_at: 1 } }).lean<SceneCodeBuild>()
      if (build) {
        const controller = new AbortController(); active = controller
        const timeout = setTimeout(() => controller.abort(new Error('Build exceeded 120 seconds')), 120_000)
        let heartbeatBusy = false
        const heartbeat = setInterval(async () => {
          if (heartbeatBusy) return
          heartbeatBusy = true
          try {
            const updated = await SceneCodeBuildModel.updateOne({ build_id: build.build_id, 'lease.token': leaseToken, status: { $nin: ['cancelled', 'failed'] } }, { $set: { 'lease.expires_at': new Date(Date.now() + 15_000) } })
            if (!updated.matchedCount) controller.abort(new Error('Build cancelled or lease lost'))
            await SceneCodeSlotModel.updateOne({ _id: 'default', owner }, { $set: { expires_at: new Date(Date.now() + 15_000) } })
          } catch (error) { controller.abort(error) } finally { heartbeatBusy = false }
        }, 1000)
        const filter = { build_id: build.build_id, 'lease.token': leaseToken, status: { $nin: ['cancelled', 'failed'] as const } }
        try {
          const compiled = await compileSceneCode({ entryPath: build.entry_path, sources: build.sources, root: sceneSourceRoot(build.scene_id) })
          controller.signal.throwIfAborted()
          build.bundle_blob_id = await writeSceneBlob(Buffer.from(compiled.bundle), build, 'bundle')
          build.source_map_blob_id = await writeSceneBlob(Buffer.from(compiled.sourceMap), build, 'source-map')
          await SceneCodeBuildModel.updateOne(filter, { $set: { status: 'running', bundle_blob_id: build.bundle_blob_id, source_map_blob_id: build.source_map_blob_id } })
          const report = await executeSceneCapsule(build, id => readSceneBlob(id, build), undefined, controller.signal) as unknown as SceneCodeReport
          controller.signal.throwIfAborted()
          await SceneCodeBuildModel.updateOne(filter, { $set: { status: 'checking' } })
          for (const object of report.snapshot.objects) { Object.assign(object.source, mapSceneStack(object.source.stack, compiled.sourceMap)); delete object.source.stack }
          const workspace = await defaultBuildWorkspace(build)
          report.montage = await storeSceneViews(build, report.views, workspace)
          controller.signal.throwIfAborted()
          await SceneCodeBuildModel.updateOne(filter, { $set: { status: 'ready', report, error: null, failure: null, lease: null } })
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause))
          let source: ReturnType<typeof mapSceneStack>
          if (build.source_map_blob_id) source = mapSceneStack(error.stack, (await readSceneBlob(build.source_map_blob_id, build)).toString())
          const compilerError = (cause as { errors?: Array<{ location?: { file: string; line: number; column: number } }> }).errors?.[0]?.location
          if (compilerError) source = { path: compilerError.file.replace(/^scene-source:/, ''), line: compilerError.line, column: compilerError.column + 1 }
          await SceneCodeBuildModel.updateOne(filter, { $set: { status: stopped ? 'queued' : 'failed', error: error.message.slice(0, 12000), failure: { stage: build.bundle_blob_id ? 'execute' : 'compile', ...source, stack: error.stack?.slice(0, 12000) }, lease: null } })
        } finally { clearTimeout(timeout); clearInterval(heartbeat); active = undefined }
      }
      await deliverSceneCodeNotifications()
    } catch (error) { console.error('[scene-code]', error instanceof Error ? error.message : String(error)) }
    finally { if (ownsSlot) await SceneCodeSlotModel.updateOne({ _id: 'default', owner }, { $set: { expires_at: new Date(0) } }).catch(() => {}); working = false }
  }
  const timer = setInterval(() => { void tick() }, 1000); timer.unref(); void tick()
  return { async stop() { stopped = true; clearInterval(timer); active?.abort(new Error('Service shutdown; build will recover')); while (working) await new Promise(resolve => setTimeout(resolve, 50)) } }
}

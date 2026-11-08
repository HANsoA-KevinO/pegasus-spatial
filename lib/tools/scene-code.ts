import { randomUUID } from 'node:crypto'
import type { ToolResult } from '../types'
import type { SpatialSceneToolRuntime } from './spatial-scene'
import type { SceneMutationIdentity } from '../spatial/scene-types'
import { freezeSceneCode, prepareSceneCode } from '../scene-code/source'
import { getSceneCodeBuild, SceneCodeBuildModel, terminal } from '../scene-code/repository'
import { exportSceneProject, observeBuild, publishSceneBuild, resolveBuildTarget } from '../scene-code/service'
import type { SceneCodeBuild, SceneCodeToolName, SceneConstraint, SceneGeometryQuery, SceneViewRequest } from '../scene-code/types'
import { inspectFeedback, runFeedback, compactCheck, compactView, buildLegend } from '../scene-code/feedback'
import { validateSceneConstraints } from '../scene-code/acceptance'

function payload(value: Record<string, unknown>, media: NonNullable<ToolResult['media']> = [], error = false): ToolResult { return { content: JSON.stringify({ schema_version: 1, kind: 'scene_code', ...value }), ...(media.length ? { media } : {}), ...(error ? { is_error: true } : {}) } }
function buildImages(build: SceneCodeBuild) { return build.report?.montage ? [build.report.montage.image] : build.report?.views.flatMap(view => view.image ? [view.image] : []) ?? [] }
export async function executeSceneCodeTool(name: SceneCodeToolName, input: Record<string, unknown>, runtime: SpatialSceneToolRuntime): Promise<ToolResult> {
  let observedRef: Record<string, unknown> = {}
  try {
    const context = runtime.executionContext, invocation = runtime.invocation, workspace = runtime.workspace
    if (!context || !invocation || !workspace) throw new Error('Code tools require a durable Agent context and authorized workspace')
    const identity: SceneMutationIdentity = { projectId: context.workspaceId || context.conversationId, userId: context.userId, conversationId: context.conversationId, runId: context.runId, toolUseId: invocation.toolUseId, actorId: context.agentId || context.agentAlias || 'root' }
    if (name === 'PrepareSceneCode') return payload(await prepareSceneCode(String(input.scene_id), identity, workspace))
    if (name === 'RunSceneCode') {
      if (input.acceptance_update && !context.isRoot) throw new Error('Only Root can map a new authenticated user request to changed acceptance conditions')
      let build = await freezeSceneCode({ identity, workspace, sceneId: String(input.scene_id), entryPath: input.entry_path as string | undefined, assetsPath: input.assets_path as string | undefined, checksPath: input.checks_path as string | undefined, seed: input.seed as number | undefined, constraints: input.constraints as SceneConstraint[] | undefined, acceptanceUpdate: input.acceptance_update as { expected_version: number; reason: string } | undefined })
      const cancelled = () => { void SceneCodeBuildModel.updateOne({ build_id: build.build_id, status: { $nin: ['ready', 'failed', 'cancelled'] } }, { $set: { status: 'cancelled', lease: null, error: 'Agent operation cancelled' } }) }
      runtime.signal?.addEventListener('abort', cancelled, { once: true })
      try {
        const deadline = Date.now() + 14_000
        while (!terminal(build.status) && Date.now() < deadline && !runtime.signal?.aborted) { await new Promise(resolve => setTimeout(resolve, 200)); build = await getSceneCodeBuild(build.build_id, identity) }
        if (runtime.signal?.aborted) { cancelled(); return payload({ status: 'cancelled', build_id: build.build_id }) }
      } finally { runtime.signal?.removeEventListener('abort', cancelled) }
      if (!terminal(build.status)) {
        await SceneCodeBuildModel.updateOne({ build_id: build.build_id }, { $set: { notify_requested: true } })
        return payload({ status: build.status, build_id: build.build_id, scene_id: build.scene_id, base_version: build.base_version, pending: true, completion: 'A durable terminal notification will resume the Agent. Do not poll.' })
      }
      return payload(runFeedback(build), buildImages(build), build.status === 'failed')
    }
    if (name === 'InspectSceneBuild') {
      const build = await getSceneCodeBuild(String(input.build_id), identity)
      return payload(inspectFeedback(build, input), buildImages(build))
    }
    const target = await resolveBuildTarget(input as { build_id?: string; scene_id?: string; revision_id?: string }, identity)
    const version = { build_id: target.build.build_id, revision_id: target.revision_id, scene_id: target.build.scene_id, time_s: Math.round(Number(input.time_s ?? 0) * 30) / 30 }
    observedRef = version
    if (name === 'PublishSceneBuild') return payload(await publishSceneBuild(target.build, identity, Number(input.expected_scene_version), String(input.change_summary)))
    if (name === 'ExportSceneBuild') {
      if (target.build.status !== 'ready') throw new Error('Export requires a ready build')
      let bytes: Buffer, mimeType: string, extension: string
      if (input.format === 'project') { bytes = await exportSceneProject(target.build); mimeType = 'application/zip'; extension = 'zip' }
      else {
        const result = await observeBuild(target.build, { kind: 'export', time_s: version.time_s, format: 'glb' }, workspace, runtime.signal)
        const exported = (result as unknown as { export: { status: string; bytes_base64?: string } }).export
        if (exported.status !== 'exported') return payload({ ...version, ...exported })
        bytes = Buffer.from(exported.bytes_base64!, 'base64'); mimeType = 'model/gltf-binary'; extension = 'glb'
      }
      const path = `output/spatial/builds/${target.build.build_id}/exports/${randomUUID().slice(0, 8)}.${extension}`
      const document = await workspace.writeDocument({ path, filename: path.split('/').pop()!, buffer: bytes, mimeType, source: { provider: 'scene-code' }, provenance: { retrieved_at: new Date().toISOString(), version: target.build.build_id } })
      const stageOnlyPly = input.format === 'project' ? target.build.assets.filter(asset => asset.preview_only).length : 0
      return payload({ ...version, status: 'exported', format: input.format, document, ...(stageOnlyPly ? { stage_only_ply_excluded: stageOnlyPly } : {}) })
    }
    const operation = name === 'RenderSceneViews' ? { kind: 'render' as const, views: input.views as SceneViewRequest[] | undefined } : name === 'QuerySceneGeometry' ? { kind: 'query' as const, queries: input.queries as SceneGeometryQuery[] } : { kind: 'check' as const, constraints: validateSceneConstraints(input.constraints) }
    const observed = await observeBuild(target.build, { ...operation, time_s: version.time_s }, workspace, runtime.signal)
    const media = observed.views?.length === 1 ? observed.views.flatMap(view => view.image ? [view.image] : []) : observed.montage ? [observed.montage.image] : []
    const failures = observed.view_errors ?? []
    const status = failures.length ? observed.views?.length ? 'partial' : failures.every(error => error.code === 'camera_not_found' || error.code === 'invalid_view_request') ? 'invalid_view_request' : 'execution_failed' : 'observed'
    return payload({ ...version, ...observed, status, snapshot: undefined, constraints: observed.constraints?.map(compactCheck), views: observed.views?.map(compactView), legend: buildLegend(observed.views ?? []), units: 'relative_scene_units' }, media, ['invalid_view_request', 'execution_failed'].includes(status))
  } catch (cause) { return payload({ ...observedRef, status: 'failed', error: cause instanceof Error ? cause.message : String(cause) }, [], true) }
}

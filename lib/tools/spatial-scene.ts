import { createHash } from 'node:crypto'
import { getSceneCodeBuild } from '../scene-code/repository'
import { observeBuild } from '../scene-code/service'
import { prepareSceneCode } from '../scene-code/source'
import { RETIRED_SCENE_EDIT_TOOLS } from '../scene-code/types'
import type { WorkspaceInstance } from '../workspace/types'
import type { AgentExecutionContext, ToolExecutionInvocation } from '../agent/execution-context'
import type { ToolResult } from '../types'
import {
  createSpatialScene,
  createSpatialObservation,
  getCurrentSpatialSceneRevision,
  listSpatialSceneHistory,
  mutateSpatialScene,
  requireSpatialScene,
  restoreSpatialSceneRevision,
  setSpatialSceneViewpoint,
} from '../spatial/scene-repository'
import { normalizeViewpoint } from '../spatial/scene-math'
import type {
  SceneCommandScope,
  SceneMutationIdentity,
  SpatialSceneRecord,
  SpatialSceneRevisionRecord,
  Vec3,
} from '../spatial/scene-types'

export const SPATIAL_SCENE_TOOL_NAMES = [
  'CreateSpatialScene',
  'SetSceneEnvironment',
  'SetSceneWorld',
  'AddSceneTerrain',
  'AddSceneObject',
  'TransformSceneObject',
  'RemoveSceneObject',
  'ApplySceneSpec',
  'InspectSpatialScene',
  'RestoreSpatialScene',
  'SetSceneViewpoint',
  'FocusSceneObject',
  'CaptureSceneView',
  'QuerySceneSurface',
] as const
export type SpatialSceneToolName = typeof SPATIAL_SCENE_TOOL_NAMES[number]

export interface SpatialSceneToolRuntime {
  executionContext?: AgentExecutionContext
  invocation?: ToolExecutionInvocation
  signal?: AbortSignal
  workspace?: WorkspaceInstance
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('工具输入必须是对象。')
  return value as Record<string, unknown>
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys)
  if (Object.keys(value).some(key => !allowed.has(key))) throw new TypeError('工具输入包含未知字段。')
}
function text(label: string, value: unknown, max = 400): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} 必须是非空字符串。`)
  if (value.trim().length > max) throw new TypeError(`${label} 不能超过 ${max} 个字符。`)
  return value.trim()
}
function context(runtime: SpatialSceneToolRuntime): {
  identity: SceneMutationIdentity
  scope: SceneCommandScope
  context: AgentExecutionContext
  invocation: ToolExecutionInvocation
} {
  const execution = runtime.executionContext
  const invocation = runtime.invocation
  if (!execution || !invocation) throw new TypeError('Scene 工具需要持久化的 Agent 执行上下文。')
  const projectId = execution.workspaceId || execution.conversationId
  return {
    identity: {
      projectId,
      userId: execution.userId,
      conversationId: execution.conversationId,
      runId: execution.runId,
      toolUseId: invocation.toolUseId,
      actorId: execution.agentId || execution.agentAlias || 'root',
    },
    scope: { projectId, userId: execution.userId, conversationId: execution.conversationId },
    context: execution,
    invocation,
  }
}
function result(value: Record<string, unknown>, error = false): ToolResult {
  return { content: JSON.stringify({ schema_version: 1, ...value }), ...(error ? { is_error: true } : {}) }
}
function failure(error: unknown): ToolResult {
  const candidate = error as { code?: unknown; message?: unknown }
  return result({
    kind: 'scene',
    status: candidate.code === 'SPATIAL_SCENE_COMMAND_REJECTED' ? 'scene_changed' : 'failed',
    error: typeof candidate.message === 'string' ? candidate.message.slice(0, 4000) : 'Scene 工具执行失败。',
  }, true)
}
function revisionPayload(scene: SpatialSceneRecord, revision: SpatialSceneRevisionRecord, replayed = false): Record<string, unknown> {
  return {
    kind: 'scene', status: 'applied', scene_id: scene.scene_id, scene_version: scene.current_version,
    change_summary: revision.change_summary, replayed,
  }
}
function mutationPayload(value: Awaited<ReturnType<typeof mutateSpatialScene>>): ToolResult {
  if (value.status === 'scene_changed') return result({
    kind: 'scene', status: 'scene_changed', scene_id: value.scene.scene_id,
    scene_version: value.scene.current_version,
    error: 'Scene 已被其他修改更新；请 InspectSpatialScene 核对当前版本后重试。',
  }, true)
  return result(revisionPayload(value.scene, value.revision, value.replayed))
}
function finiteNumber(label: string, value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} 必须是有限数字。`)
  return value
}

function pair(label: string, value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError(`${label} 必须是两个有限数字。`)
  return [finiteNumber(`${label}[0]`, value[0]), finiteNumber(`${label}[1]`, value[1])]
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]))
  }
  return value
}

function commandHash(name: SpatialSceneToolName, input: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonical({ name, input }))).digest('hex')
}

export async function executeSpatialSceneTool(
  name: SpatialSceneToolName,
  rawInput: unknown,
  runtime: SpatialSceneToolRuntime,
): Promise<ToolResult> {
  try {
    const input = record(rawInput)
    const durable = context(runtime)
    if (RETIRED_SCENE_EDIT_TOOLS.has(name)) return result({ kind: 'scene_code', status: 'source_edit_required', scene_id: input.scene_id, instruction: 'Declarative Scene editing is retired. Use CreateSpatialScene for a prepared code project, or PrepareSceneCode for source recovery. Write/Edit Three.js source and assets.json, RunSceneCode, then PublishSceneBuild.' }, true)
    if (typeof input.scene_id === 'string' && name !== 'CreateSpatialScene') {
      const scene = await requireSpatialScene(input.scene_id, durable.scope)
      const revision = await getCurrentSpatialSceneRevision(scene)
      if (revision.program) {
        if (name === 'FocusSceneObject') {
          const object = revision.program.objects.find(object => object.key === input.instance_id), bounds = object?.measured.bounds
          if (!bounds) throw new Error('Unknown object key or no measurable bounds')
          const target = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2) as Vec3
          const distance = Math.max(...bounds.size, .1) * (input.framing === 'close' ? 1.8 : input.framing === 'wide' ? 5 : 3)
          const viewpoint = normalizeViewpoint({ target, position: [target[0] + distance, target[1] - distance, target[2] + distance * .7], up: [0, 0, 1], fov_deg: 45 })
          await setSpatialSceneViewpoint({ scope: durable.scope, sceneId: scene.scene_id, viewpoint })
          return result({ status: 'applied', build_id: revision.program.build_id, revision_id: revision.revision_id, object_key: object!.key, time_s: 0, viewpoint })
        }
        if (name === 'CaptureSceneView' || name === 'QuerySceneSurface') {
          if (!runtime.workspace) throw new Error('Authorized workspace is required')
          const build = await getSceneCodeBuild(revision.program.build_id, durable.scope)
          if (name === 'QuerySceneSurface') {
            const horizontal = pair('horizontal', input.horizontal), height = finiteNumber('cast_height', input.cast_height, 1000)
            const observed = await observeBuild(build, { kind: 'query', queries: [{ kind: 'raycast', object_keys: [String(input.terrain_instance_id)], origin: [horizontal[0], horizontal[1], height], direction: [0, 0, -1] }] }, runtime.workspace, runtime.signal)
            return result({ status: 'observed', build_id: build.build_id, revision_id: revision.revision_id, time_s: 0, ...observed })
          }
          const observed = await observeBuild(build, { kind: 'render', views: [scene.agent_viewpoint ? { camera: { ...scene.agent_viewpoint, name: 'agent' } } : { preset: 'overview' }] }, runtime.workspace, runtime.signal)
          const view = observed.views![0]
          const observation = await createSpatialObservation({ observation_id: `observation_${createHash('sha256').update(`${durable.identity.runId}:${durable.identity.toolUseId}`).digest('hex').slice(0, 32)}`, scene_id: scene.scene_id, project_id: scene.project_id, user_id: scene.user_id, revision_id: revision.revision_id, build_id: build.build_id, time_s: view.time_s, source: 'agent', viewpoint: view.camera, screenshot_asset_id: view.image!.assetId, screenshot_workspace_path: view.workspace_path!, selected_instance_id: null, visible_instance_ids: view.visible_keys, comment: String(input.note ?? 'Agent observation') })
          return { content: JSON.stringify({ kind: 'scene_observation', status: 'captured', build_id: build.build_id, revision_id: revision.revision_id, observation }), media: [view.image!] }
        }
      } else if (['FocusSceneObject', 'CaptureSceneView', 'QuerySceneSurface'].includes(name)) return result({ kind: 'scene_code', status: 'code_build_required', scene_id: scene.scene_id, instruction: 'Run and publish a code build first, or use RenderSceneViews / QuerySceneGeometry with a ready build_id. No active user stage is required.' }, true)
    }
    switch (name) {
      case 'CreateSpatialScene': {
        onlyKeys(input, ['title'])
        if (!runtime.workspace) throw new TypeError('创建代码场景需要受权 Workspace。')
        const created = await createSpatialScene({ identity: durable.identity, title: text('title', input.title, 160), commandHash: commandHash(name, input) })
        if (created.status !== 'applied') return mutationPayload(created)
        const project = await prepareSceneCode(created.scene.scene_id, durable.identity, runtime.workspace)
        return result({ ...project, ...revisionPayload(created.scene, created.revision, created.replayed), mode: 'code', instruction: 'Source project is ready. Write/Edit the returned entry_path and assets_path; PrepareSceneCode is only needed for recovery. RunSceneCode to build and observe, then PublishSceneBuild.' })
      }
      case 'InspectSpatialScene': {
        onlyKeys(input, ['scene_id', 'revision_version', 'include_history'])
        const scene = await requireSpatialScene(text('scene_id', input.scene_id, 160), durable.scope)
        let revision = await getCurrentSpatialSceneRevision(scene)
        if (input.revision_version !== undefined) {
          if (!Number.isInteger(input.revision_version) || Number(input.revision_version) < 1) throw new TypeError('revision_version 必须是正整数。')
          const history = await listSpatialSceneHistory(scene.scene_id, durable.scope)
          const selected = history.find(candidate => candidate.version === Number(input.revision_version))
          if (!selected) throw new TypeError('找不到指定的历史 Scene version。')
          revision = selected
        }
        const history = input.include_history === true
          ? (await listSpatialSceneHistory(scene.scene_id, durable.scope)).map(item => ({ version: item.version, change_summary: item.change_summary, created_at: item.created_at, restorable: !!item.program }))
          : undefined
        return result({
          kind: 'scene', status: 'inspected', scene_id: scene.scene_id, scene_version: revision.version,
          title: scene.title, revision_id: revision.revision_id, program: revision.program ?? null, environment: revision.environment ?? null, world: revision.world, instances: revision.instances,
          mode: revision.program ? 'code' : 'awaiting_code_publication', ...(!revision.program ? { instruction: 'No code build is published for this revision. PrepareSceneCode starts an empty source project; declarative data is not automatically imported.' } : {}),
          agent_viewpoint: scene.agent_viewpoint, ...(history ? { history } : {}),
        })
      }
      case 'RestoreSpatialScene': {
        onlyKeys(input, ['scene_id', 'revision_version'])
        if (!Number.isInteger(input.revision_version) || Number(input.revision_version) < 1) throw new TypeError('revision_version 必须是正整数。')
        const history = await listSpatialSceneHistory(text('scene_id', input.scene_id, 160), durable.scope)
        if (!history.find(item => item.version === Number(input.revision_version))?.program) return result({ kind: 'scene_code', status: 'unsupported_history', scene_id: input.scene_id, instruction: 'Only published code build revisions can be restored. Declarative history is retained as data, without automatic conversion.' }, true)
        return mutationPayload(await restoreSpatialSceneRevision({
          identity: durable.identity, sceneId: text('scene_id', input.scene_id, 160), version: Number(input.revision_version),
          commandHash: commandHash(name, input),
        }))
      }
      case 'SetSceneViewpoint': {
        onlyKeys(input, ['scene_id', 'position', 'target', 'up', 'fov_deg'])
        const viewpoint = normalizeViewpoint({ position: input.position, target: input.target, up: input.up, fov_deg: input.fov_deg })
        const scene = await setSpatialSceneViewpoint({ scope: durable.scope, sceneId: text('scene_id', input.scene_id, 160), viewpoint })
        return result({ kind: 'scene_viewpoint', status: 'applied', scene_id: scene.scene_id, scene_version: scene.current_version, viewpoint })
      }
      default: throw new TypeError('Scene 工具输入不完整；场景修改请使用源码构建流程。')
    }
  } catch (error) {
    return failure(error)
  }
}

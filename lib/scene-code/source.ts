import { randomUUID } from 'node:crypto'
import { normalizeWorkspacePath, isInternalWorkspacePath } from '../workspace/path-policy'
import type { WorkspaceInstance } from '../workspace/types'
import type { SceneMutationIdentity } from '../spatial/scene-types'
import { getCurrentSpatialSceneRevision, requireSpatialScene } from '../spatial/scene-repository'
import { SpatialArtifactNodeModel } from '../spatial/models'
import { SCENE_CODE_DEPENDENCIES, SCENE_CODE_RUNTIME_VERSION, type SceneCodeAsset, type SceneCodeBuild, type SceneConstraint, type FrozenCodeSource } from './types'
import { findScenePreviewBlob, SceneCodeBuildModel, sha256, writeSceneBlob } from './repository'
import { getSceneCodeBuild } from './repository'
import { connectDB } from '../db/mongodb'
import { freezeSceneAcceptance, validateSceneConstraints } from './acceptance'
import { sceneAssetManifest } from './types'
import { createSceneCodeTemplate } from './template'

export function sceneSourceRoot(sceneId: string) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(sceneId)) throw new Error('Invalid scene_id')
  return `output/spatial/scenes/${sceneId}`
}
export async function prepareSceneCode(sceneId: string, identity: SceneMutationIdentity, workspace: WorkspaceInstance) {
  const scene = await requireSpatialScene(sceneId, identity), revision = await getCurrentSpatialSceneRevision(scene)
  const root = sceneSourceRoot(sceneId), entry = `${root}/main.ts`, assetsPath = `${root}/assets.json`
  if (workspace.exists(entry) && workspace.exists(assetsPath)) return { status: 'prepared', entry_path: entry, assets_path: assetsPath, scene_id: sceneId, base_version: scene.current_version, reused: true }
  if (revision.program) {
    const build = await getSceneCodeBuild(revision.program.build_id, identity)
    for (const source of build.sources) if (!workspace.exists(source.path)) await workspace.writeText(source.path, source.content)
    return { status: 'prepared', scene_id: sceneId, entry_path: build.entry_path, assets_path: build.assets_path, base_version: scene.current_version, restored_build: build.build_id }
  }
  // Missing members only: retrying Prepare never overwrites the Agent's code.
  if (!workspace.exists(assetsPath)) await workspace.writeText(assetsPath, JSON.stringify({ assets: [] }, null, 2))
  if (!workspace.exists(entry)) await workspace.writeText(entry, createSceneCodeTemplate())
  if (!workspace.exists(`${root}/checks.json`)) await workspace.writeText(`${root}/checks.json`, JSON.stringify({ constraints: [] }, null, 2))
  return { status: 'prepared', scene_id: sceneId, entry_path: entry, assets_path: assetsPath, checks_path: `${root}/checks.json`, base_version: scene.current_version, mode: 'code', previous_content_imported: false, published: false }
}
export async function freezeSceneCode(input: { identity: SceneMutationIdentity; workspace: WorkspaceInstance; sceneId: string; entryPath?: string; assetsPath?: string; checksPath?: string; seed?: number; constraints?: SceneConstraint[]; acceptanceUpdate?: { expected_version: number; reason: string } }): Promise<SceneCodeBuild> {
  const { identity, workspace } = input
  await connectDB()
  const requestHash = sha256(JSON.stringify({ sceneId: input.sceneId, entryPath: input.entryPath, assetsPath: input.assetsPath, checksPath: input.checksPath, seed: input.seed ?? 1, constraints: input.constraints ?? [], acceptanceUpdate: input.acceptanceUpdate }))
  const prior = await SceneCodeBuildModel.findOne({ project_id: identity.projectId, user_id: identity.userId, run_id: identity.runId, tool_use_id: identity.toolUseId }).lean<SceneCodeBuild>()
  if (prior) { if (prior.request_hash !== requestHash) throw new Error('This tool call is already bound to different build arguments'); return prior }
  const scene = await requireSpatialScene(input.sceneId, identity), root = sceneSourceRoot(input.sceneId)
  const entry = normalizeWorkspacePath(input.entryPath || `${root}/main.ts`), assetsPath = normalizeWorkspacePath(input.assetsPath || `${root}/assets.json`)
  if (!entry.startsWith(root + '/') || !assetsPath.startsWith(root + '/')) throw new Error('Entry and asset manifest must be inside the scene source project')
  const sources: FrozenCodeSource[] = []
  let sourceBytes = 0
  for (const path of workspace.list().filter(path => path.startsWith(root + '/') && /\.(ts|js|json|glsl|vert|frag)$/.test(path)).sort()) {
    const content = await workspace.readText(path)
    if (content === null) throw new Error(`Source disappeared: ${path}`)
    sourceBytes += Buffer.byteLength(content)
    if (sourceBytes > 8 * 1024 * 1024 || sources.length >= 128) throw new Error('Scene sources exceed 8 MiB or 128 modules')
    sources.push({ path, content, sha256: sha256(content) })
  }
  const manifest = sources.find(source => source.path === assetsPath)
  if (!manifest) throw new Error('Asset manifest is missing; call PrepareSceneCode first')
  const parsed = JSON.parse(manifest.content)
  if (!Array.isArray(parsed.assets) || parsed.assets.length > 64) throw new Error('assets.json must contain assets: [] (maximum 64)')
  const assets: SceneCodeAsset[] = [], aliases = new Set<string>()
  const pairPaths = new Map<string, string>()
  let total = 0
  for (const item of parsed.assets) {
    if (!item || typeof item.alias !== 'string' || !/^[\w.-]{1,100}$/.test(item.alias) || aliases.has(item.alias)) throw new Error('Asset aliases must be unique simple names')
    aliases.add(item.alias)
    const path = normalizeWorkspacePath(item.path)
    if (isInternalWorkspacePath(path)) throw new Error('Internal assets cannot be loaded by scene code')
    if (!['glb', 'texture', 'ply', 'spz', 'data'].includes(item.kind)) throw new Error(`Unsupported asset kind: ${item.kind}`)
    const stat = await workspace.stat(path)
    if (!stat) throw new Error(`Authorized asset not found: ${path}`)
    if (item.kind === 'glb' && !item.paired_ply && path.startsWith('output/spatial/objects/') && path.endsWith('/model.glb')) {
      pairPaths.set(path, path.replace(/model\.glb$/, 'gaussian.ply'))
    }
    const bytes = item.kind === 'texture' ? await workspace.readRasterBuffer(path) : item.kind === 'data' ? Buffer.from(await workspace.readText(path) ?? '') : await workspace.readDocumentBuffer(path)
    if (!bytes?.length) throw new Error(`Cannot read asset bytes: ${path}`)
    total += bytes.length
    if (total > 192 * 1024 * 1024) throw new Error('Frozen assets exceed 192 MiB')
    const hash = sha256(bytes)
    const blob_id = await writeSceneBlob(bytes, { user_id: identity.userId, project_id: identity.projectId }, 'asset')
    assets.push({ alias: item.alias, path, kind: item.kind, mime_type: stat.mimeType || 'application/octet-stream', size_bytes: bytes.length, sha256: hash, blob_id, normalization: item.normalization, paired_ply: item.paired_ply })
  }
  const declared = [...assets]
  const artifacts = pairPaths.size ? await SpatialArtifactNodeModel.find({ project_id: identity.projectId, user_id: identity.userId, provider: 'lux3d', state: 'published', workspace_path: { $in: [...pairPaths.keys(), ...pairPaths.values()] } }).select('job_id workspace_path sha256').lean() : []
  for (const asset of declared) {
    if (asset.paired_ply !== undefined && (asset.kind !== 'glb' || !declared.some(ply => ply.alias === asset.paired_ply && ply.kind === 'ply'))) {
      throw new Error(`Asset ${asset.alias}: paired_ply must name a declared PLY alias`)
    }
    const path = pairPaths.get(asset.path)
    const glb = artifacts.find(node => node.workspace_path === asset.path && node.sha256 === asset.sha256)
    if (!path || !glb) continue
    const stat = await workspace.stat(path)
    if (!stat || stat.mimeType !== 'application/ply' || !artifacts.some(node => node.workspace_path === path && node.job_id === glb.job_id && node.sha256 === stat.sha256)) continue
    const existing = assets.find(ply => ply.path === path && ply.kind === 'ply')
    if (existing) { asset.paired_ply = existing.alias; continue }
    const hash = stat.sha256, size = stat.sizeBytes, scope = { user_id: identity.userId, project_id: identity.projectId }
    if (!hash || !size || size > 200 * 1024 * 1024) continue
    let blob_id = await findScenePreviewBlob(hash, size, scope)
    if (!blob_id) {
      const bytes = await workspace.readDocumentBuffer(path)
      if (bytes?.length !== size || sha256(bytes) !== hash) continue
      blob_id = await writeSceneBlob(bytes, scope, 'preview-ply')
    }
    let alias = `preview-ply-${sha256(path).slice(0, 24)}`
    while (aliases.has(alias)) alias += '-p'
    aliases.add(alias)
    assets.push({ alias, path, kind: 'ply', mime_type: stat.mimeType, size_bytes: size, sha256: hash, blob_id, preview_only: true })
    asset.paired_ply = alias
  }
  // Detect a concurrent source write rather than freezing a torn multi-file project.
  for (const source of sources) if (sha256(await workspace.readText(source.path) ?? '') !== source.sha256) throw new Error('Scene sources changed during freezing; retry RunSceneCode')
  let constraints = input.constraints ?? []
  const selectedChecksPath = input.checksPath ?? (input.constraints === undefined && sources.some(source => source.path === `${root}/checks.json`) ? `${root}/checks.json` : undefined)
  if (selectedChecksPath) {
    const checksPath = normalizeWorkspacePath(selectedChecksPath)
    if (!checksPath.startsWith(root + '/')) throw new Error('Checks must be part of the scene project')
    const checks = sources.find(source => source.path === checksPath)
    if (!checks) throw new Error('Checks file is missing')
    constraints = JSON.parse(checks.content).constraints
  }
  constraints = validateSceneConstraints(constraints)
  const acceptance = await freezeSceneAcceptance(scene.scene_id, identity, constraints, input.acceptanceUpdate)
  constraints = acceptance.constraints
  const build: SceneCodeBuild = { build_id: `scnbuild_${randomUUID().replaceAll('-', '')}`, project_id: identity.projectId, user_id: identity.userId, conversation_id: identity.conversationId!, scene_id: scene.scene_id, run_id: identity.runId, tool_use_id: identity.toolUseId, actor_id: identity.actorId, status: 'queued', base_revision_id: scene.current_revision_id, base_version: scene.current_version, entry_path: entry, assets_path: assetsPath, sources, assets, source_hash: sha256(JSON.stringify({ sources, assets: assets.map(sceneAssetManifest), seed: input.seed ?? 1, dependencies: SCENE_CODE_DEPENDENCIES, constraints })), seed: input.seed ?? 1, constraints, runtime_version: SCENE_CODE_RUNTIME_VERSION, dependencies: SCENE_CODE_DEPENDENCIES, bundle_blob_id: null, source_map_blob_id: null, report: null, error: null, lease: null, attempts: 0, notify_requested: false, notified_at: null, created_at: new Date(), updated_at: new Date() }
  build.request_hash = requestHash
  build.acceptance = acceptance.contract
  build.acceptance_warnings = acceptance.warnings
  try { await SceneCodeBuildModel.create(build); return build } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error
    return (await SceneCodeBuildModel.findOne({ project_id: identity.projectId, user_id: identity.userId, run_id: identity.runId, tool_use_id: identity.toolUseId }).lean<SceneCodeBuild>())!
  }
}

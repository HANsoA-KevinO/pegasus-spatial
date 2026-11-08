import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { strToU8, zipSync } from 'fflate'
import { writeImageAsset } from '../media/storage'
import { toRasterAssetRef } from '../media/reference'
import { createScenePublicationWorkspace } from '../spatial/scene-workspace'
import { findScopedSpatialSceneRevision, getCurrentSpatialSceneRevision, getSpatialSceneRevision, mutateSpatialScene, requireSpatialScene } from '../spatial/scene-repository'
import type { SceneCommandScope, SceneMutationIdentity } from '../spatial/scene-types'
import type { WorkspaceInstance } from '../workspace/types'
import { SCENE_CODE_RUNTIME_VERSION, type SceneCodeBuild, type SceneCodeReport, type SceneRenderedView, type SceneRuntimeOperation } from './types'
import { getSceneCodeBuild, readSceneBlob, sha256 } from './repository'
import { executeSceneCapsule } from './renderer-client'
import { acceptanceCoverage } from './acceptance'
import { sceneAssetManifest } from './types'

export async function resolveBuildTarget(input: { build_id?: string; scene_id?: string; revision_id?: string }, scope: SceneCommandScope) {
  if (input.build_id) {
    const build = await getSceneCodeBuild(input.build_id, scope)
    if (input.scene_id && input.scene_id !== build.scene_id) throw new Error('Target scene_id does not match build_id')
    if (input.revision_id) {
      const revision = await getSpatialSceneRevision(build.scene_id, input.revision_id, scope)
      if (revision?.program?.build_id !== build.build_id) throw new Error('Target revision_id does not match build_id')
    }
    return { build, revision_id: input.revision_id ?? null }
  }
  if (!input.scene_id && input.revision_id) {
    const revision = await findScopedSpatialSceneRevision(input.revision_id, scope)
    if (!revision?.program) throw new Error('Revision not found or has no code build')
    await requireSpatialScene(revision.scene_id, scope)
    return { build: await getSceneCodeBuild(revision.program.build_id, scope), revision_id: revision.revision_id }
  }
  if (!input.scene_id) throw new Error('Provide build_id, revision_id, or scene_id with optional revision_id')
  const scene = await requireSpatialScene(input.scene_id, scope)
  const revision = input.revision_id ? await getSpatialSceneRevision(scene.scene_id, input.revision_id, scope) : await getCurrentSpatialSceneRevision(scene)
  if (!revision?.program) throw new Error('This revision has no code build; call PrepareSceneCode and publish the initial build')
  return { build: await getSceneCodeBuild(revision.program.build_id, scope), revision_id: revision.revision_id }
}
export async function storeSceneViews(build: SceneCodeBuild, views: SceneRenderedView[], workspace: WorkspaceInstance) {
  const images: Buffer[] = []
  for (const [index, view] of views.entries()) {
    if (!view.png_base64) throw new Error('Renderer did not return PNG pixels')
    const bytes = Buffer.from(view.png_base64, 'base64'); delete view.png_base64
    const asset = await writeImageAsset({ ownerUserId: build.user_id, conversationId: build.conversation_id, buffer: bytes, mimeType: 'image/png', source: 'tool_output' })
    const path = `output/spatial/builds/${build.build_id}/views/${randomUUID().slice(0, 8)}-${index}.png`
    const ref = toRasterAssetRef(asset)
    await workspace.writeRaster(path, ref)
    view.image = ref; view.workspace_path = path
    images.push(await sharp(bytes).resize(640, 480).png().toBuffer())
  }
  if (!images.length) return null
  const columns = Math.min(2, images.length), rows = Math.ceil(images.length / columns)
  const pixels = await sharp({ create: { width: columns * 640, height: rows * 480, channels: 4, background: '#0b2030' } }).composite(images.map((input, index) => ({ input, left: index % columns * 640, top: Math.floor(index / columns) * 480 }))).png().toBuffer()
  const asset = await writeImageAsset({ ownerUserId: build.user_id, conversationId: build.conversation_id, buffer: pixels, mimeType: 'image/png', source: 'tool_output' })
  const image = toRasterAssetRef(asset), path = `output/spatial/builds/${build.build_id}/views/${randomUUID().slice(0, 8)}-montage.png`
  await workspace.writeRaster(path, image)
  return { image, workspace_path: path }
}
export function mapSceneStack(stack: string | undefined, sourceMap: string) {
  if (!stack) return undefined
  const map = new TraceMap(sourceMap)
  for (const match of stack.matchAll(/:(\d+):(\d+)\)?(?:\n|$)/g)) {
    const position = originalPositionFor(map, { line: Number(match[1]), column: Number(match[2]) - 1 })
    if (position.source?.startsWith('scene-source:')) return { path: position.source.slice('scene-source:'.length), line: position.line ?? undefined, column: position.column === null ? undefined : position.column + 1 }
  }
  return undefined
}
export async function observeBuild(build: SceneCodeBuild, operation: SceneRuntimeOperation, workspace: WorkspaceInstance, signal?: AbortSignal) {
  if (build.status !== 'ready') throw new Error(`Build is ${build.status}; only ready immutable builds can be observed`)
  const existingEvidence = operation.kind === 'check' && (build.report?.views.length ?? 0) >= 4 && build.report?.views.every(view => view.time_s === (operation.time_s ?? 0)) ? build.report.views : null
  const result = await executeSceneCapsule(build, id => readSceneBlob(id, build), { ...operation, ...(existingEvidence ? { render_evidence: false } : {}) }, signal)
  let montage: Awaited<ReturnType<typeof storeSceneViews>> = null
  if (result.views) montage = await storeSceneViews(build, result.views, workspace)
  if (existingEvidence) {
    result.views = existingEvidence
    for (const check of result.constraints ?? []) check.evidence_views = existingEvidence.map(view => view.name)
    montage = build.report?.montage ?? null
  }
  return { ...result, montage, available_cameras: result.snapshot?.cameras.map(camera => camera.name) ?? build.report?.snapshot.cameras.map(camera => camera.name) ?? [] }
}
export async function publishSceneBuild(build: SceneCodeBuild, identity: SceneMutationIdentity, expectedVersion: number, summary: string) {
  if (build.status !== 'ready' || !build.report || build.report.errors.length) throw new Error('Only a successful checked immutable build can be published')
  const scene = await requireSpatialScene(build.scene_id, identity)
  if (build.runtime_version !== SCENE_CODE_RUNTIME_VERSION) return { status: 'runtime_revalidation_required', build_id: build.build_id, entry_path: build.entry_path, instruction: 'Rebuild with the current geometry validator before a new publication. Historical revisions remain viewable.' }
  if (!build.acceptance || scene.acceptance_contract?.hash !== build.acceptance.hash) return { status: 'acceptance_changed', build_id: build.build_id, acceptance_version: scene.acceptance_contract?.version, instruction: 'Acceptance conditions changed or this older build has no protected contract. Rebuild against the retained requirements.' }
  const coverage = acceptanceCoverage(build.acceptance, build.report.constraints)
  if (!coverage.complete) return { status: 'acceptance_incomplete', build_id: build.build_id, coverage }
  const blocked = build.report.constraints.filter(item => item.required && item.status !== 'satisfied')
  if (blocked.length) return { status: 'constraints_unmet', build_id: build.build_id, constraints: blocked }
  if (expectedVersion !== build.base_version) throw new Error('Expected version must match the build base version; rebuild against the current scene')
  const result = await mutateSpatialScene({ identity, sceneId: build.scene_id, expectedVersion, expectedAcceptanceVersion: build.acceptance.version, summary, commandHash: sha256(JSON.stringify({ build_id: build.build_id, expectedVersion, summary })), mutate: () => ({ world: null, environment: null, instances: [], program: { build_id: build.build_id, runtime_version: SCENE_CODE_RUNTIME_VERSION, source_hash: build.source_hash, entry_path: build.entry_path, objects: build.report!.snapshot.objects, cameras: build.report!.snapshot.cameras, animated: build.report!.snapshot.animated, has_ply: build.assets.some(asset => ['ply', 'spz'].includes(asset.kind)) } }) })
  return result.status === 'scene_changed' ? { status: 'scene_changed', scene_id: build.scene_id, current_version: result.scene.current_version, current_revision_id: result.scene.current_revision_id, instruction: 'Rebuild against the new scene revision and validate again.' } : { status: 'published', scene_id: build.scene_id, revision_id: result.revision.revision_id, version: result.revision.version, build_id: build.build_id }
}
export async function exportSceneProject(build: SceneCodeBuild) {
  const files: Record<string, Uint8Array> = {}
  const root = `output/spatial/scenes/${build.scene_id}/`
  const assets = build.assets.filter(asset => !asset.preview_only)
  const aliases = new Set(assets.map(asset => asset.alias))
  for (const source of build.sources) files[`source/${source.path.slice(root.length)}`] = strToU8(source.content)
  for (const asset of assets) files[`assets/${asset.alias}`] = new Uint8Array(await readSceneBlob(asset.blob_id, build))
  files['scene-worker.js'] = new Uint8Array(await readSceneBlob(build.bundle_blob_id!, build))
  files['scene-worker.js.map'] = new Uint8Array(await readSceneBlob(build.source_map_blob_id!, build))
  files['manifest.json'] = strToU8(JSON.stringify({ build_id: build.build_id, source_hash: build.source_hash, dependencies: build.dependencies, runtime_version: build.runtime_version, seed: build.seed, constraints: build.constraints, acceptance_contract: build.acceptance, assets: assets.map(asset => ({ ...sceneAssetManifest(asset), paired_ply: asset.paired_ply && aliases.has(asset.paired_ply) ? asset.paired_ply : undefined, package_path: `assets/${asset.alias}` })) }, null, 2))
  files['index.html'] = strToU8(`<!doctype html><meta charset="utf-8"><title>Scene ${build.build_id}</title><canvas id="scene" width="1280" height="960"></canvas><script type="module">const manifest=await(await fetch('./manifest.json')).json();const assets=await Promise.all(manifest.assets.map(async a=>({...a,bytes:await(await fetch(a.package_path)).arrayBuffer()})));const worker=new Worker('./scene-worker.js');let id=0;const pending=new Map();worker.onmessage=e=>{const p=pending.get(e.data.id);if(p){pending.delete(e.data.id);e.data.ok?p.resolve(e.data.result):p.reject(new Error(e.data.error.message))}};const call=(method,input)=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});worker.postMessage({id:key,method,input},input.canvas?[input.canvas]:[])});await call('init',{seed:manifest.seed,assets,canvas:document.getElementById('scene').transferControlToOffscreen(),width:1280,height:960});let t=0;async function frame(){await call('frame',{preset:'overview',time_s:t});t+=1/30;requestAnimationFrame(frame)}frame();</script>`)
  files['README.txt'] = strToU8('Serve this directory with a static HTTP server (for example: python3 -m http.server). Open index.html. Source, declared assets, source maps, fixed dependency versions, seed and compiled standalone Worker are included. Automatically paired PLY previews are available in the project Stage and are excluded from the standalone program. Animation uses a fixed 1/30 second step. Dependencies are already bundled; no runtime package installation is needed. GLB is only a static interchange snapshot; this package preserves the full program.')
  return Buffer.from(zipSync(files, { level: 6 }))
}
export async function defaultBuildWorkspace(build: SceneCodeBuild) { return createScenePublicationWorkspace({ conversationId: build.conversation_id, userId: build.user_id }) }
export type { SceneCodeReport }

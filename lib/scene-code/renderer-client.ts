import type { SceneCodeBuild, SceneCodeReport, SceneRuntimeOperation } from './types'
import { sceneAssetManifest } from './types'

/** Transport only; the renderer never receives application credentials or URLs. */
export async function executeSceneCapsule(build: SceneCodeBuild, readBlob: (id: string) => Promise<Buffer>, operation?: SceneRuntimeOperation, signal?: AbortSignal): Promise<Record<string, unknown> & Partial<SceneCodeReport>> {
  if (!build.bundle_blob_id) throw new Error('Build has no compiled runtime')
  const token = process.env.SCENE_CODE_RENDERER_TOKEN
  if (!token) throw new Error('SCENE_CODE_RENDERER_TOKEN is required')
  const assets = build.assets.filter(asset => !asset.preview_only)
  const form = new FormData()
  form.set('manifest', JSON.stringify({ assets: assets.map(sceneAssetManifest), seed: build.seed, constraints: build.constraints, operation }))
  form.set('bundle', new Blob([new Uint8Array(await readBlob(build.bundle_blob_id))]), 'scene-worker.js')
  for (const [index, asset] of assets.entries()) form.set(`asset-${index}`, new Blob([new Uint8Array(await readBlob(asset.blob_id))], { type: asset.mime_type }), `asset-${index}`)
  const response = await fetch(`${process.env.SCENE_CODE_RENDERER_URL || 'http://127.0.0.1:3201'}/render`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]) })
  const result = await response.json()
  if (!response.ok) throw Object.assign(new Error(result.error || `Renderer HTTP ${response.status}`), { stack: result.stack })
  return result
}

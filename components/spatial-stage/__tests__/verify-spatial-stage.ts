import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  chooseWorldRenderSource,
  parseWorldStageManifest,
  worldBinaryUrl,
  worldBuildLabel,
} from '../world-stage-model'
import { applyObjectLocalAlignment, computeGlbObjectAlignment, computeLuxPlyAlignment } from '../object-alignment'
import * as THREE from 'three'
import { createSpatialProxyObject, type SpatialStageInstance } from '../proxy-geometry'
import { alignmentMatrix, applyInstanceTransform, applyViewpoint, instancesInFrustum, queryMeshSurface } from '../three-scene-geometry'

const root = process.cwd()
const source = (...segments: string[]) => readFileSync(join(root, ...segments), 'utf8')

const manifest = parseWorldStageManifest(JSON.stringify({
  schema_version: 1,
  title: '记忆温室',
  world_id: 'world_123',
  up_axis: 'z',
  assets: [
    {
      key: 'world-ply',
      kind: 'point_cloud',
      path: 'output/spatial/worlds/build_alpha/world.ply',
      size_bytes: 900,
      sha256: 'a'.repeat(64),
    },
    {
      key: 'world-spz',
      kind: 'point_cloud',
      path: 'output/spatial/worlds/build_alpha/world.spz',
      size_bytes: 500,
      sha256: 'b'.repeat(64),
    },
    { path: 'references/private.bin', kind: 'point_cloud' },
  ],
  relations: [{ kind: 'conditioned_by', artifact_id: 'spart_image' }],
}))

assert.ok(manifest)
assert.equal(manifest.up_axis, 'Z')
assert.equal(manifest.assets.length, 2, 'manifest parser must exclude paths outside the public world root')
assert.deepEqual(chooseWorldRenderSource(manifest), {
  path: 'output/spatial/worlds/build_alpha/world.spz',
  format: 'spz',
  sizeBytes: 500,
  sha256: 'b'.repeat(64),
}, 'the stage should prefer the compact mirrored SPZ over PLY')
assert.equal(worldBuildLabel('output/spatial/worlds/build_alpha/manifest.json'), 'build_alpha')
assert.equal(
  worldBinaryUrl('conv 1', 'output/spatial/worlds/build_alpha/world.spz', 'b'.repeat(64)),
  `/api/conversations/conv%201/files/binary?path=output%2Fspatial%2Fworlds%2Fbuild_alpha%2Fworld.spz&v=${'b'.repeat(64)}`,
)
assert.equal(parseWorldStageManifest('{broken'), null)

const plyAlignment = computeLuxPlyAlignment({
  basis_contract_version: 'lux3d_g1_paired_v1',
  source_up_axis: 'Y',
  scene_up_axis: 'Z',
  pivot: 'bottom_center',
  glb_basis_correction: 'gltf_y_up_to_scene_z_up',
  ply_source_up_axis: '-Y',
  ply_basis_correction: 'lux_ply_negative_y_up_to_scene_z_up',
  bounds: { min: [-0.4, -0.5, -0.3], max: [0.4, 0.5, 0.3], size: [0.8, 1, 0.6] },
}, { min: [-2, -3, -4], max: [2, 3, 4] })
assert.deepEqual(plyAlignment.pivot, [0, 0, 3])
assert.ok(plyAlignment.scale.every((value, axis) => Math.abs(value - [0.2, 0.075, 1 / 6][axis]) < 1e-12))
assert.deepEqual(plyAlignment.rotationRadians, [-Math.PI / 2, 0, 0])
const alignedPlyCorners = ([-2, 2] as const).flatMap(x => ([-3, 3] as const).flatMap(y => ([-4, 4] as const)
  .map(z => applyObjectLocalAlignment([x, y, z], plyAlignment))))
const alignedMinimum = [0, 1, 2].map(axis => Math.min(...alignedPlyCorners.map(point => point[axis])))
const alignedMaximum = [0, 1, 2].map(axis => Math.max(...alignedPlyCorners.map(point => point[axis])))
assert.deepEqual(alignedMinimum, [-0.4, -0.3, 0])
assert.deepEqual(alignedMaximum, [0.4, 0.3, 1])
const glbAlignment = computeGlbObjectAlignment({
  source_up_axis: 'Y', scene_up_axis: 'Z', pivot: 'bottom_center',
  glb_basis_correction: 'gltf_y_up_to_scene_z_up',
  bounds: { min: [-0.4, -0.5, -0.3], max: [0.4, 0.5, 0.3], size: [0.8, 1, 0.6] },
})
assert.deepEqual(glbAlignment.rotationRadians, [Math.PI / 2, 0, 0])

// Exercise native geometry, transforms and raycasting rather than matching SDK strings.
const instance = {
  instance_id: 'floor', label: 'floor', role: 'terrain',
  proxy: { kind: 'box', dimensions: [10, 8, 2], material: 'stone', color: '#778899', opacity: 1 },
  transform: { position: [3, -2, 4], rotation_quaternion: [0, 0, 0, 1], scale: [2, 1, 1.5] },
} as SpatialStageInstance
const floor = createSpatialProxyObject(instance)!
applyInstanceTransform(floor, instance.transform)
assert.ok(queryMeshSurface(floor, [3, -2], 100, 'Z').every((value, axis) => Math.abs(value - [3, -2, 7][axis]) < 1e-9))
assert.throws(() => queryMeshSurface(floor, [1000, 1000], 100, 'Z'), /未命中/)
for (const primitive of ['box', 'cylinder', 'arch'] as const) {
  const object = createSpatialProxyObject({ ...instance, proxy: { kind: primitive, dimensions: [4, 2, 6] } })!
  const bounds = new THREE.Box3().setFromObject(object)
  assert.ok(bounds.min.distanceTo(new THREE.Vector3(-2, -1, 0)) < 1e-6)
  assert.ok(bounds.max.distanceTo(new THREE.Vector3(2, 1, 6)) < 1e-6)
  if (primitive === 'arch') assert.throws(() => queryMeshSurface(object, [0, 0], 4, 'Z'), /未命中/, 'arch opening must not be a filled bounding box')
}
const point = new THREE.Vector3(-2, -3, -4).applyMatrix4(alignmentMatrix(plyAlignment)).toArray()
const expected = applyObjectLocalAlignment([-2, -3, -4], plyAlignment)
assert.ok(point.every((value, axis) => Math.abs(value - expected[axis]) < 1e-12), 'native alignment must retain nonuniform scaling')
const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.01, 1000)
applyViewpoint(camera, { position: [3, -15, 10], target: [3, -2, 5], up: [0, 0, 1], fov_deg: 56 })
assert.deepEqual(instancesInFrustum([['floor', floor]], camera), ['floor'])
applyViewpoint(camera, { position: [3, -15, 10], target: [3, -100, 10], up: [0, 0, 1], fov_deg: 56 })
assert.deepEqual(instancesInFrustum([['floor', floor]], camera), [])
const canvas = source('components', 'spatial-stage', 'ThreeWorldCanvas.tsx')
const runtime = source('components', 'spatial-stage', 'three-scene-runtime.ts')
assert.match(runtime, /new THREE.WebGLRenderer/)
assert.match(runtime, /new GLTFLoader\(\)\.parseAsync/)
assert.match(runtime, /covSplats: true/, 'Gaussian covariance transforms must preserve nonuniform Scene scale')
assert.match(runtime, /entry\?\.key !== key/, 'polling must reconcile by asset identity')
assert.match(runtime, /readRenderTargetPixelsAsync/)
assert.match(runtime, /this\.epoch !== epoch/, 'capture must reject scene mutations while awaiting GPU readback')
assert.match(runtime, /new OutputPass/, 'offscreen captures need the same tone and color conversion as the screen')
assert.match(runtime, /expectedRevisionId/)
assert.match(runtime, /dispose\(\)/)
assert.doesNotMatch(canvas + runtime, /@manycore\/aholo-viewer/)

const sceneRepository = source('lib', 'spatial', 'scene-repository.ts')
assert.match(sceneRepository, /ply && job\.provider !== 'lux3d'/)
assert.match(sceneRepository, /没有已知的本地坐标基契约，拒绝猜测姿态/)
assert.match(sceneRepository, /glb_basis_correction: 'gltf_y_up_to_scene_z_up'/)
assert.match(sceneRepository, /ply_basis_correction: 'lux_ply_negative_y_up_to_scene_z_up'/)

const stage = source('components', 'spatial-stage', 'SpatialStage.tsx')
assert.match(stage, /ThreeWorldCanvas/)
assert.match(stage, /场景历史/)
assert.match(stage, /从这里提出修改/)
assert.match(stage, /不声称可以局部语义修改 3DGS/)
assert.match(stage, /把你看到的问题交给 Agent/)
assert.match(stage, /重置视角/)
assert.match(stage, /用户视角/)
assert.match(stage, /Agent 视角/)
assert.match(stage, /高质量 PLY/)
assert.match(stage, /GLB 实时模式/)
assert.match(stage, /场景资产库/)
assert.match(stage, /主 Agent 观察机位/)
assert.doesNotMatch(stage, /贴合地形/)
assert.doesNotMatch(stage, /ArrowLeft: \[0, -step\]/)
assert.doesNotMatch(stage, /PageUp: \[2, step\]/)
assert.doesNotMatch(stage, /editTransform|nudgeSelected|groundSelected/)
assert.doesNotMatch(stage, /edit_id|expected_version/)
assert.match(stage, /RENDER_COMMAND_IDLE_POLL_MS = 2_500/)
assert.match(stage, /RENDER_COMMAND_ACTIVE_POLL_MS = 250/)
assert.match(stage, /RENDER_SESSION_HEARTBEAT_MS = 15_000/)
assert.match(stage, /const clientId = crypto\.randomUUID\(\)/)
assert.match(stage, /await register\(\)\.catch/)
assert.match(stage, /method: 'DELETE'/)
assert.doesNotMatch(stage, /sessionStorage/, 'copied Stage tabs must not share one render lease identity')
assert.match(stage, /const manifestPreviewPath = initialManifestPath \|\| null/)
assert.match(stage, /sceneId\?: string \| null/)
assert.match(stage, /全屏查看/)
assert.match(stage, /sceneId && list\.scenes\.some/)

const sceneRoute = source('app', 'api', 'conversations', '[id]', 'spatial', 'scenes', '[sceneId]', 'route.ts')
assert.match(sceneRoute, /export async function PATCH/)
assert.doesNotMatch(sceneRoute, /mutateSpatialScene/)
assert.match(sceneRoute, /status: 405/)
assert.match(stage, /const effectiveLegacyPath = manifestPreviewPath \?\? legacyPath/)
assert.match(stage, /isManifestPreview \? null : manifests\[0\] \?\? null/)
assert.match(stage, /const displayedSceneData = isManifestPreview \|\| sceneData\?\.scene\.scene_id !== selectedSceneId/)
assert.match(stage, /if \(!selectedSceneId \|\| isManifestPreview \|\| previewVersion \|\| codeProgram\) return/)
assert.match(stage, /World 预览仅供查看/)

const renderCompletionRoute = source(
  'app', 'api', 'conversations', '[id]', 'spatial', 'scenes', '[sceneId]',
  'render-command', '[commandId]', 'complete', 'route.ts',
)
const observationRoute = source(
  'app', 'api', 'conversations', '[id]', 'spatial', 'scenes', '[sceneId]',
  'observations', 'route.ts',
)
assert.match(renderCompletionRoute, /getOwnedImageAsset\(body\.asset_id, userId, id\)/)
assert.match(renderCompletionRoute, /completeSpatialSurfaceQueryCommand/)
assert.match(observationRoute, /getOwnedImageAsset\(body\.asset_id, userId, id\)/)

const route = source('app', '(stage)', 'spatial', '[id]', 'page.tsx')
assert.match(route, /loadRef\.current\(id\)/)
assert.match(route, /<SpatialStage/)
assert.match(route, /useSearchParams\(\)/)
assert.match(route, /safeManifestPath\(searchParams\.get\('manifest'\)\)/)
assert.match(route, /safeSceneId\(searchParams\.get\('scene'\)\)/)
assert.match(route, /normalizeWorkspacePath\(value\)/)
assert.match(route, /!isInternalWorkspacePath\(normalized\)/)

const stageLayout = source('app', '(stage)', 'layout.tsx')
assert.doesNotMatch(stageLayout, /TopNavBar/, 'the immersive stage must not render the application navigation above its own controls')
assert.doesNotMatch(stageLayout, /pt-16/, 'the stage canvas must own the complete viewport')

const workspaceViewer = source('components', 'workspace', 'SpatialArtifactViewers.tsx')
assert.match(workspaceViewer, /进入空间舞台/)
assert.match(workspaceViewer, /\/spatial\/\$\{encodeURIComponent\(conversationId\)\}/)
assert.match(workspaceViewer, /target="_blank"/)
assert.doesNotMatch(workspaceViewer, /\?manifest=\$\{encodeURIComponent\(artifact\.path\)\}/, 'the primary Stage action must open an active Scene, not a viewer-only manifest')
assert.doesNotMatch(workspaceViewer, /<iframe/, 'Workspace world covers must never embed a second application')

console.log('spatial-stage verification passed')

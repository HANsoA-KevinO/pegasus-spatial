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
import { cameraDistanceForBoundingSphere } from '../camera-framing'
import { readRenderPixelsWithRetry } from '../render-readback'

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

const compactObjectDistance = cameraDistanceForBoundingSphere({
  radius: 0.36,
  verticalFovDeg: 56,
  aspect: 1.1,
})
assert.ok(compactObjectDistance > 0.9 && compactObjectDistance < 1.4, 'small objects should open at a readable default size')
assert.ok(
  cameraDistanceForBoundingSphere({ radius: 0.36, verticalFovDeg: 56, aspect: 0.5 }) > compactObjectDistance,
  'portrait viewports should use horizontal FOV as the framing constraint',
)
assert.ok(
  Math.abs(cameraDistanceForBoundingSphere({ radius: 0.72, verticalFovDeg: 56, aspect: 1.1 }) - compactObjectDistance * 2) < 1e-12,
  'camera framing should scale proportionally with scene size',
)

let asynchronousReads = 0
let synchronousReads = 0
const waitDurations: number[] = []
await readRenderPixelsWithRetry({
  render() {},
  async waitForRenderOver(duration) { waitDurations.push(duration) },
  async readRenderResultAsync() {
    asynchronousReads += 1
    throw new Error('GL client sync failed')
  },
  readRenderResult() { synchronousReads += 1 },
}, new Uint8Array(4), { x: 0, y: 0, width: 1, height: 1 })
assert.equal(asynchronousReads, 3)
assert.equal(synchronousReads, 1)
assert.deepEqual(waitDurations, [48, 80, 112, 96])

const canvas = source('components', 'spatial-stage', 'AholoWorldCanvas.tsx')
assert.match(canvas, /import\('@manycore\/aholo-viewer'\)/)
assert.match(canvas, /sdk\.createViewer\(/)
assert.match(canvas, /SplatLoader\.parseSplatData/)
assert.match(canvas, /SplatUtils\.createSplat/)
assert.match(canvas, /container\.addEventListener/)
assert.match(canvas, /viewer\.destroy\(\)/)
assert.match(canvas, /controller\.abort\(\)/)
assert.match(canvas, /GLTFLoader\.loadGLTF/)
assert.match(canvas, /readRenderPixelsWithRetry/)
assert.match(canvas, /isExtraCopyBeforeScreenEnabled\.set\(true\)/)
assert.match(canvas, /空间舞台尚未产生有效截图帧/)
assert.match(canvas, /createPicker\(\)/)
assert.match(canvas, /qualityMode/)
assert.match(canvas, /qualityAssetKey/)
assert.match(canvas, /QUALITY_ALIGNMENT_VERSION/)
assert.match(canvas, /qualityCacheRef/)
assert.match(canvas, /qualityCandidates/)
assert.match(canvas, /setHighlightObjects/)
assert.match(canvas, /agent-observer\.gltf/)
assert.match(canvas, /status: 'loading'/)
assert.match(canvas, /containsCaptureOrigin/)
assert.match(canvas, /orbit\.target = axis === 'Z' \? \[0, -1, 0\] : \[0, 0, -1\]/)
assert.match(canvas, /3DGS 解码超时/)
assert.match(canvas, /Lux 可编辑物体仍可继续使用/)
assert.match(canvas, /fitEditableObjects/)
assert.match(canvas, /frameLoadedObjects/)
assert.match(canvas, /new viewerSdk\.Box3\(\)\.makeEmpty\(\)/)
assert.match(canvas, /framedObjectKey === frameKey/)
assert.match(canvas, /camera\.updateProjectionMatrix\(\)/)
assert.doesNotMatch(canvas, /!container \|\| !assetUrl \|\| !format/)
assert.match(canvas, /resetUserView/)
assert.match(canvas, /movementKeys = new Set\(\['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'\]\)/)
assert.match(canvas, /requestAnimationFrame\(navigate\)/)
assert.match(canvas, /pressedKeys\.has\('KeyE'\)/)
assert.match(canvas, /pressedKeys\.has\('KeyQ'\)/)
assert.match(canvas, /orbit\.mode = event\.shiftKey/)
assert.match(canvas, /if \(orbit\.moved\)/)
assert.match(canvas, /listen\('blur', \(\) => \{ pressedKeys\.clear\(\); lastNavigationTime = 0 \}\)/)
assert.doesNotMatch(canvas, /showInteractionHints/)
assert.doesNotMatch(canvas, /keyboardActive/)
assert.doesNotMatch(canvas, /data-spatial-interaction-hints/)
assert.doesNotMatch(canvas, /data-spatial-interaction-guide/)
assert.doesNotMatch(canvas, /styles\.viewerHint/)
assert.doesNotMatch(canvas, /点击画面激活自由相机/)
assert.doesNotMatch(canvas, /Agent 视角只读/)

const readback = source('components', 'spatial-stage', 'render-readback.ts')
assert.match(readback, /WebGL clientWaitSync/)
assert.match(readback, /readRenderResultAsync/)
assert.match(readback, /waitForRenderOver\(48 \+ attempt \* 32\)/)
assert.match(readback, /viewer\.readRenderResult\(pixels, range\)/)

const viewerPatch = source('scripts', 'patch-aholo-viewer-workers.mjs')
assert.match(viewerPatch, /EXPECTED_DIRECT_WORKER_COUNT = 3/)
assert.match(viewerPatch, /new Worker\(workerUrl, \{ type: "module" \}\)/)
assert.match(viewerPatch, /Math\.max\(1, \(navigator\.hardwareConcurrency \|\| 2\) - 1\)/)

const sceneRepository = source('lib', 'spatial', 'scene-repository.ts')
assert.match(sceneRepository, /ply && job\.provider !== 'lux3d'/)
assert.match(sceneRepository, /没有已知的本地坐标基契约，拒绝猜测姿态/)
assert.match(sceneRepository, /glb_basis_correction: 'gltf_y_up_to_scene_z_up'/)
assert.match(sceneRepository, /ply_basis_correction: 'lux_ply_negative_y_up_to_scene_z_up'/)

const stage = source('components', 'spatial-stage', 'SpatialStage.tsx')
assert.match(stage, /AholoWorldCanvas/)
assert.doesNotMatch(stage, /AUTO REVISION/)
assert.doesNotMatch(stage, /styles\.railFooter/)
assert.match(stage, /从这里提出修改/)
assert.match(stage, /embedded = false/)
assert.match(stage, /sceneId = null/)
assert.match(stage, /if \(sceneId && list\.scenes\.some/)
assert.match(stage, /embedded \? styles\.stageEmbedded : ''/)
assert.match(stage, /data-spatial-stage-mode=\{embedded \? 'embedded' : 'standalone'\}/)
assert.doesNotMatch(stage, /showInteractionHints/)
assert.match(stage, /framingKey=\{displayedSceneData/)
assert.match(stage, /\{!embedded && <header className=\{styles\.stageHeader\} data-spatial-stage-header>/)
assert.doesNotMatch(stage, /data-spatial-stage-toolbar/)
assert.doesNotMatch(stage, /styles\.viewportToolbar/)
assert.match(stage, /href=\{standaloneStageHref\}/)
assert.match(stage, /data-embedded-stage-fullscreen/)
assert.match(stage, /进入全屏完整空间舞台/)
assert.match(stage, /if \(manifestPreviewPath\) query\.set\('manifest'/)
assert.match(stage, /else if \(selectedSceneId\) query\.set\('scene'/)
assert.match(stage, /EMBEDDED_NAVIGATION_HINT_DISMISSED_KEY/)
assert.match(stage, /data-embedded-navigation-hint/)
assert.match(stage, /localStorage\.setItem\(EMBEDDED_NAVIGATION_HINT_DISMISSED_KEY, '1'\)/)
assert.match(stage, /不再提醒/)
assert.doesNotMatch(stage, /data-embedded-stage-controls/)
assert.match(stage, /className=\{styles\.cameraMenuTrigger\}/)
assert.match(stage, /aria-expanded=\{cameraMenuOpen\}/)
assert.match(stage, /aria-controls="spatial-camera-menu"/)
assert.match(stage, /role="group" aria-label="选择空间视角"/)
assert.match(stage, /aria-pressed=\{cameraMode === 'user'\}/)
assert.match(stage, /Agent 尚未设置观察相机/)
assert.match(stage, /setCameraMode\('user'\); canvasRef\.current\?\.resetUserView\(\)/)
assert.match(stage, /aria-label="修改空间"/)
assert.match(stage, /data-tooltip="修改空间"/)
assert.doesNotMatch(stage, />\s*观察\s*</)
assert.doesNotMatch(stage, /<p>空间舞台<\/p>/)
assert.doesNotMatch(stage, /styles\.liveMark/)
assert.doesNotMatch(stage, /styles\.(?:statusPill|historyPill)/)
assert.match(stage, /className=\{`\$\{styles\.assetLibraryButton\}/)
assert.match(stage, /aria-controls="spatial-library-drawer"/)
assert.match(stage, /aria-label="资产"/)
assert.match(stage, /data-spatial-asset-trigger/)
assert.doesNotMatch(stage, />\s*资产\s*</)
assert.match(stage, /conciseSceneDisplayName\(scene\.title\)/)
assert.match(stage, /data-model-kind="scene"/)
assert.match(stage, /aria-label=\{`打开场景模型：\$\{displayName\}`\}/)
assert.match(stage, /不声称可以局部语义修改 3DGS/)
assert.match(stage, /把你看到的问题交给 Agent/)
assert.match(stage, /重置视角/)
assert.doesNotMatch(stage, />看向</)
assert.doesNotMatch(stage, />相对坐标</)
assert.match(stage, /用户视角/)
assert.match(stage, /Agent 视角/)
assert.match(stage, /高质量 PLY/)
assert.match(stage, /GLB 实时模式/)
assert.match(stage, /场景资产库/)
assert.doesNotMatch(stage, /styles\.agentPresence/)
assert.doesNotMatch(stage, /主 Agent 观察机位/)
assert.match(stage, /RENDER_COMMAND_IDLE_POLL_MS = 2_500/)
assert.match(stage, /RENDER_COMMAND_ACTIVE_POLL_MS = 250/)
assert.match(stage, /const manifestPreviewPath = initialManifestPath \|\| null/)
assert.match(stage, /const effectiveLegacyPath = manifestPreviewPath \?\? legacyPath/)
assert.match(stage, /isManifestPreview \? null : manifests\[0\] \?\? null/)
assert.match(stage, /const displayedSceneData = isManifestPreview \? null : sceneData/)
assert.match(stage, /if \(!selectedSceneId \|\| isManifestPreview\) return/)
assert.match(stage, /World 预览仅供查看/)

const renderCompletionRoute = source(
  'app', 'api', 'conversations', '[id]', 'spatial', 'scenes', '[sceneId]',
  'render-command', '[commandId]', 'complete', 'route.ts',
)
const observationRoute = source(
  'app', 'api', 'conversations', '[id]', 'spatial', 'scenes', '[sceneId]',
  'observations', 'route.ts',
)
assert.match(renderCompletionRoute, /getOwnedImageAsset\(body\.asset_id as string, userId, id\)/)
assert.match(observationRoute, /getOwnedImageAsset\(body\.asset_id, userId, id\)/)

const stageStyles = source('components', 'spatial-stage', 'SpatialStage.module.css')
assert.match(stageStyles, /\.stageEmbedded/)
assert.match(stageStyles, /\.stageEmbedded\s*\{[^}]*position:\s*relative/)
assert.match(stageStyles, /\.stageEmbedded\s*\{[^}]*width:\s*100%/)
assert.match(stageStyles, /\.stageEmbedded\s*\{[^}]*height:\s*100%/)
assert.match(stageStyles, /\.stageEmbedded\s*\{[^}]*container-name:\s*spatial-stage/)
assert.match(stageStyles, /@container spatial-stage \(max-width:\s*720px\)/)
assert.match(stageStyles, /\.embeddedFullscreenButton/)
assert.match(stageStyles, /\.embeddedNavigationHint/)
assert.match(stageStyles, /\.embeddedNavigationHint\s*\{[^}]*backdrop-filter:\s*blur\(20px\)/)
assert.match(stageStyles, /\.embeddedNavigationHint\s*\{[^}]*border:\s*0;/)
assert.match(stageStyles, /\.embeddedNavigationHint\s*\{[^}]*background:\s*rgba\(17, 19, 24, 0\.68\)/)
assert.match(stageStyles, /\.embeddedNavigationInstructions span\s*\{[^}]*font-size:\s*15px;/)
assert.match(stageStyles, /--paper:\s*var\(--surface\)/)
assert.match(stageStyles, /--signal:\s*var\(--primary\)/)
assert.match(stageStyles, /--stage-panel:\s*var\(--glass-panel-bg\)/)
assert.match(stageStyles, /--stage-shadow:\s*var\(--shadow-glass\)/)
assert.match(stageStyles, /font-family:\s*var\(--font-manrope\), var\(--font-noto-sc\)/)
assert.match(stageStyles, /\.stageHeader\s*\{[^}]*border-radius:\s*var\(--r-glass\)/)
assert.match(stageStyles, /\.stageHeader\s*\{[^}]*background:\s*var\(--stage-panel\)/)
assert.match(stageStyles, /\.cameraMenuPopover/)
assert.match(stageStyles, /\.cameraMenuTrigger\[data-open="true"\]/)
assert.match(stageStyles, /\.editStageButton::after/)
assert.match(stageStyles, /\.assetLibraryButton::after/)
assert.match(stageStyles, /content:\s*attr\(data-tooltip\)/)
assert.match(stageStyles, /\.buildItemActive::after/)
assert.match(stageStyles, /\.sceneModelIcon/)
assert.doesNotMatch(stageStyles, /\.cameraSwitch/)
assert.doesNotMatch(stageStyles, /\.railFooter/)
assert.match(stageStyles, /\.stageEmbedded,\s*\.stageEmbedded \.viewerRoot\s*\{[^}]*background:\s*var\(--surface-container-lowest\)/)
assert.doesNotMatch(stageStyles, /\.viewportToolbar/)
assert.doesNotMatch(stageStyles, /\.viewerHint/)
assert.doesNotMatch(stageStyles, /\.agentPresence|\.agentOrb/)
assert.doesNotMatch(stageStyles, /\.liveMark|\.statusPill|\.historyPill/)
assert.match(stageStyles, /\.headerMeta\s*\{[^}]*font-size:\s*13px/)
assert.match(stageStyles, /\.headerActions \.cameraMenuTrigger\s*\{[^}]*font-size:\s*13px/)
assert.doesNotMatch(stageStyles, /#d8d3c8|#d75a3b|rgba\(215, 90, 59/)
assert.doesNotMatch(stageStyles, /\.embeddedControlDock/)
assert.doesNotMatch(
  stageStyles,
  /\.stageEmbedded\s*\{[^}]*position:\s*fixed/,
  'Embedded spatial stages must stay inside the shell workspace instead of covering the viewport',
)
assert.doesNotMatch(stageStyles, /font-size:\s*[7-9]px/, 'Spatial stage core text must not use type smaller than 10px')

const workspacePanel = source('components', 'workspace', 'WorkspacePanel.tsx')
assert.match(workspacePanel, /data-workspace-stage-container/)
assert.match(workspacePanel, /relative h-full min-h-0 min-w-0 overflow-hidden/)

const route = source('app', '(stage)', 'spatial', '[id]', 'page.tsx')
assert.match(route, /loadRef\.current\(id\)/)
assert.match(route, /<SpatialStage/)
assert.match(route, /useSearchParams\(\)/)
assert.match(route, /safeManifestPath\(searchParams\.get\('manifest'\)\)/)
assert.match(route, /safeSceneId\(searchParams\.get\('scene'\)\)/)
assert.match(route, /sceneId=\{safeSceneId/)
assert.match(route, /normalizeWorkspacePath\(value\)/)
assert.match(route, /!isInternalWorkspacePath\(normalized\)/)

const stageLayout = source('app', '(stage)', 'layout.tsx')
assert.doesNotMatch(stageLayout, /TopNavBar/, 'the immersive stage must not render the application navigation above its own controls')
assert.doesNotMatch(stageLayout, /pt-16/, 'the stage canvas must own the complete viewport')
assert.match(stageLayout, /bg-surface/)
assert.doesNotMatch(stageLayout, /#d8d3c8/)

const workspaceViewer = source('components', 'workspace', 'SpatialArtifactViewers.tsx')
assert.match(workspaceViewer, /进入空间舞台/)
assert.match(workspaceViewer, /\/spatial\/\$\{encodeURIComponent\(conversationId\)\}/)
assert.doesNotMatch(workspaceViewer, /<iframe/, 'Workspace world covers must never embed a second application')

console.log('spatial-stage verification passed')

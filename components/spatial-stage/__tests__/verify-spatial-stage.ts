import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  chooseWorldRenderSource,
  parseWorldStageManifest,
  worldBinaryUrl,
  worldBuildLabel,
} from '../world-stage-model'

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

const canvas = source('components', 'spatial-stage', 'AholoWorldCanvas.tsx')
assert.match(canvas, /import\('@manycore\/aholo-viewer'\)/)
assert.match(canvas, /sdk\.createViewer\(/)
assert.match(canvas, /SplatLoader\.parseSplatData/)
assert.match(canvas, /SplatUtils\.createSplat/)
assert.match(canvas, /container\.addEventListener/)
assert.match(canvas, /viewer\.destroy\(\)/)
assert.match(canvas, /controller\.abort\(\)/)
assert.match(canvas, /GLTFLoader\.loadGLTF/)
assert.match(canvas, /readRenderResultAsync/)
assert.match(canvas, /createPicker\(\)/)
assert.match(canvas, /qualityInstanceId/)

const stage = source('components', 'spatial-stage', 'SpatialStage.tsx')
assert.match(stage, /AholoWorldCanvas/)
assert.match(stage, /AUTO REVISION/)
assert.match(stage, /从这里提出修改/)
assert.match(stage, /不声称可以局部语义修改 3DGS/)

const route = source('app', '(stage)', 'spatial', '[id]', 'page.tsx')
assert.match(route, /loadRef\.current\(id\)/)
assert.match(route, /<SpatialStage/)

const workspaceViewer = source('components', 'workspace', 'SpatialArtifactViewers.tsx')
assert.match(workspaceViewer, /进入空间舞台/)
assert.match(workspaceViewer, /\/spatial\/\$\{encodeURIComponent\(conversationId\)\}/)

console.log('spatial-stage verification passed')

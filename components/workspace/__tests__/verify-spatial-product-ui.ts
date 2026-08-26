import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function source(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), 'utf8')
}

const artifacts = source('hooks', 'useWorkspaceArtifacts.ts')
const panel = source('components', 'workspace', 'WorkspacePanel.tsx')
const viewers = source('components', 'workspace', 'SpatialArtifactViewers.tsx')
const explorer = source('components', 'workspace', 'WorkspaceFileExplorer.tsx')
const card = source('components', 'chat', 'SpatialJobCard.tsx')
const messageBubble = source('components', 'chat', 'MessageBubble.tsx')
const sidebar = source('components', 'shell', 'AppSidebar.tsx')
const workbench = source('components', 'workspace', 'TaskWorkbench.tsx')

assert.match(artifacts, /'image' \| 'model3d' \| 'world'/)
assert.match(artifacts, /entry\.storage === 'asset' && entry\.kind === 'raster'/)
assert.match(artifacts, /glb\|gltf/)
assert.match(artifacts, /output\\\/spatial\\\/worlds|output\/spatial\/worlds/)
assert.doesNotMatch(
  artifacts,
  /part\.tool[^\n]+(?:GenerateImage|CreateObject3D|CreateWorld3D)[\s\S]{0,240}artifacts\.set/,
  'durable job receipts must not shadow authoritative Workspace artifacts',
)

for (const component of ['SpatialImageViewer', 'SpatialModelViewer', 'SpatialWorldViewer']) {
  assert.match(panel, new RegExp(component))
  assert.match(viewers, new RegExp(`export function ${component}`))
}
assert.match(viewers, /camera-controls/)
assert.match(viewers, /下载 GLB/)
assert.match(viewers, /在 Aholo 中打开/)
assert.match(viewers, /safeHttpUrl/)
assert.match(explorer, /label: '3D'/)

for (const tool of [
  'GenerateImage',
  'CreateObject3D',
  'CreateWorld3D',
  'GetSpatialJob',
  'WaitSpatialJob',
  'InspectSpatialArtifact',
]) {
  assert.match(card, new RegExp(`'${tool}'`))
}
assert.match(card, /\/spatial\/jobs\//)
assert.match(card, /ACTIVE\.has/)
assert.match(card, /next\.status === 'published'/)
assert.match(card, /relationLabel/)
assert.match(card, /来源关系|Lineage/)
assert.match(messageBubble, /<SpatialJobCard/)
assert.match(messageBubble, /CreateWorld3D:\s*\{ pres: '创建中',\s*past: '已发起' \}/)
assert.match(messageBubble, /GenerateImage:\s*\{ pres: '生成中',\s*past: '已生成' \}/)
assert.doesNotMatch(messageBubble, /past: 'SUBMITTED'/)
assert.match(sidebar, /空间创作导航/)
assert.match(viewers, /已发布资产/)
assert.match(viewers, /来源关系/)
assert.match(viewers, /空间世界 · \{worldStatusLabel\(status\)\}/)
assert.match(viewers, /worldRelationLabel\(relation\.kind\)/)

assert.match(workbench, /自主选择当前已接入的图像生成、3D 造物与世界生成工具/)
assert.match(workbench, /现实重建会在对应工具完成真实接入后开放/)
assert.match(workbench, /不锁定工具/)
assert.doesNotMatch(workbench, /物体模式|世界模式|固定流水线/)

console.log('spatial-product-ui:verify passed')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spatialArtifactDisplayName } from '../../../lib/spatial/presentation-name'

const componentPath = fileURLToPath(new URL('../WorkspaceFileExplorer.tsx', import.meta.url))
const source = readFileSync(componentPath, 'utf8')
const panelSource = readFileSync(fileURLToPath(new URL('../WorkspacePanel.tsx', import.meta.url)), 'utf8')
const sidebarSource = readFileSync(fileURLToPath(new URL('../../shell/AppSidebar.tsx', import.meta.url)), 'utf8')
const contextSource = readFileSync(fileURLToPath(new URL('../../../contexts/ChatContext.tsx', import.meta.url)), 'utf8')

assert.match(source, /role="listbox"/, 'the flat asset collection exposes a single-select listbox')
assert.match(source, /role="option"/, 'every image and model is a same-level option')
assert.match(source, /aria-selected=/, 'the active file is announced')
assert.match(source, /data-testid="workspace-file-explorer"/, 'the Explorer has a stable browser-test target')
assert.match(source, /overflow-x-hidden overflow-y-auto/, 'long paths cannot create a horizontal Explorer scroller')
assert.match(source, /artifacts\.map\(\(artifact, index\)/, 'assets render directly without directory nodes')
assert.doesNotMatch(source, /buildWorkspaceTree|flattenVisibleTree|FolderIcon|aria-expanded|role="tree"|role="treeitem"/, 'no hierarchy or folder affordance remains')
assert.doesNotMatch(source, /conversationId/, 'the flat list has no directory-state persistence owner')

for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter']) {
  assert.match(source, new RegExp(`event\\.key === '${key}'`), `${key} keyboard behavior is wired`)
}
assert.match(
  source,
  /itemRefs\.current\.get\(path\)\?\.focus\(\)/,
  'keyboard navigation focuses an already-visible target in the key event boundary',
)

assert.match(source, /normalizedInFlight/, 'Agent writes are reflected in the asset list')
assert.doesNotMatch(source, /筛选项目文件|type="search"|SearchResult/, 'the asset-only Explorer has no search UI')
assert.match(source, /暂无可预览资产/, 'projects without an image or 3D model have a useful empty state')
assert.match(source, /\{artifact\.label\}/, 'asset rows render the centralized product-facing name')
assert.match(
  source,
  /activeIsVisible \? isSelected : index === 0/,
  'a hidden persisted file cannot remove the listbox roving-focus target',
)
assert.match(source, /data-asset-kind=\{kind\}/, 'visual asset type is explicit')
assert.match(source, /data-model-kind=\{kind === 'image' \? undefined : kind\}/, 'object and generic 3D models expose stable semantic styling hooks')
assert.match(source, /kind === 'object'/, 'Workspace object GLBs receive their own warm visual treatment')
assert.doesNotMatch(source, /\$\{artifact\.label\}，\$\{artifact\.path\}/, 'accessible names do not expose raw paths')
assert.doesNotMatch(panelSource, /WorkspaceBreadcrumb/, 'the workspace does not reserve a path-bar row above its content')
assert.doesNotMatch(panelSource, /artifacts\.map\(/, 'the old horizontal file-tab strip is gone')
assert.match(sidebarSource, /WorkspaceFileExplorer/, 'file navigation lives in the application sidebar')
assert.match(sidebarSource, /artifacts\.filter\(artifact => artifact\.type === 'image' \|\| artifact\.type === 'model3d'\)/, 'only directly openable images and 3D models enter the Explorer')
assert.match(sidebarSource, /artifacts=\{openableArtifacts\}/, 'the filtered asset projection is passed to the Explorer')
assert.doesNotMatch(sidebarSource, /<WorkspaceFileExplorer[\s\S]{0,100}conversationId=/, 'the flat Explorer does not receive obsolete hierarchy state')
assert.doesNotMatch(sidebarSource, /useConversationTitle|useLiteraturePaperSummaries|paperSummaries=/, 'hidden project and literature file metadata is not loaded')
assert.doesNotMatch(sidebarSource, />Workspace<\/span>|\{artifacts\.length\} files|activeProjectTitle/, 'the project summary card is removed')
assert.match(sidebarSource, /role="tablist"/, 'project and file navigation are explicit modes')
assert.match(sidebarSource, /aria-label="文件" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"/, 'the sidebar file panel forms a hard width boundary')
assert.match(contextSource, /pegasus_spatial_workspace_active_file:/, 'the active file is persisted per project')

assert.equal(
  spatialArtifactDisplayName('output/spatial/images/dragon_raja_sunset_road_retry.png', 'image'),
  '龙族海边夕阳',
)
assert.equal(
  spatialArtifactDisplayName('output/spatial/objects/coastal_road_module/model.glb', 'model3d'),
  '海岸公路模块',
)
assert.equal(
  spatialArtifactDisplayName('output/spatial/images/庭院黄昏.png', 'image'),
  '庭院黄昏',
)

console.log('workspace-file-explorer:verify passed')

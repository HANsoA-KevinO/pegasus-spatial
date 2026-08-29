import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spatialArtifactDisplayName } from '../../../lib/spatial/presentation-name'

const componentPath = fileURLToPath(new URL('../WorkspaceFileExplorer.tsx', import.meta.url))
const source = readFileSync(componentPath, 'utf8')
const panelSource = readFileSync(fileURLToPath(new URL('../WorkspacePanel.tsx', import.meta.url)), 'utf8')
const sidebarSource = readFileSync(fileURLToPath(new URL('../../shell/AppSidebar.tsx', import.meta.url)), 'utf8')
const contextSource = readFileSync(fileURLToPath(new URL('../../../contexts/ChatContext.tsx', import.meta.url)), 'utf8')

assert.match(source, /key: 'images'/, 'the Explorer defines a stable image group')
assert.match(source, /key: 'models'/, 'the Explorer defines a stable 3D model group')
assert.match(source, /label: '图片'/, 'the image group has a concise product-facing title')
assert.match(source, /label: '3D 模型'/, 'the model group has a concise product-facing title')
assert.match(source, /data-asset-group=\{group\.key\}/, 'each collapsible card exposes its stable runtime group key')
assert.match(source, /data-selected=\{groupSelected \? 'true' : 'false'\}/, 'the group containing the displayed workspace asset exposes a stable selected state')
assert.match(source, /selectedGroup === group\.key/, 'group selection is driven by the resolved workspace display state')
assert.match(source, /border-primary\/70/, 'the selected image card receives a clearly highlighted border')
assert.match(source, /border-\[#b98a58\]\/70/, 'the selected model card receives a clearly highlighted border')
assert.doesNotMatch(source, />当前</, 'selection is communicated by the card border without a redundant text badge')
assert.match(
  source,
  /DEFAULT_EXPANDED_GROUPS[\s\S]{0,120}\{\s*images:\s*false,\s*models:\s*false,?\s*\}/,
  'both asset groups start collapsed',
)
assert.match(source, /useState<Record<AssetGroupKey, boolean>>\(DEFAULT_EXPANDED_GROUPS\)/, 'the Explorer initializes expansion state from the collapsed defaults')
assert.match(source, /aria-expanded=\{expanded\}/, 'group headers announce their expanded state')
assert.match(source, /aria-controls=\{[^}]+\}/, 'group headers own their collapsible panel')
assert.match(source, /\{expanded\s*&&\s*\(/, 'group contents are not rendered until their header is expanded')
assert.match(source, /role="listbox"/, 'each expanded group exposes a single-select listbox')
assert.match(source, /role="option"/, 'every image and model remains a same-level option rather than a tree node')
assert.match(source, /aria-selected=/, 'the active file is announced')
assert.match(source, /data-testid="workspace-file-explorer"/, 'the Explorer has a stable browser-test target')
assert.match(source, /overflow-x-hidden overflow-y-auto/, 'long paths cannot create a horizontal Explorer scroller')
assert.match(source, /group\.artifacts\.map\(\(artifact/, 'assets render directly inside their visual-type group without directory nodes')
assert.doesNotMatch(source, /buildWorkspaceTree|flattenVisibleTree|FolderIcon|role="tree"|role="treeitem"/, 'collapsible visual groups do not reintroduce a file hierarchy')
assert.doesNotMatch(source, /conversationId/, 'the Explorer keeps no cross-project expansion persistence owner')

for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter']) {
  assert.match(source, new RegExp(`event\\.key === '${key}'`), `${key} keyboard behavior is wired`)
}
assert.match(
  source,
  /const target = itemRefs\.current\.get\(path\)[\s\S]{0,240}target\.focus\(\)/,
  'keyboard navigation focuses an already-visible target in the key event boundary',
)
assert.match(source, /focusedPathByGroup/, 'each listbox owns an independent roving-focus path')
assert.match(source, /focusedPathByGroup\[group\.key\]/, 'option focus is resolved within its visual-type group')
assert.match(source, /group\.artifacts\.findIndex\(/, 'keyboard movement starts from the current option in its own listbox')
assert.match(source, /group\.artifacts\[Math\.min\(/, 'ArrowDown stays within the current group')
assert.match(source, /group\.artifacts\[Math\.max\(/, 'ArrowUp stays within the current group')
assert.match(source, /group\.artifacts\[0\]/, 'Home targets the first option in the current group')
assert.match(source, /group\.artifacts\.at\(-1\)/, 'End targets the last option in the current group')
assert.match(source, /onKeyDown=\{event => handleAssetKeyDown\(event, group, artifact\)\}/, 'each option supplies only its own group to keyboard navigation')
assert.match(source, /tabIndex=\{isFocusable \? 0 : -1\}/, 'visible options preserve roving tabindex semantics')
assert.match(source, /onClick=\{\(\) => onSelect\(artifact\.path\)\}/, 'every visible option remains directly clickable')

assert.match(source, /normalizedInFlight/, 'Agent writes are reflected in the asset list')
assert.doesNotMatch(source, /筛选项目文件|type="search"|SearchResult/, 'the asset-only Explorer has no search UI')
assert.match(source, /暂无图片文件/, 'the collapsed image card preserves a useful empty summary')
assert.match(source, /暂无 3D 模型文件/, 'the collapsed model card preserves a useful empty summary')
assert.match(source, /\{artifact\.label\}/, 'asset rows render the centralized product-facing name')
assert.match(
  source,
  /containsActive \? isSelected : index === 0/,
  'a hidden or collapsed persisted file cannot remove the visible listbox roving-focus target',
)
assert.match(source, /data-asset-kind=\{kind\}/, 'visual asset type is explicit')
assert.match(source, /data-model-kind=\{kind === 'image' \? undefined : kind\}/, 'object and generic 3D models expose stable semantic styling hooks')
assert.match(source, /kind === 'object'/, 'Workspace object GLBs receive their own warm visual treatment')
assert.doesNotMatch(source, /\$\{artifact\.label\}，\$\{artifact\.path\}/, 'accessible names do not expose raw paths')
assert.doesNotMatch(panelSource, /WorkspaceBreadcrumb/, 'the workspace does not reserve a path-bar row above its content')
assert.doesNotMatch(panelSource, /artifacts\.map\(/, 'the old horizontal file-tab strip is gone')
assert.match(sidebarSource, /WorkspaceFileExplorer/, 'file navigation lives in the application sidebar')
assert.match(sidebarSource, /artifact\.type === 'pointcloud3d'/, 'concrete PLY files remain directly openable in the Files explorer')
assert.match(sidebarSource, /artifacts=\{openableArtifacts\}/, 'the filtered asset projection is passed to the Explorer')
assert.match(sidebarSource, /activePath=\{explorerActivePath\}/, 'file-row selection follows the artifact actually resolved for the workspace')
assert.match(sidebarSource, /selectedGroup=\{selectedAssetGroup\}/, 'the Explorer receives the resolved image/model card selection')
assert.match(sidebarSource, /activeSceneId \|\| activeModelId/, 'a displayed Scene or model entity selects the 3D model group rather than a stale file')
assert.doesNotMatch(sidebarSource, /<WorkspaceFileExplorer[\s\S]{0,100}conversationId=/, 'the flat Explorer does not receive obsolete hierarchy state')
assert.match(sidebarSource, /<WorkspaceFileExplorer[\s\S]{0,160}key=\{conversationId\}/, 'switching projects remounts the Explorer so both groups return to their collapsed defaults')
assert.doesNotMatch(sidebarSource, /useConversationTitle|useLiteraturePaperSummaries|paperSummaries=/, 'hidden project and literature file metadata is not loaded')
assert.doesNotMatch(sidebarSource, />Workspace<\/span>|\{artifacts\.length\} files|activeProjectTitle/, 'the project summary card is removed')
assert.match(sidebarSource, /role="tablist"/, 'project and file navigation are explicit modes')
assert.match(sidebarSource, /aria-label="文件" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"/, 'the sidebar file panel forms a hard width boundary')
assert.match(contextSource, /pegasus_spatial_workspace_active_file:/, 'the active file is persisted per project')
assert.match(contextSource, /pegasus_spatial_workspace_active_model:/, 'the active model entity is persisted separately from concrete files')
assert.match(
  contextSource,
  /if \(activeSceneId \|\| activeModelId\) \{\s*setActiveArtifactPathState\(null\)\s*return\s*\}/,
  'artifact synchronization cannot restore a stale file while a Scene or model entity is displayed',
)

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
assert.equal(
  spatialArtifactDisplayName('output/spatial/images/cyberpunk_food_stall.png', 'image'),
  '赛博朋克美食摊位',
)
assert.equal(
  spatialArtifactDisplayName('output/spatial/objects/cyberpunk_stilted_building/model.glb', 'model3d'),
  '赛博朋克吊脚楼',
)
assert.equal(
  spatialArtifactDisplayName('output/spatial/images/cyberpunk_signs_lanterns.png', 'image'),
  '赛博朋克招牌与灯笼',
)
assert.doesNotMatch(
  spatialArtifactDisplayName('output/spatial/images/quantum_flux_widget.png', 'image'),
  /[a-z]/i,
  'unknown legacy English filenames fall back to a Chinese product name',
)
assert.equal(
  spatialArtifactDisplayName('output/spatial/objects/modern_chair/model.glb', 'model3d'),
  '现代椅子',
)
assert.doesNotThrow(
  () => spatialArtifactDisplayName('output/spatial/images/%E0%A4%A.png', 'image'),
  'malformed legacy URL encoding cannot break the asset list',
)

console.log('workspace-file-explorer:verify passed')

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
const context = source('contexts', 'ChatContext.tsx')
const chatInput = source('components', 'chat', 'ChatInput.tsx')
const agentTeamPanel = source('components', 'team', 'AgentTeamPanel.tsx')
const chatRoute = source('app', 'api', 'chat', 'route.ts')
const globals = source('app', 'globals.css')
const topNav = source('components', 'shell', 'TopNavBar.tsx')
const workspacePage = source('app', '(shell)', 'page.tsx')
const shellLayout = source('app', '(shell)', 'layout.tsx')
const libraryPage = source('app', '(shell)', 'library', 'page.tsx')
const projectCard = source('components', 'library', 'ProjectCard.tsx')

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
assert.match(viewers, /进入空间舞台/)
assert.match(viewers, /Aholo 原始页面/)
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
assert.match(sidebar, /label="场景"/)
assert.match(sidebar, /SpatialSceneList/)
assert.match(context, /SidebarView = 'projects' \| 'scenes' \| 'files'/)
assert.match(context, /SpatialObservationDraft/)
assert.match(panel, /mode="embedded"/)
assert.match(panel, /activeSceneId/)
assert.match(workspacePage, /!isLoading && !activeSceneId/)
assert.match(chatInput, /id="pegasus-chat-input"/)
assert.match(chatInput, /参考文件/)
assert.match(chatInput, /记忆 \{memoryEnabled \? 'ON' : 'OFF'\}/)
assert.match(context, /memoryEnabled: boolean/)
assert.match(context, /memory_enabled: enabled/)
assert.match(chatRoute, /memoryEnabled && memoryV2Flags\.extraction\(\)/)
assert.match(chatRoute, /memoryEnabled && memoryV2Flags\.profileInjection\(\)/)
assert.match(chatRoute, /memoryEnabled && memoryV2Flags\.historyInjection\(\)/)
assert.match(chatRoute, /memoryEnabled && memoryV2Flags\.recallTool\(\)/)
assert.match(chatInput, /SCENE OBSERVATION/)
assert.match(chatInput, /spatial\/scenes\/\$\{encodeURIComponent\(spatialObservationDraft\.sceneId\)\}\/observations/)
assert.doesNotMatch(topNav, /空间舞台/, 'Scene stage should be project-internal rather than a primary navigation item')
assert.match(viewers, /已发布资产/)
assert.match(viewers, /来源关系/)
assert.match(viewers, /空间世界 · \{worldStatusLabel\(status\)\}/)
assert.match(viewers, /worldRelationLabel\(relation\.kind\)/)

assert.doesNotMatch(workbench, /Agent 会选择合适的图像、3D 造物和世界生成工具/)
assert.doesNotMatch(workbench, /创作语境（不锁定工具）/)
assert.match(workbench, /bg-surface/)
assert.match(workbench, /bg-\[var\(--paper\)\]/)
assert.match(workbench, /placeholder:text-ink-muted/)
assert.match(workbench, /focus:placeholder:text-transparent/)
assert.match(workbench, /描述你想进入的空间。可以补充用途、氛围、材质、光线，以及需要保留或避免的元素。/)
assert.match(workbench, /useAutoResizeTextarea/)
assert.match(workbench, /QUESTION_MIN_HEIGHT = 104/)
assert.match(workbench, /QUESTION_MAX_HEIGHT = 220/)
assert.match(workbench, /resize-none/)
assert.doesNotMatch(workbench, /resize-y/)
assert.doesNotMatch(workbench, /<select/, 'Workbench dropdowns should use the product-styled listbox')
assert.match(workbench, /aria-controls="workbench-model-options"/)
assert.match(workbench, /role="listbox" aria-label="推理模型"/)
assert.match(workbench, /id="workbench-composer"/)
assert.match(workbench, /items-center justify-center overflow-hidden bg-surface/)
assert.doesNotMatch(workbench, />你想创造什么？</)
assert.match(workbench, /aria-label="空间创作描述"/)
assert.doesNotMatch(workbench, /rounded-\[14px\] border border-ghost-border\/75/)
assert.match(workbench, /记忆 \{memoryEnabled \? 'ON' : 'OFF'\}/)
assert.equal(workbench.match(/添加参考文件/g)?.length, 1)
assert.doesNotMatch(workbench, /border-dashed/)
assert.doesNotMatch(workbench, /flex flex-wrap items-center gap-2 border-t border-ghost-border\/55 px-2\.5 py-2\.5/)
assert.match(workbench, /ACCEPTED_UPLOAD_TYPES/)
assert.match(workbench, /\/api\/media\/upload/)
assert.match(workbench, /<reference-file name=/)
assert.doesNotMatch(workbench, /Agentic spatial creation/i)
assert.doesNotMatch(workbench, /⌘ \/ Ctrl \+ Enter 开始/)
assert.doesNotMatch(workbench, /useConversations|hasSidebarContent|最近项目/)
assert.doesNotMatch(workbench, /给 Agent 的创作简报/)
assert.match(sidebar, /if \(pathname !== '\/'\) router\.push\('\/'\)/)
assert.match(shellLayout, /!pathname\.startsWith\('\/library'\) && !pathname\.startsWith\('\/store'\)/)
assert.match(shellLayout, /\{showSidebar && <AppSidebar \/>\}/)
assert.match(sidebar, /text-\[12\.5px\][^>]+>空间创作导航/)
assert.match(sidebar, /text-\[13\.5px\][^>]+>设置与帮助/)
assert.match(sidebar, /创建或打开项目后，可在“场景”查看空间版本/)
assert.match(sidebar, /\{collapsed && \(/)
assert.doesNotMatch(workbench, /bg-\[#f3f5f8\]|bg-white\/90/)
assert.doesNotMatch(workbench, /物体模式|世界模式|固定流水线/)

assert.match(libraryPage, /max-w-6xl/)
assert.match(libraryPage, /sm:grid-cols-2 xl:grid-cols-3/)
assert.match(libraryPage, /handleNewChat\(\)/)
assert.match(libraryPage, /新建项目/)
assert.match(projectCard, /min-h-\[176px\]/)
assert.match(projectCard, /fileCount/)
assert.match(projectCard, /更新于/)

assert.match(agentTeamPanel, /snapshot\.agents\.some\(agent => !agent\.is_root\)/)
assert.match(agentTeamPanel, /if \(!hasMemberAgents\) return null/)
assert.doesNotMatch(agentTeamPanel, /正在建立只读状态视图/)
const inputToolbarCss = globals.match(/\.pmo-input-toolbar\s*\{[\s\S]*?\}/)?.[0] ?? ''
assert.match(inputToolbarCss, /background:/)
assert.doesNotMatch(inputToolbarCss, /border-top:/)

console.log('spatial-product-ui:verify passed')

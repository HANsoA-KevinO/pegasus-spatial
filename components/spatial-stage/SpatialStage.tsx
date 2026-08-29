'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ImageAttachment } from '@/lib/types'
import type { SceneObjectInstance, SceneViewpoint } from '@/lib/spatial/scene-types'
import type { WorkspaceArtifact } from '@/hooks/useWorkspaceArtifacts'
import { useChatContext } from '@/contexts/ChatContext'
import { useGridFSContent } from '@/hooks/useGridFSContent'
import { conciseSceneDisplayName } from '@/lib/spatial/presentation-name'
import { AholoWorldCanvas, type SpatialCanvasHandle, type SpatialQualityRenderState, type StageCameraPose } from './AholoWorldCanvas'
import { SceneModelIcon } from './SpatialSceneList'
import { chooseWorldRenderSource, listWorldManifests, parseWorldStageManifest, worldBinaryUrl } from './world-stage-model'
import styles from './SpatialStage.module.css'

interface SceneSummary { scene_id: string; title: string; current_version: number; current_revision_id: string; agent_viewpoint: SceneViewpoint | null }
interface SceneRevision { revision_id: string; version: number; change_summary: string; world: { up_axis: 'Y' | 'Z'; artifacts: Array<{ workspace_path: string; sha256: string }> } | null; instances: SceneObjectInstance[] }
interface SceneHistorySummary { revision_id: string; version: number; change_summary: string }
interface SceneResponse { scene: SceneSummary; revision: SceneRevision; history?: SceneHistorySummary[] }
interface RenderSession { session_id: string; lease_token: string }
interface RenderCommand { command_id: string; observation_id: string; viewpoint: SceneViewpoint; lease: { token: string } }

const SCENE_LIST_POLL_MS = 2_500
const SCENE_DETAIL_POLL_MS = 1_800
const RENDER_COMMAND_IDLE_POLL_MS = 2_500
const RENDER_COMMAND_ACTIVE_POLL_MS = 250
const EMBEDDED_NAVIGATION_HINT_DISMISSED_KEY = 'pegasus-spatial-embedded-navigation-hint-dismissed'
const EMPTY_SCENE_INSTANCES: SceneObjectInstance[] = []
const INITIAL_QUALITY_RENDER_STATE: SpatialQualityRenderState = {
  status: 'glb',
  instanceId: null,
  loadedCount: 0,
  totalCount: 0,
}

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError'
}

function sceneSummaryFingerprint(scene: SceneSummary): string {
  return JSON.stringify([
    scene.scene_id,
    scene.title,
    scene.current_version,
    scene.current_revision_id,
    scene.agent_viewpoint,
  ])
}

function sameSceneSummaries(current: readonly SceneSummary[], incoming: readonly SceneSummary[]): boolean {
  return current.length === incoming.length
    && current.every((scene, index) => sceneSummaryFingerprint(scene) === sceneSummaryFingerprint(incoming[index]!))
}

function compactHistory(history: readonly SceneHistorySummary[] | undefined): SceneHistorySummary[] | undefined {
  return history?.map(item => ({
    revision_id: item.revision_id,
    version: item.version,
    change_summary: item.change_summary,
  }))
}

function sceneResponseFingerprint(value: SceneResponse): string {
  return JSON.stringify({
    scene: [
      value.scene.scene_id,
      value.scene.title,
      value.scene.current_version,
      value.scene.current_revision_id,
      value.scene.agent_viewpoint,
    ],
    revision: [
      value.revision.revision_id,
      value.revision.version,
      value.revision.change_summary,
      value.revision.world,
      value.revision.instances,
    ],
    history: value.history?.map(item => [item.revision_id, item.version, item.change_summary]) ?? null,
  })
}

function reconcileSceneResponse(current: SceneResponse | null, incoming: SceneResponse): SceneResponse {
  const incomingHistory = compactHistory(incoming.history)
  const next: SceneResponse = {
    scene: incoming.scene,
    revision: incoming.revision,
    ...(incomingHistory
      ? { history: incomingHistory }
      : current?.history
        ? { history: current.history }
        : {}),
  }
  return current && sceneResponseFingerprint(current) === sceneResponseFingerprint(next) ? current : next
}

function shortId(value: string | null | undefined): string {
  if (!value) return '—'
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value
}

function vectorText(value: readonly number[] | null | undefined): string {
  return value?.map(item => Number(item).toFixed(2)).join(' · ') ?? '— · — · —'
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  if (!response.ok) throw new Error((await response.json().catch(() => null) as { error?: string } | null)?.error ?? `HTTP ${response.status}`)
  return response.json() as Promise<T>
}

async function uploadPng(conversationId: string, blob: Blob): Promise<{ assetId: string; mimeType: string }> {
  const form = new FormData(); form.set('file', new File([blob], 'view.png', { type: 'image/png' })); form.set('conversationId', conversationId)
  const response = await fetch('/api/media/upload', { method: 'POST', body: form })
  if (!response.ok) throw new Error('观察截图上传失败。')
  const body = await response.json() as { image: { assetId: string; mimeType: string } }
  return body.image
}

export function SpatialStage({ conversationId, projectTitle, artifacts, isProjectLoading, initialManifestPath = null, embedded = false, sceneId = null }: {
  conversationId: string; projectTitle: string | null; artifacts: WorkspaceArtifact[]; isProjectLoading: boolean; initialManifestPath?: string | null; embedded?: boolean; sceneId?: string | null
}) {
  const { sendMessage } = useChatContext()
  const canvasRef = useRef<SpatialCanvasHandle>(null)
  const sceneListEpochRef = useRef(0)
  const sceneDetailEpochRef = useRef(0)
  const manifests = useMemo(() => listWorldManifests(artifacts), [artifacts])
  const [scenes, setScenes] = useState<SceneSummary[]>([])
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(sceneId)
  const [sceneData, setSceneData] = useState<SceneResponse | null>(null)
  const [previewVersion, setPreviewVersion] = useState<number | null>(null)
  const [legacyPath, setLegacyPath] = useState<string>('')
  const [cameraPose, setCameraPose] = useState<StageCameraPose | null>(null)
  const [cameraMode, setCameraMode] = useState<'user' | 'agent'>('user')
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [qualityMode, setQualityMode] = useState<'glb' | 'ply'>('glb')
  const [qualityReloadToken, setQualityReloadToken] = useState(0)
  const [qualityRenderState, setQualityRenderState] = useState<SpatialQualityRenderState>(INITIAL_QUALITY_RENDER_STATE)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeDrawer, setActiveDrawer] = useState<'library' | 'inspector' | null>(null)
  const [libraryTab, setLibraryTab] = useState<'assets' | 'scenes' | 'history'>('assets')
  const [showEmbeddedNavigationHint, setShowEmbeddedNavigationHint] = useState(false)
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false)
  const cameraMenuRef = useRef<HTMLDivElement>(null)
  const manifestPreviewPath = initialManifestPath || null
  const isManifestPreview = manifestPreviewPath !== null
  const standaloneStageHref = useMemo(() => {
    const query = new URLSearchParams()
    if (manifestPreviewPath) query.set('manifest', manifestPreviewPath)
    else if (selectedSceneId) query.set('scene', selectedSceneId)
    const search = query.toString()
    return `/spatial/${encodeURIComponent(conversationId)}${search ? `?${search}` : ''}`
  }, [conversationId, manifestPreviewPath, selectedSceneId])

  useEffect(() => {
    // The embedded Stage already receives an authoritative Scene id from the
    // application sidebar. Avoid mounting a second copy of the same list poll.
    if (embedded) return

    const requestEpoch = ++sceneListEpochRef.current
    const controller = new AbortController()
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async () => {
      try {
        const list = await json<{ scenes: SceneSummary[] }>(
          `/api/conversations/${encodeURIComponent(conversationId)}/spatial/scenes`,
          { signal: controller.signal },
        )
        if (stopped || controller.signal.aborted || sceneListEpochRef.current !== requestEpoch) return
        setScenes(current => sameSceneSummaries(current, list.scenes) ? current : list.scenes)
        setSelectedSceneId(current => {
          if (sceneId && list.scenes.some(scene => scene.scene_id === sceneId)) return sceneId
          return current && list.scenes.some(scene => scene.scene_id === current)
            ? current
            : list.scenes[0]?.scene_id ?? null
        })
      } catch (cause) {
        if (!stopped && !controller.signal.aborted && !isAbortError(cause)) {
          // The standalone Stage keeps its last good catalog through transient
          // failures and retries only after this request has settled.
        }
      } finally {
        if (!stopped && !controller.signal.aborted && sceneListEpochRef.current === requestEpoch) {
          timer = setTimeout(() => void poll(), SCENE_LIST_POLL_MS)
        }
      }
    }
    void poll()
    return () => {
      stopped = true
      controller.abort()
      if (timer) clearTimeout(timer)
      if (sceneListEpochRef.current === requestEpoch) sceneListEpochRef.current += 1
    }
  }, [conversationId, embedded, sceneId])

  useEffect(() => {
    if (!selectedSceneId || isManifestPreview) {
      setSceneData(null)
      return
    }

    const requestEpoch = ++sceneDetailEpochRef.current
    const controller = new AbortController()
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let needsHistoryRefresh = true
    let acceptedRevisionId: string | null = null
    let hasAcceptedResponse = false
    const poll = async () => {
      const includeHistory = previewVersion !== null || needsHistoryRefresh
      const query = new URLSearchParams()
      if (includeHistory) query.set('history', '1')
      if (previewVersion !== null) query.set('version', String(previewVersion))
      const search = query.toString()
      const suffix = search ? `?${search}` : ''
      try {
        const incoming = await json<SceneResponse>(
          `/api/conversations/${encodeURIComponent(conversationId)}/spatial/scenes/${encodeURIComponent(selectedSceneId)}${suffix}`,
          { signal: controller.signal },
        )
        if (stopped || controller.signal.aborted || sceneDetailEpochRef.current !== requestEpoch) return

        const revisionChanged = acceptedRevisionId !== null
          && acceptedRevisionId !== incoming.revision.revision_id
        acceptedRevisionId = incoming.revision.revision_id
        hasAcceptedResponse = true
        needsHistoryRefresh = incoming.history ? false : revisionChanged
        setError(null)
        setSceneData(current => reconcileSceneResponse(current, incoming))
      } catch (cause) {
        if (
          !hasAcceptedResponse
          && !stopped
          && !controller.signal.aborted
          && sceneDetailEpochRef.current === requestEpoch
          && !isAbortError(cause)
        ) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        // Historical revisions are immutable. Fetch a preview once; current
        // revisions use a serial poll and request full history only initially
        // or immediately after the current revision id changes.
        if (
          previewVersion === null
          && !stopped
          && !controller.signal.aborted
          && sceneDetailEpochRef.current === requestEpoch
        ) {
          timer = setTimeout(() => void poll(), SCENE_DETAIL_POLL_MS)
        }
      }
    }
    void poll()
    return () => {
      stopped = true
      controller.abort()
      if (timer) clearTimeout(timer)
      if (sceneDetailEpochRef.current === requestEpoch) sceneDetailEpochRef.current += 1
    }
  }, [conversationId, isManifestPreview, previewVersion, selectedSceneId])
  useEffect(() => {
    if (manifestPreviewPath) return
    setLegacyPath(current => current && manifests.some(item => item.path === current) ? current : manifests[0]?.path ?? '')
  }, [manifestPreviewPath, manifests])
  useEffect(() => {
    setPreviewVersion(null)
    setQualityMode('glb')
    setQualityReloadToken(0)
    setQualityRenderState(current => (
      current.status === 'glb'
      && current.instanceId === null
      && (current.loadedCount ?? 0) === 0
      && (current.totalCount ?? 0) === 0
        ? current
        : INITIAL_QUALITY_RENDER_STATE
    ))
    setSelectedInstanceId(null)
    setCameraPose(null)
    // Never display or continue loading the previous Scene while the newly
    // selected revision is in flight. Passing no instances also lets the canvas
    // release any old PLY quality substitutes before the next Scene arrives.
    setSceneData(current => current?.scene.scene_id === selectedSceneId ? current : null)
  }, [selectedSceneId])
  useEffect(() => { if (sceneId) setSelectedSceneId(sceneId) }, [sceneId])
  useEffect(() => {
    if (!embedded) { setShowEmbeddedNavigationHint(false); return }
    try { setShowEmbeddedNavigationHint(localStorage.getItem(EMBEDDED_NAVIGATION_HINT_DISMISSED_KEY) !== '1') }
    catch { setShowEmbeddedNavigationHint(true) }
  }, [embedded])
  useEffect(() => {
    if (!activeDrawer) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setActiveDrawer(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [activeDrawer])
  useEffect(() => {
    if (!cameraMenuOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!cameraMenuRef.current?.contains(event.target as Node)) setCameraMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCameraMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [cameraMenuOpen])

  // An explicit Workspace manifest link is a World preview, not a request to open the
  // project's current Scene. Keep the query path authoritative (including query changes)
  // and never silently substitute another manifest when that exact artifact is unavailable.
  const effectiveLegacyPath = manifestPreviewPath ?? legacyPath
  const legacyArtifact = manifests.find(item => item.path === effectiveLegacyPath)
    ?? (isManifestPreview ? null : manifests[0] ?? null)
  const legacyFile = useGridFSContent(conversationId, legacyArtifact?.path ?? '', Boolean(legacyArtifact?.gridfsPending))
  const legacyManifest = useMemo(() => parseWorldStageManifest(legacyArtifact?.content || legacyFile.content), [legacyArtifact?.content, legacyFile.content])
  const legacyRender = chooseWorldRenderSource(legacyManifest)
  const displayedSceneData = isManifestPreview ? null : sceneData
  const worldAsset = displayedSceneData?.revision.world?.artifacts.find(asset => asset.workspace_path.endsWith('.spz'))
    ?? displayedSceneData?.revision.world?.artifacts.find(asset => asset.workspace_path.endsWith('.ply'))
  const renderFormat = worldAsset?.workspace_path.endsWith('.spz') ? 'spz' : worldAsset ? 'ply' : legacyRender?.format ?? null
  const assetUrl = worldAsset
    ? worldBinaryUrl(conversationId, worldAsset.workspace_path, worldAsset.sha256)
    : legacyRender ? worldBinaryUrl(conversationId, legacyRender.path, legacyRender.sha256) : null
  const upAxis = displayedSceneData?.revision.world?.up_axis ?? legacyManifest?.up_axis
  const objectUrl = useCallback((instance: SceneObjectInstance, quality: 'glb' | 'ply') => {
    const artifact = quality === 'ply' ? instance.optional_ply_artifact : instance.glb_artifact
    return worldBinaryUrl(conversationId, artifact?.workspace_path ?? instance.glb_artifact.workspace_path, artifact?.sha256 ?? instance.glb_artifact.sha256)
  }, [conversationId])
  const selectedInstance = displayedSceneData?.revision.instances.find(instance => instance.instance_id === selectedInstanceId) ?? null
  const agentMarkers = useMemo(() => displayedSceneData?.scene.agent_viewpoint
    ? [{ id: 'root-agent', label: '主 Agent', color: '#91dfc2', viewpoint: displayedSceneData.scene.agent_viewpoint }]
    : [], [displayedSceneData?.scene.agent_viewpoint])
  useEffect(() => {
    if (selectedInstanceId && displayedSceneData && !displayedSceneData.revision.instances.some(instance => instance.instance_id === selectedInstanceId)) {
      setSelectedInstanceId(null)
    }
  }, [displayedSceneData, selectedInstanceId])

  const selectedAssetLabel = qualityMode === 'ply' && selectedInstance?.optional_ply_artifact
    ? 'PLY 高质量替身'
    : 'GLB 可编辑真值'
  const plyCapableCount = displayedSceneData?.revision.instances.filter(instance => instance.optional_ply_artifact).length ?? 0
  const toggleQualityMode = () => {
    if (qualityMode === 'ply' && qualityRenderState.status === 'error') setQualityReloadToken(current => current + 1)
    setQualityMode(current => current === 'glb' ? 'ply' : 'glb')
  }

  useEffect(() => {
    if (!selectedSceneId || isManifestPreview) return
    let cancelled = false; let session: RenderSession | null = null; let pollTimer: ReturnType<typeof setTimeout> | null = null; let heartbeat: ReturnType<typeof setInterval> | null = null
    const clientId = sessionStorage.getItem('pegasus-spatial-render-client') ?? crypto.randomUUID(); sessionStorage.setItem('pegasus-spatial-render-client', clientId)
    const endpoint = `/api/conversations/${encodeURIComponent(conversationId)}/spatial/scenes/${encodeURIComponent(selectedSceneId)}`
    const poll = async () => {
      if (cancelled || !session) return
      let nextPollMs = RENDER_COMMAND_IDLE_POLL_MS
      try {
        const body = await json<{ command: RenderCommand | null }>(`${endpoint}/render-command`, { method: 'POST', body: JSON.stringify({ session_id: session.session_id, lease_token: session.lease_token }) })
        if (body.command && canvasRef.current) {
          const blob = await canvasRef.current.capture(body.command.viewpoint); const image = await uploadPng(conversationId, blob)
          await json(`${endpoint}/render-command/${encodeURIComponent(body.command.command_id)}/complete`, { method: 'POST', body: JSON.stringify({ session_id: session.session_id, command_lease_token: body.command.lease.token, asset_id: image.assetId, observation_id: body.command.observation_id, visible_instance_ids: canvasRef.current.visibleInstanceIds() }) })
          nextPollMs = RENDER_COMMAND_ACTIVE_POLL_MS
        }
      } catch { /* session refresh and command lease recovery are durable */ }
      if (!cancelled) pollTimer = setTimeout(poll, nextPollMs)
    }
    void json<{ session: RenderSession }>(`${endpoint}/render-session`, { method: 'POST', body: JSON.stringify({ client_id: clientId }) }).then(body => {
      if (cancelled) return; session = body.session; heartbeat = setInterval(() => void json(`${endpoint}/render-session`, { method: 'PATCH', body: JSON.stringify({ session_id: session?.session_id, lease_token: session?.lease_token }) }).catch(() => undefined), 7000); void poll()
    }).catch(() => undefined)
    return () => { cancelled = true; if (pollTimer) clearTimeout(pollTimer); if (heartbeat) clearInterval(heartbeat) }
  }, [conversationId, isManifestPreview, selectedSceneId])

  const submitObservation = async () => {
    if (!displayedSceneData || !canvasRef.current || !comment.trim()) return
    setBusy('正在冻结观察点'); setError(null)
    try {
      const viewpoint = canvasRef.current.currentViewpoint(); if (!viewpoint) throw new Error('相机尚未就绪。')
      const image = await uploadPng(conversationId, await canvasRef.current.capture())
      const response = await json<{ observation: { observation_id: string; revision_id: string; screenshot_workspace_path: string }; image: { assetId: string; mimeType: string } }>(`/api/conversations/${encodeURIComponent(conversationId)}/spatial/scenes/${encodeURIComponent(displayedSceneData.scene.scene_id)}/observations`, {
        method: 'POST', body: JSON.stringify({ asset_id: image.assetId, comment: comment.trim(), viewpoint, selected_instance_id: selectedInstanceId, visible_instance_ids: canvasRef.current.visibleInstanceIds() }),
      })
      const structured = `<spatial-observation observation_id="${response.observation.observation_id}" scene_id="${displayedSceneData.scene.scene_id}" scene_version="${displayedSceneData.revision.version}" selected_instance_id="${selectedInstanceId ?? ''}">\n${comment.trim()}\n相机：${JSON.stringify(viewpoint)}\n截图：${response.observation.screenshot_workspace_path}\n</spatial-observation>`
      const attachment: ImageAttachment = { assetId: response.image.assetId, mimeType: response.image.mimeType }
      sendMessage(structured, [attachment]); setComment(''); setBusy(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '观察提交失败。'); setBusy(null) }
  }

  const dismissEmbeddedNavigationHint = () => {
    setShowEmbeddedNavigationHint(false)
    try { localStorage.setItem(EMBEDDED_NAVIGATION_HINT_DISMISSED_KEY, '1') } catch { /* local preference is best effort */ }
  }

  const stageActions = <>
    <button
      type="button"
      className={styles.globalQualityToggle}
      data-active={qualityMode === 'ply'}
      aria-pressed={qualityMode === 'ply'}
      disabled={plyCapableCount === 0}
      onClick={toggleQualityMode}
      aria-label={qualityMode === 'ply' ? '切换到 GLB 实时模式' : '切换到高质量 PLY 模式'}
      title="整个 Scene 统一切换 GLB 与 PLY"
    >
      {qualityMode === 'ply'
        ? `高质量 PLY ${qualityRenderState.loadedCount ?? 0}/${plyCapableCount}`
        : 'GLB 实时模式'}
    </button>
    <div ref={cameraMenuRef} className={styles.cameraMenu}>
      <button
        type="button"
        className={styles.cameraMenuTrigger}
        data-open={cameraMenuOpen}
        aria-expanded={cameraMenuOpen}
        aria-controls="spatial-camera-menu"
        title="选择视角"
        onClick={() => setCameraMenuOpen(open => !open)}
      >
        <span>视角</span>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6 3.5 3.5L11.5 6" /></svg>
      </button>
      {cameraMenuOpen && <div id="spatial-camera-menu" className={styles.cameraMenuPopover} role="group" aria-label="选择空间视角">
        <button
          type="button"
          aria-pressed={cameraMode === 'user'}
          data-active={cameraMode === 'user'}
          onClick={() => { setCameraMode('user'); setCameraMenuOpen(false) }}
        >
          <span>用户视角</span><i aria-hidden="true">{cameraMode === 'user' ? '✓' : ''}</i>
        </button>
        <button
          type="button"
          aria-pressed={cameraMode === 'agent'}
          data-active={cameraMode === 'agent'}
          disabled={!displayedSceneData?.scene.agent_viewpoint}
          title={displayedSceneData?.scene.agent_viewpoint ? '查看 Agent 保存的观察相机' : 'Agent 尚未设置观察相机'}
          onClick={() => { setCameraMode('agent'); setCameraMenuOpen(false) }}
        >
          <span>Agent 视角</span><i aria-hidden="true">{cameraMode === 'agent' ? '✓' : ''}</i>
        </button>
        <span className={styles.cameraMenuDivider} role="separator" />
        <button
          type="button"
          onClick={() => { setCameraMode('user'); canvasRef.current?.resetUserView(); setCameraMenuOpen(false) }}
        >
          <span>重置视角</span>
        </button>
      </div>}
    </div>
    <button
      type="button"
      className={`${styles.assetLibraryButton} ${activeDrawer === 'library' ? styles.actionActive : ''}`}
      aria-controls="spatial-library-drawer"
      aria-expanded={activeDrawer === 'library'}
      aria-label="资产"
      data-tooltip="资产"
      data-spatial-asset-trigger
      onClick={() => setActiveDrawer(current => current === 'library' ? null : 'library')}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3.5 8 4.2-8 4.2-8-4.2 8-4.2Z" />
        <path d="m4 12 8 4.2 8-4.2M4 16.3l8 4.2 8-4.2" />
      </svg>
    </button>
    <button
      type="button"
      className={`${styles.editStageButton} ${activeDrawer === 'inspector' ? styles.actionActive : ''}`}
      aria-controls="spatial-inspector-drawer"
      aria-expanded={activeDrawer === 'inspector'}
      aria-label="修改空间"
      data-tooltip="修改空间"
      onClick={() => setActiveDrawer(current => current === 'inspector' ? null : 'inspector')}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15.75 5.25 3 3M6.75 17.25l2.72-.54a3 3 0 0 0 1.5-.82l8.28-8.28a2.12 2.12 0 0 0-3-3l-8.28 8.28a3 3 0 0 0-.82 1.5l-.54 2.72a.12.12 0 0 0 .14.14Z" /><path d="M5 20h14" /></svg>
    </button>
  </>

  return <main
    className={`${styles.stageShell} ${embedded ? styles.stageEmbedded : ''}`}
    data-spatial-stage-mode={embedded ? 'embedded' : 'standalone'}
    data-navigation-hint-visible={embedded && showEmbeddedNavigationHint && !activeDrawer}
  >
    <section className={styles.viewportColumn} aria-label="空间舞台画布">
      <AholoWorldCanvas
        ref={canvasRef}
        assetUrl={assetUrl}
        format={renderFormat}
        upAxis={upAxis}
        instances={displayedSceneData?.revision.instances ?? EMPTY_SCENE_INSTANCES}
        objectUrl={objectUrl}
        agentViewpoint={displayedSceneData?.scene.agent_viewpoint}
        agentMarkers={agentMarkers}
        cameraMode={cameraMode}
        qualityMode={qualityMode}
        qualityReloadToken={qualityReloadToken}
        selectedInstanceId={selectedInstanceId}
        framingKey={displayedSceneData
          ? `${displayedSceneData.scene.scene_id}:${displayedSceneData.revision.revision_id}`
          : legacyArtifact ? `manifest:${legacyArtifact.path}:${legacyRender?.sha256 ?? ''}` : null}
        onQualityStateChange={setQualityRenderState}
        onSelectInstance={setSelectedInstanceId}
        onCameraChange={setCameraPose}
      />

      {!embedded && <header className={styles.stageHeader} data-spatial-stage-header>
        <div className={styles.stageIdentity}>
          <Link href="/" className={styles.backButton} aria-label="返回对话">←</Link>
          <div>
            <h1>{displayedSceneData?.scene.title ?? legacyManifest?.title ?? projectTitle ?? '未命名空间'}</h1>
          </div>
        </div>

        <div className={styles.headerMeta} aria-label="空间状态">
          <span>{renderFormat?.toUpperCase() ?? '无环境'}</span>
          <span>{displayedSceneData?.revision.instances.length ?? 0} 个物体</span>
          <span>{assetUrl ? '渲染就绪' : isProjectLoading ? '读取中' : '等待 World'}</span>
        </div>

        <div className={styles.headerActions}>{stageActions}</div>
      </header>}

      {embedded && <Link
        href={standaloneStageHref}
        className={styles.embeddedFullscreenButton}
        aria-label="进入全屏完整空间舞台"
        data-embedded-stage-fullscreen
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 3H4a1 1 0 0 0-1 1v4M16 3h4a1 1 0 0 1 1 1v4M8 21H4a1 1 0 0 1-1-1v-4m13 5h4a1 1 0 0 0 1-1v-4" />
        </svg>
        <span>全屏空间舞台</span>
      </Link>}

      <div className={styles.selectionToast} data-visible={Boolean(selectedInstance)}>
        <span>已选择</span>
        <strong>{selectedInstance?.label ?? '点击 GLB 物体进行选择'}</strong>
        {selectedInstance && <button type="button" onClick={() => setActiveDrawer('inspector')}>查看</button>}
        {selectedInstance && <button type="button" onClick={() => setSelectedInstanceId(null)}>取消</button>}
      </div>

      {!embedded && <div className={styles.viewportFooter}>
        <div className={styles.cameraReadout}><span className={styles.coordinateLabel}>相机</span><code>{vectorText(cameraPose?.position)}</code></div>
      </div>}

      {embedded && showEmbeddedNavigationHint && !activeDrawer && <aside
        className={styles.embeddedNavigationHint}
        aria-label="空间舞台移动操作提示"
        data-embedded-navigation-hint
      >
        <div className={styles.embeddedNavigationInstructions}>
          <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 平移</span>
          <span><kbd>Q</kbd><kbd>E</kbd> 升降</span>
          <span><kbd>Shift</kbd> 加速</span>
          <span>左键拖动环视</span>
        </div>
        <button type="button" onClick={dismissEmbeddedNavigationHint}>不再提醒</button>
      </aside>}
    </section>

    {activeDrawer === 'library' && <aside id="spatial-library-drawer" className={styles.buildRail} aria-label="场景资产库">
      <div className={styles.panelHeading}>
        <div><strong>场景资产库</strong><small>选择内容后在画布中高亮</small></div>
        <button type="button" onClick={() => setActiveDrawer(null)} aria-label="关闭资产库">×</button>
      </div>
      <div className={styles.drawerTabs} role="tablist" aria-label="资产库分类">
        <button id="spatial-assets-tab" type="button" role="tab" aria-controls="spatial-assets-panel" aria-selected={libraryTab === 'assets'} onClick={() => setLibraryTab('assets')}>物体 <span>{displayedSceneData?.revision.instances.length ?? 0}</span></button>
        <button id="spatial-scenes-tab" type="button" role="tab" aria-controls="spatial-scenes-panel" aria-selected={libraryTab === 'scenes'} onClick={() => setLibraryTab('scenes')}>场景 <span>{scenes.length}</span></button>
        <button id="spatial-history-tab" type="button" role="tab" aria-controls="spatial-history-panel" aria-selected={libraryTab === 'history'} onClick={() => setLibraryTab('history')}>版本 <span>{displayedSceneData?.history?.length ?? 0}</span></button>
      </div>

      {libraryTab === 'assets' && <section id="spatial-assets-panel" role="tabpanel" aria-labelledby="spatial-assets-tab" className={styles.assetLibrarySection}>
        <div className={styles.sectionLabel}><span>已放置物品</span><em>{displayedSceneData?.revision.instances.length ?? 0}</em></div>
        <div className={styles.assetLibraryList}>{displayedSceneData?.revision.instances.map((instance, index) => <button
          key={instance.instance_id}
          type="button"
          aria-pressed={selectedInstanceId === instance.instance_id}
          onClick={() => setSelectedInstanceId(instance.instance_id)}
        >
          <span className={styles.assetOrdinal}>{String(index + 1).padStart(2, '0')}</span>
          <span className={styles.assetLibraryCopy}><strong>{instance.label}</strong><small>{instance.optional_ply_artifact ? 'GLB + PLY' : 'GLB'}</small></span>
          <i aria-hidden="true" />
        </button>)}</div>
        {!displayedSceneData?.revision.instances.length && <p className={styles.emptyCopy}>{isManifestPreview ? '当前正在预览独立 World manifest；Scene 物体未叠加。' : 'Agent 放入 Scene 的 Lux 资产会显示在这里。'}</p>}
      </section>}

      {libraryTab === 'scenes' && <section id="spatial-scenes-panel" role="tabpanel" aria-labelledby="spatial-scenes-tab" className={styles.railSection}>
        <div className={styles.sectionLabel}><span>项目场景</span><em>{scenes.length}</em></div>
        <div className={styles.buildList}>{scenes.map(scene => {
          const active = scene.scene_id === selectedSceneId
          const displayName = conciseSceneDisplayName(scene.title)
          return <button
            key={scene.scene_id}
            type="button"
            className={`${styles.buildItem} ${active ? styles.buildItemActive : ''}`}
            aria-label={`打开场景模型：${displayName}`}
            aria-pressed={active}
            data-model-kind="scene"
            onClick={() => setSelectedSceneId(scene.scene_id)}
          >
            <span className={styles.sceneModelIcon} aria-hidden="true"><SceneModelIcon /></span>
            <strong>{displayName}</strong>
          </button>
        })}</div>
      </section>}

      {libraryTab === 'history' && <section id="spatial-history-panel" role="tabpanel" aria-labelledby="spatial-history-tab" className={styles.historySection}>
        <div className={styles.sectionLabel}><span>自动版本</span><em>{displayedSceneData?.history?.length ?? 0}</em></div>
        <div className={styles.historyList}>{displayedSceneData?.history?.slice(0, 24).map(item => {
          const isCurrent = item.version === displayedSceneData.scene.current_version
          const isPreview = previewVersion === item.version
          return <button key={item.revision_id} type="button" className={`${styles.historyItem} ${isPreview || (!previewVersion && isCurrent) ? styles.historyItemActive : ''}`} onClick={() => setPreviewVersion(isCurrent ? null : item.version)} aria-label={`v${item.version} ${item.change_summary}`}>
            <span>v{item.version}</span><strong>{item.change_summary}</strong>{isCurrent && <small>当前</small>}
          </button>
        })}</div>
        {previewVersion && <button type="button" className={styles.returnCurrent} onClick={() => setPreviewVersion(null)}>返回当前版本</button>}
      </section>}
    </aside>}

    {activeDrawer === 'inspector' && <aside id="spatial-inspector-drawer" className={styles.inspector} aria-label="对象与观察">
      <div className={styles.panelHeading}>
        <div><strong>{selectedInstance ? '对象详情' : '空间观察'}</strong><small>{selectedInstance ? '当前选中的可编辑物体' : '把当前视角交给 Agent'}</small></div>
        <button type="button" onClick={() => setActiveDrawer(null)} aria-label="关闭观察面板">×</button>
      </div>

      {selectedInstance && <section className={styles.objectDetail}>
        <div className={styles.detailTitle}><div><span>当前选择</span><h2>{selectedInstance.label}</h2></div><button type="button" onClick={() => setSelectedInstanceId(null)}>×</button></div>
        <dl className={styles.transformGrid}>
          <div><dt>位置 XYZ</dt><dd>{vectorText(selectedInstance.transform.position)}</dd></div>
          <div><dt>缩放 XYZ</dt><dd>{vectorText(selectedInstance.transform.scale)}</dd></div>
          <div><dt>来源 Job</dt><dd title={selectedInstance.source_job_id}>{shortId(selectedInstance.source_job_id)}</dd></div>
          <div><dt>显示资产</dt><dd>{selectedAssetLabel}</dd></div>
        </dl>
        <p className={styles.qualityNotice}>{selectedInstance.optional_ply_artifact ? '支持舞台全局高质量 PLY 模式。' : '当前物体只提供 GLB。'}</p>
      </section>}

      <section className={styles.observationComposer}>
        <div className={styles.composerHeading}><div><span>从这里提出修改</span><h2>把你看到的问题交给 Agent</h2></div><b>真实截图</b></div>
        <p>{isManifestPreview ? '当前是独立 World 预览；请从无 manifest 参数的 Scene 舞台提交观察。' : `自动附上当前画面、相机位置、所选物体与 Scene v${displayedSceneData?.revision.version ?? '—'}。`}</p>
        <label htmlFor="spatial-observation">修改意见</label>
        <textarea id="spatial-observation" value={comment} onChange={event => setComment(event.target.value)} placeholder="例如：从这个角度看，椅子挡住了入口。把它移到右侧墙边，再加一盏落地灯。" rows={6} />
        <button type="button" className={styles.submitObservation} disabled={!comment.trim() || Boolean(busy) || !displayedSceneData || Boolean(previewVersion)} onClick={() => void submitObservation()}>{isManifestPreview ? 'World 预览仅供查看' : previewVersion ? '历史版本仅供观察' : busy ?? '截图并发送给 Agent'}<span>→</span></button>
        {error && <p className={styles.errorMessage} role="alert">{error}</p>}
      </section>

      <details className={styles.boundaryNote}>
        <summary>能力边界</summary>
        <p>截图来自当前真实渲染像素；不声称可以局部语义修改 3DGS，也不验证碰撞或物理正确性。</p>
      </details>
    </aside>}
  </main>
}

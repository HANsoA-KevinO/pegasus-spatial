'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ImageAttachment } from '@/lib/types'
import type { ScenePanoramaEnvironment, SceneViewpoint } from '@/lib/spatial/scene-types'
import type { SceneProgramRef } from '@/lib/scene-code/types'
import { SceneCodeCanvas, type CodeQualityState } from './SceneCodeCanvas'
import type { ThreeSceneInput } from './three-scene-runtime'
import type { WorkspaceArtifact } from '@/hooks/useWorkspaceArtifacts'
import { useChatContext } from '@/contexts/ChatContext'
import { useGridFSContent } from '@/hooks/useGridFSContent'
import { ThreeWorldCanvas, type SpatialCanvasHandle, type SpatialQualityRenderState, type StageCameraPose } from './ThreeWorldCanvas'
import { normalizeSpatialProxy, type SpatialStageInstance } from './proxy-geometry'
import { chooseWorldRenderSource, listWorldManifests, parseWorldStageManifest, worldBinaryUrl } from './world-stage-model'
import styles from './SpatialStage.module.css'

interface SceneSummary { scene_id: string; title: string; current_version: number; current_revision_id: string; agent_viewpoint: SceneViewpoint | null }
interface SceneRevision { program?: SceneProgramRef | null; revision_id: string; version: number; change_summary: string; environment: ScenePanoramaEnvironment | null; world: { up_axis: 'Y' | 'Z'; artifacts: Array<{ workspace_path: string; sha256: string }> } | null; instances: SpatialStageInstance[] }
interface SceneResponse { scene: SceneSummary; revision: SceneRevision; history?: Array<{ revision_id: string; version: number; change_summary: string }> }
interface RenderSession { session_id: string; lease_token: string }
interface RenderCommand {
  command_id: string
  revision_id: string
  observation_id: string
  viewpoint: SceneViewpoint
  lease: { token: string }
  kind?: 'capture' | 'surface_query'
  surface_query?: { terrain_instance_id: string; horizontal: [number, number]; cast_height: number; up_axis: 'Y' | 'Z' } | null
}

const RENDER_COMMAND_IDLE_POLL_MS = 2_500
const RENDER_COMMAND_ACTIVE_POLL_MS = 250
const RENDER_SESSION_HEARTBEAT_MS = 15_000

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

export function SpatialStage({ conversationId, projectTitle, artifacts, isProjectLoading, initialManifestPath = null, sceneId = null, embedded = false }: {
  conversationId: string; projectTitle: string | null; artifacts: WorkspaceArtifact[]; isProjectLoading: boolean; initialManifestPath?: string | null; sceneId?: string | null; embedded?: boolean
}) {
  const { sendMessage } = useChatContext()
  const legacyCanvasRef = useRef<SpatialCanvasHandle>(null), codeCanvasRef = useRef<SpatialCanvasHandle>(null)
  const canvasRef = useMemo(() => ({ get current() { return codeCanvasRef.current?.isReady() ? codeCanvasRef.current : legacyCanvasRef.current } }), [])
  const [codeReadyRevision, setCodeReadyRevision] = useState<string | null>(null)
  const lastLegacyInput = useRef<{ key: string; input: ThreeSceneInput; version: number | null } | null>(null)
  const manifests = useMemo(() => listWorldManifests(artifacts), [artifacts])
  const [scenes, setScenes] = useState<SceneSummary[]>([])
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
  const [sceneData, setSceneData] = useState<SceneResponse | null>(null)
  const [previewVersion, setPreviewVersion] = useState<number | null>(null)
  const [legacyPath, setLegacyPath] = useState<string>('')
  const [cameraPose, setCameraPose] = useState<StageCameraPose | null>(null)
  const [cameraMode, setCameraMode] = useState<'user' | 'agent'>('user')
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [qualityMode, setQualityMode] = useState<'glb' | 'ply'>('glb')
  const [qualityReloadToken, setQualityReloadToken] = useState(0)
  const [qualityRenderState, setQualityRenderState] = useState<SpatialQualityRenderState>({ status: 'glb', instanceId: null, loadedCount: 0, totalCount: 0 })
  const [codeQuality, setCodeQuality] = useState<CodeQualityState | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeDrawer, setActiveDrawer] = useState<'library' | 'inspector' | null>(null)
  const [libraryTab, setLibraryTab] = useState<'assets' | 'scenes' | 'history'>('assets')
  const manifestPreviewPath = initialManifestPath || null
  const isManifestPreview = manifestPreviewPath !== null

  const refreshScenes = useCallback(async () => {
    const list = await json<{ scenes: SceneSummary[] }>(`/api/conversations/${encodeURIComponent(conversationId)}/spatial/scenes`)
    setScenes(list.scenes)
    setSelectedSceneId(current => {
      if (sceneId && list.scenes.some(scene => scene.scene_id === sceneId)) return sceneId
      return current && list.scenes.some(scene => scene.scene_id === current) ? current : list.scenes[0]?.scene_id ?? null
    })
  }, [conversationId, sceneId])
  const refreshScene = useCallback(async () => {
    if (!selectedSceneId) { setSceneData(null); return }
    const query = new URLSearchParams({ history: '1' }); if (previewVersion) query.set('version', String(previewVersion))
    setSceneData(await json<SceneResponse>(`/api/conversations/${encodeURIComponent(conversationId)}/spatial/scenes/${encodeURIComponent(selectedSceneId)}?${query}`))
  }, [conversationId, previewVersion, selectedSceneId])
  useEffect(() => { void refreshScenes().catch(() => undefined); const timer = setInterval(() => void refreshScenes().catch(() => undefined), 2500); return () => clearInterval(timer) }, [refreshScenes])
  useEffect(() => { if (sceneId) setSelectedSceneId(sceneId) }, [sceneId])
  useEffect(() => { void refreshScene().catch(errorValue => setError(String(errorValue))); const timer = setInterval(() => void refreshScene().catch(() => undefined), 1800); return () => clearInterval(timer) }, [refreshScene])
  useEffect(() => {
    if (manifestPreviewPath) return
    setLegacyPath(current => current && manifests.some(item => item.path === current) ? current : manifests[0]?.path ?? '')
  }, [manifestPreviewPath, manifests])
  useEffect(() => { setPreviewVersion(null) }, [selectedSceneId])
  useEffect(() => {
    if (!activeDrawer) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setActiveDrawer(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [activeDrawer])

  // An explicit Workspace manifest link is a World preview, not a request to open the
  // project's current Scene. Keep the query path authoritative (including query changes)
  // and never silently substitute another manifest when that exact artifact is unavailable.
  const effectiveLegacyPath = manifestPreviewPath ?? legacyPath
  const legacyArtifact = manifests.find(item => item.path === effectiveLegacyPath)
    ?? (isManifestPreview ? null : manifests[0] ?? null)
  const legacyFile = useGridFSContent(conversationId, legacyArtifact?.path ?? '', Boolean(legacyArtifact?.gridfsPending))
  const legacyManifest = useMemo(() => parseWorldStageManifest(legacyArtifact?.content || legacyFile.content), [legacyArtifact?.content, legacyFile.content])
  const legacyRender = chooseWorldRenderSource(legacyManifest)
  const displayedSceneData = isManifestPreview || sceneData?.scene.scene_id !== selectedSceneId ? null : sceneData
  const worldAsset = displayedSceneData?.revision.world?.artifacts.find(asset => asset.workspace_path.endsWith('.spz'))
    ?? displayedSceneData?.revision.world?.artifacts.find(asset => asset.workspace_path.endsWith('.ply'))
  const renderFormat = worldAsset?.workspace_path.endsWith('.spz') ? 'spz' : worldAsset ? 'ply' : !displayedSceneData ? legacyRender?.format ?? null : null
  const assetUrl = worldAsset
    ? worldBinaryUrl(conversationId, worldAsset.workspace_path, worldAsset.sha256)
    : !displayedSceneData && legacyRender ? worldBinaryUrl(conversationId, legacyRender.path, legacyRender.sha256) : null
  const environment = displayedSceneData?.revision.environment ?? null
  const environmentUrl = environment
    ? worldBinaryUrl(conversationId, environment.workspace_path, environment.sha256)
    : null
  const upAxis = displayedSceneData?.revision.world?.up_axis ?? legacyManifest?.up_axis
  const objectUrl = useCallback((instance: SpatialStageInstance, quality: 'glb' | 'ply') => {
    const artifact = quality === 'ply' ? instance.optional_ply_artifact : instance.glb_artifact
    return artifact ? worldBinaryUrl(conversationId, artifact.workspace_path, artifact.sha256) : null
  }, [conversationId])
  const codeProgram = displayedSceneData?.revision.program
  const legacyInput = useMemo<ThreeSceneInput>(() => ({ revisionId: displayedSceneData?.revision.revision_id, assetUrl, format: renderFormat, environmentUrl, environmentYawDeg: environment?.yaw_deg, environmentExposure: environment?.exposure, upAxis, instances: displayedSceneData?.revision.instances ?? [], objectUrl, agentViewpoint: displayedSceneData?.scene.agent_viewpoint, cameraMode, qualityMode, qualityReloadToken, selectedInstanceId }), [displayedSceneData?.revision.revision_id, displayedSceneData?.revision.instances, displayedSceneData?.scene.agent_viewpoint, assetUrl, renderFormat, environmentUrl, environment?.yaw_deg, environment?.exposure, upAxis, objectUrl, cameraMode, qualityMode, qualityReloadToken, selectedInstanceId])
  useEffect(() => { if (!codeProgram) { lastLegacyInput.current = { key: isManifestPreview ? effectiveLegacyPath : selectedSceneId ?? 'empty', input: legacyInput, version: displayedSceneData?.revision.version ?? null }; setCodeReadyRevision(null) } }, [codeProgram, isManifestPreview, effectiveLegacyPath, selectedSceneId, legacyInput, displayedSceneData?.revision.version])
  const fallback = lastLegacyInput.current
  const canvasInput = codeProgram && fallback ? fallback.input : legacyInput
  const shownVersion = codeProgram ? displayedSceneData?.history?.find(item => item.revision_id === codeReadyRevision)?.version ?? fallback?.version : displayedSceneData?.revision.version
  const waitingForCode = !!codeProgram && codeReadyRevision !== displayedSceneData?.revision.revision_id
  const effectiveInstances: SpatialStageInstance[] = useMemo(() => codeProgram ? codeProgram.objects.map(object => ({ instance_id: object.key, key: object.key, label: object.label, role: object.role, visible: object.measured.visible, transform: { position: object.measured.position, rotation_quaternion: object.measured.rotation_quaternion, scale: object.measured.scale } })) : displayedSceneData?.revision.instances ?? [], [codeProgram, displayedSceneData?.revision.instances])
  const selectedInstance = effectiveInstances.find(instance => instance.instance_id === selectedInstanceId) ?? null
  const selectedDescriptor = codeProgram?.objects.find(object => object.key === selectedInstanceId)
  const renderedRevision = useRef<string | null>(null)
  useEffect(() => { renderedRevision.current = !previewVersion && !codeProgram ? displayedSceneData?.revision.revision_id ?? null : null }, [displayedSceneData, codeProgram, previewVersion])
  const agentMarkers = useMemo(() => displayedSceneData?.scene.agent_viewpoint
    ? [{ id: 'root-agent', label: '主 Agent', color: '#91dfc2', viewpoint: displayedSceneData.scene.agent_viewpoint }]
    : [], [displayedSceneData?.scene.agent_viewpoint])
  useEffect(() => {
    if (selectedInstanceId && displayedSceneData && !effectiveInstances.some(instance => instance.instance_id === selectedInstanceId)) {
      setSelectedInstanceId(null)
    }
  }, [displayedSceneData, effectiveInstances, selectedInstanceId])

  const handleCanvasSelect = useCallback((instanceId: string | null) => {
    setSelectedInstanceId(instanceId)
    if (instanceId) setActiveDrawer('inspector')
  }, [])

  const selectedAssetLabel = codeProgram ? 'Three.js 源码' : selectedInstance && normalizeSpatialProxy(selectedInstance)
    ? '程序化几何'
    : qualityMode === 'ply' && selectedInstance?.optional_ply_artifact
      ? 'PLY 高质量替身'
      : 'GLB 网格'
  const plyCapableCount = displayedSceneData?.revision.instances.filter(instance => !normalizeSpatialProxy(instance) && instance.optional_ply_artifact).length ?? 0
  const displayedCodeQuality = codeQuality?.revision === displayedSceneData?.revision.revision_id ? codeQuality : null
  const canShowPly = codeProgram ? displayedCodeQuality?.available === true : plyCapableCount > 0
  const qualityError = codeProgram ? displayedCodeQuality?.error : qualityRenderState.error
  const loadedPly = codeProgram ? displayedCodeQuality?.loadedCount ?? 0 : qualityRenderState.loadedCount ?? 0
  const totalPly = codeProgram ? displayedCodeQuality?.totalCount ?? 0 : plyCapableCount
  const toggleQualityMode = () => {
    if (qualityMode === 'ply' && qualityRenderState.status === 'error') setQualityReloadToken(current => current + 1)
    setQualityMode(current => current === 'glb' ? 'ply' : 'glb')
  }
  const qualityButton = <button
    type="button"
    className={styles.globalQualityToggle}
    data-active={qualityMode === 'ply' && canShowPly}
    aria-pressed={qualityMode === 'ply' && canShowPly}
    disabled={!canShowPly}
    onClick={toggleQualityMode}
    title={qualityError ? `部分 PLY 无法显示，保留 GLB。${qualityError}` : '切换有配套 PLY 的物体，其他物体保留 GLB'}
  >{canShowPly && displayedCodeQuality?.loading ? qualityMode === 'ply' ? '正在加载 PLY' : '正在切回 GLB'
    : qualityMode === 'ply' && canShowPly ? `高质量 PLY ${loadedPly}/${totalPly}` : 'GLB 实时模式'}</button>

  useEffect(() => {
    if (!selectedSceneId || isManifestPreview || previewVersion || codeProgram) return
    let cancelled = false; let session: RenderSession | null = null; let registration: Promise<void> | null = null; let pollTimer: ReturnType<typeof setTimeout> | null = null; let heartbeat: ReturnType<typeof setInterval> | null = null
    // A mounted Stage is one render client. Persisted browser IDs can be shared
    // by copied tabs, which lets one tab invalidate the other's lease forever.
    const clientId = crypto.randomUUID()
    const endpoint = `/api/conversations/${encodeURIComponent(conversationId)}/spatial/scenes/${encodeURIComponent(selectedSceneId)}`
    const register = () => {
      if (cancelled) return Promise.resolve()
      if (registration) return registration
      registration = json<{ session: RenderSession }>(endpoint + '/render-session', { method: 'POST', body: JSON.stringify({ client_id: clientId }) })
        .then(body => { if (!cancelled) session = body.session })
        .finally(() => { registration = null })
      return registration
    }
    const invalidate = (candidate: RenderSession) => {
      if (session?.session_id === candidate.session_id && session.lease_token === candidate.lease_token) session = null
    }
    const keepAlive = async () => {
      if (cancelled) return
      if (!session) { await register().catch(() => undefined); return }
      const active = session
      try {
        await json(endpoint + '/render-session', { method: 'PATCH', body: JSON.stringify({ session_id: active.session_id, lease_token: active.lease_token }) })
      } catch {
        invalidate(active)
        await register().catch(() => undefined)
      }
    }
    const poll = async () => {
      if (cancelled) return
      let nextPollMs = RENDER_COMMAND_IDLE_POLL_MS
      try {
        if (!session) await register()
        const active = session
        const canvas = canvasRef.current
        const revisionId = renderedRevision.current
        if (active && revisionId && canvas?.renderedRevisionId() === revisionId) {
          let body: { command: RenderCommand | null }
          try {
            body = await json<{ command: RenderCommand | null }>(endpoint + '/render-command', { method: 'POST', body: JSON.stringify({ session_id: active.session_id, lease_token: active.lease_token, rendered_revision_id: revisionId }) })
          } catch (cause) {
            invalidate(active)
            throw cause
          }
          if (!body.command) {
            if (!cancelled) pollTimer = setTimeout(poll, nextPollMs)
            return
          }
          if (cancelled) return
          if (body.command.revision_id !== revisionId || canvas.renderedRevisionId() !== revisionId) {
            pollTimer = setTimeout(poll, RENDER_COMMAND_ACTIVE_POLL_MS)
            return
          }
          if (body.command.kind === 'surface_query' && body.command.surface_query) {
            const query = body.command.surface_query
            try {
              const point = await canvas.querySurface(query.terrain_instance_id, query.horizontal, query.cast_height, query.up_axis)
              if (cancelled || canvas.renderedRevisionId() !== revisionId) throw new Error('查询期间场景发生变化，请重新查询。')
              await json(endpoint + '/render-command/' + encodeURIComponent(body.command.command_id) + '/complete', { method: 'POST', body: JSON.stringify({ session_id: active.session_id, command_lease_token: body.command.lease.token, terrain_instance_id: query.terrain_instance_id, point }) })
            } catch (cause) {
              const message = cause instanceof Error ? cause.message : 'Lux 地形表面查询失败。'
              await json(endpoint + '/render-command/' + encodeURIComponent(body.command.command_id) + '/complete', { method: 'POST', body: JSON.stringify({ session_id: active.session_id, command_lease_token: body.command.lease.token, error: message }) })
            }
          } else {
            try {
              const visibleIds = canvas.visibleInstanceIds(body.command.viewpoint)
              const blob = await canvas.capture(body.command.viewpoint, revisionId)
              if (cancelled) return
              const image = await uploadPng(conversationId, blob)
              await json(endpoint + '/render-command/' + encodeURIComponent(body.command.command_id) + '/complete', { method: 'POST', body: JSON.stringify({ session_id: active.session_id, command_lease_token: body.command.lease.token, asset_id: image.assetId, observation_id: body.command.observation_id, visible_instance_ids: visibleIds }) })
            } catch (cause) {
              const message = cause instanceof Error ? cause.message : '空间舞台截图失败。'
              await json(endpoint + '/render-command/' + encodeURIComponent(body.command.command_id) + '/complete', { method: 'POST', body: JSON.stringify({ session_id: active.session_id, command_lease_token: body.command.lease.token, error: message }) })
            }
          }
          nextPollMs = RENDER_COMMAND_ACTIVE_POLL_MS
        }
      } catch { /* session refresh and command lease recovery are durable */ }
      if (!cancelled) pollTimer = setTimeout(poll, nextPollMs)
    }
    heartbeat = setInterval(() => void keepAlive(), RENDER_SESSION_HEARTBEAT_MS)
    void register().catch(() => undefined).finally(() => void poll())
    return () => {
      cancelled = true
      if (pollTimer) clearTimeout(pollTimer)
      if (heartbeat) clearInterval(heartbeat)
      const closing = session
      if (closing) void fetch(endpoint + '/render-session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: closing.session_id, lease_token: closing.lease_token }),
        keepalive: true,
      }).catch(() => undefined)
    }
  }, [conversationId, isManifestPreview, previewVersion, selectedSceneId, codeProgram, canvasRef])

  const submitObservation = async () => {
    if (!displayedSceneData || !canvasRef.current || !comment.trim()) return
    setBusy('正在冻结观察点'); setError(null)
    try {
      const viewpoint = canvasRef.current.currentViewpoint(); if (!viewpoint) throw new Error('相机尚未就绪。')
      const revisionId = displayedSceneData.revision.revision_id
      const time = canvasRef.current.currentTime?.() ?? 0
      const buildId = canvasRef.current.renderedBuildId?.() ?? null
      const image = await uploadPng(conversationId, await canvasRef.current.capture(viewpoint, revisionId))
      const visibleIds = canvasRef.current.visibleInstanceIds(viewpoint)
      const response = await json<{ observation: { observation_id: string; revision_id: string; screenshot_workspace_path: string }; image: { assetId: string; mimeType: string } }>(`/api/conversations/${encodeURIComponent(conversationId)}/spatial/scenes/${encodeURIComponent(displayedSceneData.scene.scene_id)}/observations`, {
        method: 'POST', body: JSON.stringify({ asset_id: image.assetId, revision_id: revisionId, build_id: buildId, time_s: time, comment: comment.trim(), viewpoint, selected_instance_id: selectedInstanceId, visible_instance_ids: visibleIds }),
      })
      const structured = `<spatial-observation observation_id="${response.observation.observation_id}" scene_id="${displayedSceneData.scene.scene_id}" scene_version="${displayedSceneData.revision.version}" revision_id="${revisionId}" build_id="${buildId ?? ''}" time_s="${time}" selected_instance_id="${selectedInstanceId ?? ''}">\n${comment.trim()}\n相机：${JSON.stringify(viewpoint)}\n截图：${response.observation.screenshot_workspace_path}\n</spatial-observation>`
      const attachment: ImageAttachment = { assetId: response.image.assetId, mimeType: response.image.mimeType }
      sendMessage(structured, [attachment]); setComment(''); setBusy(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '观察提交失败。'); setBusy(null) }
  }

  return <main className={`${styles.stageShell} ${embedded ? styles.stageEmbedded : ''}`}>
    <section className={styles.viewportColumn} aria-label="空间舞台画布">
      {(!codeProgram || !codeReadyRevision) && <ThreeWorldCanvas
        {...canvasInput}
        key={codeProgram ? fallback?.key : isManifestPreview ? effectiveLegacyPath : selectedSceneId ?? 'empty'}
        ref={legacyCanvasRef}
        agentMarkers={agentMarkers}
        onQualityStateChange={setQualityRenderState}
        onSelectInstance={handleCanvasSelect}
        onCameraChange={setCameraPose}
      />}
      {codeProgram && displayedSceneData && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', pointerEvents: codeReadyRevision ? 'auto' : 'none' }}>
        <SceneCodeCanvas ref={codeCanvasRef} conversationId={conversationId} program={codeProgram} revisionId={displayedSceneData.revision.revision_id} hasFallback={!!fallback && !codeReadyRevision} selectedInstanceId={selectedInstanceId} cameraMode={cameraMode} agentViewpoint={displayedSceneData.scene.agent_viewpoint} qualityMode={qualityMode} onQualityState={setCodeQuality} onReady={setCodeReadyRevision} onSelectInstance={handleCanvasSelect} onCameraChange={setCameraPose} />
      </div>}

      {embedded ? <div className={styles.embeddedStageBar}>
        <div><span className={styles.liveMark} /><p><strong>{displayedSceneData?.scene.title ?? projectTitle ?? '空间 Scene'}</strong><small>v{displayedSceneData?.revision.version ?? '—'} · {effectiveInstances.length} 个物体</small></p></div>
        <div>{canShowPly && qualityButton}<Link className={styles.embeddedFullscreenButton} href={`/spatial/${encodeURIComponent(conversationId)}?scene=${encodeURIComponent(selectedSceneId ?? '')}`}>全屏查看 <span>↗</span></Link></div>
      </div> : <header className={styles.stageHeader}>
        <div className={styles.stageIdentity}>
          <Link href="/" className={styles.backButton} aria-label="返回对话">←</Link>
          <span className={styles.liveMark} />
          <div>
            <p>空间舞台</p>
            <h1>{displayedSceneData?.scene.title ?? legacyManifest?.title ?? projectTitle ?? '未命名空间'}</h1>
          </div>
          <span className={previewVersion && !isManifestPreview ? styles.historyPill : styles.statusPill}>
            {isManifestPreview ? 'World 预览' : previewVersion ? `历史 v${shownVersion ?? '—'}` : `v${shownVersion ?? '—'}${waitingForCode ? ' · 载入新版本' : ''}`}
          </span>
        </div>

        <div className={styles.headerMeta} aria-label="空间状态">
          <span>{codeProgram ? 'Three.js 场景' : environment ? '全景环境' : renderFormat?.toUpperCase() ?? '无环境'}</span>
          <span>{effectiveInstances.length} 个物体</span>
          <span>{effectiveInstances.length ? '浏览与选择' : environmentUrl || assetUrl ? '环境预览' : isProjectLoading ? '读取中' : '等待内容'}</span>
        </div>

        <div className={styles.headerActions}>
          {qualityButton}
          <div className={styles.cameraSwitch} aria-label="相机视角">
            <button type="button" className={cameraMode === 'user' ? styles.cameraActive : ''} onClick={() => setCameraMode('user')}>用户视角</button>
            <button type="button" className={cameraMode === 'agent' ? styles.cameraActive : ''} disabled={!displayedSceneData?.scene.agent_viewpoint} title={displayedSceneData?.scene.agent_viewpoint ? '查看 Agent 保存的观察相机' : 'Agent 尚未设置观察相机'} onClick={() => setCameraMode('agent')}>Agent 视角</button>
          </div>
          <button type="button" className={activeDrawer === 'library' ? styles.actionActive : ''} aria-controls="spatial-library-drawer" aria-expanded={activeDrawer === 'library'} onClick={() => setActiveDrawer(current => current === 'library' ? null : 'library')}>资产</button>
          <button type="button" className={activeDrawer === 'inspector' ? styles.actionActive : ''} aria-controls="spatial-inspector-drawer" aria-expanded={activeDrawer === 'inspector'} onClick={() => setActiveDrawer(current => current === 'inspector' ? null : 'inspector')}>观察</button>
        </div>
      </header>}

      <div className={styles.viewportToolbar}>
        <div><span className={styles.toolBadge}>{cameraMode === 'agent' ? 'AGENT CAMERA' : 'FREE CAMERA'}</span><strong>{cameraMode === 'agent' ? '正在查看 Agent 的观察点' : 'WASD / Q E 自由移动 · 左键旋转'}</strong></div>
        <button type="button" disabled={cameraMode !== 'user'} onClick={() => canvasRef.current?.resetUserView()}>重置视角</button>
      </div>

      <div className={styles.selectionToast} data-visible={Boolean(selectedInstance)}>
        <span>已选择</span>
        <strong>{selectedInstance?.label ?? '点击场景物体进行选择'}</strong>
        {selectedInstance && <button type="button" onClick={() => setActiveDrawer('inspector')}>查看详情</button>}
        {selectedInstance && <button type="button" onClick={() => setSelectedInstanceId(null)}>取消</button>}
      </div>

      <div className={styles.viewportFooter}>
        <div className={styles.cameraReadout}><span className={styles.coordinateLabel}>相机</span><code>{vectorText(cameraPose?.position)}</code></div>
        <div className={styles.cameraReadout}><span className={styles.coordinateLabel}>看向</span><code>{vectorText(cameraPose?.target)}</code></div>
        <p>相对坐标</p>
      </div>

      <div className={styles.agentPresence}>
        <span className={styles.agentOrb} />
        <p><strong>{codeProgram ? 'Agent 独立观察' : '主 Agent 观察机位'}</strong><small>{codeProgram ? '无需打开舞台即可渲染和测量' : displayedSceneData?.scene.agent_viewpoint ? '已显示位置与朝向' : '尚未设置'}</small></p>
        <em>{codeProgram ? 'HEADLESS' : displayedSceneData?.scene.agent_viewpoint ? 'LIVE' : '未设置'}</em>
      </div>
    </section>

    {activeDrawer === 'library' && <aside id="spatial-library-drawer" className={styles.buildRail} aria-label="场景资产库">
      <div className={styles.panelHeading}>
        <div><strong>场景资产库</strong><small>选择内容后在画布中高亮</small></div>
        <button type="button" onClick={() => setActiveDrawer(null)} aria-label="关闭资产库">×</button>
      </div>
      <div className={styles.drawerTabs} role="tablist" aria-label="资产库分类">
        <button id="spatial-assets-tab" type="button" role="tab" aria-controls="spatial-assets-panel" aria-selected={libraryTab === 'assets'} onClick={() => setLibraryTab('assets')}>物体 <span>{effectiveInstances.length}</span></button>
        <button id="spatial-scenes-tab" type="button" role="tab" aria-controls="spatial-scenes-panel" aria-selected={libraryTab === 'scenes'} onClick={() => setLibraryTab('scenes')}>场景 <span>{scenes.length}</span></button>
        <button id="spatial-history-tab" type="button" role="tab" aria-controls="spatial-history-panel" aria-selected={libraryTab === 'history'} onClick={() => setLibraryTab('history')}>版本 <span>{displayedSceneData?.history?.length ?? 0}</span></button>
      </div>

      {libraryTab === 'assets' && <section id="spatial-assets-panel" role="tabpanel" aria-labelledby="spatial-assets-tab" className={styles.assetLibrarySection}>
        <div className={styles.sectionLabel}><span>已放置物品</span><em>{effectiveInstances.length}</em></div>
        <div className={styles.assetLibraryList}>{effectiveInstances.map((instance, index) => <button
          key={instance.instance_id}
          type="button"
          aria-pressed={selectedInstanceId === instance.instance_id}
          onClick={() => setSelectedInstanceId(instance.instance_id)}
        >
          <span className={styles.assetOrdinal}>{String(index + 1).padStart(2, '0')}</span>
          <span className={styles.assetLibraryCopy}><strong>{instance.label}</strong><small>{instance.role === 'terrain' ? '地形 · ' : ''}{codeProgram ? '源码对象' : normalizeSpatialProxy(instance) ? '程序化几何' : instance.optional_ply_artifact ? 'GLB + PLY' : 'GLB'}</small></span>
          <i aria-hidden="true" />
        </button>)}</div>
        {!effectiveInstances.length && <p className={styles.emptyCopy}>{isManifestPreview ? '当前正在预览独立 World manifest；Scene 物体未叠加。' : 'Agent 放入场景的物体会显示在这里。'}</p>}
      </section>}

      {libraryTab === 'scenes' && <section id="spatial-scenes-panel" role="tabpanel" aria-labelledby="spatial-scenes-tab" className={styles.railSection}>
        <div className={styles.sectionLabel}><span>项目场景</span><em>{scenes.length}</em></div>
        <div className={styles.buildList}>{scenes.map(scene => <button key={scene.scene_id} type="button" disabled={Boolean(sceneId)} className={`${styles.buildItem} ${scene.scene_id === selectedSceneId ? styles.buildItemActive : ''}`} onClick={() => setSelectedSceneId(scene.scene_id)}><span className={styles.buildIndex}>v{scene.current_version}</span><span className={styles.buildCopy}><strong>{scene.title}</strong><small>{shortId(scene.scene_id)}</small></span><i /></button>)}</div>
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
      <div className={styles.railFooter}><span>场景历史</span><p>场景修改由 Agent 完成，每次发布都可以在历史中查看。</p></div>
    </aside>}

    {activeDrawer === 'inspector' && <aside id="spatial-inspector-drawer" className={styles.inspector} aria-label="对象与观察">
      <div className={styles.panelHeading}>
        <div><strong>{selectedInstance ? '对象详情' : '空间观察'}</strong><small>{selectedInstance ? '当前选中物体 · 修改交给 Agent' : '把当前视角交给 Agent'}</small></div>
        <button type="button" onClick={() => setActiveDrawer(null)} aria-label="关闭观察面板">×</button>
      </div>

      {selectedInstance && <section className={styles.objectDetail}>
        <div className={styles.detailTitle}><div><span>当前选择</span><h2>{selectedInstance.label}</h2></div><button type="button" onClick={() => setSelectedInstanceId(null)}>×</button></div>
        <dl className={styles.transformGrid}>
          <div><dt>位置</dt><dd>{vectorText(selectedInstance.transform.position)}</dd></div>
          <div><dt>缩放</dt><dd>{vectorText(selectedInstance.transform.scale)}</dd></div>
          {selectedDescriptor && <div><dt>实际尺寸</dt><dd>{vectorText(selectedDescriptor.measured.bounds?.size)}</dd></div>}
          <div><dt>对象 key</dt><dd>{selectedInstance.key ?? selectedInstance.instance_id}</dd></div>
        </dl>
        <button type="button" onClick={() => { setCameraMode('user'); canvasRef.current?.focusObject?.(selectedInstance.instance_id) }}>聚焦物体</button>
        <dl className={styles.transformGrid}>
          <div><dt>来源 Job</dt><dd title={selectedInstance.source_job_id ?? undefined}>{shortId(selectedInstance.source_job_id)}</dd></div>
          <div><dt>显示资产</dt><dd>{selectedAssetLabel}</dd></div>
        </dl>
        <p className={styles.qualityNotice}>{codeProgram ? selectedDescriptor?.measured.queryable ? '可查询当前构建的几何；修改意见请交给 Agent。' : '当前对象仅提供视觉内容，相关几何关系尚无法验证。' : normalizeSpatialProxy(selectedInstance) ? '这是可查询表面的程序化网格。' : selectedInstance.optional_ply_artifact ? '支持舞台全局高质量 PLY 模式。' : '当前物体只提供 GLB。'}</p>
      </section>}

      <section className={styles.observationComposer}>
        <div className={styles.composerHeading}><div><span>从这里提出修改</span><h2>把你看到的问题交给 Agent</h2></div><b>真实截图</b></div>
        <p>{isManifestPreview ? '当前是独立 World 预览；请从无 manifest 参数的 Scene 舞台提交观察。' : `自动附上当前画面、相机位置、所选物体与 Scene v${displayedSceneData?.revision.version ?? '—'}。`}</p>
        <label htmlFor="spatial-observation">修改意见</label>
        <textarea id="spatial-observation" value={comment} onChange={event => setComment(event.target.value)} placeholder="例如：从这个角度看，椅子挡住了入口。把它移到右侧墙边，再加一盏落地灯。" rows={6} />
        <button type="button" className={styles.submitObservation} disabled={!comment.trim() || Boolean(busy) || !displayedSceneData || Boolean(previewVersion) || waitingForCode} onClick={() => void submitObservation()}>{isManifestPreview ? 'World 预览仅供查看' : previewVersion ? '历史版本仅供观察' : busy ?? '截图并发送给 Agent'}<span>→</span></button>
        {error && <p className={styles.errorMessage} role="alert">{error}</p>}
      </section>

      <details className={styles.boundaryNote}>
        <summary>能力边界</summary>
        <p>截图来自当前真实渲染像素；不声称可以局部语义修改 3DGS，也不验证碰撞或物理正确性。</p>
      </details>
    </aside>}
  </main>
}

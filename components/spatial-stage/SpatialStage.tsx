'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ImageAttachment } from '@/lib/types'
import type { SceneObjectInstance, SceneViewpoint } from '@/lib/spatial/scene-types'
import type { WorkspaceArtifact } from '@/hooks/useWorkspaceArtifacts'
import { useChatContext } from '@/contexts/ChatContext'
import { useGridFSContent } from '@/hooks/useGridFSContent'
import { AholoWorldCanvas, type SpatialCanvasHandle, type StageCameraPose } from './AholoWorldCanvas'
import { chooseWorldRenderSource, listWorldManifests, parseWorldStageManifest, worldBinaryUrl } from './world-stage-model'
import styles from './SpatialStage.module.css'

interface SceneSummary { scene_id: string; title: string; current_version: number; current_revision_id: string; agent_viewpoint: SceneViewpoint | null }
interface SceneRevision { revision_id: string; version: number; change_summary: string; world: { up_axis: 'Y' | 'Z'; artifacts: Array<{ workspace_path: string; sha256: string }> } | null; instances: SceneObjectInstance[] }
interface SceneResponse { scene: SceneSummary; revision: SceneRevision; history?: Array<{ revision_id: string; version: number; change_summary: string }> }
interface RenderSession { session_id: string; lease_token: string }
interface RenderCommand { command_id: string; observation_id: string; viewpoint: SceneViewpoint; lease: { token: string } }

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

export function SpatialStage({ conversationId, projectTitle, artifacts, isProjectLoading, mode = 'standalone', sceneId }: {
  conversationId: string
  projectTitle: string | null
  artifacts: WorkspaceArtifact[]
  isProjectLoading: boolean
  mode?: 'standalone' | 'embedded'
  sceneId?: string | null
}) {
  const { sendMessage, spatialObservationDraft, setSpatialObservationDraft } = useChatContext()
  const canvasRef = useRef<SpatialCanvasHandle>(null)
  const manifests = useMemo(() => listWorldManifests(artifacts), [artifacts])
  const [scenes, setScenes] = useState<SceneSummary[]>([])
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(sceneId ?? null)
  const [sceneData, setSceneData] = useState<SceneResponse | null>(null)
  const [previewVersion, setPreviewVersion] = useState<number | null>(null)
  const [legacyPath, setLegacyPath] = useState<string>('')
  const [cameraPose, setCameraPose] = useState<StageCameraPose | null>(null)
  const [cameraMode, setCameraMode] = useState<'user' | 'agent'>('user')
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [qualityInstanceId, setQualityInstanceId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [showInspector, setShowInspector] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshScenes = useCallback(async () => {
    const list = await json<{ scenes: SceneSummary[] }>(`/api/conversations/${encodeURIComponent(conversationId)}/spatial/scenes`)
    setScenes(list.scenes); setSelectedSceneId(current => sceneId ?? (current && list.scenes.some(scene => scene.scene_id === current) ? current : list.scenes[0]?.scene_id ?? null))
  }, [conversationId, sceneId])
  const refreshScene = useCallback(async () => {
    if (!selectedSceneId) { setSceneData(null); return }
    const query = new URLSearchParams({ history: '1' }); if (previewVersion) query.set('version', String(previewVersion))
    setSceneData(await json<SceneResponse>(`/api/conversations/${encodeURIComponent(conversationId)}/spatial/scenes/${encodeURIComponent(selectedSceneId)}?${query}`))
  }, [conversationId, previewVersion, selectedSceneId])
  useEffect(() => { void refreshScenes().catch(() => undefined); const timer = setInterval(() => void refreshScenes().catch(() => undefined), 2500); return () => clearInterval(timer) }, [refreshScenes])
  useEffect(() => { void refreshScene().catch(errorValue => setError(String(errorValue))); const timer = setInterval(() => void refreshScene().catch(() => undefined), 1800); return () => clearInterval(timer) }, [refreshScene])
  useEffect(() => { if (!legacyPath) setLegacyPath(manifests[0]?.path ?? '') }, [legacyPath, manifests])
  useEffect(() => { setPreviewVersion(null) }, [selectedSceneId])
  useEffect(() => { if (sceneId) setSelectedSceneId(sceneId) }, [sceneId])

  const legacyArtifact = manifests.find(item => item.path === legacyPath) ?? manifests[0] ?? null
  const legacyFile = useGridFSContent(conversationId, legacyArtifact?.path ?? '', Boolean(legacyArtifact?.gridfsPending))
  const legacyManifest = useMemo(() => parseWorldStageManifest(legacyArtifact?.content || legacyFile.content), [legacyArtifact?.content, legacyFile.content])
  const legacyRender = chooseWorldRenderSource(legacyManifest)
  const worldAsset = sceneData?.revision.world?.artifacts.find(asset => asset.workspace_path.endsWith('.spz'))
    ?? sceneData?.revision.world?.artifacts.find(asset => asset.workspace_path.endsWith('.ply'))
  const renderFormat = worldAsset?.workspace_path.endsWith('.spz') ? 'spz' : worldAsset ? 'ply' : legacyRender?.format ?? null
  const assetUrl = worldAsset
    ? worldBinaryUrl(conversationId, worldAsset.workspace_path, worldAsset.sha256)
    : legacyRender ? worldBinaryUrl(conversationId, legacyRender.path, legacyRender.sha256) : null
  const upAxis = sceneData?.revision.world?.up_axis ?? legacyManifest?.up_axis
  const objectUrl = useCallback((instance: SceneObjectInstance, quality: 'glb' | 'ply') => {
    const artifact = quality === 'ply' ? instance.optional_ply_artifact : instance.glb_artifact
    return worldBinaryUrl(conversationId, artifact?.workspace_path ?? instance.glb_artifact.workspace_path, artifact?.sha256 ?? instance.glb_artifact.sha256)
  }, [conversationId])

  useEffect(() => {
    if (!selectedSceneId) return
    let cancelled = false; let session: RenderSession | null = null; let pollTimer: ReturnType<typeof setTimeout> | null = null; let heartbeat: ReturnType<typeof setInterval> | null = null
    const clientId = sessionStorage.getItem('pegasus-spatial-render-client') ?? crypto.randomUUID(); sessionStorage.setItem('pegasus-spatial-render-client', clientId)
    const endpoint = `/api/conversations/${encodeURIComponent(conversationId)}/spatial/scenes/${encodeURIComponent(selectedSceneId)}`
    const poll = async () => {
      if (cancelled || !session) return
      try {
        const body = await json<{ command: RenderCommand | null }>(`${endpoint}/render-command`, { method: 'POST', body: JSON.stringify({ session_id: session.session_id, lease_token: session.lease_token }) })
        if (body.command && canvasRef.current) {
          const blob = await canvasRef.current.capture(body.command.viewpoint); const image = await uploadPng(conversationId, blob)
          await json(`${endpoint}/render-command/${encodeURIComponent(body.command.command_id)}/complete`, { method: 'POST', body: JSON.stringify({ session_id: session.session_id, command_lease_token: body.command.lease.token, asset_id: image.assetId, observation_id: body.command.observation_id, visible_instance_ids: canvasRef.current.visibleInstanceIds() }) })
        }
      } catch { /* session refresh and command lease recovery are durable */ }
      if (!cancelled) pollTimer = setTimeout(poll, 900)
    }
    void json<{ session: RenderSession }>(`${endpoint}/render-session`, { method: 'POST', body: JSON.stringify({ client_id: clientId }) }).then(body => {
      if (cancelled) return; session = body.session; heartbeat = setInterval(() => void json(`${endpoint}/render-session`, { method: 'PATCH', body: JSON.stringify({ session_id: session?.session_id, lease_token: session?.lease_token }) }).catch(() => undefined), 7000); void poll()
    }).catch(() => undefined)
    return () => { cancelled = true; if (pollTimer) clearTimeout(pollTimer); if (heartbeat) clearInterval(heartbeat) }
  }, [conversationId, selectedSceneId])

  const submitObservation = async () => {
    if (!sceneData || !canvasRef.current || !comment.trim()) return
    setBusy('正在冻结观察点'); setError(null)
    try {
      const viewpoint = canvasRef.current.currentViewpoint(); if (!viewpoint) throw new Error('相机尚未就绪。')
      const image = await uploadPng(conversationId, await canvasRef.current.capture())
      const response = await json<{ observation: { observation_id: string; revision_id: string; screenshot_workspace_path: string }; image: { assetId: string; mimeType: string } }>(`/api/conversations/${encodeURIComponent(conversationId)}/spatial/scenes/${encodeURIComponent(sceneData.scene.scene_id)}/observations`, {
        method: 'POST', body: JSON.stringify({ asset_id: image.assetId, revision_id: sceneData.revision.revision_id, comment: comment.trim(), viewpoint, selected_instance_id: selectedInstanceId, visible_instance_ids: canvasRef.current.visibleInstanceIds() }),
      })
      const structured = `<spatial-observation observation_id="${response.observation.observation_id}" scene_id="${sceneData.scene.scene_id}" scene_version="${sceneData.revision.version}" selected_instance_id="${selectedInstanceId ?? ''}">\n${comment.trim()}\n相机：${JSON.stringify(viewpoint)}\n截图：${response.observation.screenshot_workspace_path}\n</spatial-observation>`
      const attachment: ImageAttachment = { assetId: response.image.assetId, mimeType: response.image.mimeType }
      sendMessage(structured, [attachment]); setComment(''); setBusy(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '观察提交失败。'); setBusy(null) }
  }

  const selectedInstance = sceneData?.revision.instances.find(instance => instance.instance_id === selectedInstanceId) ?? null
  const draftAttached = spatialObservationDraft?.sceneId === sceneData?.scene.scene_id
    && spatialObservationDraft?.revisionId === sceneData?.revision.revision_id

  const prepareObservationDraft = async () => {
    if (!sceneData || !canvasRef.current || previewVersion) return
    setBusy('正在截取当前视角'); setError(null)
    try {
      const viewpoint = canvasRef.current.currentViewpoint()
      if (!viewpoint) throw new Error('相机尚未就绪。')
      const image = await uploadPng(conversationId, await canvasRef.current.capture())
      setSpatialObservationDraft({
        conversationId,
        sceneId: sceneData.scene.scene_id,
        sceneVersion: sceneData.revision.version,
        revisionId: sceneData.revision.revision_id,
        selectedInstanceId,
        selectedInstanceLabel: selectedInstance?.label,
        visibleInstanceIds: canvasRef.current.visibleInstanceIds(),
        viewpoint,
        image,
      })
      setBusy(null)
      window.requestAnimationFrame(() => document.getElementById('pegasus-chat-input')?.focus())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '当前视角截图失败。')
      setBusy(null)
    }
  }

  const selectInstance = (instanceId: string | null) => {
    setSelectedInstanceId(instanceId)
    if (instanceId && mode === 'embedded') setShowInspector(true)
  }

  if (mode === 'embedded') {
    return <main className={`${styles.stageShell} ${styles.embeddedShell}`}>
      <header className={styles.embeddedToolbar}>
        <div className={styles.embeddedIdentity}>
          <span className={styles.liveMark} />
          <div>
            <p>SCENE · v{sceneData?.revision.version ?? '—'}{previewVersion ? ' · 历史预览' : ''}</p>
            <h1>{sceneData?.scene.title ?? projectTitle ?? '空间场景'}</h1>
          </div>
        </div>
        <div className={styles.embeddedStatus}>
          <span>{renderFormat?.toUpperCase() ?? 'NO WORLD'}</span>
          <span className={styles.statusPill}>{assetUrl ? '可观察' : isProjectLoading ? '读取中' : '等待世界'}</span>
        </div>
        <div className={styles.embeddedActions}>
          <div className={styles.cameraSwitch} aria-label="视角模式">
            <button type="button" className={cameraMode === 'user' ? styles.activeControl : ''} onClick={() => setCameraMode('user')}>用户视角</button>
            <button type="button" className={cameraMode === 'agent' ? styles.activeControl : ''} onClick={() => setCameraMode('agent')}>Agent 视角</button>
          </div>
          <button type="button" className={showInspector ? styles.activeControl : ''} onClick={() => setShowInspector(value => !value)}>对象 {sceneData?.revision.instances.length ?? 0}</button>
          <button type="button" className={showHistory ? styles.activeControl : ''} onClick={() => setShowHistory(value => !value)}>版本 {sceneData?.history?.length ?? 0}</button>
          <Link href={`/spatial/${encodeURIComponent(conversationId)}`} title="在独立页面打开空间舞台">全屏 ↗</Link>
        </div>
      </header>

      <section className={styles.embeddedViewport}>
        <AholoWorldCanvas
          ref={canvasRef}
          assetUrl={assetUrl}
          format={renderFormat}
          upAxis={upAxis}
          instances={sceneData?.revision.instances ?? []}
          objectUrl={objectUrl}
          agentViewpoint={sceneData?.scene.agent_viewpoint}
          cameraMode={cameraMode}
          qualityInstanceId={qualityInstanceId}
          onSelectInstance={selectInstance}
          onCameraChange={setCameraPose}
        />

        {showInspector && (
          <aside className={`${styles.embeddedDrawer} ${styles.objectDrawer}`} aria-label="对象检查器">
            <div className={styles.drawerHeader}>
              <div><span>OBJECT INSPECTOR</span><strong>{selectedInstance?.label ?? '选择画布中的物体'}</strong></div>
              <button type="button" onClick={() => setShowInspector(false)} aria-label="关闭对象检查器">×</button>
            </div>
            <div className={styles.drawerBody}>
              <div className={styles.instanceList}>
                {sceneData?.revision.instances.map(instance => (
                  <button key={instance.instance_id} type="button" className={selectedInstanceId === instance.instance_id ? styles.instanceActive : ''} onClick={() => selectInstance(instance.instance_id)}>
                    <span>{selectedInstanceId === instance.instance_id ? 'SELECTED' : 'GLB'}</span>
                    <strong>{instance.label}</strong>
                  </button>
                ))}
              </div>
              {selectedInstance && (
                <div className={styles.transformGrid}>
                  <div><span>位置</span><code>{selectedInstance.transform.position.map(value => value.toFixed(2)).join(' / ')}</code></div>
                  <div><span>旋转</span><code>{selectedInstance.transform.rotation_quaternion.map(value => value.toFixed(2)).join(' / ')}</code></div>
                  <div><span>缩放</span><code>{selectedInstance.transform.scale.map(value => value.toFixed(2)).join(' / ')}</code></div>
                  {selectedInstance.optional_ply_artifact && <button type="button" onClick={() => setQualityInstanceId(current => current === selectedInstanceId ? null : selectedInstanceId)}>{qualityInstanceId === selectedInstanceId ? '回到可编辑 GLB' : '切换高质量 PLY 预览'}</button>}
                </div>
              )}
              <p className={styles.drawerNote}>对象变换由 Agent 修改；这里用于选择、核对和提出精确要求。</p>
            </div>
          </aside>
        )}

        {showHistory && (
          <aside className={`${styles.embeddedDrawer} ${styles.historyDrawer}`} aria-label="Scene 版本历史">
            <div className={styles.drawerHeader}>
              <div><span>REVISION HISTORY</span><strong>版本历史 · 只读</strong></div>
              <button type="button" onClick={() => setShowHistory(false)} aria-label="关闭版本历史">×</button>
            </div>
            <div className={styles.historyList}>
              {sceneData?.history?.map(item => (
                <button key={item.revision_id} type="button" className={(previewVersion ?? sceneData.revision.version) === item.version ? styles.historyActive : ''} onClick={() => setPreviewVersion(item.version === sceneData.scene.current_version ? null : item.version)}>
                  <span>v{item.version}</span><strong>{item.change_summary || 'Scene 更新'}</strong>
                </button>
              ))}
            </div>
            {previewVersion && <button type="button" className={styles.returnCurrent} onClick={() => setPreviewVersion(null)}>返回当前 revision</button>}
          </aside>
        )}

        <button
          type="button"
          className={`${styles.observationAction} ${draftAttached ? styles.observationAttached : ''}`}
          disabled={Boolean(busy) || !sceneData || Boolean(previewVersion)}
          onClick={() => void prepareObservationDraft()}
        >
          <span>{draftAttached ? '✓' : '◎'}</span>
          {previewVersion ? '历史 revision 仅供观察' : busy ?? (draftAttached ? '当前视角已附加 · 在右侧输入修改要求' : '从这里提出修改')}
        </button>
        {error && <p role="alert" className={styles.embeddedError}>{error}</p>}
      </section>

      <footer className={styles.embeddedFooter}>
        <div><span>CAMERA</span><code>{cameraPose?.position.map(value => value.toFixed(2)).join(' / ') ?? '— / — / —'}</code></div>
        <p>World 是视觉背景；GLB 是可编辑物体真值。坐标为相对空间，不承诺真实米制。</p>
        <span>真实渲染像素</span>
      </footer>
    </main>
  }

  return <main className={styles.stageShell}>
    <header className={styles.stageHeader}>
      <div className={styles.stageIdentity}><span className={styles.liveMark} /><div><p>SCENE STAGE · 空间创作台</p><h1>{sceneData?.scene.title ?? legacyManifest?.title ?? projectTitle ?? '未命名空间'}</h1></div></div>
      <div className={styles.headerMeta}><span>WORLD + GLB</span><span>{renderFormat?.toUpperCase() ?? 'NO WORLD'}</span><span>SCENE v{sceneData?.revision.version ?? '—'}{previewVersion ? ' · 只读历史' : ''}</span><span className={styles.statusPill}>{assetUrl ? '可观察' : isProjectLoading ? '读取中' : '等待世界'}</span></div>
      <div className={styles.headerActions}><button type="button" onClick={() => setCameraMode(value => value === 'user' ? 'agent' : 'user')}>{cameraMode === 'user' ? '切到 Agent 视角' : '回到用户视角'}</button><Link href="/">返回 Agent</Link></div>
    </header>
    <div className={styles.stageGrid}>
      <aside className={styles.buildRail} aria-label="Scene revisions">
        <div className={styles.panelHeading}><span>01</span><div><strong>Scene</strong><small>{scenes.length} SCENES</small></div></div>
        <div className={styles.buildList}>{scenes.map(scene => <button key={scene.scene_id} type="button" className={`${styles.buildItem} ${scene.scene_id === selectedSceneId ? styles.buildItemActive : ''}`} onClick={() => setSelectedSceneId(scene.scene_id)}><span className={styles.buildIndex}>v{scene.current_version}</span><span className={styles.buildCopy}><strong>{scene.title}</strong><small>{scene.scene_id.slice(0, 16)}</small></span></button>)}</div>
        <div className={styles.railFooter}><span>AUTO REVISION</span><p>每次 Agent 修改自动创建 revision；工具无需管理 revision ID。</p></div>
      </aside>
      <section className={styles.viewportColumn}>
        <AholoWorldCanvas ref={canvasRef} assetUrl={assetUrl} format={renderFormat} upAxis={upAxis} instances={sceneData?.revision.instances ?? []} objectUrl={objectUrl} agentViewpoint={sceneData?.scene.agent_viewpoint} cameraMode={cameraMode} qualityInstanceId={qualityInstanceId} onSelectInstance={selectInstance} onCameraChange={setCameraPose} />
        <div className={styles.viewportFooter}><div><span className={styles.coordinateLabel}>CAMERA</span><code>{cameraPose?.position.map(value => value.toFixed(2)).join(' / ') ?? '— / — / —'}</code></div><p>World 是整体视觉背景；GLB 是可编辑物体真值。坐标为相对空间，不承诺真实米制。</p></div>
      </section>
      <aside className={styles.inspector}>
        <div className={styles.panelHeading}><span>02</span><div><strong>观察与修改</strong><small>REAL PIXELS</small></div></div>
        <section className={styles.assetEvidence}><div className={styles.sectionLabel}><span>物体实例</span><em>{sceneData?.revision.instances.length ?? 0}</em></div><div>{sceneData?.revision.instances.map(instance => <button key={instance.instance_id} type="button" onClick={() => setSelectedInstanceId(instance.instance_id)}><span>{selectedInstanceId === instance.instance_id ? '已选择' : 'GLB'}</span><strong>{instance.label}</strong><small>{instance.instance_id}</small></button>)}</div>{selectedInstanceId && sceneData?.revision.instances.find(instance => instance.instance_id === selectedInstanceId)?.optional_ply_artifact && <button type="button" onClick={() => setQualityInstanceId(current => current === selectedInstanceId ? null : selectedInstanceId)}>{qualityInstanceId === selectedInstanceId ? '回到可编辑 GLB' : '高质量 PLY 预览（一次一个）'}</button>}</section>
        <section className={styles.relationEvidence}><div className={styles.sectionLabel}><span>Revision 历史（只读）</span><em>{sceneData?.history?.length ?? 0}</em></div><div>{sceneData?.history?.slice(0, 8).map(item => <article key={item.revision_id}><button type="button" onClick={() => setPreviewVersion(item.version === sceneData.scene.current_version ? null : item.version)}><span>v{item.version}</span><code>{item.change_summary}</code></button></article>)}</div>{previewVersion && <button type="button" onClick={() => setPreviewVersion(null)}>返回当前 revision</button>}</section>
        <div className={styles.boundaryNote}><span>从这里提出修改</span><textarea value={comment} onChange={event => setComment(event.target.value)} placeholder="例如：从这个位置看，把左边椅子移开并增加一张桌子" rows={5} /><button type="button" disabled={!comment.trim() || Boolean(busy) || !sceneData || Boolean(previewVersion)} onClick={() => void submitObservation()}>{previewVersion ? '历史 revision 仅供观察' : busy ?? '截图并交给 Agent'}</button>{error && <p role="alert">{error}</p>}</div>
        <div className={styles.boundaryNote}><span>VERIFICATION BOUNDARY</span><p>截图来自当前真实渲染像素；不声称可以局部语义修改 3DGS、验证碰撞或物理正确性。</p></div>
      </aside>
    </div>
  </main>
}

'use client'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { RuntimeAsset, SceneProgramRef, SceneQualityState, SceneRenderedView } from '@/lib/scene-code/types'
import type { SceneViewpoint } from '@/lib/spatial/scene-types'
import { SCENE_SANDBOX_HTML } from '@/lib/scene-code/sandbox-page'
import type { SpatialCanvasHandle, StageCameraPose } from './three-stage-types'
import styles from './SpatialStage.module.css'

type AssetManifest = Omit<RuntimeAsset, 'bytes'>
type BrowserAsset = AssetManifest & { bytes: ArrayBuffer }
export type CodeQualityState = SceneQualityState & { revision: string; available: boolean; loading: boolean }
interface Frame { key: string; revision: string; build: string; port?: MessagePort; ready: boolean; camera: SceneViewpoint | null; time: number; visible: string[]; serial: number; pending: Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>; capsule: { bundle: string; assets: BrowserAsset[]; seed: number }; resourceUrl: string; previewAssets: AssetManifest[]; qualityAliases: string[]; sentPreviewAssets: Set<string> }
interface Props { conversationId: string; program: SceneProgramRef; revisionId: string; hasFallback?: boolean; selectedInstanceId?: string | null; cameraMode: 'user' | 'agent'; agentViewpoint?: SceneViewpoint | null; qualityMode: 'glb' | 'ply'; onQualityState?(state: CodeQualityState): void; onSelectInstance?(key: string | null): void; onCameraChange?(camera: StageCameraPose): void; onReady?(revision: string): void }
export const SceneCodeCanvas = forwardRef<SpatialCanvasHandle, Props>(function SceneCodeCanvas(props, ref) {
  const active = useRef<Frame | null>(null), framesRef = useRef<Frame[]>([]), propsRef = useRef(props)
  propsRef.current = props
  const [frames, setFrames] = useState<Frame[]>([]), [activeKey, setActiveKey] = useState<string | null>(null), [error, setError] = useState<string | null>(null)
  const call = (frame: Frame, method: string, input: unknown = {}, transfer: Transferable[] = []) => new Promise<unknown>((resolve, reject) => {
    if (!frame.port) return reject(new Error('场景尚未载入'))
    const id = ++frame.serial, timer = setTimeout(() => { frame.pending.delete(id); reject(new Error('场景操作超时')); if (!frame.ready) frame.port?.close() }, 120_000)
    frame.pending.set(id, { resolve, reject, timer }); frame.port.postMessage({ id, method, input }, transfer)
  })
  const close = (frame: Frame) => { frame.port?.postMessage({ id: ++frame.serial, method: 'dispose' }); frame.port?.close(); for (const request of frame.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Scene replaced')) }; frame.pending.clear() }
  useImperativeHandle(ref, () => ({
    isReady: () => !!active.current?.ready,
    renderedRevisionId: () => active.current?.ready ? active.current.revision : null,
    renderedBuildId: () => active.current?.build ?? null,
    currentTime: () => active.current?.time ?? 0,
    currentViewpoint: () => propsRef.current.cameraMode === 'agent' ? propsRef.current.agentViewpoint ?? active.current?.camera ?? null : active.current?.camera ?? null,
    visibleInstanceIds: () => active.current?.visible ?? [],
    resetUserView: () => { if (active.current) void call(active.current, 'focus') },
    focusObject: key => { if (active.current) void call(active.current, 'focus', { key }) },
    querySurface: () => Promise.reject(new Error('Use QuerySceneGeometry against the immutable code build')),
    capture: async (viewpoint, revision) => {
      const frame = active.current
      if (!frame?.ready || (revision && frame.revision !== revision)) throw new Error('实际显示的版本与请求不一致，请等待新版本载入')
      const view = await call(frame, 'render', { camera: viewpoint ?? frame.camera, time_s: frame.time, width: 1280, height: 960 }) as SceneRenderedView
      if (active.current !== frame || (revision && frame.revision !== revision)) throw new Error('截图期间场景发生变化')
      frame.visible = view.visible_keys
      return new Blob([Uint8Array.from(atob(view.png_base64!), character => character.charCodeAt(0))], { type: 'image/png' })
    },
  }))
  useEffect(() => {
    const controller = new AbortController()
    let candidate: Frame | undefined
    setError(null)
    const base = `/api/conversations/${encodeURIComponent(props.conversationId)}/scene-code/${encodeURIComponent(props.program.build_id)}`
    const fetchResource = async (url: string) => { const response = await fetch(url, { signal: controller.signal }); if (!response.ok) throw new Error('不可变场景资源读取失败'); return response }
    void (async () => {
      const manifest = await (await fetchResource(base)).json()
      const bundle = await (await fetchResource(base + '?resource=bundle')).text()
      const entries = manifest.assets as AssetManifest[]
      const assets = await Promise.all(entries.filter(asset => !asset.preview_only).map(async asset => ({ ...asset, bytes: await (await fetchResource(base + '?resource=asset&alias=' + encodeURIComponent(asset.alias))).arrayBuffer() })))
      if (controller.signal.aborted) return
      candidate = { key: crypto.randomUUID(), revision: props.revisionId, build: props.program.build_id, ready: false, camera: null, time: 0, visible: [], serial: 0, pending: new Map(), capsule: { bundle, assets, seed: manifest.seed }, resourceUrl: base, previewAssets: entries.filter(asset => asset.preview_only), qualityAliases: [], sentPreviewAssets: new Set() }
      framesRef.current = active.current ? [active.current, candidate] : [candidate]
      setFrames([...framesRef.current])
    })().catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '程序载入失败') })
    return () => { controller.abort(); if (candidate && active.current !== candidate) { close(candidate); framesRef.current = framesRef.current.filter(frame => frame !== candidate) } }
  }, [props.conversationId, props.program.build_id, props.revisionId])
  useEffect(() => { if (active.current) void call(active.current, 'view', { mode: props.cameraMode, camera: props.agentViewpoint }).catch(() => {}) }, [props.cameraMode, props.agentViewpoint])
  useEffect(() => { if (active.current) void call(active.current, 'select', { key: props.selectedInstanceId }).catch(() => {}) }, [props.selectedInstanceId])
  useEffect(() => {
    const frame = active.current
    if (!frame?.qualityAliases.length) return
    let cancelled = false
    const mode = props.qualityMode
    const update = (state: SceneQualityState, loading = false) => {
      if (!cancelled && active.current === frame) propsRef.current.onQualityState?.({ revision: frame.revision, available: true, loading, ...state })
    }
    update({ loadedCount: 0, totalCount: frame.qualityAliases.length }, true)
    void (async () => {
      let result = await call(frame, 'quality', { mode }) as SceneQualityState
      const errors = new Set(result.error ? [result.error] : [])
      for (const asset of frame.previewAssets) {
        if (!frame.qualityAliases.includes(asset.alias) || frame.sentPreviewAssets.has(asset.alias)) continue
        if (mode === 'glb' || cancelled || active.current !== frame) break
        try {
          const response = await fetch(frame.resourceUrl + '?resource=asset&alias=' + encodeURIComponent(asset.alias))
          if (cancelled || active.current !== frame) { await response.body?.cancel(); break }
          if (!response.ok || !response.body) throw new Error('PLY 资源读取失败')
          result = await call(frame, 'quality', { mode, asset: { ...asset, stream: response.body } }, [response.body]) as SceneQualityState
          if (result.error) errors.add(result.error)
          else frame.sentPreviewAssets.add(asset.alias)
          update(result, true)
        } catch (cause) { errors.add(cause instanceof Error ? cause.message : 'PLY 载入失败') }
      }
      update({ ...result, error: [...errors].join('；') || undefined })
    })().catch(cause => update({ loadedCount: 0, totalCount: frame.qualityAliases.length, error: String(cause) }))
    return () => { cancelled = true }
  }, [activeKey, props.qualityMode])
  useEffect(() => () => framesRef.current.forEach(close), [])
  const initialize = (frame: Frame, element: HTMLIFrameElement) => {
    if (frame.port) return
    const channel = new MessageChannel(); frame.port = channel.port1
    const timeout = setTimeout(() => { if (!frame.ready) { close(frame); framesRef.current = framesRef.current.filter(item => item !== frame); setFrames([...framesRef.current]); setError('新版本执行超过 120 秒，已保留原版本') } }, 120_000)
    channel.port1.onmessage = event => {
      const data = event.data, request = frame.pending.get(data.id)
      if (request) { clearTimeout(request.timer); frame.pending.delete(data.id); if (data.ok) request.resolve(data.result); else request.reject(new Error(data.error)); return }
      if (data.kind === 'ready') {
        clearTimeout(timeout); frame.ready = true; frame.camera = data.camera
        frame.qualityAliases = data.snapshot.quality_aliases ?? []
        const previous = active.current; active.current = frame; setActiveKey(frame.key); setError(null)
        framesRef.current = [frame]; setFrames([frame]); if (previous && previous !== frame) close(previous)
        void call(frame, 'view', { mode: propsRef.current.cameraMode, camera: propsRef.current.agentViewpoint })
        void call(frame, 'select', { key: propsRef.current.selectedInstanceId }).catch(() => {})
        propsRef.current.onReady?.(frame.revision)
        propsRef.current.onQualityState?.({ revision: frame.revision, available: frame.qualityAliases.length > 0, loadedCount: 0, totalCount: frame.qualityAliases.length, loading: false })
      } else if (data.kind === 'camera') {
        frame.camera = data.camera
        if (active.current === frame && data.camera) propsRef.current.onCameraChange?.({ ...data.camera, distance: Math.hypot(...data.camera.position.map((value: number, index: number) => value - data.camera.target[index])) })
      } else if (data.kind === 'time') frame.time = data.time_s
      else if (data.kind === 'select' && active.current === frame) propsRef.current.onSelectInstance?.(data.key)
      else if (data.kind === 'error') { clearTimeout(timeout); setError(`${data.message}；实际显示版本：${active.current?.revision ?? '无'}`); if (active.current !== frame) { close(frame); framesRef.current = framesRef.current.filter(item => item !== frame); setFrames([...framesRef.current]) } }
    }
    element.contentWindow!.postMessage({ kind: 'scene-boot', ...frame.capsule }, '*', [channel.port2, ...frame.capsule.assets.map(asset => asset.bytes)])
  }
  return <div className={styles.viewerRoot} style={props.hasFallback && !activeKey ? { background: 'transparent' } : undefined}>
    {frames.map(frame => <iframe key={frame.key} title="Three.js 代码场景" sandbox="allow-scripts" srcDoc={SCENE_SANDBOX_HTML} onLoad={event => initialize(frame, event.currentTarget)} style={{ position: 'absolute', width: '100%', height: '100%', border: 0, visibility: activeKey === frame.key ? 'visible' : 'hidden' }} />)}
    {!activeKey && !error && <div className={props.hasFallback ? styles.viewerWarning : styles.viewerState} role="status">正在初始化新版本{props.hasFallback ? '，仍显示上一版本' : ''}</div>}
    {activeKey && frames.some(frame => !frame.ready) && <div className={styles.viewerWarning} role="status">正在载入新版本；当前仍显示 {active.current?.revision}</div>}
    {error && <div className={styles.viewerWarning} role="alert">{error}</div>}
  </div>
})

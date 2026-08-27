'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Object3D, PerspectiveCamera, Splat, Vector3, Viewer } from '@manycore/aholo-viewer'
import type { SceneObjectInstance, SceneViewpoint } from '@/lib/spatial/scene-types'
import type { WorldRenderFormat } from './world-stage-model'
import styles from './SpatialStage.module.css'

export interface StageCameraPose extends SceneViewpoint { distance: number }
export interface SpatialCanvasHandle {
  capture(viewpoint?: SceneViewpoint): Promise<Blob>
  currentViewpoint(): SceneViewpoint | null
  visibleInstanceIds(): string[]
}

async function pixelsToPng(pixels: Uint8Array, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器无法创建截图画布。')
  const flipped = new Uint8ClampedArray(pixels.length)
  for (let y = 0; y < height; y += 1) flipped.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4)
  context.putImageData(new ImageData(flipped, width, height), 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG 编码失败。')), 'image/png'))
}

export const AholoWorldCanvas = forwardRef<SpatialCanvasHandle, {
  assetUrl: string | null
  format: WorldRenderFormat | null
  upAxis: string | undefined
  instances?: SceneObjectInstance[]
  objectUrl?: (instance: SceneObjectInstance, quality: 'glb' | 'ply') => string
  agentViewpoint?: SceneViewpoint | null
  cameraMode?: 'user' | 'agent'
  qualityInstanceId?: string | null
  onSelectInstance?: (instanceId: string | null) => void
  onCameraChange?: (pose: StageCameraPose) => void
}>(function AholoWorldCanvas({
  assetUrl, format, upAxis, instances = [], objectUrl, agentViewpoint, cameraMode = 'user', qualityInstanceId,
  onSelectInstance, onCameraChange,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const captureQueueRef = useRef<Promise<void>>(Promise.resolve())
  const cameraModeRef = useRef(cameraMode)
  const agentViewpointRef = useRef(agentViewpoint)
  cameraModeRef.current = cameraMode
  agentViewpointRef.current = agentViewpoint
  const runtimeRef = useRef<{
    viewer: Viewer; camera: PerspectiveCamera; target: Vector3; objects: Map<string, Object3D>
    applyUser(): void; applyViewpoint(value: SceneViewpoint): void; viewpoint(): SceneViewpoint
  } | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(assetUrl ? 'loading' : 'idle')
  const [error, setError] = useState<string | null>(null)

  useImperativeHandle(ref, () => ({
    currentViewpoint: () => runtimeRef.current?.viewpoint() ?? null,
    visibleInstanceIds: () => [...(runtimeRef.current?.objects.keys() ?? [])],
    capture(value) {
      const operation = async () => {
        const runtime = runtimeRef.current; const container = containerRef.current
        if (!runtime || !container) throw new Error('空间舞台尚未就绪。')
        const prior = runtime.viewpoint(); const originalSize = runtime.viewer.getSize(); const originalAspect = runtime.camera.aspect
        const scale = Math.min(1, 1280 / Math.max(originalSize.width, 1), 720 / Math.max(originalSize.height, 1))
        const width = Math.max(1, Math.round(originalSize.width * scale)); const height = Math.max(1, Math.round(originalSize.height * scale))
        try {
          if (value) runtime.applyViewpoint(value)
          if (width !== originalSize.width || height !== originalSize.height) {
            runtime.viewer.resize({ width, height }); runtime.camera.aspect = width / height; runtime.camera.updateProjectionMatrix()
          }
          runtime.viewer.render()
          const pixels = new Uint8Array(width * height * 4)
          await runtime.viewer.readRenderResultAsync(pixels, { x: 0, y: 0, width, height })
          return await pixelsToPng(pixels, width, height)
        } finally {
          if (width !== originalSize.width || height !== originalSize.height) {
            runtime.viewer.resize(originalSize); runtime.camera.aspect = originalAspect; runtime.camera.updateProjectionMatrix()
          }
          if (value) runtime.applyViewpoint(prior); else runtime.viewer.render()
        }
      }
      const result = captureQueueRef.current.then(operation, operation)
      captureQueueRef.current = result.then(() => undefined, () => undefined)
      return result
    },
  }), [])

  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime) return
    if (cameraMode === 'agent' && agentViewpoint) runtime.applyViewpoint(agentViewpoint); else runtime.applyUser()
  }, [agentViewpoint, cameraMode])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || !objectUrl || status !== 'ready') return
    let cancelled = false
    void (async () => {
      const sdk = await import('@manycore/aholo-viewer')
      const desired = new Set(instances.map(instance => instance.instance_id))
      for (const [instanceId, object] of runtime.objects) {
        if (!desired.has(instanceId)) { runtime.viewer.getScene().remove(object); object.destroy(); runtime.objects.delete(instanceId) }
      }
      for (const instance of instances) {
        let outer = runtime.objects.get(instance.instance_id)
        if (!outer) {
          const response = await fetch(objectUrl(instance, 'glb'), { redirect: 'error' }); if (!response.ok || cancelled) continue
          const parsed = await sdk.GLTFLoader.loadGLTF(await response.arrayBuffer(), { textureLoader: url => sdk.downloadTexture(url, { context: runtime.viewer }) })
          if (cancelled) { parsed.scene.destroy(); continue }
          outer = new sdk.Object3D(); outer.name = instance.label; outer.userData.instanceId = instance.instance_id
          const basis = new sdk.Object3D(); if (instance.normalization.scene_up_axis === 'Z') basis.rotation = new sdk.Euler(Math.PI / 2, 0, 0)
          const bounds = instance.normalization.bounds; if (bounds) basis.position.set(-(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[2] + bounds.max[2]) / 2, -bounds.min[1])
          basis.add(parsed.scene); outer.add(basis); runtime.viewer.getScene().add(outer); runtime.objects.set(instance.instance_id, outer)
        }
        outer.position.set(...instance.transform.position); outer.quaternion = new sdk.Quaternion(...instance.transform.rotation_quaternion); outer.scale.set(...instance.transform.scale); outer.updateMatrixWorld(true)
      }
      const sceneExtent = instances.reduce((maximum, instance) => {
        const centerDistance = Math.hypot(...instance.transform.position)
        const localSize = instance.normalization.bounds
          ? Math.hypot(...instance.normalization.bounds.size.map((value, axis) => value * instance.transform.scale[axis]))
          : Math.max(...instance.transform.scale)
        return Math.max(maximum, centerDistance + localSize)
      }, 1)
      runtime.camera.near = Math.max(Math.min(sceneExtent / 10_000, 0.05), 0.005)
      runtime.camera.far = Math.max(runtime.camera.far, sceneExtent * 20, 500)
      runtime.camera.updateProjectionMatrix()
      runtime.viewer.render()
    })().catch(() => undefined)
    return () => { cancelled = true }
  }, [instances, objectUrl, status])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || !objectUrl || status !== 'ready') return
    let cancelled = false; let root: Object3D | null = null; let qualitySplat: Splat | null = null
    const instance = instances.find(candidate => candidate.instance_id === qualityInstanceId && candidate.optional_ply_artifact)
    if (!instance) return
    void (async () => {
      const sdk = await import('@manycore/aholo-viewer')
      const response = await fetch(objectUrl(instance, 'ply'), { redirect: 'error' }); if (!response.ok || cancelled) return
      const data = await sdk.SplatLoader.parseSplatData(sdk.SplatLoader.SplatFileType.PLY, new Uint8Array(await response.arrayBuffer()))
      if (cancelled) return
      qualitySplat = await sdk.SplatUtils.createSplat(data); if (cancelled) { qualitySplat.freeGPU(); return }
      const dense = sdk.SplatUtils.computeDenseBox(new sdk.SplatUtils.SplatOperator(qualitySplat, data), 0.995)
      root = new sdk.Object3D(); root.userData.instanceId = instance.instance_id; root.position.set(...instance.transform.position); root.quaternion = new sdk.Quaternion(...instance.transform.rotation_quaternion); root.scale.set(...instance.transform.scale)
      qualitySplat.position.set(-(dense.boxMin[0] + dense.boxMax[0]) / 2, -(dense.boxMin[1] + dense.boxMax[1]) / 2, -dense.boxMin[2])
      root.add(qualitySplat)
      const editable = runtime.objects.get(instance.instance_id); if (!editable) { qualitySplat.freeGPU(); qualitySplat = null; root = null; return }
      editable.visible = false; runtime.viewer.getScene().add(root); runtime.viewer.render()
    })().catch(() => undefined)
    return () => {
      cancelled = true
      const editable = runtime.objects.get(instance.instance_id); if (editable) editable.visible = true
      if (root) runtime.viewer.getScene().remove(root)
      qualitySplat?.freeGPU(); runtime.viewer.render()
    }
  }, [instances, objectUrl, qualityInstanceId, status])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !assetUrl || !format) { setStatus('idle'); return }
    let cancelled = false; let viewer: Viewer | null = null; let camera: PerspectiveCamera | null = null
    let target: Vector3 | null = null; let splat: Splat | null = null; let raf: number | null = null
    const controller = new AbortController(); const removers: Array<() => void> = []
    const axis: 'Y' | 'Z' = upAxis?.toUpperCase() === 'Y' ? 'Y' : 'Z'
    const orbit = { yaw: axis === 'Z' ? -0.82 : 0.72, pitch: 0.38, distance: 8, target: [0, 0, 0] as [number, number, number], dragging: false, pointerId: -1, x: 0, y: 0 }
    const objects = new Map<string, Object3D>()
    const render = () => { if (!cancelled && viewer && raf === null) raf = requestAnimationFrame(() => { raf = null; if (viewer && !viewer.isDestroyed) viewer.render() }) }
    const viewpoint = (): SceneViewpoint => ({ position: camera ? [camera.position.x, camera.position.y, camera.position.z] : [0, 0, 0], target: [...orbit.target], up: camera ? [camera.up.x, camera.up.y, camera.up.z] : [0, 0, 1], fov_deg: camera?.fov ?? 56 })
    const applyViewpoint = (value: SceneViewpoint) => { if (!camera || !target) return; camera.position.set(...value.position); camera.up.set(...value.up); camera.fov = value.fov_deg; target.set(...value.target); camera.lookAt(target); camera.updateMatrixWorld(true); render() }
    const applyUser = () => {
      if (!camera || !target) return
      const horizontal = Math.cos(orbit.pitch) * orbit.distance
      if (axis === 'Z') camera.up.set(0, 0, 1); else camera.up.set(0, 1, 0)
      if (axis === 'Z') camera.position.set(orbit.target[0] + Math.cos(orbit.yaw) * horizontal, orbit.target[1] + Math.sin(orbit.yaw) * horizontal, orbit.target[2] + Math.sin(orbit.pitch) * orbit.distance)
      else camera.position.set(orbit.target[0] + Math.cos(orbit.yaw) * horizontal, orbit.target[1] + Math.sin(orbit.pitch) * orbit.distance, orbit.target[2] + Math.sin(orbit.yaw) * horizontal)
      target.set(...orbit.target); camera.lookAt(target); camera.updateMatrixWorld(true); onCameraChange?.({ ...viewpoint(), distance: orbit.distance }); render()
    }
    const listen = <K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions) => { container.addEventListener(type, handler as EventListener, options); removers.push(() => container.removeEventListener(type, handler as EventListener, options)) }
    void (async () => {
      try {
        setStatus('loading'); setError(null); const sdk = await import('@manycore/aholo-viewer'); if (cancelled) return
        viewer = sdk.createViewer(`spatial-stage-${Date.now()}`, container, { antialiasing: true, alpha: false })
        camera = new sdk.PerspectiveCamera(56, Math.max(container.clientWidth / Math.max(container.clientHeight, 1), 0.1), 0.02, 5000); target = new sdk.Vector3(); viewer.setCamera(camera)
        sdk.setViewerConfig(viewer, { pipeline: { Background: { background: { active: sdk.BackgroundMode.BasicBackground, basic: { color: new sdk.Color(0.018, 0.025, 0.035) } }, ground: { enabled: false } }, Splatting: { enabled: true }, TAA: { enabled: false } } }); viewer.requestRenderHandler = render
        const worldResponse = await fetch(assetUrl, { signal: controller.signal, redirect: 'error' }); if (!worldResponse.ok) throw new Error(`世界资产加载失败（HTTP ${worldResponse.status}）`)
        const data = await sdk.SplatLoader.parseSplatData(format === 'spz' ? sdk.SplatLoader.SplatFileType.SPZ : sdk.SplatLoader.SplatFileType.PLY, new Uint8Array(await worldResponse.arrayBuffer()))
        if (cancelled) return; splat = await sdk.SplatUtils.createSplat(data); viewer.getScene().add(splat)
        const dense = sdk.SplatUtils.computeDenseBox(new sdk.SplatUtils.SplatOperator(splat, data), 0.995)
        orbit.target = dense.boxMin.map((value, index) => (value + dense.boxMax[index]) / 2) as [number, number, number]
        const diagonal = Math.hypot(...dense.boxMax.map((value, index) => value - dense.boxMin[index])); orbit.distance = Number.isFinite(diagonal) ? Math.min(Math.max(diagonal * 0.82, 1.5), 2400) : 8
        camera.near = Math.max(orbit.distance / 5000, 0.01); camera.far = Math.max(orbit.distance * 30, 500)
        viewer.getScene().add(new sdk.AmbientLight(0xffffff, 0.85))
        for (const [index, position] of [[4, -3, 7], [-5, 2, 4], [1, 6, 3]].entries()) { const light = new sdk.DirectionalLight(0xffffff, index === 0 ? 0.75 : 0.4); light.position.set(...position as [number, number, number]); viewer.getScene().add(light) }
        runtimeRef.current = { viewer, camera, target, objects, applyUser, applyViewpoint, viewpoint }
        if (cameraModeRef.current === 'agent' && agentViewpointRef.current) applyViewpoint(agentViewpointRef.current); else applyUser(); setStatus('ready')
      } catch (cause) { if (!cancelled && !(cause instanceof DOMException && cause.name === 'AbortError')) { setError(cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/g, '[asset]') : '空间载入失败。'); setStatus('error') } }
    })()
    const resize = new ResizeObserver(() => { if (viewer && camera && !viewer.isDestroyed) { viewer.resize(); camera.aspect = Math.max(container.clientWidth / Math.max(container.clientHeight, 1), 0.1); camera.updateMatrixWorld(true); render() } }); resize.observe(container)
    listen('pointerdown', event => { if (event.button !== 0) return; orbit.dragging = true; orbit.pointerId = event.pointerId; orbit.x = event.clientX; orbit.y = event.clientY; container.setPointerCapture(event.pointerId) })
    listen('pointermove', event => { if (!orbit.dragging || event.pointerId !== orbit.pointerId || cameraModeRef.current !== 'user') return; orbit.yaw -= (event.clientX - orbit.x) * 0.006; orbit.pitch = Math.min(1.42, Math.max(-1.42, orbit.pitch + (event.clientY - orbit.y) * 0.0045)); orbit.x = event.clientX; orbit.y = event.clientY; applyUser() })
    const stop = (event: PointerEvent) => { if (event.pointerId === orbit.pointerId) { orbit.dragging = false; orbit.pointerId = -1 } }; listen('pointerup', stop); listen('pointercancel', stop)
    listen('wheel', event => { event.preventDefault(); if (cameraModeRef.current === 'user') { orbit.distance = Math.min(5000, Math.max(0.35, orbit.distance * Math.exp(event.deltaY * 0.0012))); applyUser() } }, { passive: false })
    listen('click', async event => {
      if (!viewer || !camera) return
      const sdk = await import('@manycore/aholo-viewer'); const rect = container.getBoundingClientRect()
      const hits = viewer.createPicker().pick(new sdk.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1)), camera, true)
      let node: Object3D | null = hits[0]?.object ?? null; let instanceId: string | null = null
      while (node) { if (typeof node.userData.instanceId === 'string') { instanceId = node.userData.instanceId; break } node = node.parent }
      onSelectInstance?.(instanceId)
    })
    return () => { cancelled = true; controller.abort(); resize.disconnect(); removers.forEach(remove => remove()); if (raf !== null) cancelAnimationFrame(raf); runtimeRef.current = null; if (viewer && !viewer.isDestroyed) { if (splat) { viewer.getScene().remove(splat); splat.freeGPU() } viewer.destroy() } }
  }, [assetUrl, format, upAxis, onCameraChange, onSelectInstance])

  return <div className={styles.viewerRoot}>
    <div ref={containerRef} className={styles.viewerContainer} aria-label="Aholo 混合空间查看器" />
    {status !== 'ready' && <div className={styles.viewerState} role={status === 'error' ? 'alert' : 'status'}><strong>{status === 'error' ? '空间载入失败' : status === 'idle' ? '选择一个 Scene' : '正在构建混合空间'}</strong><p>{status === 'error' ? error : '正在读取 World 3DGS 与 Scene GLB。'}</p></div>}
    {status === 'ready' && <div className={styles.viewerHint}><span>拖动环视</span><i /><span>滚轮缩放</span><i /><span>{cameraMode === 'agent' ? 'Agent 视角' : '用户视角'}</span></div>}
    <div className={styles.scanline} aria-hidden="true" />
  </div>
})

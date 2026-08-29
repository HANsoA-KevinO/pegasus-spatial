'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Object3D, PerspectiveCamera, Splat, Vector3, Viewer } from '@manycore/aholo-viewer'
import type { SceneObjectInstance, SceneSourceArtifact, SceneViewpoint } from '@/lib/spatial/scene-types'
import { cameraDistanceForBoundingSphere } from './camera-framing'
import type { WorldRenderFormat } from './world-stage-model'
import { computeGlbObjectAlignment, computeLuxPlyAlignment } from './object-alignment'
import { readRenderPixelsWithRetry } from './render-readback'
import styles from './SpatialStage.module.css'

type AholoViewerSdk = typeof import('@manycore/aholo-viewer')

let aholoViewerSdkPromise: Promise<AholoViewerSdk> | null = null
const QUALITY_ALIGNMENT_VERSION = 'lux-ply-x-minus-90-v3'
const MAX_GLB_CONTENT_BYTES = 256 * 1024 * 1024
const MAX_PLY_CONTENT_BYTES = 512 * 1024 * 1024

function loadAholoViewerSdk(): Promise<AholoViewerSdk> {
  if (aholoViewerSdkPromise) return aholoViewerSdkPromise
  aholoViewerSdkPromise = import('@manycore/aholo-viewer').catch(cause => {
    // A transient chunk/worker failure must not poison every subsequent Stage
    // mount for the rest of the page session.
    aholoViewerSdkPromise = null
    throw cause
  })
  return aholoViewerSdkPromise
}

function assertArtifactWithinBudget(
  artifact: SceneSourceArtifact,
  response: Response,
  maximumBytes: number,
  label: 'GLB' | 'PLY',
): number {
  const declaredBytes = Number.isFinite(artifact.size_bytes) && artifact.size_bytes > 0
    ? artifact.size_bytes
    : null
  const rawContentLength = response.headers.get('content-length')
  const responseBytes = rawContentLength && /^\d+$/.test(rawContentLength)
    ? Number(rawContentLength)
    : null
  for (const bytes of [declaredBytes, responseBytes]) {
    if (bytes !== null && bytes > maximumBytes) {
      throw new Error(`${label} 文件过大（最大允许 ${Math.round(maximumBytes / 1024 / 1024)} MB）`)
    }
  }
  const contentLength = responseBytes ?? declaredBytes
  if (contentLength === null) throw new Error(`${label} 文件缺少可信的内容长度。`)
  return contentLength
}

function streamWithinBudget(
  input: ReadableStream<Uint8Array>,
  maximumBytes: number,
  label: string,
): ReadableStream<Uint8Array> {
  const reader = input.getReader()
  let receivedBytes = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          controller.close()
          return
        }
        receivedBytes += result.value.byteLength
        if (receivedBytes > maximumBytes) {
          await reader.cancel()
          controller.error(new Error(`${label} 响应超过浏览器加载预算。`))
          return
        }
        controller.enqueue(result.value)
      } catch (cause) {
        controller.error(cause)
      }
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  })
}

function destroyObjectTree(root: Object3D): void {
  const nodes: Object3D[] = []
  root.traverse(node => { nodes.push(node) })
  for (let index = nodes.length - 1; index >= 0; index -= 1) nodes[index].destroy()
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), timeoutMs) }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export interface StageCameraPose extends SceneViewpoint { distance: number }
export interface SpatialCanvasHandle {
  capture(viewpoint?: SceneViewpoint): Promise<Blob>
  currentViewpoint(): SceneViewpoint | null
  visibleInstanceIds(): string[]
  resetUserView(): void
}
export interface SpatialQualityRenderState {
  status: 'glb' | 'loading' | 'ply' | 'error'
  instanceId: string | null
  error?: string
  loadedCount?: number
  totalCount?: number
}

export interface SpatialObjectLoadState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  instanceIds: string[]
  failedInstanceIds: string[]
  error?: string
}

export interface SpatialAgentMarker {
  id: string
  label: string
  color: string
  viewpoint: SceneViewpoint
}

const EMPTY_SCENE_INSTANCES: SceneObjectInstance[] = []
const EMPTY_AGENT_MARKERS: SpatialAgentMarker[] = []

async function pixelsToPng(pixels: Uint8Array, width: number, height: number): Promise<Blob> {
  // A newly mounted/stale SDK session can expose an allocated Composite
  // target before it contains a rendered frame. Never publish that uniform
  // black buffer as a successful Agent observation; leave the durable command
  // claim to expire so another healthy Stage can retry it.
  let minimum = 255
  let maximum = 0
  for (let index = 0; index < pixels.length; index += 4) {
    minimum = Math.min(minimum, pixels[index], pixels[index + 1], pixels[index + 2])
    maximum = Math.max(maximum, pixels[index], pixels[index + 1], pixels[index + 2])
  }
  if (maximum <= 2 || maximum - minimum <= 1) {
    throw new Error('空间舞台尚未产生有效截图帧，请稍后重试。')
  }
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
  agentMarkers?: SpatialAgentMarker[]
  cameraMode?: 'user' | 'agent'
  qualityMode?: 'glb' | 'ply'
  qualityReloadToken?: number
  selectedInstanceId?: string | null
  framingKey?: string | null
  captureEnabled?: boolean
  onObjectLoadStateChange?: (state: SpatialObjectLoadState) => void
  onQualityStateChange?: (state: SpatialQualityRenderState) => void
  onSelectInstance?: (instanceId: string | null) => void
  onCameraChange?: (pose: StageCameraPose) => void
}>(function AholoWorldCanvas({
  assetUrl, format, upAxis, instances = EMPTY_SCENE_INSTANCES, objectUrl, agentViewpoint, agentMarkers = EMPTY_AGENT_MARKERS, cameraMode = 'user', qualityMode = 'glb', selectedInstanceId,
  qualityReloadToken = 0,
  framingKey = null,
  captureEnabled = true,
  onObjectLoadStateChange, onQualityStateChange, onSelectInstance, onCameraChange,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const captureQueueRef = useRef<Promise<void>>(Promise.resolve())
  const cameraModeRef = useRef(cameraMode)
  const qualityModeRef = useRef(qualityMode)
  const agentViewpointRef = useRef(agentViewpoint)
  const objectLoadStateCallbackRef = useRef(onObjectLoadStateChange)
  const qualityStateCallbackRef = useRef(onQualityStateChange)
  const instancesRef = useRef(instances)
  const framingKeyRef = useRef(framingKey)
  cameraModeRef.current = cameraMode
  qualityModeRef.current = qualityMode
  agentViewpointRef.current = agentViewpoint
  objectLoadStateCallbackRef.current = onObjectLoadStateChange
  qualityStateCallbackRef.current = onQualityStateChange
  instancesRef.current = instances
  framingKeyRef.current = framingKey
  const runtimeRef = useRef<{
    viewer: Viewer; camera: PerspectiveCamera; target: Vector3; objects: Map<string, Object3D>
    applyUser(): void; resetUser(): void; applyViewpoint(value: SceneViewpoint): void; viewpoint(): SceneViewpoint
    frameLoadedObjects(frameKey: string): void
  } | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(assetUrl ? 'loading' : 'idle')
  const [objectLoadRevision, setObjectLoadRevision] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const qualityCandidates = useMemo(
    () => instances.filter(candidate => candidate.optional_ply_artifact),
    [instances],
  )
  const qualityCandidatesRef = useRef(qualityCandidates)
  qualityCandidatesRef.current = qualityCandidates
  const qualityAssetKey = qualityCandidates.map(candidate => `${candidate.instance_id}:${candidate.optional_ply_artifact?.sha256}:${candidate.optional_ply_artifact?.workspace_path}:${QUALITY_ALIGNMENT_VERSION}`).join('|')
  const qualityTransformKey = JSON.stringify(qualityCandidates.map(candidate => [candidate.instance_id, candidate.transform.position, candidate.transform.rotation_quaternion, candidate.transform.scale]))
  const agentMarkersRef = useRef(agentMarkers)
  agentMarkersRef.current = agentMarkers
  const agentMarkersKey = JSON.stringify(agentMarkers.map(marker => [marker.id, marker.label, marker.color, marker.viewpoint]))
  const qualityCacheRef = useRef(new Map<string, {
    assetKey: string
    instanceId: string
    root: Object3D
    splat: Splat
    editable: Object3D
    viewer: Viewer
    disposed: boolean
  }>())
  const objectRequestRef = useRef<AbortController | null>(null)
  const qualityRequestRef = useRef<AbortController | null>(null)
  const qualityParseTailRef = useRef<Promise<void>>(Promise.resolve())
  const objectLoadGenerationRef = useRef(0)
  const qualityLoadGenerationRef = useRef(0)
  const agentObjectsRef = useRef(new Map<string, Object3D>())
  const disposeQualityCache = useCallback((instanceId: string, restoreEditable = true) => {
    const cache = qualityCacheRef.current.get(instanceId)
    if (!cache) return
    qualityCacheRef.current.delete(instanceId)
    if (cache.disposed) return
    cache.disposed = true
    const currentEditable = runtimeRef.current?.objects.get(instanceId)
    if (restoreEditable && currentEditable === cache.editable) currentEditable.visible = true
    if (!cache.viewer.isDestroyed) cache.viewer.getScene().remove(cache.root)
    cache.splat.freeGPU()
    destroyObjectTree(cache.root)
  }, [])
  const disposeQualityCaches = useCallback((restoreEditable = true) => {
    for (const instanceId of [...qualityCacheRef.current.keys()]) {
      disposeQualityCache(instanceId, restoreEditable)
    }
  }, [disposeQualityCache])

  useImperativeHandle(ref, () => ({
    currentViewpoint: () => runtimeRef.current?.viewpoint() ?? null,
    visibleInstanceIds: () => [...(runtimeRef.current?.objects.keys() ?? [])],
    resetUserView: () => runtimeRef.current?.resetUser(),
    capture(value) {
      const operation = async () => {
        if (!captureEnabled) throw new Error('当前查看器未启用截图读取。')
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
          const pixels = new Uint8Array(width * height * 4)
          await readRenderPixelsWithRetry(runtime.viewer, pixels, { x: 0, y: 0, width, height })
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
  }), [captureEnabled])

  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime) return
    if (cameraMode === 'agent' && agentViewpoint) runtime.applyViewpoint(agentViewpoint); else runtime.applyUser()
  }, [agentViewpoint, cameraMode])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || !objectUrl || status !== 'ready') return
    let cancelled = false
    objectRequestRef.current?.abort()
    const controller = new AbortController()
    objectRequestRef.current = controller
    const generation = objectLoadGenerationRef.current + 1
    objectLoadGenerationRef.current = generation
    const isStale = () => (
      cancelled
      || controller.signal.aborted
      || objectLoadGenerationRef.current !== generation
      || runtimeRef.current !== runtime
      || runtime.viewer.isDestroyed
    )
    const requestedInstanceIds = instances.map(instance => instance.instance_id)
    objectLoadStateCallbackRef.current?.({
      status: requestedInstanceIds.length ? 'loading' : 'idle',
      instanceIds: [],
      failedInstanceIds: [],
    })
    const loadObjects = async () => {
      const sdk = await loadAholoViewerSdk()
      if (isStale()) return
      const desired = new Set(instances.map(instance => instance.instance_id))
      const failures = new Map<string, string>()
      for (const [instanceId, object] of runtime.objects) {
        if (!desired.has(instanceId)) {
          disposeQualityCache(instanceId, false)
          runtime.objects.delete(instanceId)
          runtime.viewer.getScene().remove(object)
          destroyObjectTree(object)
        }
      }
      for (const instance of instances) {
        if (isStale()) return
        let outer = runtime.objects.get(instance.instance_id)
        const assetKey = `${instance.glb_artifact.sha256}:${instance.glb_artifact.workspace_path}`
        if (outer && outer.userData.assetKey !== assetKey) {
          disposeQualityCache(instance.instance_id, false)
          runtime.objects.delete(instance.instance_id)
          runtime.viewer.getScene().remove(outer)
          destroyObjectTree(outer)
          outer = undefined
        }
        try {
          if (!outer) {
            const response = await fetch(objectUrl(instance, 'glb'), { redirect: 'error', signal: controller.signal })
            if (isStale()) return
            if (!response.ok) throw new Error(`GLB 下载失败（HTTP ${response.status}）`)
            assertArtifactWithinBudget(instance.glb_artifact, response, MAX_GLB_CONTENT_BYTES, 'GLB')
            const glbBytes = await response.arrayBuffer()
            if (isStale()) return
            if (glbBytes.byteLength > MAX_GLB_CONTENT_BYTES) throw new Error('GLB 响应超过浏览器加载预算。')
            const parsed = await sdk.GLTFLoader.loadGLTF(glbBytes, { textureLoader: url => sdk.downloadTexture(url, { context: runtime.viewer }) })
            if (isStale()) { destroyObjectTree(parsed.scene); return }
            outer = new sdk.Object3D(); outer.name = instance.label; outer.userData.instanceId = instance.instance_id; outer.userData.assetKey = assetKey
            const glbAlignment = computeGlbObjectAlignment(instance.normalization)
            const basis = new sdk.Object3D()
            basis.rotation = new sdk.Euler(...glbAlignment.rotationRadians)
            basis.position.set(...glbAlignment.pivot)
            basis.add(parsed.scene); outer.add(basis)
            if (isStale()) { destroyObjectTree(outer); return }
            runtime.viewer.getScene().add(outer); runtime.objects.set(instance.instance_id, outer)
          }
          if (isStale()) return
          outer.position.set(...instance.transform.position); outer.quaternion = new sdk.Quaternion(...instance.transform.rotation_quaternion); outer.scale.set(...instance.transform.scale); outer.updateMatrixWorld(true)
        } catch (cause) {
          if (isStale()) return
          failures.set(
            instance.instance_id,
            cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/g, '[asset]') : 'GLB 加载失败。',
          )
        }
      }
      if (isStale()) return
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
      const frameKey = framingKeyRef.current ?? instances.map(instance => [
        instance.instance_id,
        instance.glb_artifact.sha256,
        instance.transform.position,
        instance.transform.rotation_quaternion,
        instance.transform.scale,
      ]).join('|')
      runtime.frameLoadedObjects(frameKey)
      runtime.viewer.render()
      const instanceIds = requestedInstanceIds.filter(instanceId => runtime.objects.has(instanceId))
      const failedInstanceIds = requestedInstanceIds.filter(instanceId => !runtime.objects.has(instanceId))
      objectLoadStateCallbackRef.current?.({
        status: failedInstanceIds.length ? 'error' : requestedInstanceIds.length ? 'ready' : 'idle',
        instanceIds,
        failedInstanceIds,
        ...(failedInstanceIds.length ? {
          error: failedInstanceIds.map(instanceId => failures.get(instanceId) ?? 'GLB 加载失败。').join('；'),
        } : {}),
      })
      // PLY quality loading depends on an editable GLB root. A user can select
      // PLY while that root is still downloading; advancing this revision makes
      // the quality effect retry against the newly committed object map.
      if (qualityModeRef.current === 'ply') setObjectLoadRevision(revision => revision + 1)
    }
    void loadObjects().catch(cause => {
      if (isStale()) return
      const message = cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/g, '[asset]') : 'GLB 加载失败。'
      objectLoadStateCallbackRef.current?.({
        status: 'error',
        instanceIds: [],
        failedInstanceIds: requestedInstanceIds,
        error: message,
      })
      if (qualityModeRef.current === 'ply') setObjectLoadRevision(revision => revision + 1)
    })
    return () => {
      cancelled = true
      controller.abort()
      if (objectRequestRef.current === controller) objectRequestRef.current = null
      if (objectLoadGenerationRef.current === generation) objectLoadGenerationRef.current += 1
    }
  }, [disposeQualityCache, instances, objectUrl, status])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || status !== 'ready') return
    const highlighted: Parameters<Viewer['setHighlightObjects']>[0] = []
    const selected = selectedInstanceId ? runtime.objects.get(selectedInstanceId) : null
    selected?.traverse(node => {
      if ((node as Object3D & { isMesh?: boolean }).isMesh) highlighted.push({ object: node as Parameters<Viewer['setHighlightObjects']>[0][number]['object'] })
    })
    runtime.viewer.setHighlightObjects(highlighted)
    runtime.viewer.render()
  }, [selectedInstanceId, status])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || status !== 'ready') return
    let cancelled = false
    void (async () => {
      const sdk = await loadAholoViewerSdk()
      const markers = agentMarkersRef.current
      const desired = new Set(markers.map(marker => marker.id))
      for (const [id, object] of agentObjectsRef.current) {
        if (!desired.has(id)) { runtime.viewer.getScene().remove(object); object.destroy(); agentObjectsRef.current.delete(id) }
      }
      for (const marker of markers) {
        let object = agentObjectsRef.current.get(marker.id)
        if (!object) {
          const response = await fetch('/spatial/agent-observer.gltf', { redirect: 'error' })
          if (!response.ok || cancelled) continue
          const parsed = await sdk.GLTFLoader.loadGLTF(await response.arrayBuffer(), { textureLoader: url => sdk.downloadTexture(url, { context: runtime.viewer }) })
          if (cancelled) { parsed.scene.destroy(); continue }
          object = new sdk.Object3D(); object.name = marker.label; object.userData.agentId = marker.id; object.add(parsed.scene)
          parsed.scene.traverse(node => {
            const tintable = node as Object3D & { isMesh?: boolean; material?: { setValues?(values: { color: string }): void } }
            if (tintable.isMesh) tintable.material?.setValues?.({ color: marker.color })
          })
          runtime.viewer.getScene().add(object); agentObjectsRef.current.set(marker.id, object)
        }
        object.position.set(...marker.viewpoint.position)
        object.lookAt(new sdk.Vector3(...marker.viewpoint.target))
        object.scale.set(0.7, 0.7, 0.7)
        object.updateMatrixWorld(true)
      }
      runtime.viewer.render()
    })().catch(() => undefined)
    return () => { cancelled = true }
  }, [agentMarkersKey, status])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || !objectUrl || status !== 'ready') return
    qualityRequestRef.current?.abort()
    const controller = new AbortController()
    qualityRequestRef.current = controller
    const generation = qualityLoadGenerationRef.current + 1
    qualityLoadGenerationRef.current = generation
    const isStale = () => (
      controller.signal.aborted
      || qualityLoadGenerationRef.current !== generation
      || runtimeRef.current !== runtime
      || runtime.viewer.isDestroyed
    )
    const invalidate = () => {
      controller.abort()
      if (qualityRequestRef.current === controller) qualityRequestRef.current = null
      if (qualityLoadGenerationRef.current === generation) qualityLoadGenerationRef.current += 1
    }
    const candidates = qualityCandidatesRef.current
    const totalCount = candidates.length
    const desiredInstanceIds = new Set(candidates.map(candidate => candidate.instance_id))
    for (const instanceId of [...qualityCacheRef.current.keys()]) {
      if (desiredInstanceIds.has(instanceId)) continue
      disposeQualityCache(instanceId)
    }

    if (qualityMode === 'glb' || totalCount === 0) {
      for (const [instanceId, cache] of qualityCacheRef.current) {
        if (runtime.objects.get(instanceId) !== cache.editable) {
          disposeQualityCache(instanceId, false)
          continue
        }
        cache.root.visible = false
        cache.editable.visible = true
      }
      runtime.viewer.render()
      qualityStateCallbackRef.current?.({ status: 'glb', instanceId: null, loadedCount: 0, totalCount })
      return invalidate
    }

    qualityStateCallbackRef.current?.({ status: 'loading', instanceId: null, loadedCount: 0, totalCount })
    const loadQuality = async () => {
      const sdk = await loadAholoViewerSdk()
      if (isStale()) return
      let loadedCount = 0
      const failures: string[] = []
      for (const instance of candidates) {
        if (isStale()) return
        const artifact = instance.optional_ply_artifact
        if (!artifact) continue
        const instanceKey = `${instance.instance_id}:${instance.optional_ply_artifact?.sha256}:${QUALITY_ALIGNMENT_VERSION}`
        let cache = qualityCacheRef.current.get(instance.instance_id)
        let pendingSplat: Splat | null = null
        let pendingRoot: Object3D | null = null
        try {
          if (cache && (cache.assetKey !== instanceKey || runtime.objects.get(instance.instance_id) !== cache.editable)) {
            disposeQualityCache(instance.instance_id, runtime.objects.get(instance.instance_id) === cache.editable)
            cache = undefined
          }
          if (!cache) {
            const response = await fetch(objectUrl(instance, 'ply'), { redirect: 'error', signal: controller.signal })
            if (isStale()) return
            if (!response.ok) throw new Error(`PLY 下载失败（HTTP ${response.status}）`)
            const contentLength = assertArtifactWithinBudget(artifact, response, MAX_PLY_CONTENT_BYTES, 'PLY')
            if (!response.body) throw new Error('PLY 响应不支持流式读取。')
            const data = await sdk.SplatLoader.parseSplatData(
              sdk.SplatLoader.SplatFileType.PLY,
              {
                stream: streamWithinBudget(response.body, MAX_PLY_CONTENT_BYTES, 'PLY'),
                contentLength,
              },
            )
            if (isStale()) return
            const qualitySplat = await sdk.SplatUtils.createSplat(data)
            pendingSplat = qualitySplat
            if (isStale()) { qualitySplat.freeGPU(); qualitySplat.destroy(); pendingSplat = null; return }
            const dense = sdk.SplatUtils.computeDenseBox(new sdk.SplatUtils.SplatOperator(qualitySplat, data), 0.995)
            if (isStale()) { qualitySplat.freeGPU(); qualitySplat.destroy(); pendingSplat = null; return }
            const alignment = computeLuxPlyAlignment(instance.normalization, { min: dense.boxMin as [number, number, number], max: dense.boxMax as [number, number, number] })
            const root = new sdk.Object3D(); const fit = new sdk.Object3D(); const basis = new sdk.Object3D()
            pendingRoot = root
            root.userData.instanceId = instance.instance_id
            fit.scale.set(...alignment.scale); basis.rotation = new sdk.Euler(...alignment.rotationRadians); basis.position.set(...alignment.pivot)
            basis.add(qualitySplat); fit.add(basis); root.add(fit)
            const editable = runtime.objects.get(instance.instance_id)
            if (!editable || isStale()) {
              qualitySplat.freeGPU()
              destroyObjectTree(root)
              pendingSplat = null
              pendingRoot = null
              if (isStale()) return
              throw new Error('GLB 尚未就绪，正在等待后重试。')
            }
            runtime.viewer.getScene().add(root)
            cache = { assetKey: instanceKey, instanceId: instance.instance_id, root, splat: qualitySplat, editable, viewer: runtime.viewer, disposed: false }
            qualityCacheRef.current.set(instance.instance_id, cache)
            pendingSplat = null
            pendingRoot = null
          }
          if (isStale()) return
          cache.root.position.set(...instance.transform.position); cache.root.quaternion = new sdk.Quaternion(...instance.transform.rotation_quaternion); cache.root.scale.set(...instance.transform.scale); cache.root.visible = true; cache.root.updateMatrixWorld(true)
          cache.editable.visible = false
          loadedCount += 1
          runtime.viewer.render()
          qualityStateCallbackRef.current?.({ status: loadedCount === totalCount ? 'ply' : 'loading', instanceId: null, loadedCount, totalCount })
        } catch (cause) {
          if (pendingRoot) {
            pendingSplat?.freeGPU()
            destroyObjectTree(pendingRoot)
          } else if (pendingSplat) {
            pendingSplat.freeGPU()
            pendingSplat.destroy()
          }
          if (isStale()) return
          const editable = runtime.objects.get(instance.instance_id); if (editable) editable.visible = true
          failures.push(cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/g, '[asset]') : 'PLY 加载失败。')
        }
      }
      if (!isStale() && failures.length) qualityStateCallbackRef.current?.({ status: 'error', instanceId: null, loadedCount, totalCount, error: `${failures.length} 个 PLY 加载失败，已自动保留 GLB。` })
    }
    const queuedLoad = qualityParseTailRef.current.then(loadQuality, loadQuality)
    qualityParseTailRef.current = queuedLoad.then(() => undefined, () => undefined)
    void queuedLoad.catch(cause => {
      if (isStale()) return
      const message = cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/g, '[asset]') : 'PLY 加载失败。'
      qualityStateCallbackRef.current?.({ status: 'error', instanceId: null, loadedCount: 0, totalCount, error: message })
    })
    return invalidate
  }, [disposeQualityCache, objectLoadRevision, objectUrl, qualityAssetKey, qualityMode, qualityReloadToken, status])

  useEffect(() => {
    const caches = qualityCacheRef.current
    void loadAholoViewerSdk().then(sdk => {
      for (const instance of qualityCandidatesRef.current) {
        const cached = caches.get(instance.instance_id); if (!cached) continue
        cached.root.position.set(...instance.transform.position); cached.root.scale.set(...instance.transform.scale); cached.root.quaternion = new sdk.Quaternion(...instance.transform.rotation_quaternion); cached.root.updateMatrixWorld(true)
      }
      const viewer = caches.values().next().value?.viewer as Viewer | undefined
      if (viewer && !viewer.isDestroyed) viewer.render()
    })
  }, [qualityTransformKey])

  useEffect(() => () => {
    objectLoadGenerationRef.current += 1
    qualityLoadGenerationRef.current += 1
    objectRequestRef.current?.abort()
    objectRequestRef.current = null
    qualityRequestRef.current?.abort()
    qualityRequestRef.current = null
    disposeQualityCaches(false)
  }, [disposeQualityCaches])

  useEffect(() => {
    const container = containerRef.current
    if (!container) { setStatus('idle'); return }
    const agentObjects = agentObjectsRef.current
    let cancelled = false; let viewer: Viewer | null = null; let camera: PerspectiveCamera | null = null
    let target: Vector3 | null = null; let splat: Splat | null = null; let raf: number | null = null; let navigationRaf: number | null = null
    let viewerSdk: AholoViewerSdk | null = null
    let userHasAdjustedView = false
    let framedObjectKey: string | null = null
    let loadedObjectFrame: null | {
      key: string
      yaw: number
      pitch: number
      radius: number
      target: [number, number, number]
    } = null
    let worldFrameState: 'none' | 'pending' | 'ready' | 'failed' = assetUrl && format ? 'pending' : 'none'
    const controller = new AbortController(); const removers: Array<() => void> = []
    const pressedKeys = new Set<string>()
    const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])
    const axis: 'Y' | 'Z' = upAxis?.toUpperCase() === 'Y' ? 'Y' : 'Z'
    const defaultYaw = axis === 'Z' ? -0.82 : 0.72
    const defaultPitch = 0.38
    const orbit = {
      yaw: defaultYaw,
      pitch: defaultPitch,
      distance: 8,
      target: [0, 0, 0] as [number, number, number],
      home: null as null | { yaw: number; pitch: number; distance: number; target: [number, number, number] },
      dragging: false,
      pointerId: -1,
      mode: 'orbit' as 'orbit' | 'pan',
      moved: false,
      x: 0,
      y: 0,
    }
    const fitEditableObjects = () => {
      const editableInstances = instancesRef.current
      if (editableInstances.length === 0) return
      const center = editableInstances.reduce<[number, number, number]>((sum, instance) => [
        sum[0] + instance.transform.position[0],
        sum[1] + instance.transform.position[1],
        sum[2] + instance.transform.position[2],
      ], [0, 0, 0]).map(value => value / editableInstances.length) as [number, number, number]
      const radius = editableInstances.reduce((maximum, instance) => {
        const size = instance.normalization.bounds?.size ?? [1, 1, 1]
        const scaled = size.map((value, index) => Math.abs(value * instance.transform.scale[index]))
        const extent = Math.hypot(...scaled) / 2
        const offset = Math.hypot(...instance.transform.position.map((value, index) => value - center[index]))
        return Math.max(maximum, extent + offset)
      }, 0.5)
      orbit.target = center
      orbit.distance = camera
        ? cameraDistanceForBoundingSphere({ radius, verticalFovDeg: camera.fov, aspect: camera.aspect })
        : Math.min(Math.max(radius * 3.1, 0.2), 5_000)
    }
    const objects = new Map<string, Object3D>()
    const render = () => { if (!cancelled && viewer && raf === null) raf = requestAnimationFrame(() => { raf = null; if (viewer && !viewer.isDestroyed) viewer.render() }) }
    const viewpoint = (): SceneViewpoint => ({ position: camera ? [camera.position.x, camera.position.y, camera.position.z] : [0, 0, 0], target: [...orbit.target], up: camera ? [camera.up.x, camera.up.y, camera.up.z] : [0, 0, 1], fov_deg: camera?.fov ?? 56 })
    const applyViewpoint = (value: SceneViewpoint) => { if (!camera || !target) return; camera.position.set(...value.position); camera.up.set(...value.up); camera.fov = value.fov_deg; camera.updateProjectionMatrix(); target.set(...value.target); camera.lookAt(target); camera.updateMatrixWorld(true); render() }
    const applyUser = () => {
      if (!camera || !target) return
      const horizontal = Math.cos(orbit.pitch) * orbit.distance
      if (axis === 'Z') camera.up.set(0, 0, 1); else camera.up.set(0, 1, 0)
      if (axis === 'Z') camera.position.set(orbit.target[0] + Math.cos(orbit.yaw) * horizontal, orbit.target[1] + Math.sin(orbit.yaw) * horizontal, orbit.target[2] + Math.sin(orbit.pitch) * orbit.distance)
      else camera.position.set(orbit.target[0] + Math.cos(orbit.yaw) * horizontal, orbit.target[1] + Math.sin(orbit.pitch) * orbit.distance, orbit.target[2] + Math.sin(orbit.yaw) * horizontal)
      target.set(...orbit.target); camera.lookAt(target); camera.updateMatrixWorld(true); onCameraChange?.({ ...viewpoint(), distance: orbit.distance }); render()
    }
    const resetUser = () => {
      if (!orbit.home) return
      orbit.yaw = orbit.home.yaw
      orbit.pitch = orbit.home.pitch
      orbit.distance = orbit.home.distance
      orbit.target = [...orbit.home.target]
      userHasAdjustedView = false
      applyUser()
    }
    const updateCameraClipPlanes = (distance: number, radius: number) => {
      if (!camera) return
      camera.near = Math.max(Math.min(distance / 5_000, radius / 50), 0.001)
      camera.far = Math.max(distance + radius * 8, camera.near * 1_000, 500)
      camera.updateProjectionMatrix()
    }
    const frameLoadedObjects = (frameKey: string) => {
      if (!viewerSdk || !camera || objects.size === 0 || framedObjectKey === frameKey) return
      if (worldFrameState === 'pending' || worldFrameState === 'ready') return

      // A changed Scene/revision is a new framing context. Polls of the same
      // revision keep the user's camera untouched.
      userHasAdjustedView = false

      const bounds = new viewerSdk.Box3().makeEmpty()
      for (const object of objects.values()) {
        object.updateMatrixWorld(true)
        bounds.expandByObject(object)
      }
      if (bounds.isEmpty() || bounds.hasNan()) return

      const center = bounds.getCenter(new viewerSdk.Vector3())
      const size = bounds.getSize(new viewerSdk.Vector3())
      const radius = Math.max(Math.hypot(size.x, size.y, size.z) / 2, 0.001)
      loadedObjectFrame = {
        key: frameKey,
        yaw: defaultYaw,
        pitch: defaultPitch,
        radius,
        target: [center.x, center.y, center.z],
      }
      const nextHome = {
        yaw: loadedObjectFrame.yaw,
        pitch: loadedObjectFrame.pitch,
        distance: cameraDistanceForBoundingSphere({
          radius,
          verticalFovDeg: camera.fov,
          aspect: camera.aspect,
        }),
        target: [center.x, center.y, center.z] as [number, number, number],
      }
      framedObjectKey = frameKey
      orbit.home = nextHome

      // A late Scene response used to leave the camera at its generic distance
      // of 8, making small GLBs look like dots. Reframe only while the view is
      // untouched; once the user moves, update Reset without stealing control.
      orbit.yaw = nextHome.yaw
      orbit.pitch = nextHome.pitch
      orbit.distance = nextHome.distance
      orbit.target = [...nextHome.target]
      updateCameraClipPlanes(nextHome.distance, radius)
      applyUser()
    }
    let lastNavigationTime = 0
    const navigate = (time: number) => {
      navigationRaf = null
      if (cancelled || !camera || !target || cameraModeRef.current !== 'user' || pressedKeys.size === 0) {
        lastNavigationTime = 0
        return
      }
      const deltaSeconds = lastNavigationTime ? Math.min((time - lastNavigationTime) / 1000, 0.05) : 0
      lastNavigationTime = time
      if (deltaSeconds > 0) {
        const forward: [number, number, number] = [
          target.x - camera.position.x,
          target.y - camera.position.y,
          target.z - camera.position.z,
        ]
        forward[axis === 'Z' ? 2 : 1] = 0
        const forwardLength = Math.hypot(...forward) || 1
        forward[0] /= forwardLength; forward[1] /= forwardLength; forward[2] /= forwardLength
        const right: [number, number, number] = axis === 'Z'
          ? [forward[1], -forward[0], 0]
          : [-forward[2], 0, forward[0]]
        const up: [number, number, number] = axis === 'Z' ? [0, 0, 1] : [0, 1, 0]
        const movement: [number, number, number] = [0, 0, 0]
        const add = (vector: [number, number, number], multiplier: number) => {
          movement[0] += vector[0] * multiplier
          movement[1] += vector[1] * multiplier
          movement[2] += vector[2] * multiplier
        }
        if (pressedKeys.has('KeyW')) add(forward, 1)
        if (pressedKeys.has('KeyS')) add(forward, -1)
        if (pressedKeys.has('KeyD')) add(right, 1)
        if (pressedKeys.has('KeyA')) add(right, -1)
        if (pressedKeys.has('KeyE')) add(up, 1)
        if (pressedKeys.has('KeyQ')) add(up, -1)
        const length = Math.hypot(...movement)
        if (length > 0) {
          const speed = Math.max(orbit.distance * 0.9, 0.75) * (pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight') ? 3.5 : 1)
          orbit.target = orbit.target.map((value, index) => value + movement[index] / length * speed * deltaSeconds) as [number, number, number]
          applyUser()
        }
      }
      navigationRaf = requestAnimationFrame(navigate)
    }
    const startNavigation = () => {
      if (navigationRaf === null) navigationRaf = requestAnimationFrame(navigate)
    }
    const listen = <K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions) => { container.addEventListener(type, handler as EventListener, options); removers.push(() => container.removeEventListener(type, handler as EventListener, options)) }
    void (async () => {
      try {
        setStatus('loading'); setError(null); const sdk = await loadAholoViewerSdk(); if (cancelled) return
        viewerSdk = sdk
        viewer = sdk.createViewer(`spatial-stage-${Date.now()}`, container, { antialiasing: true, alpha: false })
        // Aholo's async pixel readback is intentionally opt-in because it adds
        // an extra framebuffer copy. Agent/User observations depend on real
        // rendered pixels, so enable it only for this interactive Stage.
        if (captureEnabled) viewer.config.isExtraCopyBeforeScreenEnabled.set(true)
        camera = new sdk.PerspectiveCamera(56, Math.max(container.clientWidth / Math.max(container.clientHeight, 1), 0.1), 0.02, 5000); target = new sdk.Vector3(); viewer.setCamera(camera)
        sdk.setViewerConfig(viewer, { pipeline: { Background: { background: { active: sdk.BackgroundMode.BasicBackground, basic: { color: new sdk.Color(0.018, 0.025, 0.035) } }, ground: { enabled: false } }, Splatting: { enabled: true }, TAA: { enabled: false } } }); viewer.requestRenderHandler = render
        fitEditableObjects()
        camera.near = Math.max(orbit.distance / 5000, 0.01); camera.far = Math.max(orbit.distance * 30, 500)
        viewer.getScene().add(new sdk.AmbientLight(0xffffff, 0.85))
        for (const [index, position] of [[4, -3, 7], [-5, 2, 4], [1, 6, 3]].entries()) { const light = new sdk.DirectionalLight(0xffffff, index === 0 ? 0.75 : 0.4); light.position.set(...position as [number, number, number]); viewer.getScene().add(light) }
        orbit.home = { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance, target: [...orbit.target] }
        runtimeRef.current = { viewer, camera, target, objects, applyUser, resetUser, applyViewpoint, viewpoint, frameLoadedObjects }
        if (cameraModeRef.current === 'agent' && agentViewpointRef.current) applyViewpoint(agentViewpointRef.current); else applyUser(); setStatus('ready')
        if (assetUrl && format) {
          try {
            const worldResponse = await fetch(assetUrl, { signal: controller.signal, redirect: 'error' })
            if (!worldResponse.ok) throw new Error(`世界资产加载失败（HTTP ${worldResponse.status}）`)
            const data = await withTimeout(
              sdk.SplatLoader.parseSplatData(
                format === 'spz' ? sdk.SplatLoader.SplatFileType.SPZ : sdk.SplatLoader.SplatFileType.PLY,
                new Uint8Array(await worldResponse.arrayBuffer()),
              ),
              60_000,
              '3DGS 解码超时。',
            )
            if (cancelled) return
            splat = await sdk.SplatUtils.createSplat(data); viewer.getScene().add(splat)
            const dense = sdk.SplatUtils.computeDenseBox(new sdk.SplatUtils.SplatOperator(splat, data), 0.995)
            const containsCaptureOrigin = dense.boxMin.every((minimum, index) => minimum <= 0 && dense.boxMax[index] >= 0)
            const diagonal = Math.hypot(...dense.boxMax.map((value, index) => value - dense.boxMin[index]))
            if (containsCaptureOrigin) {
              // Aholo AI World/360 reconstructions are authored around the capture
              // origin. Looking inward from outside their splat shell produces an
              // unreadable, overdrawn view even though the asset is valid.
              orbit.yaw = Math.PI / 2
              orbit.pitch = 0
              orbit.distance = 1
              orbit.target = axis === 'Z' ? [0, -1, 0] : [0, 0, -1]
            } else {
              orbit.target = dense.boxMin.map((value, index) => (value + dense.boxMax[index]) / 2) as [number, number, number]
              orbit.distance = Number.isFinite(diagonal) ? Math.min(Math.max(diagonal * 0.82, 1.5), 2400) : orbit.distance
            }
            worldFrameState = 'ready'
            orbit.home = { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance, target: [...orbit.target] }
            camera.near = Math.max(orbit.distance / 5000, 0.01); camera.far = Math.max(orbit.distance * 30, 500)
            if (cameraModeRef.current === 'agent' && agentViewpointRef.current) applyViewpoint(agentViewpointRef.current)
            else applyUser()
            setError(null)
          } catch (cause) {
            if (!cancelled && !(cause instanceof DOMException && cause.name === 'AbortError')) {
              worldFrameState = 'failed'
              frameLoadedObjects(framingKeyRef.current ?? `world-fallback:${[...objects.keys()].sort().join('|')}`)
              const message = cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/g, '[asset]') : 'World 背景载入失败。'
              setError(`${message} Lux 可编辑物体仍可继续使用。`)
            }
          }
        }
      } catch (cause) { if (!cancelled && !(cause instanceof DOMException && cause.name === 'AbortError')) { setError(cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/g, '[asset]') : '空间载入失败。'); setStatus('error') } }
    })()
    const resize = new ResizeObserver(() => {
      if (!viewer || !camera || viewer.isDestroyed) return
      viewer.resize()
      camera.aspect = Math.max(container.clientWidth / Math.max(container.clientHeight, 1), 0.1)
      camera.updateProjectionMatrix()
      if (loadedObjectFrame && worldFrameState !== 'pending' && worldFrameState !== 'ready') {
        const distance = cameraDistanceForBoundingSphere({
          radius: loadedObjectFrame.radius,
          verticalFovDeg: camera.fov,
          aspect: camera.aspect,
        })
        updateCameraClipPlanes(distance, loadedObjectFrame.radius)
        orbit.home = {
          yaw: loadedObjectFrame.yaw,
          pitch: loadedObjectFrame.pitch,
          distance,
          target: [...loadedObjectFrame.target],
        }
        if (!userHasAdjustedView) {
          orbit.yaw = loadedObjectFrame.yaw
          orbit.pitch = loadedObjectFrame.pitch
          orbit.distance = distance
          orbit.target = [...loadedObjectFrame.target]
          if (cameraModeRef.current === 'user') { applyUser(); return }
        }
      }
      render()
    }); resize.observe(container)
    listen('blur', () => { pressedKeys.clear(); lastNavigationTime = 0 })
    listen('keydown', event => {
      if (cameraModeRef.current !== 'user' || (!movementKeys.has(event.code) && !event.code.startsWith('Shift'))) return
      event.preventDefault()
      if (movementKeys.has(event.code)) userHasAdjustedView = true
      pressedKeys.add(event.code)
      startNavigation()
    })
    listen('keyup', event => {
      if (!movementKeys.has(event.code) && !event.code.startsWith('Shift')) return
      event.preventDefault()
      pressedKeys.delete(event.code)
      if (![...pressedKeys].some(code => movementKeys.has(code))) lastNavigationTime = 0
    })
    listen('contextmenu', event => event.preventDefault())
    listen('pointerdown', event => {
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) return
      container.focus({ preventScroll: true })
      orbit.dragging = true
      orbit.pointerId = event.pointerId
      orbit.mode = event.shiftKey || event.button === 1 || event.button === 2 ? 'pan' : 'orbit'
      orbit.moved = false
      orbit.x = event.clientX
      orbit.y = event.clientY
      container.setPointerCapture(event.pointerId)
    })
    listen('pointermove', event => {
      if (!orbit.dragging || event.pointerId !== orbit.pointerId || cameraModeRef.current !== 'user') return
      const deltaX = event.clientX - orbit.x
      const deltaY = event.clientY - orbit.y
      if (Math.hypot(deltaX, deltaY) > 2) orbit.moved = true
      if (Math.hypot(deltaX, deltaY) > 2) userHasAdjustedView = true
      if (orbit.mode === 'orbit') {
        orbit.yaw -= deltaX * 0.006
        orbit.pitch = Math.min(1.42, Math.max(-1.42, orbit.pitch + deltaY * 0.0045))
      } else {
        const speed = Math.max(orbit.distance, 0.35) * 0.0014
        const right: [number, number, number] = axis === 'Z'
          ? [-Math.sin(orbit.yaw), Math.cos(orbit.yaw), 0]
          : [-Math.sin(orbit.yaw), 0, Math.cos(orbit.yaw)]
        const vertical: [number, number, number] = axis === 'Z'
          ? [-Math.cos(orbit.yaw) * Math.sin(orbit.pitch), -Math.sin(orbit.yaw) * Math.sin(orbit.pitch), Math.cos(orbit.pitch)]
          : [-Math.cos(orbit.yaw) * Math.sin(orbit.pitch), Math.cos(orbit.pitch), -Math.sin(orbit.yaw) * Math.sin(orbit.pitch)]
        orbit.target = orbit.target.map((value, index) => value - right[index] * deltaX * speed + vertical[index] * deltaY * speed) as [number, number, number]
      }
      orbit.x = event.clientX
      orbit.y = event.clientY
      applyUser()
    })
    const stop = (event: PointerEvent) => { if (event.pointerId === orbit.pointerId) { orbit.dragging = false; orbit.pointerId = -1 } }; listen('pointerup', stop); listen('pointercancel', stop)
    listen('wheel', event => { event.preventDefault(); if (cameraModeRef.current === 'user') { userHasAdjustedView = true; orbit.distance = Math.min(5000, Math.max(0.35, orbit.distance * Math.exp(event.deltaY * 0.0012))); applyUser() } }, { passive: false })
    listen('click', async event => {
      if (!viewer || !camera) return
      if (orbit.moved) { orbit.moved = false; return }
      const sdk = await loadAholoViewerSdk(); const rect = container.getBoundingClientRect()
      const hits = viewer.createPicker().pick(new sdk.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1)), camera, true)
      let node: Object3D | null = hits[0]?.object ?? null; let instanceId: string | null = null
      while (node) { if (typeof node.userData.instanceId === 'string') { instanceId = node.userData.instanceId; break } node = node.parent }
      onSelectInstance?.(instanceId)
    })
    return () => { cancelled = true; controller.abort(); objectLoadGenerationRef.current += 1; qualityLoadGenerationRef.current += 1; objectRequestRef.current?.abort(); objectRequestRef.current = null; qualityRequestRef.current?.abort(); qualityRequestRef.current = null; resize.disconnect(); removers.forEach(remove => remove()); if (raf !== null) cancelAnimationFrame(raf); if (navigationRaf !== null) cancelAnimationFrame(navigationRaf); pressedKeys.clear(); runtimeRef.current = null; disposeQualityCaches(false); for (const object of agentObjects.values()) destroyObjectTree(object); agentObjects.clear(); if (viewer && !viewer.isDestroyed) { if (splat) { viewer.getScene().remove(splat); splat.freeGPU() } viewer.destroy() } }
  }, [assetUrl, captureEnabled, disposeQualityCaches, format, upAxis, onCameraChange, onSelectInstance])

  return <div className={styles.viewerRoot}>
    <div
      ref={containerRef}
      className={styles.viewerContainer}
      aria-label="Aholo 混合空间查看器"
      tabIndex={0}
    />
    {status !== 'ready' && <div className={styles.viewerState} role={status === 'error' ? 'alert' : 'status'}><strong>{status === 'error' ? '空间载入失败' : status === 'idle' ? '选择一个 Scene' : '正在构建混合空间'}</strong><p>{status === 'error' ? error : '正在读取 World 3DGS 与 Scene GLB。'}</p></div>}
    {status === 'ready' && error && <div className={styles.viewerWarning} role="alert"><strong>World 背景未载入</strong><span>{error}</span></div>}
    <div className={styles.scanline} aria-hidden="true" />
  </div>
})

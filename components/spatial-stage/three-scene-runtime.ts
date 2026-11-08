import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { SceneViewpoint, Vec3 } from '@/lib/spatial/scene-types'
import { computeLuxPlyAlignment } from './object-alignment'
import { createSpatialProxyObject, spatialInstanceAssetKey, type SpatialStageInstance } from './proxy-geometry'
import { alignmentMatrix, applyInstanceTransform, applyViewpoint, disposeObject, instancesInFrustum, prepareGlb, queryMeshSurface } from './three-scene-geometry'
import type { SpatialAgentMarker, SpatialCanvasHandle, SpatialQualityRenderState, StageCameraPose } from './three-stage-types'

type Spark = typeof import('@sparkjsdev/spark')
type SplatMesh = import('@sparkjsdev/spark').SplatMesh
interface Entry {
  key: string
  root: THREE.Group
  controller: AbortController
  mesh?: THREE.Object3D
  pending: boolean
  error?: string
  quality?: { key: string; mesh?: SplatMesh; controller: AbortController; pending: boolean; error?: string }
}

export interface ThreeSceneInput {
  revisionId?: string | null
  assetUrl: string | null
  format: 'spz' | 'ply' | null
  environmentUrl?: string | null
  environmentYawDeg?: number
  environmentExposure?: number
  upAxis?: string
  instances?: SpatialStageInstance[]
  objectUrl?: (instance: SpatialStageInstance, quality: 'glb' | 'ply') => string | null
  agentViewpoint?: SceneViewpoint | null
  agentMarkers?: SpatialAgentMarker[]
  cameraMode?: 'user' | 'agent'
  qualityMode?: 'glb' | 'ply'
  qualityReloadToken?: number
  selectedInstanceId?: string | null
}

interface Callbacks {
  onState: (loading: boolean, error: string | null) => void
  onQualityStateChange?: (state: SpatialQualityRenderState) => void
  onSelectInstance?: (id: string | null) => void
  onCameraChange?: (pose: StageCameraPose) => void
  onKeyboardActive?: (active: boolean) => void
}

function message(cause: unknown): string {
  return (cause instanceof Error ? cause.message : String(cause)).replace(/https?:\/\/\S+/g, '[asset]')
}

async function fetchBytes(url: string, controller: AbortController): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]), redirect: 'error' })
  if (!response.ok) throw new Error(`资产读取失败（HTTP ${response.status}）`)
  return response.arrayBuffer()
}

/**
 * A persistent Three.js host. Scene polling reconciles stable asset keys instead
 * of cancelling in-flight loads. Only replacement/removal/unmount abort a load.
 * GLB/procedural meshes own selection and surface truth; splats are visual only.
 */
export class ThreeSceneRuntime implements SpatialCanvasHandle {
  readonly scene = new THREE.Scene()
  readonly renderer: THREE.WebGLRenderer
  readonly userCamera = new THREE.PerspectiveCamera(56, 1, 0.01, 5000)
  readonly observationCamera = new THREE.PerspectiveCamera(56, 1, 0.01, 5000)
  readonly controls: OrbitControls
  private entries = new Map<string, Entry>()
  private input: ThreeSceneInput = { assetUrl: null, format: null }
  private signature = ''
  private epoch = 0
  private destroyed = false
  private raf = 0
  private captureActive = false
  private captureQueue: Promise<unknown> = Promise.resolve()
  private fitted = false
  private home: SceneViewpoint | null = null
  private resizeObserver: ResizeObserver
  private removers: Array<() => void> = []
  private pressedKeys = new Set<string>()
  private navigationRaf = 0
  private selection = new THREE.Box3Helper(new THREE.Box3(), '#a1dfc5')
  private markerRoot = new THREE.Group()
  private markerSource?: THREE.Object3D
  private markerSignature = ''
  private markerController = new AbortController()
  private spark?: import('@sparkjsdev/spark').SparkRenderer
  private sparkPromise?: Promise<Spark>
  private world?: { key: string; controller: AbortController; mesh?: SplatMesh; pending: boolean; error?: string }
  private environment?: { key: string; controller: AbortController; texture?: THREE.Texture; pending: boolean; error?: string }
  private keyLight = new THREE.DirectionalLight(0xfff3e1, 2.6)
  private lastQuality = ''
  private lastState = ''

  constructor(private container: HTMLElement, private callbacks: Callbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.scene.background = new THREE.Color('#202735')
    this.scene.add(new THREE.HemisphereLight(0xe4edff, 0x6d6554, 1.8))
    this.keyLight.position.set(5, -7, 12)
    this.keyLight.castShadow = true
    this.keyLight.shadow.mapSize.set(2048, 2048)
    this.keyLight.shadow.normalBias = 0.025
    this.scene.add(this.keyLight, this.keyLight.target)
    const fill = new THREE.DirectionalLight(0xb8d5ff, 0.8)
    fill.position.set(-5, 4, 6)
    this.scene.add(fill)
    this.userCamera.up.set(0, 0, 1)
    this.userCamera.position.set(6, -9, 6)
    this.controls = new OrbitControls(this.userCamera, this.renderer.domElement)
    this.controls.target.set(0, 0, 1)
    this.controls.enableDamping = false
    this.controls.maxDistance = 5000
    this.controls.minDistance = 0.05
    this.controls.update()
    this.controls.addEventListener('change', this.cameraChanged)
    this.selection.visible = false
    const selectionMaterial = this.selection.material as THREE.LineBasicMaterial
    selectionMaterial.depthTest = false
    this.selection.renderOrder = 1000
    this.markerRoot.name = 'Agent observers'
    this.scene.add(this.selection, this.markerRoot)
    container.append(this.renderer.domElement)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.installInput()
    // A marker failure must never block the actual scene or observations.
    void fetchBytes('/spatial/agent-observer.gltf', this.markerController)
      .then(bytes => new GLTFLoader().parseAsync(bytes, '/spatial/'))
      .then(gltf => {
        if (this.destroyed) { disposeObject(gltf.scene); return }
        this.markerSource = gltf.scene
        this.updateMarkers()
      }).catch(() => undefined)
  }

  sync(input: ThreeSceneInput): void {
    if (this.destroyed) return
    const previous = this.input
    this.input = input
    const signature = JSON.stringify({ ...input, objectUrl: undefined, cameraMode: undefined, selectedInstanceId: undefined, agentMarkers: undefined, agentViewpoint: undefined })
    if (signature !== this.signature) { this.signature = signature; this.epoch += 1 }
    this.controls.enabled = input.cameraMode !== 'agent'
    if (previous.upAxis !== input.upAxis) {
      this.userCamera.up.set(0, input.upAxis === 'Y' ? 1 : 0, input.upAxis === 'Y' ? 0 : 1)
      this.controls.update()
    }
    const instances = input.instances ?? []
    const ids = new Set(instances.map(instance => instance.instance_id))
    for (const [id, entry] of this.entries) if (!ids.has(id)) { this.disposeEntry(entry); this.entries.delete(id) }
    for (const instance of instances) {
      const assetKey = spatialInstanceAssetKey(instance)
      const key = `${assetKey}:${JSON.stringify(instance.normalization ?? null)}:${input.objectUrl?.(instance, 'glb') ?? ''}`
      let entry = this.entries.get(instance.instance_id)
      if (entry?.key !== key) {
        if (entry) this.disposeEntry(entry)
        entry = { key, root: new THREE.Group(), controller: new AbortController(), pending: true }
        entry.root.userData.instanceId = instance.instance_id
        this.entries.set(instance.instance_id, entry)
        this.scene.add(entry.root)
        const proxy = createSpatialProxyObject(instance)
        if (proxy) { entry.mesh = proxy; entry.root.add(proxy); entry.pending = false }
        else {
          const url = input.objectUrl?.(instance, 'glb')
          if (!url || !assetKey) { entry.pending = false; entry.error = `“${instance.label}”缺少可读取的 GLB。` }
          else this.loadGlb(entry, instance, url)
        }
      }
      entry.root.name = instance.label
      entry.root.visible = instance.visible !== false
      applyInstanceTransform(entry.root, instance.transform)
      this.syncQuality(entry, instance)
    }
    this.syncEnvironment()
    this.syncWorld()
    this.updateMarkers()
    this.updateSelection()
    this.fitOnce()
    if (input.cameraMode === 'agent' && input.agentViewpoint) applyViewpoint(this.observationCamera, input.agentViewpoint)
    this.publishState()
    if (previous.cameraMode !== input.cameraMode || (input.cameraMode === 'agent' && JSON.stringify(previous.agentViewpoint) !== JSON.stringify(input.agentViewpoint))) this.cameraChanged()
    this.render()
  }

  isReady(): boolean {
    return !this.destroyed && !this.renderer.getContext().isContextLost() && !this.loading() && this.errors().length === 0
  }

  renderedRevisionId(): string | null { return this.isReady() ? this.input.revisionId ?? null : null }

  private loading(): boolean {
    return Boolean(this.world?.pending || this.environment?.pending || [...this.entries.values()].some(entry => entry.root.visible && (entry.pending || (this.input.qualityMode === 'ply' && entry.quality?.pending))))
  }

  private errors(): string[] {
    return [this.world?.error, this.environment?.error, ...[...this.entries.values()].filter(entry => entry.root.visible).flatMap(entry => [entry.error, this.input.qualityMode === 'ply' ? entry.quality?.error : undefined])].filter((value): value is string => Boolean(value))
  }

  private publishState(): void {
    if (this.destroyed) return
    const errors = this.errors()
    const state = JSON.stringify([this.loading(), errors])
    if (state !== this.lastState) { this.lastState = state; this.callbacks.onState(this.loading(), errors.join('；') || null) }
    const candidates = [...this.entries.values()].filter(entry => entry.root.visible && entry.quality)
    const loadedCount = candidates.filter(entry => entry.quality?.mesh).length
    const error = candidates.find(entry => entry.quality?.error)?.quality?.error
    const quality: SpatialQualityRenderState = {
      status: this.input.qualityMode !== 'ply' ? 'glb' : error ? 'error' : candidates.some(entry => entry.quality?.pending) ? 'loading' : 'ply',
      instanceId: null, loadedCount, totalCount: candidates.length, ...(error ? { error } : {}),
    }
    const qualityKey = JSON.stringify(quality)
    if (qualityKey !== this.lastQuality) { this.lastQuality = qualityKey; this.callbacks.onQualityStateChange?.(quality) }
  }

  private loadGlb(entry: Entry, instance: SpatialStageInstance, url: string): void {
    void fetchBytes(url, entry.controller).then(bytes => new GLTFLoader().parseAsync(bytes, ''))
      .then(gltf => {
        if (entry.controller.signal.aborted || this.destroyed) { disposeObject(gltf.scene); return }
        entry.mesh = prepareGlb(gltf.scene, instance)
        entry.root.add(entry.mesh)
        entry.pending = false
        this.updateQualityVisibility(entry)
        this.fitOnce()
        this.updateSelection()
        this.publishState()
        this.render()
      }).catch(cause => {
        if (!entry.controller.signal.aborted && !this.destroyed) { entry.pending = false; entry.error = `“${instance.label}”加载失败：${message(cause)}`; this.publishState() }
      })
  }

  private async ensureSpark(): Promise<Spark> {
    if (!this.sparkPromise) this.sparkPromise = import('@sparkjsdev/spark').then(sdk => {
      if (this.destroyed) throw new Error('空间舞台已关闭。')
      // Covariance encoding preserves nonuniform scale, including Lux PLY/GLB
      // calibration and the Scene's outer transform. Default Gsplat averages it.
      this.spark = new sdk.SparkRenderer({ renderer: this.renderer, onDirty: () => this.render(), covSplats: true, accumExtSplats: true })
      this.scene.add(this.spark)
      return sdk
    }).catch(cause => { this.sparkPromise = undefined; throw cause })
    return this.sparkPromise
  }

  private async loadSplat(url: string, format: 'ply' | 'spz', controller: AbortController): Promise<SplatMesh> {
    const [sdk, bytes] = await Promise.all([this.ensureSpark(), fetchBytes(url, controller)])
    controller.signal.throwIfAborted()
    const mesh = new sdk.SplatMesh({ fileBytes: bytes, fileName: `asset.${format}`, covSplats: true, extSplats: true, raycastable: false })
    try {
      await mesh.initialized
      controller.signal.throwIfAborted()
      if (!mesh.numSplats) throw new Error('3DGS 资产没有可显示的点。')
      return mesh
    } catch (cause) { mesh.dispose(); throw cause }
  }

  private syncQuality(entry: Entry, instance: SpatialStageInstance): void {
    const url = instance.optional_ply_artifact && instance.normalization && !instance.proxy ? this.input.objectUrl?.(instance, 'ply') : null
    const key = url ? `${url}:${this.input.qualityReloadToken ?? 0}` : null
    if (entry.quality && entry.quality.key !== key) {
      entry.quality.controller.abort()
      entry.quality.mesh?.removeFromParent()
      entry.quality.mesh?.dispose()
      entry.quality = undefined
    }
    if (key && url && this.input.qualityMode === 'ply' && !entry.quality) {
      const quality = { key, controller: new AbortController(), pending: true } as NonNullable<Entry['quality']>
      entry.quality = quality
      void this.loadSplat(url, 'ply', quality.controller).then(mesh => {
        if (quality.controller.signal.aborted || this.destroyed) { mesh.dispose(); return }
        const bounds = mesh.getBoundingBox()
        mesh.matrix.copy(alignmentMatrix(computeLuxPlyAlignment(instance.normalization!, { min: bounds.min.toArray() as Vec3, max: bounds.max.toArray() as Vec3 })))
        mesh.matrixAutoUpdate = false
        entry.root.add(mesh)
        quality.mesh = mesh
        quality.pending = false
        this.updateQualityVisibility(entry)
        this.publishState()
        this.render()
      }).catch(cause => {
        if (!quality.controller.signal.aborted && !this.destroyed) { quality.pending = false; quality.error = `PLY 加载失败：${message(cause)}`; this.updateQualityVisibility(entry); this.publishState(); this.render() }
      })
    }
    this.updateQualityVisibility(entry)
  }

  private updateQualityVisibility(entry: Entry): void {
    const usePly = this.input.qualityMode === 'ply' && Boolean(entry.quality?.mesh)
    if (entry.mesh) entry.mesh.visible = !usePly
    if (entry.quality?.mesh) entry.quality.mesh.visible = usePly
  }

  private syncWorld(): void {
    const key = this.input.assetUrl && this.input.format ? `${this.input.assetUrl}:${this.input.format}` : null
    if (this.world && this.world.key !== key) {
      this.world.controller.abort(); this.world.mesh?.removeFromParent(); this.world.mesh?.dispose(); this.world = undefined
    }
    if (!key || this.world) return
    const world = { key, controller: new AbortController(), pending: true } as NonNullable<ThreeSceneRuntime['world']>
    this.world = world
    void this.loadSplat(this.input.assetUrl!, this.input.format!, world.controller).then(mesh => {
      if (world.controller.signal.aborted || this.destroyed) { mesh.dispose(); return }
      world.mesh = mesh; world.pending = false
      this.scene.add(mesh)
      if (!this.fitted && !(this.input.instances?.length)) {
        const bounds = mesh.getBoundingBox()
        if (bounds.containsPoint(new THREE.Vector3())) this.setHome({ position: [0, 0, 0], target: this.input.upAxis === 'Y' ? [0, 0, -1] : [0, -1, 0], up: this.up(), fov_deg: 56 })
        else this.fitBounds(bounds)
      }
      this.publishState(); this.render()
    }).catch(cause => {
      if (!world.controller.signal.aborted && !this.destroyed) { world.pending = false; world.error = `World 背景加载失败：${message(cause)}`; this.publishState() }
    })
  }

  private syncEnvironment(): void {
    const key = this.input.environmentUrl ?? null
    if (this.environment && this.environment.key !== key) {
      this.environment.controller.abort(); this.environment.texture?.dispose()
      const bitmap = this.environment.texture?.source.data
      if (bitmap instanceof ImageBitmap) bitmap.close()
      this.environment = undefined
      this.scene.background = new THREE.Color('#202735')
    }
    this.scene.backgroundIntensity = this.input.environmentExposure ?? 1
    // Saved panoramas use yaw around the Scene's up axis.
    this.scene.backgroundRotation.set(Math.PI / 2, 0, (this.input.environmentYawDeg ?? 0) * Math.PI / 180, 'ZXY')
    if (this.input.upAxis === 'Y') this.scene.backgroundRotation.set(0, (this.input.environmentYawDeg ?? 0) * Math.PI / 180, 0)
    if (!key || this.environment) return
    const environment = { key, controller: new AbortController(), pending: true } as NonNullable<ThreeSceneRuntime['environment']>
    this.environment = environment
    void fetchBytes(key, environment.controller).then(bytes => createImageBitmap(new Blob([bytes]), { imageOrientation: 'flipY' })).then(bitmap => {
      if (this.destroyed || environment.controller.signal.aborted) { bitmap.close(); return }
      const texture = new THREE.Texture(bitmap)
      texture.mapping = THREE.EquirectangularReflectionMapping
      texture.colorSpace = THREE.SRGBColorSpace
      texture.needsUpdate = true
      environment.texture = texture; environment.pending = false
      this.scene.background = texture
      this.publishState(); this.render()
    }).catch(cause => {
      if (!environment.controller.signal.aborted && !this.destroyed) { environment.pending = false; environment.error = `全景环境加载失败：${message(cause)}`; this.publishState() }
    })
  }

  private updateMarkers(): void {
    const signature = JSON.stringify([this.markerSource?.uuid, this.input.cameraMode, this.input.agentMarkers])
    if (signature === this.markerSignature) return
    this.markerSignature = signature
    // Clones share marker resources; only dispose the source at runtime teardown.
    this.markerRoot.clear()
    this.markerRoot.visible = this.input.cameraMode !== 'agent'
    if (!this.markerSource) return
    for (const marker of this.input.agentMarkers ?? []) {
      const object = this.markerSource.clone(true)
      object.position.fromArray(marker.viewpoint.position)
      object.up.fromArray(marker.viewpoint.up)
      object.lookAt(new THREE.Vector3().fromArray(marker.viewpoint.target))
      object.name = marker.label
      this.markerRoot.add(object)
    }
    this.render()
  }

  private updateSelection(): void {
    const entry = this.input.selectedInstanceId ? this.entries.get(this.input.selectedInstanceId) : undefined
    this.selection.visible = Boolean(entry?.mesh && entry.root.visible)
    if (entry?.mesh) { entry.root.updateWorldMatrix(true, true); this.selection.box.setFromObject(entry.mesh); this.selection.updateMatrixWorld(true) }
  }

  private up(): Vec3 { return this.input.upAxis === 'Y' ? [0, 1, 0] : [0, 0, 1] }
  private activeCamera(): THREE.PerspectiveCamera { return this.input.cameraMode === 'agent' && this.input.agentViewpoint ? this.observationCamera : this.userCamera }
  private cameraChanged = (): void => {
    const camera = this.activeCamera()
    this.callbacks.onCameraChange?.({ ...this.currentViewpoint(), distance: camera.position.distanceTo(this.input.cameraMode === 'agent' && this.input.agentViewpoint ? new THREE.Vector3().fromArray(this.input.agentViewpoint.target) : this.controls.target) })
    this.render()
  }

  currentViewpoint(): SceneViewpoint {
    const camera = this.activeCamera()
    return { position: camera.position.toArray() as Vec3, target: this.input.cameraMode === 'agent' && this.input.agentViewpoint ? [...this.input.agentViewpoint.target] : this.controls.target.toArray() as Vec3, up: camera.up.toArray() as Vec3, fov_deg: camera.fov }
  }

  resetUserView(): void {
    if (!this.home) return
    applyViewpoint(this.userCamera, this.home)
    this.controls.target.fromArray(this.home.target)
    this.controls.update(); this.cameraChanged()
  }
  focusObject(key: string): void {
    const object = this.entries.get(key)?.root
    if (!object) return
    const bounds = new THREE.Box3().setFromObject(object, true), target = bounds.getCenter(new THREE.Vector3())
    const distance = Math.max(bounds.getSize(new THREE.Vector3()).length(), .1) * 1.8
    applyViewpoint(this.userCamera, { target: target.toArray() as Vec3, position: target.clone().add(new THREE.Vector3(distance, -distance, distance * .7)).toArray() as Vec3, up: this.userCamera.up.toArray() as Vec3, fov_deg: this.userCamera.fov })
    this.controls.target.copy(target); this.controls.update(); this.cameraChanged()
  }

  private setHome(viewpoint: SceneViewpoint): void {
    this.home = viewpoint; this.fitted = true; this.resetUserView()
  }

  private fitOnce(): void {
    if (this.fitted) return
    const visible = (this.input.instances ?? []).filter(instance => instance.visible !== false)
    if (!visible.length || visible.some(instance => this.entries.get(instance.instance_id)?.pending)) return
    const authored = visible.filter(instance => instance.role !== 'terrain')
    const bounds = new THREE.Box3()
    for (const instance of authored.length ? authored : visible) {
      const entry = this.entries.get(instance.instance_id)
      if (entry?.mesh) { entry.root.updateWorldMatrix(true, true); bounds.union(new THREE.Box3().setFromObject(entry.mesh)) }
    }
    if (!bounds.isEmpty()) this.fitBounds(bounds)
  }

  private fitBounds(bounds: THREE.Box3): void {
    const center = bounds.getCenter(new THREE.Vector3())
    const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.5)
    const halfFov = Math.min(THREE.MathUtils.degToRad(this.userCamera.fov / 2), Math.atan(Math.tan(THREE.MathUtils.degToRad(this.userCamera.fov / 2)) * this.userCamera.aspect))
    const distance = Math.max(radius / Math.sin(halfFov) * 1.1, 1.5)
    const direction = this.input.upAxis === 'Y' ? new THREE.Vector3(1, 0.65, 1.5) : new THREE.Vector3(1, -1.5, 0.65)
    const position = center.clone().addScaledVector(direction.normalize(), distance)
    this.userCamera.near = Math.max(distance / 10000, 0.005)
    this.userCamera.far = Math.max(distance * 50, 5000)
    this.observationCamera.far = this.userCamera.far
    this.keyLight.target.position.copy(center)
    this.keyLight.position.copy(center).add(new THREE.Vector3(radius, -radius, radius * 2))
    Object.assign(this.keyLight.shadow.camera, { left: -radius * 2, right: radius * 2, top: radius * 2, bottom: -radius * 2, near: 0.01, far: radius * 8 })
    this.keyLight.shadow.camera.updateProjectionMatrix()
    this.setHome({ position: position.toArray() as Vec3, target: center.toArray() as Vec3, up: this.up(), fov_deg: 56 })
  }

  async querySurface(id: string, horizontal: [number, number], castHeight: number, upAxis: 'Y' | 'Z'): Promise<Vec3> {
    const instance = this.input.instances?.find(item => item.instance_id === id)
    const entry = this.entries.get(id)
    if (!instance || instance.role !== 'terrain' || !entry?.mesh || entry.pending || !entry.root.visible) throw new Error('目标地形网格尚未就绪。')
    return queryMeshSurface(entry.mesh, horizontal, castHeight, upAxis)
  }

  visibleInstanceIds(viewpoint?: SceneViewpoint): string[] {
    const camera = viewpoint ? this.activeCamera().clone() : this.activeCamera()
    if (viewpoint) applyViewpoint(camera, viewpoint)
    const objects: Array<[string, THREE.Object3D]> = []
    for (const [id, entry] of this.entries) if (entry.root.visible && entry.mesh && !entry.pending) objects.push([id, entry.mesh])
    return instancesInFrustum(objects, camera)
  }

  capture(viewpoint?: SceneViewpoint, expectedRevisionId?: string): Promise<Blob> {
    const operation = this.captureQueue.then(() => this.captureFrame(viewpoint, expectedRevisionId))
    this.captureQueue = operation.catch(() => undefined)
    return operation
  }

  private async captureFrame(viewpoint?: SceneViewpoint, expectedRevisionId?: string): Promise<Blob> {
    if (!this.isReady()) throw new Error('空间资产尚未完整载入，无法提交观察。')
    if (expectedRevisionId && this.renderedRevisionId() !== expectedRevisionId) throw new Error('场景版本尚未同步，请重新观察。')
    const epoch = this.epoch
    const camera = this.activeCamera().clone()
    if (viewpoint) applyViewpoint(camera, viewpoint)
    const width = Math.max(1, Math.min(1280, Math.round(720 * camera.aspect)))
    const height = Math.max(1, Math.round(width / camera.aspect))
    camera.aspect = width / height; camera.updateProjectionMatrix()
    const linear = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 })
    const output = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false })
    const pass = new OutputPass()
    const pixels = new Uint8Array(width * height * 4)
    const markerVisible = this.markerRoot.visible
    const selectionVisible = this.selection.visible
    const sparkAutoUpdate = this.spark?.autoUpdate
    this.captureActive = true
    try {
      this.markerRoot.visible = false; this.selection.visible = false
      if (this.spark) {
        // update() may return early while an on-screen sort is in flight. Wait
        // for it, then explicitly generate/sort for the observation camera.
        // Disable onBeforeRender updates so they cannot replace this snapshot
        // with an asynchronously prepared user-camera accumulator.
        this.spark.autoUpdate = false
        const deadline = performance.now() + 10_000
        const settleSort = async () => {
          while (this.spark?.sorting || this.spark?.sortDirty) {
            if (this.destroyed || performance.now() > deadline) throw new Error('3DGS 观察帧排序尚未完成，请重试。')
            await new Promise(resolve => setTimeout(resolve, 16))
          }
        }
        await settleSort()
        this.scene.updateMatrixWorld(true)
        await this.spark.update({ scene: this.scene, camera })
        await settleSort()
      }
      if (this.destroyed || this.epoch !== epoch) throw new Error('截图期间场景发生变化，请重新观察。')
      this.renderer.setRenderTarget(linear)
      this.renderer.render(this.scene, camera)
      pass.render(this.renderer, output, linear, 0, false)
      await this.renderer.readRenderTargetPixelsAsync(output, 0, 0, width, height, pixels)
      if (this.destroyed || this.epoch !== epoch) throw new Error('截图期间场景发生变化，请重新观察。')
    } finally {
      this.renderer.setRenderTarget(null)
      this.markerRoot.visible = markerVisible; this.selection.visible = selectionVisible
      if (this.spark && sparkAutoUpdate !== undefined) this.spark.autoUpdate = sparkAutoUpdate
      linear.dispose(); output.dispose(); pass.dispose()
      this.captureActive = false; this.render()
    }
    // WebGL readback starts at the lower left; PNG scanlines start at the top.
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建截图画布。')
    const data = context.createImageData(width, height)
    for (let y = 0; y < height; y++) data.data.set(pixels.subarray((height - y - 1) * width * 4, (height - y) * width * 4), y * width * 4)
    context.putImageData(data, 0, 0)
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('截图编码失败。')), 'image/png'))
  }

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1), height = Math.max(this.container.clientHeight, 1)
    this.renderer.setSize(width, height)
    for (const camera of [this.userCamera, this.observationCamera]) { camera.aspect = width / height; camera.updateProjectionMatrix() }
    this.render()
  }

  private render(): void {
    if (this.destroyed || this.raf || this.captureActive) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      if (!this.destroyed && !this.captureActive) this.renderer.render(this.scene, this.activeCamera())
    })
  }

  private installInput(): void {
    const canvas = this.renderer.domElement
    const listen = (target: EventTarget, name: string, handler: EventListener, options?: AddEventListenerOptions) => {
      target.addEventListener(name, handler, options); this.removers.push(() => target.removeEventListener(name, handler, options))
    }
    let pointerStart: [number, number] | null = null
    listen(canvas, 'pointerdown', ((event: PointerEvent) => { this.container.focus(); pointerStart = [event.clientX, event.clientY] }) as EventListener)
    listen(canvas, 'pointerup', ((event: PointerEvent) => {
      if (this.input.cameraMode === 'agent' || !pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 4 || event.button !== 0) return
      const rect = canvas.getBoundingClientRect()
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), this.userCamera)
      const meshes = [...this.entries.values()].filter(entry => entry.root.visible && entry.mesh).map(entry => entry.mesh!)
      let node: THREE.Object3D | null = ray.intersectObjects(meshes, true)[0]?.object ?? null
      while (node && typeof node.userData.instanceId !== 'string') node = node.parent
      this.callbacks.onSelectInstance?.(node?.userData.instanceId ?? null)
      pointerStart = null
    }) as EventListener)
    const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])
    listen(this.container, 'focus', () => this.callbacks.onKeyboardActive?.(true))
    const clear = () => { this.pressedKeys.clear(); this.callbacks.onKeyboardActive?.(false) }
    listen(this.container, 'blur', clear)
    listen(window, 'blur', clear)
    listen(document, 'visibilitychange', () => { if (document.hidden) clear() })
    listen(this.container, 'keydown', ((event: KeyboardEvent) => {
      if (this.input.cameraMode === 'agent' || event.target !== this.container) return
      if (movementKeys.has(event.code)) { event.preventDefault(); this.pressedKeys.add(event.code); this.navigate() }
      if (event.code.startsWith('Shift')) this.pressedKeys.add(event.code)
    }) as EventListener)
    listen(window, 'keyup', ((event: KeyboardEvent) => { this.pressedKeys.delete(event.code) }) as EventListener)
    listen(canvas, 'webglcontextlost', ((event: Event) => { event.preventDefault(); this.callbacks.onState(false, '图形上下文已丢失，请刷新舞台。') }) as EventListener)
    listen(canvas, 'webglcontextrestored', () => { this.lastState = ''; this.publishState(); this.render() })
  }

  private navigate(): void {
    if (this.navigationRaf) return
    let previous = performance.now()
    const step = (time: number) => {
      this.navigationRaf = 0
      if (this.destroyed || this.input.cameraMode === 'agent' || !this.pressedKeys.size) return
      const delta = Math.min((time - previous) / 1000, 0.05); previous = time
      const up = new THREE.Vector3().fromArray(this.up())
      const forward = this.controls.target.clone().sub(this.userCamera.position).projectOnPlane(up).normalize()
      const right = forward.clone().cross(up).normalize()
      const movement = new THREE.Vector3()
      if (this.pressedKeys.has('KeyW')) movement.add(forward)
      if (this.pressedKeys.has('KeyS')) movement.sub(forward)
      if (this.pressedKeys.has('KeyD')) movement.add(right)
      if (this.pressedKeys.has('KeyA')) movement.sub(right)
      if (this.pressedKeys.has('KeyE')) movement.add(up)
      if (this.pressedKeys.has('KeyQ')) movement.sub(up)
      const speed = Math.max(this.controls.target.distanceTo(this.userCamera.position) * 0.5, 0.75) * ([...this.pressedKeys].some(key => key.startsWith('Shift')) ? 3.5 : 1)
      movement.normalize().multiplyScalar(speed * delta)
      this.userCamera.position.add(movement); this.controls.target.add(movement)
      this.controls.update()
      this.navigationRaf = requestAnimationFrame(step)
    }
    this.navigationRaf = requestAnimationFrame(step)
  }

  private disposeEntry(entry: Entry): void {
    entry.controller.abort(); entry.quality?.controller.abort()
    entry.quality?.mesh?.removeFromParent(); entry.quality?.mesh?.dispose()
    disposeObject(entry.root)
  }

  dispose(): void {
    this.destroyed = true
    cancelAnimationFrame(this.raf); cancelAnimationFrame(this.navigationRaf)
    this.resizeObserver.disconnect(); this.removers.forEach(remove => remove())
    this.controls.removeEventListener('change', this.cameraChanged); this.controls.dispose()
    this.entries.forEach(entry => this.disposeEntry(entry)); this.entries.clear()
    this.world?.controller.abort(); this.world?.mesh?.dispose()
    this.environment?.controller.abort(); this.environment?.texture?.dispose()
    const bitmap = this.environment?.texture?.source.data
    if (bitmap instanceof ImageBitmap) bitmap.close()
    this.markerController.abort(); this.markerRoot.clear()
    if (this.markerSource) disposeObject(this.markerSource)
    this.selection.geometry.dispose(); (this.selection.material as THREE.Material).dispose()
    this.spark?.dispose(); this.keyLight.shadow.dispose(); this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { GeometrySession, createGeometryHelpers, objectBounds, type SceneRegistry } from './geometry'
import type { RuntimeAsset, SceneCamera, SceneConstraint, SceneGeometryQuery, SceneObjectDescriptor, SceneObjectMetadata, SceneQualityAsset, SceneQualityState, SceneRenderedView, SceneRuntimeInit, SceneRuntimeSnapshot, SceneViewRequest } from '../types'
import type { Vec3 } from '../../spatial/scene-types'
import { computeGlbObjectAlignment, computeLuxPlyAlignment } from '../../spatial/object-alignment'

export interface SceneProgram {
  scene: THREE.Scene
  cameras?: Record<string, THREE.Camera | SceneCamera>
  update?: (time: number, dt: number) => void
  dispose?: () => void
}
export interface SceneContext {
  THREE: typeof THREE
  renderer: THREE.WebGLRenderer
  random: () => number
  assets: {
    loadGLB: (alias: string) => Promise<THREE.Group>
    loadTexture: (alias: string) => Promise<THREE.Texture>
    loadSplat: (alias: string) => Promise<THREE.Object3D>
    readData: (alias: string) => unknown
  }
  registerObject: <T extends THREE.Object3D>(key: string, object: T, metadata?: SceneObjectMetadata) => T
  geometry: ReturnType<typeof createGeometryHelpers>
  createCanvas: (width: number, height: number) => OffscreenCanvas
}
export interface SceneModule { createScene: (ctx: SceneContext) => Promise<SceneProgram> | SceneProgram }
type SparkMesh = import('@sparkjsdev/spark').SplatMesh
interface QualityPair { glb: THREE.Group; basis: THREE.Object3D; alias: string; size: Vec3; ply?: THREE.Group; visual?: SparkMesh }
const vec = (value: Vec3) => new THREE.Vector3().fromArray(value)
const array = (value: THREE.Vector3) => value.toArray() as Vec3
const base64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  return btoa(binary)
}
function random(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
function alignment(object: THREE.Object3D, value: ReturnType<typeof computeGlbObjectAlignment>) {
  object.matrix.makeScale(...value.scale).multiply(new THREE.Matrix4().makeTranslation(...value.pivot)).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...value.rotationRadians)))
  object.matrixAutoUpdate = false
}
function disposeTree(root: THREE.Object3D) {
  const resources = new Set<{ dispose(): void }>()
  root.traverse(node => {
    const mesh = node as THREE.Mesh
    if (mesh.geometry) resources.add(mesh.geometry)
    for (const material of !mesh.material ? [] : Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      resources.add(material)
      for (const value of Object.values(material)) if ((value as THREE.Texture)?.isTexture) resources.add(value as THREE.Texture)
    }
    if ('dispose' in node && typeof node.dispose === 'function') resources.add(node as unknown as { dispose(): void })
  })
  resources.forEach(resource => resource.dispose())
}

/** This host is bundled once with the frozen program, for both browser and service. */
export class SceneHost {
  readonly renderer: THREE.WebGLRenderer
  readonly registry: SceneRegistry = new Map()
  private program!: SceneProgram
  private time = 0
  private loaded = new Set<string>()
  private glbs = new Map<string, Promise<THREE.Group>>()
  private textures = new Map<string, Promise<THREE.Texture>>()
  private splats = 0
  private qualityMode: 'glb' | 'ply' = 'glb'
  private qualityPairs: QualityPair[] = []
  private qualityAssets = new Map<string, { mesh: SparkMesh; bounds: THREE.Box3 }>()
  private spark?: import('@sparkjsdev/spark').SparkRenderer
  private shaderErrors: string[] = []
  private warnings = new Set<string>()
  private lastRenderMs = 0
  private selectionKey: string | null = null
  private capturing = false
  constructor(private module: SceneModule, private init: SceneRuntimeInit) {
    const canvas = init.canvas ?? new OffscreenCanvas(init.width ?? 960, init.height ?? 720)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(init.width ?? 960, init.height ?? 720, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.localClippingEnabled = true
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      this.shaderErrors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n'))
    }
  }
  async start() { await this.create(); return this.inspect() }
  private asset(alias: string, kinds: RuntimeAsset['kind'][]) {
    const asset = this.init.assets.find(item => item.alias === alias)
    if (!asset || !kinds.includes(asset.kind)) throw new Error(`Missing or incompatible authorized asset: ${alias} (expected ${kinds.join('/')})`)
    this.loaded.add(alias)
    return asset
  }
  private async loadGLB(alias: string): Promise<THREE.Group> {
    const asset = this.asset(alias, ['glb'])
    if (!this.glbs.has(alias)) this.glbs.set(alias, (async () => {
      // External GLTF URIs are deliberately rejected by the loader manager.
      const manager = new THREE.LoadingManager()
      manager.setURLModifier(url => { if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('GLB external resources are not allowed; embed textures in the authorized asset'); return url })
      const gltf = await new GLTFLoader(manager).parseAsync(new Uint8Array(asset.bytes).slice().buffer, '')
      const basis = new THREE.Group()
      if (asset.normalization) alignment(basis, computeGlbObjectAlignment(asset.normalization))
      else {
        basis.rotation.x = Math.PI / 2
        basis.add(gltf.scene); basis.updateMatrixWorld(true)
        const bounds = objectBounds(basis), center = bounds.getCenter(new THREE.Vector3())
        basis.position.set(-center.x, -center.y, -bounds.min.z)
      }
      if (!gltf.scene.parent) basis.add(gltf.scene)
      basis.traverse(node => { const mesh = node as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = mesh.receiveShadow = true; if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals() } })
      const root = new THREE.Group(); root.add(basis); root.userData.sceneAssetAlias = alias
      root.animations = gltf.animations
      return root
    })())
    const template = await this.glbs.get(alias)!
    const instance = cloneSkeleton(template) as THREE.Group
    if (asset.paired_ply) this.qualityPairs.push({ glb: instance, basis: instance.children[0], alias: asset.paired_ply, size: array(objectBounds(template).getSize(new THREE.Vector3())) })
    return instance
  }
  private async loadTexture(alias: string) {
    const asset = this.asset(alias, ['texture'])
    if (!this.textures.has(alias)) this.textures.set(alias, (async () => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(asset.bytes).slice().buffer], { type: asset.mime_type }), { imageOrientation: 'flipY' })
      const texture = new THREE.Texture(bitmap)
      texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false; texture.needsUpdate = true
      texture.userData.sceneAssetAlias = alias
      return texture
    })())
    return this.textures.get(alias)!
  }
  private async loadSplat(alias: string): Promise<THREE.Object3D> {
    const asset = this.asset(alias, ['ply', 'spz'])
    const mesh = await this.decodeSplat(asset)
    const root = new THREE.Group(); root.userData.sceneAssetAlias = alias
    const basis = new THREE.Group()
    if (asset.normalization) {
      const bounds = mesh.getBoundingBox()
      alignment(basis, computeLuxPlyAlignment(asset.normalization, { min: array(bounds.min), max: array(bounds.max) }))
    }
    basis.add(mesh); root.add(basis)
    this.splats++
    return root
  }
  private async decodeSplat(asset: RuntimeAsset | SceneQualityAsset, preview = false): Promise<SparkMesh> {
    const { SplatMesh } = await this.ensureSpark()
    const input = 'stream' in asset ? { stream: asset.stream, streamLength: asset.size_bytes } : { fileBytes: new Uint8Array(asset.bytes) }
    const mesh = new SplatMesh({ ...input, fileName: asset.path, covSplats: true, extSplats: true, raycastable: !preview, ...(preview ? { lod: true, nonLod: false } : {}) })
    try {
      await mesh.initialized
      if (!mesh.numSplats && !mesh.extSplats?.lodSplats?.numSplats) throw new Error('3DGS 资产没有可显示的点')
    } catch (error) { mesh.dispose(); throw error }
    return mesh
  }
  private async ensureSpark() {
    const sdk = await import('@sparkjsdev/spark')
    this.spark ??= new sdk.SparkRenderer({ renderer: this.renderer, covSplats: true, accumExtSplats: true, enableLod: true, lodSplatCount: 750_000 })
    return sdk
  }
  private placedQualityPairs() {
    const placed = new Set<THREE.Object3D>()
    this.program.scene.traverse(object => placed.add(object))
    return this.qualityPairs.filter(pair => placed.has(pair.glb) && pair.basis.parent === pair.glb)
  }
  qualityAliases() { return [...new Set(this.placedQualityPairs().map(pair => pair.alias))] }
  async setQuality(mode: 'glb' | 'ply', incoming?: SceneQualityAsset): Promise<SceneQualityState> {
    this.qualityMode = mode
    const pairs = this.placedQualityPairs(), errors = new Set<string>()
    if (mode === 'ply') for (const pair of pairs) {
      if (pair.ply) continue
      try {
        let cached = this.qualityAssets.get(pair.alias)
        if (!cached) {
          const asset = incoming?.alias === pair.alias ? incoming : this.init.assets.find(asset => asset.alias === pair.alias && asset.kind === 'ply')
          if (!asset) continue
          const mesh = await this.decodeSplat(asset, true)
          const bounds = new THREE.Box3()
          const splats = mesh.extSplats?.lodSplats ?? mesh.extSplats!
          splats.forEachSplat((_, center) => bounds.expandByPoint(center))
          if (bounds.isEmpty()) { mesh.dispose(); throw new Error('PLY 缺少有效范围') }
          cached = { mesh, bounds }
          this.qualityAssets.set(pair.alias, cached)
        }
        const { SplatMesh } = await this.ensureSpark()
        const visual = new SplatMesh({ extSplats: cached.mesh.extSplats!, covSplats: true, raycastable: false })
        const basis = new THREE.Group()
        alignment(basis, computeLuxPlyAlignment({ source_up_axis: 'Y', scene_up_axis: 'Z', pivot: 'bottom_center' }, { min: array(cached.bounds.min), max: array(cached.bounds.max) }, pair.size))
        basis.add(visual)
        pair.ply = new THREE.Group(); pair.ply.matrixAutoUpdate = false; pair.ply.add(basis); pair.visual = visual
      } catch (error) { errors.add(error instanceof Error ? error.message : String(error)) }
    }
    return { loadedCount: mode === 'ply' ? pairs.filter(pair => pair.ply).length : 0, totalCount: pairs.length, error: [...errors].join('；') || undefined }
  }
  private async prepareSplats(camera: THREE.Camera) {
    const spark = this.spark!
    const wait = async () => { const began = performance.now(); while (spark.sorting || spark.sortDirty) { if (performance.now() - began > 10_000) throw new Error('Gaussian sort timed out'); await new Promise(resolve => setTimeout(resolve, 10)) } }
    spark.autoUpdate = false
    await wait()
    await spark.update({ scene: this.program.scene, camera })
    await wait()
  }
  private async create() {
    if (this.program) { this.program.dispose?.(); disposeTree(this.program.scene) }
    if (this.spark && !this.spark.parent) this.spark.dispose()
    this.registry.clear(); this.loaded.clear(); this.glbs.clear(); this.textures.clear(); this.splats = 0; this.spark = undefined; this.qualityPairs = []; this.shaderErrors = []; this.time = 0
    const context: SceneContext = {
      THREE, renderer: this.renderer, random: random(this.init.seed),
      assets: { loadGLB: alias => this.loadGLB(alias), loadTexture: alias => this.loadTexture(alias), loadSplat: alias => this.loadSplat(alias), readData: alias => JSON.parse(new TextDecoder().decode(this.asset(alias, ['data']).bytes)) },
      createCanvas: (width, height) => new OffscreenCanvas(width, height), geometry: createGeometryHelpers(this.registry),
      registerObject: (key, object, metadata = {}) => {
        if (typeof key !== 'string' || !key.trim() || key.length > 200 || this.registry.has(key)) throw new Error(`Object key must be nonempty and unique: ${key}`)
        if (!object?.isObject3D) throw new Error(`registerObject(${key}) requires a Three.js Object3D`)
        if ([...this.registry.values()].some(entry => entry.object === object)) throw new Error('Register each object once; register distinct children for semantic parts')
        for (const [field, maximum] of [['label', 200], ['semantic_type', 200], ['description', 4000]] as const) if (metadata[field] !== undefined && (typeof metadata[field] !== 'string' || metadata[field]!.length > maximum)) throw new Error(`Object ${key}: ${field} must be a string of at most ${maximum} characters`)
        if (metadata.query_geometry && !(metadata.query_geometry as THREE.Object3D).isObject3D) throw new Error(`Object ${key}: query_geometry must be an Object3D`)
        this.registry.set(key, { key, object, metadata, stack: new Error().stack })
        return object
      },
    }
    if (typeof this.module.createScene !== 'function') throw new Error('Entry must export createScene(ctx)')
    this.program = await this.module.createScene(context)
    if (!this.program?.scene?.isScene) throw new Error('createScene must return { scene: THREE.Scene }')
    if (this.spark) this.program.scene.add(this.spark)
    this.program.scene.updateMatrixWorld(true)
    this.detectDisplacement()
    if (this.qualityMode === 'ply') await this.setQuality('ply')
  }
  private detectDisplacement() {
    for (const entry of this.registry.values()) entry.object.traverse(node => {
      const mesh = node as THREE.Mesh
      const materials = !mesh.material ? [] : Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (materials.some(material => (material as THREE.ShaderMaterial).isShaderMaterial || (material as THREE.MeshStandardMaterial).displacementMap || Object.hasOwn(material, 'onBeforeCompile'))) {
        if (!entry.metadata.query_geometry) entry.metadata.query_geometry_required = true
      }
    })
  }
  async seek(time = 0) {
    if (!Number.isFinite(time) || time < 0 || time > 120) throw new Error('time_s must be between 0 and 120 seconds')
    const frame = Math.round(time * 30), current = Math.round(this.time * 30)
    if (frame < current) await this.create()
    for (let index = Math.round(this.time * 30) + 1; index <= frame; index++) this.program.update?.(index / 30, 1 / 30)
    this.time = frame / 30
    this.program.scene.updateMatrixWorld(true)
  }
  inspect(): SceneRuntimeSnapshot {
    this.program.scene.updateMatrixWorld(true)
    const objects: SceneObjectDescriptor[] = [], usage = new Map<string, number>()
    this.program.scene.traverse(node => {
      const aliases = new Set<string>()
      if (node.userData.sceneAssetAlias) aliases.add(node.userData.sceneAssetAlias)
      const mesh = node as THREE.Mesh
      for (const material of !mesh.material ? [] : Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const textures = [...Object.values(material), ...Object.values((material as THREE.ShaderMaterial).uniforms ?? {}).map(uniform => uniform.value)]
        for (const texture of textures) if ((texture as THREE.Texture)?.isTexture && (texture as THREE.Texture).userData.sceneAssetAlias) aliases.add((texture as THREE.Texture).userData.sceneAssetAlias)
      }
      for (const alias of aliases) usage.set(alias, (usage.get(alias) ?? 0) + 1)
    })
    if ((this.program.scene.background as THREE.Texture)?.userData?.sceneAssetAlias) usage.set((this.program.scene.background as THREE.Texture).userData.sceneAssetAlias, 1)
    if (this.program.scene.environment?.userData?.sceneAssetAlias) usage.set(this.program.scene.environment.userData.sceneAssetAlias, (usage.get(this.program.scene.environment.userData.sceneAssetAlias) ?? 0) + 1)
    const keys = new Map([...this.registry.values()].map(entry => [entry.object, entry.key]))
    for (const entry of this.registry.values()) {
      let parent = entry.object.parent, parentKey: string | null = null
      while (parent) { if (keys.has(parent)) { parentKey = keys.get(parent)!; break }; parent = parent.parent }
      const bounds = objectBounds(entry.object), materials = new Map<string, SceneObjectDescriptor['measured']['materials'][number]>(), aliases = new Set<string>()
      let meshes = 0, triangles = 0
      entry.object.traverse(node => {
        if (node.userData.sceneAssetAlias) aliases.add(node.userData.sceneAssetAlias)
        const mesh = node as THREE.Mesh
        if (mesh.isMesh) { meshes++; triangles += ((mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0) / 3) * ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1) }
        for (const material of !mesh.material ? [] : Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const standard = material as THREE.MeshStandardMaterial
          materials.set(material.uuid, { name: material.name, type: material.type, color: standard.color ? `#${standard.color.getHexString()}` : undefined, opacity: material.opacity, roughness: standard.roughness, metalness: standard.metalness, texture_slots: Object.entries(material).filter(([, value]) => (value as THREE.Texture)?.isTexture).map(([key]) => key) })
        }
      })
      let visible = true, ancestor: THREE.Object3D | null = entry.object
      while (ancestor) { visible &&= ancestor.visible; ancestor = ancestor.parent }
      let root = entry.object
      while (root.parent) root = root.parent
      const inScene = root === this.program.scene
      const queryable = inScene && (meshes > 0 || !!entry.metadata.query_geometry) && (!entry.metadata.query_geometry_required || !!entry.metadata.query_geometry)
      objects.push({ key: entry.key, parent_key: parentKey, label: entry.metadata.label ?? entry.key, semantic_type: entry.metadata.semantic_type ?? null, description: entry.metadata.description ?? null, role: entry.metadata.role ?? 'object', declared: { forward: entry.metadata.forward, anchors: entry.metadata.anchors },
        measured: { bounds: bounds.isEmpty() ? null : { min: array(bounds.min), max: array(bounds.max), size: array(bounds.getSize(new THREE.Vector3())) }, position: array(entry.object.getWorldPosition(new THREE.Vector3())), rotation_quaternion: entry.object.getWorldQuaternion(new THREE.Quaternion()).toArray(), scale: array(entry.object.getWorldScale(new THREE.Vector3())), meshes, triangles, materials: [...materials.values()], visible: visible && inScene, in_scene: inScene, queryable, query_method: queryable ? entry.metadata.query_geometry ? 'author_supplied_query_mesh' : 'posed_cpu_triangles' : 'unavailable' }, source: { stack: entry.stack, asset_aliases: [...aliases] } })
    }
    let meshes = 0, triangles = 0
    this.program.scene.traverse(node => { const mesh = node as THREE.Mesh; if (mesh.isMesh) { meshes++; triangles += ((mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0) / 3) * ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1) } })
    return { time_s: this.time, objects, cameras: Object.entries(this.program.cameras ?? {}).map(([key, camera]) => this.namedCamera(key, camera)), assets: this.init.assets.map(asset => ({ alias: asset.alias, path: asset.path, loaded: this.loaded.has(asset.alias), instances_in_scene: usage.get(asset.alias) ?? 0 })), animated: !!this.program.update, warnings: [...this.warnings], metrics: { meshes, triangles, draw_calls: this.renderer.info.render.calls, render_ms: this.lastRenderMs } }
  }
  private namedCamera(key: string, camera: THREE.Camera | SceneCamera): SceneCamera {
    if (!(camera as THREE.Camera).isCamera) return { ...(camera as SceneCamera), name: key }
    const native = camera as THREE.PerspectiveCamera
    native.updateWorldMatrix(true, false)
    const position = native.getWorldPosition(new THREE.Vector3()), target = position.clone().add(native.getWorldDirection(new THREE.Vector3()))
    return { name: key, position: array(position), target: array(target), up: array(native.up), fov_deg: native.fov ?? 45, projection: (native as unknown as THREE.OrthographicCamera).isOrthographicCamera ? 'orthographic' : 'perspective', span: (native as unknown as THREE.OrthographicCamera).top ? ((native as unknown as THREE.OrthographicCamera).top - (native as unknown as THREE.OrthographicCamera).bottom) / native.zoom : undefined }
  }
  camera(request: SceneViewRequest = {}, aspect = 4 / 3): { descriptor: SceneCamera; camera: THREE.Camera } {
    let descriptor = request.camera
    const named = request.camera_key ?? (request.preset === 'entrance' ? 'entrance' : undefined)
    if (named) { const camera = this.program.cameras?.[named]; if (!camera) throw Object.assign(new Error(`Unknown camera: ${named}. Choose an available camera or an automatic overview; geometry does not need rebuilding.`), { code: 'camera_not_found', available_cameras: Object.keys(this.program.cameras ?? {}), suggested_preset: 'overview' }); descriptor = this.namedCamera(named, camera) }
    if (!descriptor) {
      const bounds = new THREE.Box3()
      for (const entry of this.registry.values()) if (request.object_keys?.includes(entry.key) || (!request.object_keys?.length && entry.metadata.role !== 'terrain')) bounds.union(objectBounds(entry.object))
      if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, 1, 2))
      const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3()), radius = Math.max(size.length(), 1)
      const preset = request.preset ?? 'overview'
      const direction = preset === 'top' ? new THREE.Vector3(0, 0, 1) : preset === 'front' ? new THREE.Vector3(0, -1, 0) : preset === 'side' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(1.2, -1.6, 1.1).normalize()
      const span = preset === 'top' ? Math.max(size.y, size.x / aspect) : preset === 'side' ? Math.max(size.z, size.y / aspect) : Math.max(size.z, size.x / aspect)
      descriptor = { name: request.name ?? preset, position: array(center.clone().addScaledVector(direction, radius * 1.65)), target: array(center), up: preset === 'top' ? [0, 1, 0] : [0, 0, 1], fov_deg: 45, projection: ['top', 'front', 'side'].includes(preset) ? 'orthographic' : 'perspective', span: Math.max(span * 1.18, 0.1) }
    }
    const span = descriptor.span ?? 10
    const camera = descriptor.projection === 'orthographic' ? new THREE.OrthographicCamera(-span * aspect / 2, span * aspect / 2, span / 2, -span / 2, 0.001, 1e6) : new THREE.PerspectiveCamera(descriptor.fov_deg, aspect, 0.001, 1e6)
    camera.position.copy(vec(descriptor.position)); camera.up.copy(vec(descriptor.up)); camera.lookAt(vec(descriptor.target)); camera.updateMatrixWorld(true)
    return { descriptor, camera }
  }
  async frame(request: SceneViewRequest = {}, useQuality = true) {
    await this.seek(request.time_s ?? this.time)
    const width = Math.max(64, Math.min(4096, request.width ?? this.renderer.domElement.width)), height = Math.max(64, Math.min(4096, request.height ?? this.renderer.domElement.height))
    this.renderer.setSize(width, height, false)
    const camera = this.camera(request, width / height)
    const began = performance.now()
    const scene = this.program.scene, restore: Array<() => void> = [], activePairs: QualityPair[] = []
    try {
      if (useQuality && this.qualityMode === 'ply') for (const pair of this.placedQualityPairs()) {
        if (!pair.ply) continue
        let visible = true
        for (let node: THREE.Object3D | null = pair.glb; node; node = node.parent) visible &&= node.visible
        const basis = pair.basis
        if (!visible || !basis.visible) continue
        pair.ply.matrix.copy(scene.matrixWorld).invert().multiply(pair.glb.matrixWorld)
        pair.ply.matrixWorldNeedsUpdate = true
        scene.add(pair.ply)
        activePairs.push(pair)
        restore.push(() => pair.ply!.removeFromParent())
      }
      if (restore.length && this.spark && !this.spark.parent) {
        scene.add(this.spark)
        restore.push(() => this.spark!.removeFromParent())
      }
      if (this.splats || activePairs.length) {
        scene.updateMatrixWorld(true)
        await this.prepareSplats(camera.camera)
      }
      // Spark picks the LoD asynchronously. Keep the mesh visible until its
      // splats contribute to the current view, including under the point budget.
      for (const { basis, visual } of activePairs) if (visual?.numSplats && !visual.generatorError) {
        basis.visible = false
        restore.push(() => { basis.visible = true })
      }
      this.renderer.render(scene, camera.camera)
      if (this.renderer.getContext().isContextLost()) throw new Error('WebGL context lost while rendering the scene')
    } finally { restore.reverse().forEach(action => action()) }
    if (this.selectionKey && !this.capturing) {
      const object = this.registry.get(this.selectionKey)?.object
      if (object) {
        const helper = new THREE.Box3Helper(objectBounds(object), 0x46edcb), overlay = new THREE.Scene()
        overlay.add(helper)
        this.renderer.autoClear = false; this.renderer.clearDepth(); this.renderer.render(overlay, camera.camera); this.renderer.autoClear = true
        helper.geometry.dispose(); (helper.material as THREE.Material).dispose()
      }
    }
    this.lastRenderMs = performance.now() - began
    if (this.shaderErrors.length) throw new Error(`Shader compilation failed:\n${this.shaderErrors.join('\n')}`)
    return camera
  }
  async render(request: SceneViewRequest = {}): Promise<SceneRenderedView> {
    await this.seek(request.time_s ?? 0)
    const mode = request.mode ?? 'beauty', restore: Array<() => void> = [], scene = this.program.scene
    try {
      this.capturing = true
      if (mode === 'isolate') {
        if (!request.object_keys?.length) throw new Error('isolate requires object_keys; isolated images are not full-scene evidence')
        const included = new Set<THREE.Object3D>()
        for (const key of request.object_keys) { const entry = this.registry.get(key); if (!entry) throw new Error(`Unknown object: ${key}`); entry.object.traverse(node => included.add(node)); let parent = entry.object.parent; while (parent) { included.add(parent); parent = parent.parent } }
        scene.traverse(node => { if (!included.has(node) && !(node as THREE.Light).isLight && (node as THREE.Mesh).isMesh) { const visible = node.visible; restore.push(() => { node.visible = visible }); node.visible = false } })
      }
      if (mode === 'clay' || mode === 'wireframe' || mode === 'section') {
        if (mode === 'section' && !request.section) throw new Error('section mode requires explicit normal and constant (n·p + constant = 0)')
        const material = new THREE.MeshStandardMaterial({ color: 0xc4c9cc, roughness: 0.85, wireframe: mode === 'wireframe', side: THREE.DoubleSide })
        if (request.section) material.clippingPlanes = [new THREE.Plane(vec(request.section.normal), request.section.constant).normalize()]
        scene.traverse(node => { const mesh = node as THREE.Mesh; if (mesh.isMesh) { const previous = mesh.material; restore.push(() => { mesh.material = previous }); mesh.material = material } })
        restore.unshift(() => material.dispose())
        this.warnings.add('Diagnostic materials show CPU mesh surfaces; shader-displaced appearance requires beauty views and query_geometry.')
      }
      const { descriptor, camera } = await this.frame(request, mode === 'beauty')
      const canvas = this.renderer.domElement as unknown as OffscreenCanvas
      const width = canvas.width, height = canvas.height
      const picture = new OffscreenCanvas(width, height), context = picture.getContext('2d')!
      context.drawImage(canvas, 0, 0)
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      const labels: SceneRenderedView['labels'] = [], visible_keys: string[] = []
      let number = 0
      for (const entry of this.registry.values()) {
        number++
        const bounds = objectBounds(entry.object)
        let visible = true, ancestor: THREE.Object3D | null = entry.object
        while (ancestor) { visible &&= ancestor.visible; ancestor = ancestor.parent }
        if (!visible || bounds.isEmpty() || !frustum.intersectsBox(bounds)) continue
        visible_keys.push(entry.key)
        const position = bounds.getCenter(new THREE.Vector3()).project(camera)
        const x = (position.x + 1) / 2 * width, y = (1 - position.y) / 2 * height
        labels.push({ number, key: entry.key, x, y })
        context.fillStyle = '#102a43'; context.beginPath(); context.arc(x, y, 12, 0, Math.PI * 2); context.fill()
        context.font = 'bold 12px sans-serif'; context.textAlign = 'center'; context.fillStyle = '#ffffff'; context.fillText(String(number), x, y + 4)
      }
      context.textAlign = 'left'; context.font = '13px monospace'; context.fillStyle = '#071d32dd'; context.fillRect(0, 0, width, 50); context.fillStyle = 'white'
      context.fillText(`${descriptor.name} · ${mode}${mode === 'isolate' ? ' (ISOLATED, not full scene)' : ''} · t=${this.time.toFixed(3)}s`, 12, 20)
      context.fillText(`Z up · relative units${descriptor.projection === 'orthographic' ? ` · vertical view span ${descriptor.span?.toFixed(3)}` : ' · perspective'}`, 12, 39)
      // A projected world-axis triad makes front/side/top direction unambiguous.
      const origin = vec(descriptor.target), projected = origin.clone().project(camera)
      for (const [axis, color, endpoint] of [['X', '#fc7979', new THREE.Vector3(1, 0, 0)], ['Y', '#73d990', new THREE.Vector3(0, 1, 0)], ['Z', '#76adff', new THREE.Vector3(0, 0, 1)]] as const) {
        const end = origin.clone().add(endpoint).project(camera).sub(projected), length = Math.hypot(end.x, end.y)
        if (length < 1e-6) continue
        const x = 44 + 26 * end.x / length, y = height - 44 - 26 * end.y / length
        context.strokeStyle = color; context.beginPath(); context.moveTo(44, height - 44); context.lineTo(x, y); context.stroke(); context.fillStyle = color; context.fillText(axis, x, y)
      }
      const blob = await picture.convertToBlob({ type: 'image/png' })
      return { name: descriptor.name, camera: descriptor, mode, time_s: this.time, width, height, labels, visible_keys, png_base64: base64(new Uint8Array(await blob.arrayBuffer())) }
    } finally { this.capturing = false; restore.reverse().forEach(action => action()) }
  }
  select(key: string | null) { if (key && !this.registry.has(key)) throw new Error('Unknown selection key'); this.selectionKey = key; return { key } }
  async query(queries: SceneGeometryQuery[], time = 0) { await this.seek(time); const session = new GeometrySession(this.registry); try { return queries.map(query => session.query(query)) } finally { session.dispose() } }
  async check(checks: SceneConstraint[], time = 0) { await this.seek(time); const session = new GeometrySession(this.registry); try { return checks.map(check => session.check(check)) } finally { session.dispose() } }
  async pick(x: number, y: number, request: SceneViewRequest) {
    await this.seek(request.time_s ?? this.time)
    const { camera } = this.camera(request, this.renderer.domElement.width / this.renderer.domElement.height)
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x, y), camera)
    const hits = ray.intersectObjects([...this.registry.values()].map(entry => entry.object), true)
    for (const hit of hits) {
      let ancestor: THREE.Object3D = hit.object, visible = true
      while (ancestor.parent) { visible &&= ancestor.visible; ancestor = ancestor.parent }
      if (!visible || ancestor !== this.program.scene) continue
      let object: THREE.Object3D | null = hit.object
      while (object) { const entry = [...this.registry.values()].find(entry => entry.object === object); if (entry) return { key: entry.key, point: array(hit.point), time_s: this.time }; object = object.parent }
    }
    return null
  }
  async exportGLB(time = 0) {
    await this.seek(time)
    const unsupported: string[] = []
    this.program.scene.traverse(node => {
      const mesh = node as THREE.Mesh
      if ((node as THREE.Points).isPoints || node.type.includes('Splat')) unsupported.push(`${node.name || node.type}: point/splat content`)
      for (const material of !mesh.material ? [] : Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial && !(material as THREE.MeshBasicMaterial).isMeshBasicMaterial) unsupported.push(`${node.name || node.type}: ${material.type}`)
        if (Object.hasOwn(material, 'onBeforeCompile') || (material as THREE.MeshStandardMaterial).displacementMap) unsupported.push(`${node.name || node.type}: custom or displacement shader cannot be represented by static standard GLB materials`)
      }
    })
    if (this.splats) unsupported.push('Gaussian splat content')
    if (unsupported.length) return { status: 'unsupported', reasons: [...new Set(unsupported)], suggestion: 'Export the full project to preserve shaders, splats and animation.' }
    const data = await new GLTFExporter().parseAsync(this.program.scene, { binary: true, onlyVisible: true, trs: false })
    return { status: 'exported', mime_type: 'model/gltf-binary', bytes_base64: base64(new Uint8Array(data as ArrayBuffer)), time_s: this.time, animation: 'static_snapshot', coordinate_basis: 'Z-up scene coordinates stored unchanged' }
  }
  dispose() { this.program?.dispose?.(); if (this.program) disposeTree(this.program.scene); this.qualityAssets.forEach(({ mesh }) => mesh.dispose()); if (this.spark && !this.spark.parent) this.spark.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss() }
}

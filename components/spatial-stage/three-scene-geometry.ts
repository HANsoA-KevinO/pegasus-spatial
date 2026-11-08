import * as THREE from 'three'
import type { SceneTransform3D, SceneViewpoint, Vec3 } from '@/lib/spatial/scene-types'
import { computeGlbObjectAlignment, type ObjectLocalAlignment } from './object-alignment'
import type { SpatialStageInstance } from './proxy-geometry'

export function applyInstanceTransform(object: THREE.Object3D, transform: SceneTransform3D): void {
  object.position.fromArray(transform.position)
  object.quaternion.fromArray(transform.rotation_quaternion)
  object.scale.fromArray(transform.scale)
  object.updateMatrixWorld(true)
}

/** Scale * (translation * rotation), matching the persisted normalization contract. */
export function alignmentMatrix(alignment: ObjectLocalAlignment): THREE.Matrix4 {
  return new THREE.Matrix4().makeScale(...alignment.scale)
    .multiply(new THREE.Matrix4().makeTranslation(...alignment.pivot))
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...alignment.rotationRadians)))
}

export function prepareGlb(root: THREE.Object3D, instance: SpatialStageInstance): THREE.Group {
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    if (!node.geometry.getAttribute('normal')) node.geometry.computeVertexNormals()
    node.castShadow = true
    node.receiveShadow = true
  })
  const basis = new THREE.Group()
  if (instance.normalization) {
    basis.matrix.copy(alignmentMatrix(computeGlbObjectAlignment(instance.normalization)))
    basis.matrixAutoUpdate = false
  }
  basis.add(root)
  return basis
}

export function applyViewpoint(camera: THREE.PerspectiveCamera, viewpoint: SceneViewpoint): void {
  camera.position.fromArray(viewpoint.position)
  camera.up.fromArray(viewpoint.up).normalize()
  camera.fov = viewpoint.fov_deg
  camera.lookAt(new THREE.Vector3().fromArray(viewpoint.target))
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
}

export function queryMeshSurface(object: THREE.Object3D, horizontal: [number, number], castHeight: number, upAxis: 'Y' | 'Z'): Vec3 {
  object.updateWorldMatrix(true, true)
  const origin = upAxis === 'Z'
    ? new THREE.Vector3(horizontal[0], horizontal[1], castHeight)
    : new THREE.Vector3(horizontal[0], castHeight, horizontal[1])
  const raycaster = new THREE.Raycaster(origin, upAxis === 'Z' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, -1, 0))
  const hit = raycaster.intersectObject(object, true)[0]
  if (!hit) throw new Error('射线未命中地形网格，请换一个位置。')
  return hit.point.toArray() as Vec3
}

/** Frustum candidates; this does not claim pixel-level occlusion visibility. */
export function instancesInFrustum(objects: Iterable<[string, THREE.Object3D]>, camera: THREE.PerspectiveCamera): string[] {
  camera.updateMatrixWorld(true)
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
  const bounds = new THREE.Box3()
  const ids: string[] = []
  for (const [id, object] of objects) {
    object.updateWorldMatrix(true, true)
    bounds.setFromObject(object)
    if (!bounds.isEmpty() && frustum.intersectsBox(bounds)) ids.push(id)
  }
  return ids
}

export function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh) && !(node instanceof THREE.Line)) return
    geometries.add(node.geometry)
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
    }
  })
  textures.forEach(texture => { texture.dispose(); if (typeof ImageBitmap !== 'undefined' && texture.source.data instanceof ImageBitmap) texture.source.data.close() })
  materials.forEach(material => material.dispose())
  geometries.forEach(geometry => geometry.dispose())
  root.removeFromParent()
}

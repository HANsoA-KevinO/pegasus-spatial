import type { SceneObjectInstance, SceneObjectNormalization } from '@/lib/spatial/scene-types'

import * as THREE from 'three'
type Vec3 = [number, number, number]

export type SpatialProxyShape = 'box' | 'cylinder' | 'arch'

/**
 * Lightweight geometry authored directly in Scene coordinates.
 *
 * Canonical `dimensions` are `[width X, depth Y, height Z]`. Aliases are
 * accepted intentionally so old draft Scene specs remain viewable while the
 * persisted contract uses `kind + dimensions`.
 */
export interface SpatialProxyDescription {
  primitive?: SpatialProxyShape
  shape?: SpatialProxyShape
  type?: SpatialProxyShape
  kind?: SpatialProxyShape
  size?: Vec3
  dimensions?: Vec3
  width?: number
  depth?: number
  height?: number
  radius?: number
  thickness?: number
  color?: string
  opacity?: number
  material?: string
}

export type SpatialStageInstance = Omit<SceneObjectInstance, 'source_job_id' | 'glb_artifact' | 'normalization' | 'proxy'> & {
  source_job_id?: string | null
  glb_artifact?: SceneObjectInstance['glb_artifact'] | null
  normalization?: SceneObjectNormalization | null
  proxy?: SpatialProxyDescription | null
}

export interface NormalizedSpatialProxy {
  shape: SpatialProxyShape
  size: Vec3
  thickness: number
  color: string
  opacity: number
  material: string
}

const DEFAULT_SIZE: Vec3 = [1, 1, 1]

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function tuple(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null
  const result = value.map((item, index) => positive(item, DEFAULT_SIZE[index])) as Vec3
  return result
}

export function normalizeSpatialProxy(instance: SpatialStageInstance): NormalizedSpatialProxy | null {
  const value = instance.proxy
  if (!value || typeof value !== 'object') return null
  const shape = value.primitive ?? value.shape ?? value.type ?? value.kind
  if (shape !== 'box' && shape !== 'cylinder' && shape !== 'arch') return null

  let size = tuple(value.size) ?? tuple(value.dimensions)
  if (!size) {
    if (shape === 'cylinder') {
      const diameter = positive(value.radius, 0.5) * 2
      size = [positive(value.width, diameter), positive(value.depth, diameter), positive(value.height, 1)]
    } else {
      size = [positive(value.width, 1), positive(value.depth, 1), positive(value.height, 1)]
    }
  }

  const smallestArchDimension = Math.min(size[0], size[2])
  const thickness = Math.min(
    positive(value.thickness, smallestArchDimension * 0.18),
    smallestArchDimension * 0.48,
  )
  const color = typeof value.color === 'string' && value.color.trim() ? value.color : '#95a1b3'
  const hasAlpha = /^#[0-9a-f]{8}$/i.test(color)
  const alpha = hasAlpha ? parseInt(color.slice(7, 9), 16) / 255 : 1

  return {
    shape,
    size,
    thickness,
    color: hasAlpha ? color.slice(0, 7) : color,
    opacity: Math.min(1, positive(value.opacity, 0.92)) * alpha,
    material: value.material ?? 'matte',
  }
}

export function spatialInstanceLocalSize(instance: SpatialStageInstance): Vec3 {
  const proxy = normalizeSpatialProxy(instance)
  if (proxy) return proxy.size
  if (!instance.glb_artifact) return DEFAULT_SIZE
  return instance.normalization?.bounds?.size ?? DEFAULT_SIZE
}

export function spatialInstanceAssetKey(instance: SpatialStageInstance): string | null {
  const proxy = normalizeSpatialProxy(instance)
  if (proxy) return `proxy:${JSON.stringify(proxy)}`
  if (instance.glb_artifact) {
    return `glb:${instance.glb_artifact.sha256}:${instance.glb_artifact.workspace_path}`
  }
  return null
}

/** Native Three geometry, with the same bottom-centre Z-up contract as saved Scenes. */
export function createSpatialProxyObject(instance: SpatialStageInstance): THREE.Group | null {
  const proxy = normalizeSpatialProxy(instance)
  if (!proxy) return null
  const group = new THREE.Group()
  group.name = instance.label
  const material = new THREE.MeshStandardMaterial({
    color: proxy.color,
    roughness: proxy.material === 'metal' ? 0.3 : proxy.material === 'glass' ? 0.08 : 0.85,
    metalness: proxy.material === 'metal' ? 0.8 : 0,
    opacity: proxy.opacity,
    transparent: proxy.opacity < 1,
    emissive: proxy.material === 'emissive' ? proxy.color : '#000000',
    emissiveIntensity: proxy.material === 'emissive' ? 0.8 : 0,
  })
  const [width, depth, height] = proxy.size
  const box = (w: number, d: number, h: number, x = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), material)
    mesh.position.set(x, 0, z + h / 2)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  if (proxy.shape === 'cylinder') {
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
    geometry.rotateX(Math.PI / 2)
    geometry.scale(width, depth, height)
    geometry.translate(0, 0, height / 2)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  } else if (proxy.shape === 'arch') {
    const t = proxy.thickness
    box(t, depth, height - t, -(width - t) / 2)
    box(t, depth, height - t, (width - t) / 2)
    box(width, depth, t, 0, height - t)
  } else box(width, depth, height)
  return group
}

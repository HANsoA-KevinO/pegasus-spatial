import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { SceneConstraint, SceneConstraintResult, SceneGeometryObservation, SceneGeometryQuery, SceneObjectMetadata } from '../types'
import type { Vec3 } from '../../spatial/scene-types'

export interface RegisteredObject { key: string; object: THREE.Object3D; metadata: SceneObjectMetadata; stack?: string }
export type SceneRegistry = Map<string, RegisteredObject>
interface SolidPart { geometry: THREE.BufferGeometry; bvh?: MeshBVH; bounds: THREE.Box3 }
interface Baked { geometry: THREE.BufferGeometry; bvh: MeshBVH; bounds: THREE.Box3; closed: boolean; component_points: THREE.Vector3[]; solids: SolidPart[] }
const MAX_TRIANGLES = 500_000
const EPS = 1e-6

export function objectBounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true)
  return new THREE.Box3().setFromObject(object, true)
}

/** Bake posed mesh vertices in WORLD coordinates, including morphs/skinning.
 * No AABB is ever substituted for mesh intersection or surface distance. */
function bake(entry: RegisteredObject): Baked {
  const root = (entry.metadata.query_geometry as THREE.Object3D | undefined) ?? entry.object
  if (entry.metadata.query_geometry_required && !entry.metadata.query_geometry) throw new Error('GPU deformation requires registered query_geometry')
  root.updateWorldMatrix(true, true)
  const vertices: number[] = [], owners: number[] = []
  const ranges: Array<{ start: number; end: number }> = []
  let triangles = 0
  const vertex = new THREE.Vector3()
  root.traverse(node => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return
    const geometry = mesh.geometry
    const count = geometry.index?.count ?? geometry.getAttribute('position').count
    const start = geometry.drawRange.start
    const end = Math.min(count, start + geometry.drawRange.count)
    const instances = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1
    if (triangles + Math.floor((end - start) / 3) * instances > MAX_TRIANGLES) throw new Error(`Query mesh exceeds ${MAX_TRIANGLES} triangles; supply simpler query_geometry`)
    const instance = new THREE.Matrix4()
    for (let copy = 0; copy < instances; copy++) {
      const partStart = vertices.length, owner = ranges.length
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).getMatrixAt(copy, instance)
      else instance.identity()
      const world = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, instance)
      for (let index = start; index + 2 < end; index += 3) {
        for (let corner = 0; corner < 3; corner++) {
          const pointIndex = geometry.index ? geometry.index.getX(index + corner) : index + corner
          mesh.getVertexPosition(pointIndex, vertex)
          vertex.applyMatrix4(world)
          if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) throw new Error('Non-finite mesh vertex')
          vertices.push(vertex.x, vertex.y, vertex.z); owners.push(owner)
        }
        triangles++
      }
      if (vertices.length > partStart) ranges.push({ start: partStart, end: vertices.length })
    }
  })
  if (!triangles) throw new Error('No CPU mesh geometry is available for this object')
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.computeBoundingBox()
  // Weld positions for topology classification without changing query geometry.
  const edges = new Map<string, number>()
  const nodes = new Map<string, number>(), parents: number[] = [], offsets: number[] = []
  const find = (id: number): number => { let root = id; while (parents[root] !== root) root = parents[root]; while (parents[id] !== id) { const next = parents[id]; parents[id] = root; id = next }; return root }
  const nodeId = (name: string, offset: number) => { const known = nodes.get(name); if (known !== undefined) return known; const id = parents.length; nodes.set(name, id); parents.push(id); offsets.push(offset); return id }
  // Meshes/instances are separate solids. Welding different meshes together
  // at touching vertices incorrectly classifies ordinary assemblies as open.
  const key = (offset: number) => `${owners[offset / 3]}:${vertices.slice(offset, offset + 3).map(value => Math.round(value / EPS)).join(',')}`
  for (let offset = 0; offset < vertices.length; offset += 9) {
    const points = [key(offset), key(offset + 3), key(offset + 6)]
    const ids = points.map((point, corner) => nodeId(point, offset + corner * 3))
    parents[find(ids[1])] = find(ids[0]); parents[find(ids[2])] = find(ids[0])
    for (let corner = 0; corner < 3; corner++) {
      const edge = [points[corner], points[(corner + 1) % 3]].sort().join('|')
      edges.set(edge, (edges.get(edge) ?? 0) + 1)
    }
  }
  const representatives = new Map<number, THREE.Vector3>()
  for (let id = 0; id < parents.length; id++) { const root = find(id); if (!representatives.has(root)) representatives.set(root, new THREE.Vector3().fromArray(vertices, offsets[id])) }
  const closedParts = ranges.map(() => true)
  for (const [edge, count] of edges) if (count !== 2) closedParts[Number(edge.slice(0, edge.indexOf(':')))] = false
  const bvh = new MeshBVH(geometry)
  const solids: SolidPart[] = []
  for (const [index, range] of ranges.entries()) {
    if (!closedParts[index]) continue
    if (ranges.length === 1) solids.push({ geometry, bvh, bounds: geometry.boundingBox!.clone() })
    else {
      const part = new THREE.BufferGeometry()
      part.setAttribute('position', new THREE.Float32BufferAttribute(vertices.slice(range.start, range.end), 3))
      part.computeBoundingBox()
      solids.push({ geometry: part, bounds: part.boundingBox!.clone() })
    }
  }
  return { geometry, bvh, bounds: geometry.boundingBox!.clone(), closed: closedParts.every(Boolean), component_points: [...representatives.values()], solids }
}

function disposeBaked(value: Baked) { for (const part of value.solids) if (part.geometry !== value.geometry) part.geometry.dispose(); value.geometry.dispose() }

function inside(mesh: Baked, point: THREE.Vector3): boolean {
  // Each Mesh uses signed crossings (including correctly oriented cavities).
  // A Group/InstancedMesh is a UNION of these solids; overlapping parts must
  // not cancel each other as they would in one combined parity ray test.
  for (const part of mesh.solids) {
    if (!part.bounds.containsPoint(point)) continue
    part.bvh ??= new MeshBVH(part.geometry)
    const direction = new THREE.Vector3(0.889, 0.371, 0.263).normalize()
    const hits = part.bvh.raycast(new THREE.Ray(point, direction), THREE.DoubleSide)
      .filter(hit => hit.distance > EPS).sort((a, b) => a.distance - b.distance)
    let winding = 0
    for (let start = 0; start < hits.length;) {
      let end = start, positive = false, negative = false
      while (end < hits.length && hits[end].distance - hits[start].distance <= EPS) {
        const dot = hits[end].face!.normal.dot(direction)
        positive ||= dot > EPS; negative ||= dot < -EPS; end++
      }
      winding += positive === negative ? 0 : positive ? 1 : -1
      start = end
    }
    if (winding !== 0) return true
  }
  return false
}

function vector(value: unknown, label: string): THREE.Vector3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) throw new Error(`${label} must be three finite numbers`)
  return new THREE.Vector3().fromArray(value)
}

export class GeometrySession {
  private baked = new Map<string, Baked>()
  constructor(private registry: SceneRegistry) {}
  private entry(key: string): RegisteredObject {
    const entry = this.registry.get(key)
    if (!entry) throw new Error(`Unknown object key: ${key}`)
    let root = entry.object
    while (root.parent) root = root.parent
    if (!(root as THREE.Scene).isScene) throw new Error(`Object ${key} is registered but not placed in the scene`)
    return entry
  }
  private mesh(key: string): Baked {
    if (!this.baked.has(key)) this.baked.set(key, bake(this.entry(key)))
    return this.baked.get(key)!
  }
  query(query: SceneGeometryQuery): SceneGeometryObservation {
    const base = { id: query.id ?? query.kind, kind: query.kind, object_keys: query.object_keys }
    try {
      if (!query.object_keys.length) throw new Error('At least one object key is required')
      if (query.kind === 'bounds') {
        const values = query.object_keys.map(key => {
          const entry = this.entry(key), bounds = objectBounds(entry.object)
          if (entry.metadata.query_geometry_required && !entry.metadata.query_geometry) throw new Error('GPU deformation requires query_geometry for bounds')
          return { key, min: bounds.min.toArray(), max: bounds.max.toArray(), size: bounds.getSize(new THREE.Vector3()).toArray(), basis: 'world', representation: 'axis_aligned_bounds' }
        })
        return { ...base, status: 'measured', method: 'world_mesh_bounds', value: values }
      }
      if (query.kind === 'raycast') {
        const origin = vector(query.origin, 'origin'), direction = vector(query.direction, 'direction')
        if (!direction.lengthSq()) throw new Error('Ray direction must be nonzero')
        const ray = new THREE.Ray(origin, direction.normalize())
        let nearest: { object_key: string; point: number[]; distance: number; normal: number[] } | null = null
        for (const key of query.object_keys) {
          const hit = this.mesh(key).bvh.raycastFirst(ray, THREE.DoubleSide)
          if (hit && hit.distance <= (query.max_distance ?? Infinity) && (!nearest || hit.distance < nearest.distance)) nearest = { object_key: key, point: hit.point.toArray(), distance: hit.distance, normal: hit.face?.normal.toArray() ?? [0, 0, 0] }
        }
        return { ...base, status: 'measured', method: 'posed_mesh_triangle_raycast', value: nearest }
      }
      if (query.kind === 'orientation') {
        const entry = this.entry(query.object_keys[0])
        if (!entry.metadata.forward) throw new Error('No authored forward axis; semantic facing cannot be inferred from a GLB')
        entry.object.updateWorldMatrix(true, true)
        const forward = vector(entry.metadata.forward, 'forward').transformDirection(entry.object.matrixWorld)
        const target = query.direction ? vector(query.direction, 'direction') : this.entry(query.object_keys[1]).object.getWorldPosition(new THREE.Vector3()).sub(entry.object.getWorldPosition(new THREE.Vector3()))
        if (!target.lengthSq() || !forward.lengthSq()) throw new Error('Facing direction is undefined')
        return { ...base, status: 'measured', method: 'authored_forward_world_angle', value: { angle_deg: THREE.MathUtils.radToDeg(forward.angleTo(target)), forward: forward.toArray(), target_direction: target.normalize().toArray() } }
      }
      const a = this.mesh(query.object_keys[0])
      if (query.kind === 'section') {
        const normal = vector(query.normal, 'normal')
        if (!normal.lengthSq()) throw new Error('Section normal must be nonzero')
        const plane = new THREE.Plane(normal, query.constant ?? 0).normalize()
        const positions = a.geometry.getAttribute('position'), indices = a.geometry.index
        const triangle = new THREE.Triangle(), line = new THREE.Line3(), point = new THREE.Vector3()
        const segments: number[][][] = []
        for (let index = 0; index < (indices?.count ?? positions.count); index += 3) {
          triangle.a.fromBufferAttribute(positions, indices ? indices.getX(index) : index)
          triangle.b.fromBufferAttribute(positions, indices ? indices.getX(index + 1) : index + 1)
          triangle.c.fromBufferAttribute(positions, indices ? indices.getX(index + 2) : index + 2)
          const corners = [triangle.a, triangle.b, triangle.c], points: THREE.Vector3[] = []
          for (let side = 0; side < 3; side++) {
            line.set(corners[side], corners[(side + 1) % 3])
            if (plane.intersectLine(line, point) && !points.some(other => other.distanceTo(point) < EPS)) points.push(point.clone())
          }
          if (points.length === 2) segments.push(points.map(value => value.toArray()))
        }
        return { ...base, status: 'measured', method: 'posed_triangle_plane_intersection', value: { segments: segments.slice(0, 20_000), total_segments: segments.length, truncated: segments.length > 20_000 } }
      }
      if (query.object_keys.length !== 2) throw new Error(`${query.kind} requires two object keys`)
      const b = this.mesh(query.object_keys[1])
      if (query.kind === 'distance') {
        const first = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }, second = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }
        const hit = a.bvh.closestPointToGeometry(b.geometry, new THREE.Matrix4(), first, second)
        if (!hit) throw new Error('No closest surface points')
        return { ...base, status: 'measured', method: 'posed_triangle_surface_distance', value: { distance: first.point.distanceTo(second.point), points: [first.point.toArray(), second.point.toArray()] } }
      }
      if (query.kind === 'intersection') {
        // Disjoint bounds prove disjoint geometry, including open/compound
        // meshes. Overlap alone never proves an intersection.
        if (!a.bounds.intersectsBox(b.bounds)) {
          const gaps = [0, 1, 2].map(axis => Math.max(a.bounds.min.getComponent(axis) - b.bounds.max.getComponent(axis), b.bounds.min.getComponent(axis) - a.bounds.max.getComponent(axis), 0))
          return { ...base, status: 'measured', method: 'disjoint_world_mesh_bounds', value: { intersects: false, non_intersection_proven: true, axis_gaps: gaps, distance_lower_bound: Math.hypot(...gaps) } }
        }
        const surface = a.bvh.intersectsGeometry(b.geometry, new THREE.Matrix4())
        const containment = !surface && (b.component_points.some(point => inside(a, point)) || a.component_points.some(point => inside(b, point)))
        const conclusive = surface || containment || (a.closed && b.closed)
        return { ...base, status: conclusive ? 'measured' : 'unknown', method: 'triangle_intersection_and_mesh_union_containment', value: { intersects: conclusive ? surface || containment : null, surface_intersection: surface, containment: conclusive ? containment : null, non_intersection_proven: !surface && !containment && a.closed && b.closed, containment_check_available: a.closed && b.closed, closed_topology: [a.closed, b.closed], tested_components: [a.component_points.length, b.component_points.length], solid_model: 'union_of_closed_meshes_nonzero_winding_within_each_mesh' }, ...(!conclusive ? { reason: 'No triangle crossing was found, but overlapping bounds and non-closed query surfaces leave containment unverifiable. Supply suitable query geometry; retain the required check.' } : {}) }
      }
      if (query.kind === 'support') {
        const points: Array<{ point: number[]; surface: number[] | null; gap: number | null }> = []
        const ray = new THREE.Ray(), down = new THREE.Vector3(0, 0, -1)
        const height = Math.max(a.bounds.max.z, b.bounds.max.z) + Math.max(a.bounds.getSize(new THREE.Vector3()).length(), 1)
        for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
          const px = THREE.MathUtils.lerp(a.bounds.min.x, a.bounds.max.x, (x + 0.01) / 4.02)
          const py = THREE.MathUtils.lerp(a.bounds.min.y, a.bounds.max.y, (y + 0.01) / 4.02)
          ray.set(new THREE.Vector3(px, py, height), down)
          const foot = a.bvh.raycast(ray, THREE.DoubleSide).sort((u, v) => v.distance - u.distance)[0]
          if (!foot) continue
          const surface = b.bvh.raycastFirst(ray, THREE.DoubleSide)
          if (foot.point.z <= a.bounds.min.z + Math.max(query.tolerance ?? .01, EPS)) points.push({ point: foot.point.toArray(), surface: surface?.point.toArray() ?? null, gap: surface ? foot.point.z - surface.point.z : null })
        }
        // Thin chair/table feet can fall between every AABB grid column.
        // Include deterministic vertices on the actual lowest surface, so the
        // Agent need not invent a base plate just to make a grid hit its legs.
        const position = a.geometry.getAttribute('position'), candidates = new Map<string, THREE.Vector3>()
        for (let index = 0; index < position.count; index++) {
          const point = new THREE.Vector3().fromBufferAttribute(position, index)
          if (point.z <= a.bounds.min.z + Math.max(query.tolerance ?? .01, EPS)) candidates.set(point.toArray().map(value => Math.round(value / EPS)).join(','), point)
        }
        const vertices = [...candidates.values()], stride = Math.max(1, Math.ceil(vertices.length / 64))
        for (let index = 0; index < vertices.length; index += stride) {
          const foot = vertices[index]
          ray.set(new THREE.Vector3(foot.x, foot.y, height), down)
          const surface = b.bvh.raycastFirst(ray, THREE.DoubleSide)
          points.push({ point: foot.toArray(), surface: surface?.point.toArray() ?? null, gap: surface ? foot.z - surface.point.z : null })
        }
        if (!points.length) throw new Error('No bottom surface samples are available')
        const gaps = points.flatMap(point => point.gap === null ? [] : [point.gap])
        const tolerance = query.tolerance ?? 0.01
        const touching = gaps.filter(gap => Math.abs(gap) <= tolerance).length
        return { ...base, status: 'measured', method: 'lowest_surface_vertices_and_5x5_columns_not_physics', value: { points, sampled: points.length, touching, support_fraction: touching / points.length, missed_target: points.length - gaps.length, min_gap: gaps.length ? Math.min(...gaps) : null, max_gap: gaps.length ? Math.max(...gaps) : null, tolerance, lowest_surface_band: [a.bounds.min.z, a.bounds.min.z + tolerance], coverage: 'lowest surface band only; not all feet, center of mass or physical stability' } }
      }
      throw new Error('Unsupported geometry query')
    } catch (cause) { return { ...base, status: 'unknown', method: 'unavailable', reason: cause instanceof Error ? cause.message : String(cause) } }
  }
  check(constraint: SceneConstraint): SceneConstraintResult {
    const kind = constraint.kind === 'contact' ? 'distance' : ['no_intersection', 'keep_clear'].includes(constraint.kind) ? 'intersection' : constraint.kind
    const observation = this.query({ id: constraint.id, kind: kind as SceneGeometryQuery['kind'], object_keys: constraint.object_keys, tolerance: constraint.tolerance })
    let status: SceneConstraintResult['status'] = 'unknown'
    const value = observation.value as Record<string, number | boolean | null> | undefined
    if (observation.status === 'measured' && value) {
      if (constraint.kind === 'distance' || constraint.kind === 'contact') {
        const distance = Number(value.distance)
        status = distance >= (constraint.min ?? 0) && distance <= (constraint.max ?? (constraint.kind === 'contact' ? constraint.tolerance ?? 0.01 : Infinity)) ? 'satisfied' : 'violated'
      } else if (constraint.kind === 'support') status = value.min_gap === null ? 'violated' : Number(value.support_fraction) >= (constraint.min_support_fraction ?? 1) && Number(value.min_gap) >= -(constraint.tolerance ?? 0.01) ? 'satisfied' : 'violated'
      else if (constraint.kind === 'orientation') status = Number(value.angle_deg) <= (constraint.max_angle_deg ?? 10) ? 'satisfied' : 'violated'
      else status = value.intersects ? 'violated' : value.non_intersection_proven ? 'satisfied' : 'unknown'
    }
    return { id: constraint.id, object_keys: constraint.object_keys, status, required: constraint.required ?? true, requirement: constraint, observation, evidence_views: ['top', 'front', 'side', 'overview'] }
  }
  dispose(): void { this.baked.forEach(disposeBaked); this.baked.clear() }
}

function moveWorld(object: THREE.Object3D, delta: THREE.Vector3): void {
  const position = object.getWorldPosition(new THREE.Vector3()).add(delta)
  if (object.parent) object.parent.worldToLocal(position)
  object.position.copy(position); object.updateWorldMatrix(true, true)
}

export function createGeometryHelpers(registry: SceneRegistry) {
  const temporary = (object: THREE.Object3D): RegisteredObject => ({ key: 'temporary', object, metadata: {} })
  const project = (object: THREE.Object3D, normal: THREE.Vector3) => {
    const baked = bake(temporary(object)), positions = baked.geometry.getAttribute('position')
    let min = Infinity, max = -Infinity
    const point = new THREE.Vector3()
    for (let index = 0; index < positions.count; index++) { const distance = point.fromBufferAttribute(positions, index).dot(normal); min = Math.min(min, distance); max = Math.max(max, distance) }
    disposeBaked(baked); return { min, max }
  }
  return {
    bounds: objectBounds,
    alignAgainstWall(object: THREE.Object3D, wall: THREE.Object3D, options: { normal: Vec3; gap?: number }) {
      const normal = vector(options.normal, 'normal').normalize()
      if (!normal.lengthSq()) throw new Error('Wall normal is required')
      const source = project(object, normal), target = project(wall, normal)
      moveWorld(object, normal.multiplyScalar(target.max + (options.gap ?? 0) - source.min))
      return object
    },
    placeOn(object: THREE.Object3D, surface: THREE.Object3D, options: { at?: [number, number]; clearance?: number } = {}) {
      const position = object.getWorldPosition(new THREE.Vector3())
      if (options.at) moveWorld(object, new THREE.Vector3(options.at[0] - position.x, options.at[1] - position.y, 0))
      const bounds = objectBounds(object), target = bake(temporary(surface))
      try {
        const center = bounds.getCenter(new THREE.Vector3())
        const origin = new THREE.Vector3(center.x, center.y, Math.max(bounds.max.z, target.bounds.max.z) + 1)
        const hit = target.bvh.raycastFirst(new THREE.Ray(origin, new THREE.Vector3(0, 0, -1)), THREE.DoubleSide)
        if (!hit) throw new Error('No surface under placement point')
        moveWorld(object, new THREE.Vector3(0, 0, hit.point.z + (options.clearance ?? 0) - bounds.min.z))
        return object
      } finally { disposeBaked(target) }
    },
    faceTowards(object: THREE.Object3D, target: THREE.Object3D | THREE.Vector3, options: { forward?: Vec3 } = {}) {
      const metadata = [...registry.values()].find(entry => entry.object === object)?.metadata
      const forward = options.forward ?? metadata?.forward
      if (!forward) throw new Error('Specify the authored forward axis')
      object.updateWorldMatrix(true, true)
      const current = vector(forward, 'forward').transformDirection(object.matrixWorld).setZ(0).normalize()
      const destination = (target as THREE.Object3D).isObject3D ? (target as THREE.Object3D).getWorldPosition(new THREE.Vector3()) : (target as THREE.Vector3).clone()
      const desired = destination.sub(object.getWorldPosition(new THREE.Vector3())).setZ(0).normalize()
      if (!current.lengthSq() || !desired.lengthSq()) throw new Error('Horizontal facing direction is undefined')
      const yaw = Math.atan2(current.clone().cross(desired).z, current.dot(desired))
      const world = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw).multiply(object.getWorldQuaternion(new THREE.Quaternion()))
      if (object.parent) world.premultiply(object.parent.getWorldQuaternion(new THREE.Quaternion()).invert())
      object.quaternion.copy(world); object.updateWorldMatrix(true, true); return object
    },
    distribute(objects: THREE.Object3D[], options: { direction: Vec3; start: Vec3; gap?: number }) {
      const direction = vector(options.direction, 'direction').normalize(), start = vector(options.start, 'start')
      if (!direction.lengthSq()) throw new Error('Distribution direction is required')
      let cursor = start.dot(direction)
      for (const object of objects) { const extent = project(object, direction); moveWorld(object, direction.clone().multiplyScalar(cursor - extent.min)); cursor += extent.max - extent.min + (options.gap ?? 0) }
      return objects
    },
  }
}

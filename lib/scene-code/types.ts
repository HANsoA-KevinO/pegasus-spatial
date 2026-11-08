import type { RasterAssetRef } from '../types'
import type { SceneObjectNormalization, SceneViewpoint, Vec3 } from '../spatial/scene-types'

export const SCENE_CODE_RUNTIME_VERSION = 'three-code-v4' as const
export const SCENE_CODE_DEPENDENCIES = { three: '0.183.2', spark: '2.4.0', csg: '0.0.18', bvh: '0.9.18' } as const
export const SCENE_CODE_TOOL_NAMES = ['PrepareSceneCode', 'RunSceneCode', 'InspectSceneBuild', 'RenderSceneViews', 'QuerySceneGeometry', 'CheckSceneConstraints', 'PublishSceneBuild', 'ExportSceneBuild'] as const
export const RETIRED_SCENE_EDIT_TOOLS: ReadonlySet<string> = new Set(['SetSceneEnvironment', 'SetSceneWorld', 'AddSceneTerrain', 'AddSceneObject', 'TransformSceneObject', 'RemoveSceneObject', 'ApplySceneSpec'])
export type SceneCodeToolName = typeof SCENE_CODE_TOOL_NAMES[number]
export type SceneCodeBuildStatus = 'queued' | 'compiling' | 'running' | 'checking' | 'ready' | 'failed' | 'cancelled'
export interface FrozenCodeSource { path: string; sha256: string; content: string }
export interface SceneCodeAsset {
  alias: string
  path: string
  kind: 'glb' | 'texture' | 'ply' | 'spz' | 'data'
  mime_type: string
  sha256: string
  size_bytes: number
  blob_id: string
  normalization?: SceneObjectNormalization
  paired_ply?: string
  preview_only?: boolean
}
export interface RuntimeAsset extends Omit<SceneCodeAsset, 'blob_id'> { bytes: ArrayBuffer | Uint8Array }
export interface SceneQualityAsset extends Omit<RuntimeAsset, 'bytes'> { stream: ReadableStream<Uint8Array> }
export interface SceneQualityState { loadedCount: number; totalCount: number; error?: string }
/** Keep database blob identifiers out of browser/renderer/project manifests. */
export function sceneAssetManifest({ blob_id, ...manifest }: SceneCodeAsset) { void blob_id; return manifest }
export interface SceneObjectMetadata {
  label?: string
  semantic_type?: string
  description?: string
  role?: 'object' | 'terrain'
  forward?: Vec3
  anchors?: Record<string, Vec3>
  /** Required for CPU queries when a shader moves vertices. */
  query_geometry?: unknown
  query_geometry_required?: boolean
}
export interface SceneObjectDescriptor {
  key: string
  parent_key: string | null
  label: string
  semantic_type: string | null
  description: string | null
  role: 'object' | 'terrain'
  declared: { forward?: Vec3; anchors?: Record<string, Vec3> }
  measured: {
    bounds: { min: Vec3; max: Vec3; size: Vec3 } | null
    position: Vec3
    rotation_quaternion: [number, number, number, number]
    scale: Vec3
    meshes: number
    triangles: number
    materials: Array<{ name: string; type: string; color?: string; opacity?: number; roughness?: number; metalness?: number; texture_slots?: string[] }>
    visible: boolean
    in_scene: boolean
    queryable: boolean
    query_method: string
  }
  source: { stack?: string; path?: string; line?: number; column?: number; asset_aliases: string[] }
}
export interface SceneCamera extends SceneViewpoint { name: string; projection?: 'perspective' | 'orthographic'; span?: number }
export type SceneViewMode = 'beauty' | 'clay' | 'wireframe' | 'isolate' | 'section'
export interface SceneViewRequest {
  name?: string
  preset?: 'top' | 'front' | 'side' | 'overview' | 'entrance'
  camera?: SceneCamera
  camera_key?: string
  object_keys?: string[]
  mode?: SceneViewMode
  time_s?: number
  width?: number
  height?: number
  section?: { normal: Vec3; constant: number }
}
export interface SceneGeometryQuery {
  id?: string
  kind: 'bounds' | 'raycast' | 'distance' | 'intersection' | 'support' | 'orientation' | 'section'
  object_keys: string[]
  origin?: Vec3
  direction?: Vec3
  max_distance?: number
  tolerance?: number
  normal?: Vec3
  constant?: number
}
export interface SceneGeometryObservation {
  id: string
  kind: SceneGeometryQuery['kind']
  object_keys: string[]
  status: 'measured' | 'unknown'
  method: string
  value?: unknown
  reason?: string
}
export interface SceneConstraint {
  id: string
  kind: 'distance' | 'contact' | 'support' | 'no_intersection' | 'orientation' | 'keep_clear'
  object_keys: string[]
  min?: number
  max?: number
  tolerance?: number
  max_angle_deg?: number
  required?: boolean
  min_support_fraction?: number
}
export interface SceneAcceptanceContract {
  version: number
  hash: string
  requirements: SceneConstraint[]
  established_run_id: string
  changed_run_id: string
  change_reason: string
}
export interface SceneConstraintResult {
  id: string
  object_keys: string[]
  status: 'satisfied' | 'violated' | 'unknown'
  required: boolean
  requirement: SceneConstraint
  observation: SceneGeometryObservation
  evidence_views: string[]
}
export interface SceneRuntimeSnapshot {
  time_s: number
  objects: SceneObjectDescriptor[]
  cameras: SceneCamera[]
  assets: Array<{ alias: string; path: string; loaded: boolean; instances_in_scene: number }>
  animated: boolean
  warnings: string[]
  metrics: { meshes: number; triangles: number; draw_calls: number; render_ms: number }
}
export interface SceneRenderedView {
  name: string
  camera: SceneCamera
  mode: SceneViewMode
  time_s: number
  width: number
  height: number
  visible_keys: string[]
  labels: Array<{ number: number; key: string; x: number; y: number }>
  png_base64?: string
  image?: RasterAssetRef
  workspace_path?: string
}
export interface SceneCodeReport {
  view_errors?: Array<{ index: number; name: string; code: string; message: string; available_cameras?: string[]; suggested_preset?: string }>
  montage?: { image: RasterAssetRef; workspace_path: string } | null
  snapshot: SceneRuntimeSnapshot
  constraints: SceneConstraintResult[]
  views: SceneRenderedView[]
  errors: Array<{ stage: string; message: string; stack?: string; path?: string; line?: number; column?: number }>
}
export interface SceneProgramRef {
  build_id: string
  runtime_version: typeof SCENE_CODE_RUNTIME_VERSION
  source_hash: string
  entry_path: string
  objects: SceneObjectDescriptor[]
  cameras: SceneCamera[]
  animated: boolean
  has_ply: boolean
}
export interface SceneCodeBuild {
  acceptance?: SceneAcceptanceContract
  acceptance_warnings?: string[]
  request_hash?: string
  build_id: string
  project_id: string
  conversation_id: string
  user_id: string
  scene_id: string
  run_id: string
  tool_use_id: string
  actor_id: string
  status: SceneCodeBuildStatus
  base_revision_id: string
  base_version: number
  entry_path: string
  assets_path: string
  source_hash: string
  sources: FrozenCodeSource[]
  assets: SceneCodeAsset[]
  seed: number
  constraints: SceneConstraint[]
  runtime_version: typeof SCENE_CODE_RUNTIME_VERSION
  dependencies: typeof SCENE_CODE_DEPENDENCIES
  bundle_blob_id: string | null
  source_map_blob_id: string | null
  report: SceneCodeReport | null
  error: string | null
  failure?: { stage: 'compile' | 'execute'; path?: string; line?: number; column?: number; stack?: string } | null
  lease: { owner: string; token: string; expires_at: Date } | null
  attempts: number
  notify_requested: boolean
  notified_at: Date | null
  created_at: Date
  updated_at: Date
}
export interface SceneRuntimeInit {
  seed: number
  assets: RuntimeAsset[]
  canvas?: OffscreenCanvas
  width?: number
  height?: number
  quality_mode?: 'glb' | 'ply'
}
export interface SceneRuntimeOperation {
  render_evidence?: boolean
  kind: 'inspect' | 'render' | 'query' | 'check' | 'export'
  views?: SceneViewRequest[]
  queries?: SceneGeometryQuery[]
  constraints?: SceneConstraint[]
  time_s?: number
  format?: 'glb'
}

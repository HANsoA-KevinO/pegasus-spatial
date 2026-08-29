export type Vec3 = [number, number, number]
export type Quaternion = [number, number, number, number]

export interface SceneViewpoint {
  position: Vec3
  target: Vec3
  up: Vec3
  fov_deg: number
}

export interface SceneTransform3D {
  position: Vec3
  rotation_quaternion: Quaternion
  scale: Vec3
}

export interface SceneSourceArtifact {
  artifact_id: string
  job_id: string
  kind: string
  workspace_path: string
  mime_type: string
  size_bytes: number
  sha256: string
  metadata: Record<string, unknown>
}

export interface SceneWorldSource {
  source_job_id: string
  up_axis: 'Y' | 'Z'
  artifacts: SceneSourceArtifact[]
}

export interface SceneObjectNormalization {
  basis_contract_version?: 'lux3d_g1_paired_v1'
  source_up_axis: 'Y'
  scene_up_axis: 'Y' | 'Z'
  pivot: 'bottom_center'
  glb_basis_correction?: 'gltf_y_up_to_scene_z_up'
  ply_source_up_axis?: 'Z' | '-Y'
  ply_yaw_correction_deg?: number
  ply_basis_correction?: 'lux_ply_negative_y_up_to_scene_z_up'
  bounds?: { min: Vec3; max: Vec3; size: Vec3 }
}

export interface SceneObjectInstance {
  instance_id: string
  label: string
  source_job_id: string
  glb_artifact: SceneSourceArtifact
  optional_ply_artifact?: SceneSourceArtifact
  normalization: SceneObjectNormalization
  transform: SceneTransform3D
}

/**
 * User-safe projection of one published standalone object build. Storage
 * locators and provider credentials deliberately stay behind the API boundary.
 */
export interface SpatialObjectModelEntity {
  job_id: string
  label: string
  provider: string
  status: 'published'
  updated_at: string
  glb_artifact: SceneSourceArtifact
  ply_artifact: SceneSourceArtifact
  normalization: SceneObjectNormalization
}

export interface SpatialSceneRecord {
  scene_id: string
  project_id: string
  user_id: string
  conversation_id: string
  title: string
  current_revision_id: string
  current_version: number
  agent_viewpoint: SceneViewpoint | null
  created_at: Date
  updated_at: Date
}

export interface SpatialSceneRevisionRecord {
  revision_id: string
  scene_id: string
  project_id: string
  user_id: string
  version: number
  parent_revision_id: string | null
  mutation_key: string
  mutation_hash: string
  world: SceneWorldSource | null
  instances: SceneObjectInstance[]
  change_summary: string
  observation_id: string | null
  created_by: string
  committed: boolean
  created_at: Date
  updated_at: Date
}

export interface SpatialObservationRecord {
  observation_id: string
  scene_id: string
  project_id: string
  user_id: string
  revision_id: string
  source: 'user' | 'agent'
  viewpoint: SceneViewpoint
  screenshot_asset_id: string
  screenshot_workspace_path: string
  selected_instance_id: string | null
  visible_instance_ids: string[]
  comment: string
  created_at: Date
  updated_at: Date
}

export interface SpatialRenderSessionRecord {
  session_id: string
  scene_id: string
  project_id: string
  user_id: string
  client_id: string
  lease_token: string
  heartbeat_at: Date
  expires_at: Date
  created_at: Date
  updated_at: Date
}

export type SpatialRenderCommandStatus = 'queued' | 'claimed' | 'completed' | 'failed'

export interface SpatialRenderCommandRecord {
  command_id: string
  scene_id: string
  project_id: string
  user_id: string
  run_id: string
  tool_use_id: string
  revision_id: string
  viewpoint: SceneViewpoint
  note: string | null
  status: SpatialRenderCommandStatus
  lease: { session_id: string; token: string; expires_at: Date } | null
  observation_id: string
  screenshot_asset_id: string | null
  screenshot_workspace_path: string | null
  last_error: string | null
  created_at: Date
  updated_at: Date
  completed_at: Date | null
}

export interface SceneCommandScope {
  projectId: string
  userId: string
  conversationId?: string
}

export interface SceneMutationIdentity extends SceneCommandScope {
  runId: string
  toolUseId: string
  actorId: string
}

export type SceneMutationResult =
  | { status: 'applied'; scene: SpatialSceneRecord; revision: SpatialSceneRevisionRecord; replayed: boolean }
  | { status: 'scene_changed'; scene: SpatialSceneRecord; latestRevision: SpatialSceneRevisionRecord }

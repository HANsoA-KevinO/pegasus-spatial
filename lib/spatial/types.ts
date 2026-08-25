export const SPATIAL_BUILD_KINDS = ['image', 'object', 'world'] as const
export type SpatialBuildKind = typeof SPATIAL_BUILD_KINDS[number]

export const SPATIAL_BUILD_STATUSES = [
  'prepared',
  'submitting',
  'submitted',
  'running',
  'materializing',
  'published',
  'failed',
  'unknown',
  'cancelled',
] as const
export type SpatialBuildStatus = typeof SPATIAL_BUILD_STATUSES[number]

export const SPATIAL_TERMINAL_STATUSES = [
  'published',
  'failed',
  'unknown',
  'cancelled',
] as const satisfies readonly SpatialBuildStatus[]

export const SPATIAL_ARTIFACT_KINDS = [
  'image',
  'thumbnail',
  'model',
  'point_cloud',
  'manifest',
  'other',
] as const
export type SpatialArtifactKind = typeof SPATIAL_ARTIFACT_KINDS[number]

export const SPATIAL_ARTIFACT_RELATIONS = [
  'derived_from',
  'revision_of',
  'conditioned_by',
  'compared_with',
] as const
export type SpatialArtifactRelationKind = typeof SPATIAL_ARTIFACT_RELATIONS[number]

export interface SpatialArtifactRelation {
  kind: SpatialArtifactRelationKind
  artifact_id: string
}

export interface SpatialLease {
  owner_id: string
  token: string
  acquired_at: Date
  heartbeat_at: Date
  expires_at: Date
}

export interface SpatialBuildRequestSnapshot {
  output_path_prefix: string
  prompt?: string
  input_image_paths?: string[]
  source_image_path?: string
  provider_options?: Record<string, unknown>
  relations?: SpatialArtifactRelation[]
  [key: string]: unknown
}

export interface SpatialBuildJobRecord {
  job_id: string
  idempotency_key: string
  project_id: string
  run_id: string
  tool_use_id: string
  user_id: string
  conversation_id: string
  kind: SpatialBuildKind
  provider: string
  model_snapshot: string | null
  request_hash: string
  request_snapshot: SpatialBuildRequestSnapshot
  output_path_prefix?: string
  status: SpatialBuildStatus
  active_slot?: 0 | 1
  status_revision: number
  execution_attempts: number
  consecutive_failures?: number
  submission_attempts: number
  poll_attempts: number
  lease: SpatialLease | null
  external_job_id: string | null
  provider_status: string | null
  published_artifact_ids: string[]
  published_workspace_paths: string[]
  publication_token: string | null
  available_at: Date | null
  last_error: string | null
  unknown_reason: string | null
  created_at: Date
  updated_at: Date
  finished_at: Date | null
}

export interface SpatialArtifactNodeRecord {
  artifact_id: string
  job_id: string
  project_id: string
  user_id: string
  provider: string
  kind: SpatialArtifactKind
  state: 'published' | 'orphaned'
  publication_token: string
  provider_asset_key: string
  filename: string
  workspace_path: string
  storage_uri: string
  mime_type: string
  size_bytes: number
  sha256: string
  relations: SpatialArtifactRelation[]
  metadata: Record<string, unknown>
  created_at: Date
  updated_at: Date
}

export interface PrepareSpatialBuildInput {
  projectId: string
  runId: string
  toolUseId: string
  userId: string
  conversationId: string
  kind: SpatialBuildKind
  provider: string
  modelSnapshot?: string | null
  request: SpatialBuildRequestSnapshot
}

export interface ClaimedSpatialBuildJob {
  job: SpatialBuildJobRecord
  ownerId: string
  leaseToken: string
}

export interface SpatialCommandScope {
  projectId: string
  userId: string
}

export interface RegisterPublishedSpatialArtifactInput {
  artifactId: string
  jobId: string
  projectId: string
  userId: string
  provider: string
  publicationToken: string
  providerAssetKey: string
  kind: SpatialArtifactKind
  filename: string
  workspacePath: string
  storageUri: string
  mimeType: string
  sizeBytes: number
  sha256: string
  relations?: SpatialArtifactRelation[]
  metadata?: Record<string, unknown>
}

export type SpatialPaidHolderType = 'spatial_build' | 'image_generation'

export interface SpatialPaidSlotRecord {
  project_id: string
  user_id: string
  slot: 0 | 1
  holder_type: SpatialPaidHolderType
  holder_key: string
  reservation_token: string
  state: 'reserved' | 'active'
  reservation_expires_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface SpatialPaidSlotClaim {
  projectId: string
  userId: string
  slot: 0 | 1
  holderType: SpatialPaidHolderType
  holderKey: string
  reservationToken: string
  state: 'reserved' | 'active'
}

export interface SpatialStagedBatchRecord {
  job_id: string
  project_id: string
  user_id: string
  publication_token: string
  state: 'ready'
  assets: StagedSpatialAsset[]
  expires_at: Date
  created_at: Date
  updated_at: Date
}

export interface ProviderArtifactDescriptor {
  assetKey: string
  kind: SpatialArtifactKind
  fileName: string
  remoteUrl?: string
  /** Adapter-generated UTF-8 content; mutually exclusive with remoteUrl. */
  inlineContent?: string
  claimedMimeType?: string
  metadata?: Record<string, unknown>
  relations?: SpatialArtifactRelation[]
}

export type SpatialProviderPollResult =
  | { state: 'queued'; providerStatus?: string }
  | { state: 'running'; providerStatus?: string }
  | { state: 'succeeded'; providerStatus?: string; artifacts: ProviderArtifactDescriptor[] }
  | { state: 'failed'; providerStatus?: string; error?: string }
  | { state: 'cancelled'; providerStatus?: string; error?: string }

export interface SpatialProviderSubmission {
  externalJobId: string
  providerStatus?: string
}

export interface SpatialProviderAdapter {
  readonly provider: string
  supports(kind: SpatialBuildKind): boolean
  submit(
    job: SpatialBuildJobRecord,
    context: { providerIdempotencyKey: string; signal?: AbortSignal },
  ): Promise<SpatialProviderSubmission>
  poll(
    job: SpatialBuildJobRecord,
    context: { signal?: AbortSignal },
  ): Promise<SpatialProviderPollResult>
  cancel?(
    job: SpatialBuildJobRecord,
    context: { signal?: AbortSignal },
  ): Promise<void>
}

export interface StagedSpatialAsset {
  stageId: string
  artifactId: string
  jobId: string
  publicationToken: string
  providerAssetKey: string
  kind: SpatialArtifactKind
  filename: string
  workspacePath: string
  mimeType: string
  sizeBytes: number
  sha256: string
  relations: SpatialArtifactRelation[]
  metadata: Record<string, unknown>
}

export interface PublishedSpatialAsset extends StagedSpatialAsset {
  storageUri: string
}

export interface SpatialAssetPublisher {
  recoverStage(input: {
    job: SpatialBuildJobRecord
    publicationToken: string
    artifactId: string
    providerAssetKey: string
    kind: SpatialArtifactKind
    filename: string
    workspacePath: string
    relations: SpatialArtifactRelation[]
    metadata: Record<string, unknown>
  }): Promise<StagedSpatialAsset | null>
  stage(input: {
    job: SpatialBuildJobRecord
    publicationToken: string
    artifactId: string
    providerAssetKey: string
    kind: SpatialArtifactKind
    filename: string
    workspacePath: string
    buffer: Buffer
    mimeType: string
    sha256: string
    relations: SpatialArtifactRelation[]
    metadata: Record<string, unknown>
  }): Promise<StagedSpatialAsset>
  markBatchReady(input: {
    job: SpatialBuildJobRecord
    publicationToken: string
    assets: readonly StagedSpatialAsset[]
  }): Promise<void>
  recoverReadyBatch(input: {
    job: SpatialBuildJobRecord
    publicationToken: string
  }): Promise<StagedSpatialAsset[] | null>
  publishBatch(input: {
    job: SpatialBuildJobRecord
    publicationToken: string
    assets: readonly StagedSpatialAsset[]
  }): Promise<PublishedSpatialAsset[]>
  discardBatch(assets: readonly StagedSpatialAsset[]): Promise<void>
  discardJobStages(input: {
    job: SpatialBuildJobRecord
    publicationToken: string
  }): Promise<number>
  cleanupExpired(now?: Date): Promise<number>
}

export interface MaterializedSpatialArtifact {
  artifactId: string
  providerAssetKey: string
  kind: SpatialArtifactKind
  filename: string
  workspacePath: string
  storageUri: string
  mimeType: string
  sizeBytes: number
  sha256: string
  relations: SpatialArtifactRelation[]
  metadata: Record<string, unknown>
}

export function isSpatialTerminalStatus(
  status: SpatialBuildStatus,
): status is typeof SPATIAL_TERMINAL_STATUSES[number] {
  return (SPATIAL_TERMINAL_STATUSES as readonly string[]).includes(status)
}

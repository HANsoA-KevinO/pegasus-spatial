import mongoose, { Schema, type Model } from 'mongoose'
import {
  SPATIAL_ARTIFACT_KINDS,
  SPATIAL_ARTIFACT_RELATIONS,
  SPATIAL_BUILD_KINDS,
  SPATIAL_BUILD_STATUSES,
  type SpatialArtifactNodeRecord,
  type SpatialBuildJobRecord,
  type SpatialPaidSlotRecord,
  type SpatialStagedBatchRecord,
} from './types'

const SpatialBuildJobSchema = new Schema<SpatialBuildJobRecord>({
  job_id: { type: String, required: true, unique: true, index: true },
  idempotency_key: { type: String, required: true },
  project_id: { type: String, required: true, index: true },
  run_id: { type: String, required: true, index: true },
  tool_use_id: { type: String, required: true },
  user_id: { type: String, required: true, index: true },
  conversation_id: { type: String, required: true, index: true },
  kind: { type: String, enum: SPATIAL_BUILD_KINDS, required: true },
  provider: { type: String, required: true, index: true },
  model_snapshot: { type: String, default: null },
  request_hash: { type: String, required: true },
  request_snapshot: { type: Schema.Types.Mixed, required: true },
  output_path_prefix: { type: String, required: true },
  status: { type: String, enum: SPATIAL_BUILD_STATUSES, required: true, index: true },
  active_slot: { type: Number, enum: [0, 1], default: undefined },
  status_revision: { type: Number, default: 0 },
  execution_attempts: { type: Number, default: 0 },
  consecutive_failures: { type: Number, default: 0 },
  submission_attempts: { type: Number, default: 0 },
  poll_attempts: { type: Number, default: 0 },
  lease: { type: Schema.Types.Mixed, default: null },
  external_job_id: { type: String, default: null, index: true },
  provider_status: { type: String, default: null },
  published_artifact_ids: { type: [String], default: [] },
  published_workspace_paths: { type: [String], default: [] },
  publication_token: { type: String, default: null },
  available_at: { type: Date, default: null, index: true },
  last_error: { type: String, default: null },
  unknown_reason: { type: String, default: null },
  finished_at: { type: Date, default: null },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'spatial_build_jobs',
})

SpatialBuildJobSchema.index(
  { project_id: 1, run_id: 1, tool_use_id: 1 },
  { unique: true },
)
SpatialBuildJobSchema.index(
  { project_id: 1, output_path_prefix: 1 },
  { unique: true },
)
SpatialBuildJobSchema.index(
  { project_id: 1, active_slot: 1 },
  {
    unique: true,
    partialFilterExpression: { active_slot: { $type: 'number' } },
  },
)
SpatialBuildJobSchema.index({
  status: 1,
  available_at: 1,
  'lease.expires_at': 1,
  created_at: 1,
})
SpatialBuildJobSchema.index({ user_id: 1, project_id: 1, created_at: -1 })

const SpatialArtifactRelationSchema = new Schema({
  kind: { type: String, enum: SPATIAL_ARTIFACT_RELATIONS, required: true },
  artifact_id: { type: String, required: true },
}, { _id: false })

const SpatialArtifactNodeSchema = new Schema<SpatialArtifactNodeRecord>({
  artifact_id: { type: String, required: true, unique: true, index: true },
  job_id: { type: String, required: true, index: true },
  project_id: { type: String, required: true, index: true },
  user_id: { type: String, required: true, index: true },
  provider: { type: String, required: true },
  kind: { type: String, enum: SPATIAL_ARTIFACT_KINDS, required: true },
  state: { type: String, enum: ['published', 'orphaned'], required: true, index: true },
  publication_token: { type: String, required: true, index: true },
  provider_asset_key: { type: String, required: true },
  filename: { type: String, required: true },
  workspace_path: { type: String, required: true },
  storage_uri: { type: String, required: true },
  mime_type: { type: String, required: true },
  size_bytes: { type: Number, required: true },
  sha256: { type: String, required: true, index: true },
  relations: { type: [SpatialArtifactRelationSchema], default: [] },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'spatial_artifact_nodes',
})

const SpatialPaidSlotSchema = new Schema<SpatialPaidSlotRecord>({
  project_id: { type: String, required: true, index: true },
  user_id: { type: String, required: true, index: true },
  slot: { type: Number, enum: [0, 1], required: true },
  holder_type: { type: String, enum: ['spatial_build', 'image_generation'], required: true },
  holder_key: { type: String, required: true },
  reservation_token: { type: String, required: true },
  state: { type: String, enum: ['reserved', 'active'], required: true, index: true },
  reservation_expires_at: { type: Date, default: null, index: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'spatial_paid_slots',
})

SpatialPaidSlotSchema.index({ project_id: 1, slot: 1 }, { unique: true })
SpatialPaidSlotSchema.index(
  { project_id: 1, holder_type: 1, holder_key: 1 },
  { unique: true },
)

SpatialArtifactNodeSchema.index({ job_id: 1, publication_token: 1 })
SpatialArtifactNodeSchema.index({ user_id: 1, project_id: 1, created_at: -1 })

const SpatialStagedBatchSchema = new Schema<SpatialStagedBatchRecord>({
  job_id: { type: String, required: true, index: true },
  project_id: { type: String, required: true, index: true },
  user_id: { type: String, required: true, index: true },
  publication_token: { type: String, required: true },
  state: { type: String, enum: ['ready'], required: true },
  assets: { type: [Schema.Types.Mixed], required: true } as never,
  expires_at: { type: Date, required: true, index: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'spatial_staged_batches',
})

SpatialStagedBatchSchema.index({ job_id: 1, publication_token: 1 }, { unique: true })

export const SpatialBuildJobModel =
  (mongoose.models.SpatialBuildJob as Model<SpatialBuildJobRecord> | undefined)
  ?? mongoose.model<SpatialBuildJobRecord>('SpatialBuildJob', SpatialBuildJobSchema)

export const SpatialArtifactNodeModel =
  (mongoose.models.SpatialArtifactNode as Model<SpatialArtifactNodeRecord> | undefined)
  ?? mongoose.model<SpatialArtifactNodeRecord>('SpatialArtifactNode', SpatialArtifactNodeSchema)

export const SpatialPaidSlotModel =
  (mongoose.models.SpatialPaidSlot as Model<SpatialPaidSlotRecord> | undefined)
  ?? mongoose.model<SpatialPaidSlotRecord>('SpatialPaidSlot', SpatialPaidSlotSchema)

export const SpatialStagedBatchModel =
  (mongoose.models.SpatialStagedBatch as Model<SpatialStagedBatchRecord> | undefined)
  ?? mongoose.model<SpatialStagedBatchRecord>('SpatialStagedBatch', SpatialStagedBatchSchema)

export const SPATIAL_MODELS = [
  SpatialBuildJobModel,
  SpatialArtifactNodeModel,
  SpatialPaidSlotModel,
  SpatialStagedBatchModel,
] as const

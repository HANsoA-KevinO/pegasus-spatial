import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { projectPublishedObjectModel, SpatialSceneAssetRejectedError } from '../scene-repository'
import type { SpatialArtifactNodeRecord, SpatialBuildJobRecord } from '../types'

const now = new Date('2026-08-29T00:00:00.000Z')
const job: SpatialBuildJobRecord = {
  job_id: 'spjob_fixture',
  idempotency_key: 'idempotency_fixture',
  project_id: 'project_fixture',
  run_id: 'run_fixture',
  tool_use_id: 'tool_fixture',
  user_id: 'user_fixture',
  conversation_id: 'project_fixture',
  kind: 'object',
  provider: 'lux3d',
  model_snapshot: 'G1',
  request_hash: 'request_hash_fixture',
  request_snapshot: {
    output_path_prefix: 'output/spatial/objects/fixture',
    provider_options: { name: '示例物体' },
  },
  output_path_prefix: 'output/spatial/objects/fixture',
  status: 'published',
  status_revision: 1,
  execution_attempts: 1,
  consecutive_failures: 0,
  submission_attempts: 1,
  poll_attempts: 1,
  lease: null,
  external_job_id: 'provider_fixture',
  provider_status: 'SUCCEEDED',
  published_artifact_ids: ['glb', 'ply'],
  published_workspace_paths: [
    'output/spatial/objects/fixture/model.glb',
    'output/spatial/objects/fixture/gaussian.ply',
  ],
  publication_token: 'publication_fixture',
  available_at: null,
  last_error: null,
  unknown_reason: null,
  created_at: now,
  updated_at: now,
  finished_at: now,
}

function artifact(input: {
  artifactId: string
  kind: SpatialArtifactNodeRecord['kind']
  path: string
  mimeType: string
  metadata?: Record<string, unknown>
  publicationToken?: string
  userId?: string
}): SpatialArtifactNodeRecord {
  return {
    artifact_id: input.artifactId,
    job_id: job.job_id,
    project_id: job.project_id,
    user_id: input.userId ?? job.user_id,
    provider: job.provider,
    kind: input.kind,
    state: 'published',
    publication_token: input.publicationToken ?? job.publication_token!,
    provider_asset_key: input.artifactId,
    filename: input.path.split('/').at(-1)!,
    workspace_path: input.path,
    storage_uri: `private:must-not-leak:${input.artifactId}`,
    mime_type: input.mimeType,
    size_bytes: 42,
    sha256: input.artifactId.padEnd(64, '0').slice(0, 64),
    relations: [],
    metadata: input.metadata ?? {},
    created_at: now,
    updated_at: now,
  }
}

const glb = artifact({
  artifactId: 'glb',
  kind: 'model',
  path: 'output/spatial/objects/fixture/model.glb',
  mimeType: 'model/gltf-binary',
  metadata: { bounds: { min: [-1, 0, -1], max: [1, 2, 1], size: [2, 2, 2] } },
})
const ply = artifact({
  artifactId: 'ply',
  kind: 'point_cloud',
  path: 'output/spatial/objects/fixture/gaussian.ply',
  mimeType: 'application/ply',
})
const wrongOwner = artifact({
  artifactId: 'foreign',
  kind: 'model',
  path: 'output/spatial/objects/foreign/model.glb',
  mimeType: 'model/gltf-binary',
  userId: 'different_user',
})
const wrongGeneration = artifact({
  artifactId: 'stale',
  kind: 'model',
  path: 'output/spatial/objects/fixture/stale.glb',
  mimeType: 'model/gltf-binary',
  publicationToken: 'different_publication',
})

const entity = projectPublishedObjectModel(job, [wrongOwner, wrongGeneration, ply, glb])
assert.equal(entity.job_id, job.job_id)
assert.equal(entity.label, '示例物体')
assert.equal(entity.provider, 'lux3d')
assert.equal(entity.status, 'published')
assert.equal(entity.updated_at, now.toISOString())
assert.equal(entity.glb_artifact.workspace_path, glb.workspace_path)
assert.equal(entity.ply_artifact.workspace_path, ply.workspace_path)
assert.equal(entity.normalization.basis_contract_version, 'lux3d_g1_paired_v1')
assert.deepEqual(entity.normalization.bounds?.size, [2, 2, 2])
assert.doesNotMatch(JSON.stringify(entity), /storage_uri|must-not-leak/)

assert.throws(
  () => projectPublishedObjectModel(job, [glb]),
  SpatialSceneAssetRejectedError,
)
assert.throws(
  () => projectPublishedObjectModel(job, [ply]),
  SpatialSceneAssetRejectedError,
)

const route = readFileSync(fileURLToPath(new URL('../../../app/api/conversations/[id]/spatial/models/route.ts', import.meta.url)), 'utf8')
const hook = readFileSync(fileURLToPath(new URL('../../../hooks/useSpatialModels.ts', import.meta.url)), 'utf8')
assert.match(route, /Conversation\.exists\(\{ conversation_id: id, user_id: userId \}\)/)
assert.match(route, /listPublishedSpatialObjectModels\(\{ projectId: id, userId \}\)/)
assert.doesNotMatch(route, /storage_uri/)
assert.match(hook, /\/spatial\/models/)
assert.match(hook, /cache: 'no-store'/)
assert.match(hook, /2500/)

console.log('spatial model entity verification passed')

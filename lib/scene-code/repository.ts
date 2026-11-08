import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import mongoose, { Schema } from 'mongoose'
import { GridFSBucket, ObjectId } from 'mongodb'
import { connectDB } from '../db/mongodb'
import type { SceneCommandScope } from '../spatial/scene-types'
import type { SceneCodeBuild } from './types'

const schema = new Schema<SceneCodeBuild>({
  build_id: { type: String, unique: true, required: true },
  project_id: { type: String, required: true }, user_id: { type: String, required: true },
  conversation_id: { type: String, required: true }, scene_id: { type: String, required: true },
  run_id: { type: String, required: true }, tool_use_id: { type: String, required: true },
  status: { type: String, required: true }, lease: { type: Schema.Types.Mixed, default: null },
  report: { type: Schema.Types.Mixed, default: null },
}, { strict: false, collection: 'scene_code_builds', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
schema.index({ project_id: 1, user_id: 1, run_id: 1, tool_use_id: 1 }, { unique: true })
schema.index({ status: 1, created_at: 1 })
export const SceneCodeBuildModel = mongoose.models.SceneCodeBuild as mongoose.Model<SceneCodeBuild> || mongoose.model('SceneCodeBuild', schema)
const slotSchema = new Schema({ _id: String, owner: String, expires_at: Date }, { collection: 'scene_code_slots' })
export const SceneCodeSlotModel = mongoose.models.SceneCodeSlot || mongoose.model('SceneCodeSlot', slotSchema)
export const terminal = (status: string) => ['ready', 'failed', 'cancelled'].includes(status)
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')

export async function getSceneCodeBuild(id: string, scope: SceneCommandScope): Promise<SceneCodeBuild> {
  await connectDB()
  const build = await SceneCodeBuildModel.findOne({ build_id: id, project_id: scope.projectId, user_id: scope.userId }).lean<SceneCodeBuild>()
  if (!build) throw new Error('Build not found in this project')
  return build
}
async function bucket() { await connectDB(); return new GridFSBucket(mongoose.connection.db!, { bucketName: 'scene_code_blobs' }) }
// Frozen build blobs have their own bucket: workspace version GC cannot delete them.
export async function writeSceneBlob(bytes: Buffer, scope: { user_id: string; project_id: string }, kind: string): Promise<string> {
  const stream = (await bucket()).openUploadStream(`${kind}-${randomUUID()}`, { metadata: { ...scope, kind, sha256: sha256(bytes) } })
  await new Promise<void>((resolve, reject) => { stream.once('error', reject); stream.once('finish', resolve); stream.end(bytes) })
  return stream.id.toHexString()
}
export async function findScenePreviewBlob(hash: string, size: number, scope: { user_id: string; project_id: string }): Promise<string | undefined> {
  const [file] = await (await bucket()).find({ length: size, 'metadata.kind': 'preview-ply', 'metadata.sha256': hash, 'metadata.user_id': scope.user_id, 'metadata.project_id': scope.project_id }, { limit: 1 }).toArray()
  return file?._id.toHexString()
}
export async function streamScenePreviewBlob(id: string, hash: string, scope: { user_id: string; project_id: string }): Promise<ReadableStream<Uint8Array>> {
  const store = await bucket(), objectId = new ObjectId(id)
  const [file] = await store.find({ _id: objectId, 'metadata.sha256': hash, 'metadata.user_id': scope.user_id, 'metadata.project_id': scope.project_id }).toArray()
  if (!file) throw new Error('Frozen preview blob is unavailable')
  return Readable.toWeb(store.openDownloadStream(objectId), { strategy: { highWaterMark: 2, size: () => 1 } }) as ReadableStream<Uint8Array>
}
export async function readSceneBlob(id: string, scope: { user_id: string; project_id: string }): Promise<Buffer> {
  const store = await bucket(), objectId = new ObjectId(id)
  const [file] = await store.find({ _id: objectId, 'metadata.user_id': scope.user_id, 'metadata.project_id': scope.project_id }).toArray()
  if (!file) throw new Error('Frozen build blob is unavailable')
  const chunks: Buffer[] = []
  for await (const chunk of store.openDownloadStream(objectId)) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  if (sha256(bytes) !== file.metadata?.sha256) throw new Error('Frozen build blob hash mismatch')
  return bytes
}
export async function cancelSceneCodeBuild(id: string, scope: SceneCommandScope) {
  await getSceneCodeBuild(id, scope)
  await SceneCodeBuildModel.updateOne({ build_id: id, status: { $nin: ['ready', 'failed', 'cancelled'] } }, { $set: { status: 'cancelled', error: 'Cancelled by user', lease: null } })
  return getSceneCodeBuild(id, scope)
}

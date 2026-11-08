import { providerRasterExtension } from '../../media/object-prefix'
import { getOwnedImageAsset, readImageAsset } from '../../media/storage'
import type { SpatialBuildJobRecord } from '../types'
import { uploadAholoReferenceImage, type AholoUploadSource } from './aholo-upload'

export async function readOwnedSpatialReference(assetId: string, job: SpatialBuildJobRecord): Promise<AholoUploadSource | null> {
  const asset = await getOwnedImageAsset(assetId, job.user_id, job.conversation_id)
  if (!asset) return null
  const variant = asset.variants.original.mimeType === 'image/gif' ? 'model' : 'original'
  const mimeType = asset.variants[variant].mimeType
  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg' && mimeType !== 'image/webp') return null
  const image = await readImageAsset(assetId, variant)
  return image ? {
    buffer: image.buffer,
    mimeType,
    filename: `reference.${providerRasterExtension(mimeType)}`,
  } : null
}

/** Local Lux jobs persist IDs. OUS URLs exist only in the outbound create request. */
export async function materializeSpatialReferenceUrls(
  job: SpatialBuildJobRecord,
  options: {
    base: URL
    token: string
    fetchImpl: typeof fetch
    signal?: AbortSignal
    readReference?: typeof readOwnedSpatialReference
  },
): Promise<SpatialBuildJobRecord> {
  const providerOptions = job.request_snapshot.provider_options
  if (job.kind !== 'object' || providerOptions?.source_image_transport !== 'provider_asset') return job
  const ids = providerOptions.source_asset_ids
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4
    || ids.some(id => typeof id !== 'string' || !id.trim())) {
    throw new Error('Invalid queued reference image identities')
  }

  const urls: string[] = []
  for (const id of ids) {
    options.signal?.throwIfAborted()
    const source = await (options.readReference ?? readOwnedSpatialReference)(id, job)
    if (!source) throw new Error('Reference image is unavailable in this conversation')
    const deadline = AbortSignal.timeout(120_000)
    urls.push(await uploadAholoReferenceImage({
      baseUrl: options.base.origin, apiKey: options.token, source, fetchImpl: options.fetchImpl,
      signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline,
    }))
  }
  return {
    ...job,
    request_snapshot: {
      ...job.request_snapshot,
      provider_options: { ...providerOptions, source_image_urls: urls },
    },
  }
}

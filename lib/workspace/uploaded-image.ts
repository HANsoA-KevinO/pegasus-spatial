import { toImageBlock, toRasterAssetRef } from '../media/reference'
import { claimImageAsset, type StoredImageAsset } from '../media/storage'
import type { ImageBlock, ImageAttachment } from '../types'
import type { WorkspaceInstance } from './types'

const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export async function uploadedImageBlock(
  workspace: WorkspaceInstance | undefined,
  asset: StoredImageAsset,
): Promise<ImageBlock> {
  const image = toImageBlock(asset)
  const extension = extensions[asset.variants.original.mimeType]
  if (!workspace || !extension || !/^[a-f0-9]{64}$/.test(asset.sha256)) return image
  const path = `references/uploads/${asset.sha256}.${extension}`
  try {
    const current = await workspace.readRaster(path)
    if (current?.assetId !== asset.assetId) {
      await workspace.writeRaster(path, toRasterAssetRef(asset), '用户上传的原始参考图', { archive: false })
    }
    return { ...image, workspace_path: path }
  } catch (error) {
    console.warn('[workspace] Could not place user image', asset.assetId, error instanceof Error ? error.name : '')
    return image
  }
}

export async function queuedImageBlock(
  workspace: WorkspaceInstance | undefined,
  image: Extract<ImageAttachment, { assetId: string }>,
  ownerId: string | undefined,
  conversationId: string,
): Promise<ImageBlock> {
  const asset = ownerId && workspace
    ? await claimImageAsset(image.assetId, ownerId, conversationId).catch(() => null)
    : null
  if (asset) return uploadedImageBlock(workspace, asset)
  return {
    type: 'image',
    source: {
      type: 'asset',
      asset_id: image.assetId,
      media_type: image.mimeType,
      width: image.width,
      height: image.height,
      ...(image.storageDriver ? { storage_driver: image.storageDriver } : {}),
    },
  }
}

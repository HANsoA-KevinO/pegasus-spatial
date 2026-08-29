import type { FileEntry, RasterAssetFileEntry } from '@/lib/workspace/types'

const SPATIAL_IMAGE_ROOT = 'output/spatial/images/'
const MEDIA_ASSET_ID = /^[A-Za-z0-9_-]{43}$/
const SCENE_IMAGE_HINT = /(?:^|[_\-.])(world|scene|environment|background|panorama)(?:[_\-.]|$)/i

export type ProjectCoverKind = 'scene' | 'objects' | 'images' | 'empty'

export interface ProjectCoverAsset {
  path: string
  asset_id: string
  mime_type: string
  width: number
  height: number
}

export interface ProjectCoverJob {
  conversation_id: string
  kind: 'image' | 'object' | 'world'
  request_snapshot: {
    input_image_paths?: string[]
    source_image_path?: string
    provider_options?: {
      source_asset_id?: string
      source_asset_ids?: string[]
    }
  }
  created_at?: Date | string
  updated_at?: Date | string
}

export interface ProjectCoverSelection {
  kind: ProjectCoverKind
  images: ProjectCoverAsset[]
}

interface RasterCandidate extends ProjectCoverAsset {
  createdAt: number
}

function timestamp(value: string | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isSpatialRaster(path: string, entry: FileEntry): entry is RasterAssetFileEntry {
  return path.startsWith(SPATIAL_IMAGE_ROOT)
    && entry.storage === 'asset'
    && entry.kind === 'raster'
    && entry.mime_type.startsWith('image/')
    && MEDIA_ASSET_ID.test(entry.asset_id)
}

function rasterCandidates(files: Record<string, FileEntry>): RasterCandidate[] {
  return Object.entries(files)
    .filter((item): item is [string, RasterAssetFileEntry] => isSpatialRaster(item[0], item[1]))
    .map(([path, entry]) => ({
      path,
      asset_id: entry.asset_id,
      mime_type: entry.mime_type,
      width: entry.width,
      height: entry.height,
      createdAt: Math.max(timestamp(entry.updated_at), timestamp(entry.created_at)),
    }))
    .sort((left, right) => right.createdAt - left.createdAt || left.path.localeCompare(right.path))
}

function jobTimestamp(job: ProjectCoverJob): number {
  const updated = job.updated_at instanceof Date ? job.updated_at.getTime() : timestamp(job.updated_at)
  const created = job.created_at instanceof Date ? job.created_at.getTime() : timestamp(job.created_at)
  return Math.max(updated, created)
}

function publicAsset(candidate: RasterCandidate): ProjectCoverAsset {
  return {
    path: candidate.path,
    asset_id: candidate.asset_id,
    mime_type: candidate.mime_type,
    width: candidate.width,
    height: candidate.height,
  }
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map(path => path.trim()).filter(Boolean))]
}

/**
 * Choose a project cover from the same immutable reference images that shaped
 * its published 3D output. A published World uses its single source image;
 * object-only projects use up to four object reference images as a mosaic.
 */
export function selectProjectCoverAssets(
  files: Record<string, FileEntry> | undefined,
  jobs: readonly ProjectCoverJob[] = [],
): ProjectCoverSelection {
  const candidates = rasterCandidates(files ?? {})
  if (candidates.length === 0) return { kind: 'empty', images: [] }

  const byPath = new Map(candidates.map(candidate => [candidate.path, candidate]))
  const byAssetId = new Map(candidates.map(candidate => [candidate.asset_id, candidate]))
  const orderedJobs = [...jobs].sort((left, right) => jobTimestamp(right) - jobTimestamp(left))
  const worldAssetIds = uniquePaths(orderedJobs
    .filter(job => job.kind === 'world')
    .map(job => job.request_snapshot.provider_options?.source_asset_id ?? ''))
  const worldPaths = uniquePaths(orderedJobs
    .filter(job => job.kind === 'world')
    .map(job => job.request_snapshot.source_image_path ?? ''))
  const worldCover = worldAssetIds.map(assetId => byAssetId.get(assetId)).find(Boolean)
    ?? worldPaths.map(path => byPath.get(path)).find(Boolean)
  if (worldCover) return { kind: 'scene', images: [publicAsset(worldCover)] }

  const objectAssetIds = uniquePaths(orderedJobs
    .filter(job => job.kind === 'object')
    .flatMap(job => job.request_snapshot.provider_options?.source_asset_ids ?? []))
  const objectPaths = uniquePaths(orderedJobs
    .filter(job => job.kind === 'object')
    .flatMap(job => job.request_snapshot.input_image_paths ?? []))
  const objectCovers = [...objectAssetIds.map(assetId => byAssetId.get(assetId)), ...objectPaths.map(path => byPath.get(path))]
    .filter((candidate): candidate is RasterCandidate => Boolean(candidate))
    .filter((candidate, index, list) => list.findIndex(item => item?.asset_id === candidate.asset_id) === index)
    .slice(0, 4)
    .map(publicAsset)
  if (objectCovers.length > 0) return { kind: 'objects', images: objectCovers }

  const sceneFallback = candidates.find(candidate => {
    const filename = candidate.path.slice(SPATIAL_IMAGE_ROOT.length)
    return SCENE_IMAGE_HINT.test(filename)
  })
  if (sceneFallback) return { kind: 'scene', images: [publicAsset(sceneFallback)] }

  const fallback = candidates.slice(0, 4).map(publicAsset)
  return { kind: fallback.length > 1 ? 'objects' : 'images', images: fallback }
}

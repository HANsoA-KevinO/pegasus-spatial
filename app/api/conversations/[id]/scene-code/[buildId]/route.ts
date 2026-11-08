import { NextRequest, NextResponse } from 'next/server'
import { resolveLocalOwner } from '@/lib/local-owner'
import { cancelSceneCodeBuild, getSceneCodeBuild, readSceneBlob, streamScenePreviewBlob } from '@/lib/scene-code/repository'
import { sceneAssetManifest } from '@/lib/scene-code/types'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; buildId: string }> }) {
  const userId = await resolveLocalOwner(); if (userId instanceof Response) return userId
  const { id, buildId } = await params
  try {
    const build = await getSceneCodeBuild(buildId, { projectId: id, userId })
    if (build.status !== 'ready') return NextResponse.json({ status: build.status, error: build.error }, { status: 409 })
    const search = request.nextUrl.searchParams, resource = search.get('resource')
    if (!resource) return NextResponse.json({ build_id: build.build_id, seed: build.seed, source_hash: build.source_hash, assets: build.assets.map(sceneAssetManifest) })
    const asset = build.assets.find(asset => asset.alias === search.get('alias'))
    const blob = resource === 'bundle' ? build.bundle_blob_id : resource === 'asset' ? asset?.blob_id : null
    if (!blob) return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
    const headers = { 'content-type': resource === 'bundle' ? 'text/javascript' : asset!.mime_type, 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' }
    if (resource === 'asset' && asset?.preview_only) {
      return new Response(await streamScenePreviewBlob(blob, asset.sha256, build), { headers: { ...headers, 'content-length': String(asset.size_bytes) } })
    }
    return new Response(new Uint8Array(await readSceneBlob(blob, build)), { headers })
  } catch { return NextResponse.json({ error: 'Build not found' }, { status: 404 }) }
}
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; buildId: string }> }) {
  const userId = await resolveLocalOwner(); if (userId instanceof Response) return userId
  const { id, buildId } = await params
  try { const build = await cancelSceneCodeBuild(buildId, { projectId: id, userId }); return NextResponse.json({ build_id: build.build_id, status: build.status }) }
  catch { return NextResponse.json({ error: 'Build not found' }, { status: 404 }) }
}

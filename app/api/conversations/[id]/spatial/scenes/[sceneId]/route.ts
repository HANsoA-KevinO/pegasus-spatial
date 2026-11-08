import { NextRequest, NextResponse } from 'next/server'
import { resolveLocalOwner } from '@/lib/local-owner'
import { getCurrentSpatialSceneRevision, listSpatialSceneHistory, requireSpatialScene, SpatialSceneCommandRejectedError } from '@/lib/spatial'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; sceneId: string }> }) {
  const userId = await resolveLocalOwner(); if (userId instanceof Response) return userId
  const { id, sceneId } = await params
  try {
    const scene = await requireSpatialScene(sceneId, { projectId: id, userId })
    const search = new URL(request.url).searchParams
    const includeHistory = search.get('history') === '1'
    const requestedVersion = Number(search.get('version'))
    const needsHistory = includeHistory || (Number.isInteger(requestedVersion) && requestedVersion > 0)
    const history = needsHistory ? await listSpatialSceneHistory(scene.scene_id, { projectId: id, userId }) : undefined
    const revision = Number.isInteger(requestedVersion) && requestedVersion > 0
      ? history?.find(candidate => candidate.version === requestedVersion)
      : await getCurrentSpatialSceneRevision(scene)
    if (!revision) return NextResponse.json({ error: 'Scene revision not found' }, { status: 404 })
    return NextResponse.json({ scene, revision, ...(history ? { history } : {}) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof SpatialSceneCommandRejectedError ? 'Scene not found' : 'Unable to read Scene' }, { status: error instanceof SpatialSceneCommandRejectedError ? 404 : 500 })
  }
}

export async function PATCH() {
  return NextResponse.json({ error: '场景由 Agent 修改；请通过选中物体和截图提出意见。' }, { status: 405, headers: { Allow: 'GET' } })
}

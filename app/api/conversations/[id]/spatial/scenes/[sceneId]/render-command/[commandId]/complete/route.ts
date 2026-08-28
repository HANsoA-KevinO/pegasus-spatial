import { NextRequest, NextResponse } from 'next/server'
import { resolveLocalOwner } from '@/lib/local-owner'
import { completeSpatialRenderCommand, createSpatialObservation, getSpatialRenderCommand } from '@/lib/spatial'
import { getOwnedImageAsset } from '@/lib/media/storage'
import { toRasterAssetRef } from '@/lib/media/reference'
import { createScenePublicationWorkspace } from '@/lib/spatial/scene-workspace'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; sceneId: string; commandId: string }> }) {
  const userId = await resolveLocalOwner(); if (userId instanceof Response) return userId
  const { id, sceneId, commandId } = await params
  try {
    const body = await request.json() as { session_id?: unknown; command_lease_token?: unknown; asset_id?: unknown; visible_instance_ids?: unknown }
    if ([body.session_id, body.command_lease_token, body.asset_id].some(value => typeof value !== 'string')) return NextResponse.json({ error: 'invalid completion' }, { status: 400 })
    const asset = await getOwnedImageAsset(body.asset_id as string, userId, id)
    if (!asset) return NextResponse.json({ error: 'screenshot asset not found' }, { status: 404 })
    const existing = await getSpatialRenderCommand(commandId, { projectId: id, userId })
    if (!existing || existing.scene_id !== sceneId) return NextResponse.json({ error: 'render command not found' }, { status: 404 })
    const workspacePath = `output/spatial/reviews/${existing.observation_id}/view.png`
    const workspace = await createScenePublicationWorkspace({ conversationId: id, userId })
    await workspace.writeRaster(workspacePath, toRasterAssetRef(asset), 'Spatial Stage captured real pixels', { archive: false })
    const command = existing.status === 'completed' && existing.screenshot_asset_id === asset.assetId
      ? existing
      : await completeSpatialRenderCommand({ commandId, sessionId: body.session_id as string, leaseToken: body.command_lease_token as string, screenshotAssetId: asset.assetId, screenshotWorkspacePath: workspacePath })
    if (!command) return NextResponse.json({ error: 'render command lease lost' }, { status: 409 })
    if (command.scene_id !== sceneId || command.project_id !== id || command.user_id !== userId) {
      return NextResponse.json({ error: 'render command scope mismatch' }, { status: 403 })
    }
    const visibleInstanceIds = Array.isArray(body.visible_instance_ids)
      ? body.visible_instance_ids.filter((value): value is string => typeof value === 'string').slice(0, 500)
      : []
    await createSpatialObservation({
      observation_id: command.observation_id, scene_id: command.scene_id,
      project_id: command.project_id, user_id: command.user_id,
      revision_id: command.revision_id, source: 'agent', viewpoint: command.viewpoint,
      screenshot_asset_id: asset.assetId, screenshot_workspace_path: workspacePath,
      selected_instance_id: null, visible_instance_ids: visibleInstanceIds,
      comment: command.note ?? 'Agent 视角截图复核',
    })
    return NextResponse.json({ command })
  } catch { return NextResponse.json({ error: 'Unable to publish render result' }, { status: 500 }) }
}

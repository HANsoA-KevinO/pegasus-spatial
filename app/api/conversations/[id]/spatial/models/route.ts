import { NextRequest, NextResponse } from 'next/server'
import { resolveLocalOwner } from '@/lib/local-owner'
import { connectDB } from '@/lib/db/mongodb'
import { Conversation } from '@/lib/db/models'
import { listPublishedSpatialObjectModels } from '@/lib/spatial'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await resolveLocalOwner()
  if (userId instanceof Response) return userId
  const { id } = await params
  await connectDB()
  if (!await Conversation.exists({ conversation_id: id, user_id: userId })) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }
  try {
    const models = await listPublishedSpatialObjectModels({ projectId: id, userId })
    return NextResponse.json({ models })
  } catch {
    return NextResponse.json({ error: 'Unable to read spatial models' }, { status: 500 })
  }
}

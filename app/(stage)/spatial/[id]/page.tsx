'use client'

import { useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useChatContext } from '@/contexts/ChatContext'
import { useConversationTitle } from '@/hooks/useConversation'
import { SpatialStage } from '@/components/spatial-stage/SpatialStage'

export default function SpatialStagePage() {
  const { id } = useParams<{ id: string }>()
  const { conversationId, artifacts, isLoadingConversation, loadConversation } = useChatContext()
  const { title } = useConversationTitle(id)
  const loadRef = useRef(loadConversation)

  useEffect(() => { loadRef.current = loadConversation })
  useEffect(() => {
    if (id && conversationId !== id) loadRef.current(id)
  }, [conversationId, id])

  return (
    <SpatialStage
      conversationId={id}
      projectTitle={title}
      artifacts={conversationId === id ? artifacts : []}
      isProjectLoading={conversationId !== id || isLoadingConversation}
    />
  )
}

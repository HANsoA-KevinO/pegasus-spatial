'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ImageAttachment, ModelProvider } from '@/lib/types'
import { useChat, type ChatMessage } from '@/hooks/useChat'
import { buildArtifactsFromDB, useWorkspaceArtifacts, type WorkspaceArtifact } from '@/hooks/useWorkspaceArtifacts'
import {
  ROOT_AGENT_RUN_EVENT,
  type RootAgentRunEventDetail,
} from '@/hooks/useAgentTeam'
import type { QuotedSelection } from '@/components/chat/ChatContainer'
import type { SceneViewpoint } from '@/lib/spatial/scene-types'

const ACTIVE_CONVERSATION_KEY = 'pegasus_spatial_active_conversation_id'
const ACTIVE_ARTIFACT_KEY_PREFIX = 'pegasus_spatial_workspace_active_file:'
const ACTIVE_SCENE_KEY_PREFIX = 'pegasus_spatial_workspace_active_scene:'
const ACTIVE_MODEL_KEY_PREFIX = 'pegasus_spatial_workspace_active_model:'

export type SidebarView = 'projects' | 'scenes' | 'files'

export interface SpatialObservationDraft {
  conversationId: string
  sceneId: string
  sceneVersion: number
  revisionId: string
  selectedInstanceId: string | null
  selectedInstanceLabel?: string
  visibleInstanceIds: string[]
  viewpoint: SceneViewpoint
  image: { assetId: string; mimeType: string }
}

interface ChatContextValue {
  model: ModelProvider
  setModel: (model: ModelProvider) => void
  memoryEnabled: boolean
  setMemoryEnabled: (enabled: boolean) => void
  researchDomain: string
  setResearchDomain: (domain: string) => void
  messages: ChatMessage[]
  isLoading: boolean
  isLoadingConversation: boolean
  conversationId: string | null
  contextUsage: { compressible: number; threshold: number } | null
  runningConversationIds: Set<string>
  waitingForUserIds: Set<string>
  sendMessage: (
    text: string,
    images?: ImageAttachment[],
    interactionId?: string,
    researchDomainOverride?: string,
  ) => void
  stopGeneration: () => void
  loadConversation: (id: string) => void
  answerQuestion: (answer: string) => void
  resetChat: () => void
  artifacts: WorkspaceArtifact[]
  showWorkspace: boolean
  activeArtifactPath: string | null
  setActiveArtifactPath: (path: string | null) => void
  activeSceneId: string | null
  setActiveSceneId: (sceneId: string | null) => void
  activeModelId: string | null
  setActiveModelId: (modelId: string | null) => void
  spatialObservationDraft: SpatialObservationDraft | null
  setSpatialObservationDraft: (draft: SpatialObservationDraft | null) => void
  clearSpatialObservationDraft: () => void
  inFlightPaths: Set<string>
  quotedSelection: QuotedSelection | null
  setQuotedSelection: (selection: QuotedSelection | null) => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  sidebarView: SidebarView
  setSidebarView: (view: SidebarView) => void
  handleNewChat: () => void
  handleDeleteConversation: (id: string) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<ModelProvider>('main_standard')
  const [memoryEnabled, setMemoryEnabled] = useState(false)
  const [researchDomain, setResearchDomain] = useState('开放空间创作')
  const [quotedSelection, setQuotedSelection] = useState<QuotedSelection | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarView, setSidebarView] = useState<SidebarView>('projects')
  const [activeArtifactPath, setActiveArtifactPathState] = useState<string | null>(null)
  const [activeSceneId, setActiveSceneIdState] = useState<string | null>(null)
  const [activeModelId, setActiveModelIdState] = useState<string | null>(null)
  const [spatialObservationDraft, setSpatialObservationDraft] = useState<SpatialObservationDraft | null>(null)
  const previousConversationIdRef = useRef<string | null>(null)
  const handleConversationLoaded = useCallback((settings: {
    orchestrator_model?: string
    research_domain?: string
    memory_enabled?: boolean
  }) => {
    if (settings.orchestrator_model) setModel(settings.orchestrator_model as ModelProvider)
    if (settings.research_domain !== undefined) setResearchDomain(settings.research_domain)
    setMemoryEnabled(settings.memory_enabled === true)
  }, [])

  const chat = useChat({ model, memoryEnabled, researchDomain, onConversationLoaded: handleConversationLoaded })
  const activeConversationId = chat.conversationId
  const reconnectConversation = chat.loadConversation
  const updateCachedSettings = chat.updateCachedSettings
  const refreshConversationArtifacts = chat.refreshConversationArtifacts

  const handleMemoryToggle = useCallback((enabled: boolean) => {
    setMemoryEnabled(enabled)
    if (!activeConversationId) return
    void fetch(`/api/conversations/${activeConversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memory_enabled: enabled }),
    })
    updateCachedSettings(activeConversationId, { memory_enabled: enabled })
  }, [activeConversationId, updateCachedSettings])

  useEffect(() => {
    const handleRootAgentRun = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<RootAgentRunEventDetail>
      if (!event.detail?.conversationId || event.detail.conversationId !== activeConversationId) return
      // loadConversation paints the cache immediately, then either keeps the
      // existing subscriber or rehydrates Mongo before attaching to the newly
      // announced public Root stream. Member streams are never accepted here.
      reconnectConversation(event.detail.conversationId)
    }
    window.addEventListener(ROOT_AGENT_RUN_EVENT, handleRootAgentRun)
    return () => window.removeEventListener(ROOT_AGENT_RUN_EVENT, handleRootAgentRun)
  }, [activeConversationId, reconnectConversation])

  const assistantParts = useMemo(() => chat.messages.flatMap(message => (
    message.role === 'assistant' ? message.parts ?? [] : []
  )), [chat.messages])
  const timelineArtifacts = useWorkspaceArtifacts(assistantParts)
  const dbArtifacts = useMemo(
    () => chat.dbArtifactFields ? buildArtifactsFromDB(chat.dbArtifactFields) : [],
    [chat.dbArtifactFields],
  )
  const artifacts = useMemo(() => {
    const merged = new Map<string, WorkspaceArtifact>()
    for (const artifact of dbArtifacts) merged.set(artifact.path, artifact)
    for (const artifact of timelineArtifacts) merged.set(artifact.path, artifact)
    return Array.from(merged.values())
  }, [dbArtifacts, timelineArtifacts])

  const shouldWatchWorkspaceArtifacts = Boolean(
    activeConversationId
    && (
      sidebarView === 'scenes'
      || sidebarView === 'files'
      || chat.isLoading
      || chat.runningConversationIds.has(activeConversationId)
    ),
  )

  // Background spatial workers publish their files outside the chat SSE
  // process. Keep the currently visible asset catalog synchronized with the
  // authoritative Workspace projection, and refresh immediately when the tab
  // regains focus. This lets each completed model card appear without a manual
  // page reload while avoiding a heavyweight message re-hydration.
  useEffect(() => {
    if (!activeConversationId || !shouldWatchWorkspaceArtifacts) return
    const controller = new AbortController()
    let refreshing = false
    const refresh = async () => {
      if (refreshing || controller.signal.aborted) return
      refreshing = true
      try {
        await refreshConversationArtifacts(activeConversationId, controller.signal)
      } finally {
        refreshing = false
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_500)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [activeConversationId, refreshConversationArtifacts, shouldWatchWorkspaceArtifacts])

  const setActiveArtifactPath = useCallback((path: string | null) => {
    setActiveArtifactPathState(path)
    if (path) {
      setActiveSceneIdState(null)
      setActiveModelIdState(null)
      setSpatialObservationDraft(null)
    }
    if (!chat.conversationId) return
    try {
      const key = `${ACTIVE_ARTIFACT_KEY_PREFIX}${chat.conversationId}`
      if (path) localStorage.setItem(key, path)
      else localStorage.removeItem(key)
      if (path) localStorage.removeItem(`${ACTIVE_SCENE_KEY_PREFIX}${chat.conversationId}`)
      if (path) localStorage.removeItem(`${ACTIVE_MODEL_KEY_PREFIX}${chat.conversationId}`)
    } catch { /* localStorage may be unavailable in privacy modes */ }
  }, [chat.conversationId])

  const setActiveSceneId = useCallback((sceneId: string | null) => {
    setActiveSceneIdState(sceneId)
    setSpatialObservationDraft(null)
    if (sceneId) {
      setActiveArtifactPathState(null)
      setActiveModelIdState(null)
    }
    if (!chat.conversationId) return
    try {
      const key = `${ACTIVE_SCENE_KEY_PREFIX}${chat.conversationId}`
      if (sceneId) localStorage.setItem(key, sceneId)
      else localStorage.removeItem(key)
      if (sceneId) {
        localStorage.removeItem(`${ACTIVE_ARTIFACT_KEY_PREFIX}${chat.conversationId}`)
        localStorage.removeItem(`${ACTIVE_MODEL_KEY_PREFIX}${chat.conversationId}`)
      }
    } catch { /* localStorage may be unavailable in privacy modes */ }
  }, [chat.conversationId])

  const setActiveModelId = useCallback((modelId: string | null) => {
    setActiveModelIdState(modelId)
    setSpatialObservationDraft(null)
    if (modelId) {
      setActiveArtifactPathState(null)
      setActiveSceneIdState(null)
    }
    if (!chat.conversationId) return
    try {
      const key = `${ACTIVE_MODEL_KEY_PREFIX}${chat.conversationId}`
      if (modelId) localStorage.setItem(key, modelId)
      else localStorage.removeItem(key)
      if (modelId) {
        localStorage.removeItem(`${ACTIVE_ARTIFACT_KEY_PREFIX}${chat.conversationId}`)
        localStorage.removeItem(`${ACTIVE_SCENE_KEY_PREFIX}${chat.conversationId}`)
      }
    } catch { /* localStorage may be unavailable in privacy modes */ }
  }, [chat.conversationId])

  const clearSpatialObservationDraft = useCallback(() => setSpatialObservationDraft(null), [])

  // The active file belongs to a project, not to the global application. A
  // project switch restores its last file without letting newly streamed files
  // steal focus from whatever the user is currently reading.
  useEffect(() => {
    const nextConversationId = chat.conversationId
    const changedProject = previousConversationIdRef.current !== nextConversationId
    previousConversationIdRef.current = nextConversationId

    if (!nextConversationId) {
      setActiveArtifactPathState(null)
      setActiveSceneIdState(null)
      setActiveModelIdState(null)
      setSpatialObservationDraft(null)
      setSidebarView('projects')
      return
    }

    if (changedProject) {
      setQuotedSelection(null)
      setSpatialObservationDraft(null)
      let savedPath: string | null = null
      let savedSceneId: string | null = null
      let savedModelId: string | null = null
      try { savedPath = localStorage.getItem(`${ACTIVE_ARTIFACT_KEY_PREFIX}${nextConversationId}`) } catch { /* ignore */ }
      try { savedSceneId = localStorage.getItem(`${ACTIVE_SCENE_KEY_PREFIX}${nextConversationId}`) } catch { /* ignore */ }
      try { savedModelId = localStorage.getItem(`${ACTIVE_MODEL_KEY_PREFIX}${nextConversationId}`) } catch { /* ignore */ }
      setActiveSceneIdState(savedSceneId)
      setActiveModelIdState(savedSceneId ? null : savedModelId)
      setActiveArtifactPathState(savedSceneId || savedModelId ? null : savedPath)
      setSidebarView(savedSceneId || savedModelId ? 'scenes' : 'files')
    }
  }, [chat.conversationId])

  useEffect(() => {
    if (!chat.conversationId) return
    if (activeSceneId || activeModelId) {
      setActiveArtifactPathState(null)
      return
    }
    if (artifacts.length === 0) {
      setActiveArtifactPathState(null)
      return
    }
    setActiveArtifactPathState(current => {
      if (current && artifacts.some(artifact => artifact.path === current)) return current

      let savedPath: string | null = null
      try { savedPath = localStorage.getItem(`${ACTIVE_ARTIFACT_KEY_PREFIX}${chat.conversationId}`) } catch { /* ignore */ }
      const preferred = artifacts.find(artifact => artifact.path === savedPath)
        ?? artifacts.find(artifact => artifact.path === 'output/research-report.md')
        ?? artifacts.find(artifact => artifact.path === 'analysis/research-scope.md')
        ?? artifacts[0]
      try { localStorage.setItem(`${ACTIVE_ARTIFACT_KEY_PREFIX}${chat.conversationId}`, preferred.path) } catch { /* ignore */ }
      return preferred.path
    })
  }, [activeModelId, activeSceneId, artifacts, chat.conversationId])
  const showWorkspace = Boolean(activeSceneId || activeModelId) || artifacts.length > 0 || (chat.isLoading && chat.hasMutatorStarted)
  const inFlightPaths = useMemo(() => {
    const result = new Set<string>()
    for (const part of assistantParts) {
      if (part.type === 'tool_call' && part.pending && part.target_path) result.add(part.target_path)
    }
    return result
  }, [assistantParts])

  const handleNewChat = useCallback(() => {
    setQuotedSelection(null)
    setActiveArtifactPathState(null)
    setActiveSceneIdState(null)
    setActiveModelIdState(null)
    setSpatialObservationDraft(null)
    setSidebarView('projects')
    chat.resetChat()
  }, [chat])
  const handleDeleteConversation = useCallback((id: string) => {
    if (id === chat.conversationId) chat.resetChat()
  }, [chat])

  useEffect(() => {
    let savedId: string | null = null
    try { savedId = localStorage.getItem(ACTIVE_CONVERSATION_KEY) } catch { return }
    if (!savedId) return
    fetch(`/api/conversations/${savedId}`)
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (data?.is_running) chat.loadConversation(savedId as string)
        else localStorage.removeItem(ACTIVE_CONVERSATION_KEY)
      })
      .catch(() => {
        try { localStorage.removeItem(ACTIVE_CONVERSATION_KEY) } catch { /* ignore */ }
      })
  // Restore only once. useChat keeps loadConversation stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<ChatContextValue>(() => ({
    model,
    setModel,
    memoryEnabled,
    setMemoryEnabled: handleMemoryToggle,
    researchDomain,
    setResearchDomain,
    messages: chat.messages,
    isLoading: chat.isLoading,
    isLoadingConversation: chat.isLoadingConversation,
    conversationId: chat.conversationId,
    contextUsage: chat.contextUsage,
    runningConversationIds: chat.runningConversationIds,
    waitingForUserIds: chat.waitingForUserIds,
    sendMessage: chat.sendMessage,
    stopGeneration: chat.stopGeneration,
    loadConversation: chat.loadConversation,
    answerQuestion: chat.answerQuestion,
    resetChat: chat.resetChat,
    artifacts,
    showWorkspace,
    activeArtifactPath,
    setActiveArtifactPath,
    activeSceneId,
    setActiveSceneId,
    activeModelId,
    setActiveModelId,
    spatialObservationDraft,
    setSpatialObservationDraft,
    clearSpatialObservationDraft,
    inFlightPaths,
    quotedSelection,
    setQuotedSelection,
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarView,
    setSidebarView,
    handleNewChat,
    handleDeleteConversation,
  }), [
    model, memoryEnabled, handleMemoryToggle, researchDomain, chat.messages, chat.isLoading, chat.isLoadingConversation,
    chat.conversationId, chat.contextUsage, chat.runningConversationIds,
    chat.waitingForUserIds, chat.sendMessage, chat.stopGeneration,
    chat.loadConversation, chat.answerQuestion, chat.resetChat,
    artifacts, showWorkspace, activeArtifactPath, setActiveArtifactPath,
    activeSceneId, setActiveSceneId, activeModelId, setActiveModelId, spatialObservationDraft, clearSpatialObservationDraft,
    inFlightPaths, quotedSelection, sidebarCollapsed, sidebarView,
    handleNewChat, handleDeleteConversation,
  ])

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChatContext() {
  const context = useContext(ChatContext)
  if (!context) throw new Error('useChatContext must be used within ChatProvider')
  return context
}

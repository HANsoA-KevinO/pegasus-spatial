'use client'

import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { WorkspaceArtifact } from '@/hooks/useWorkspaceArtifacts'
import type { QuotedSelection } from '@/components/chat/ChatContainer'
import { useChatContext } from '@/contexts/ChatContext'
import { useGridFSContent } from '@/hooks/useGridFSContent'
import { useConversationTitle } from '@/hooks/useConversation'
import { ShimmerBlock } from '@/components/loading/Skeleton'
import { SpatialStage } from '@/components/spatial-stage/SpatialStage'
import { ArtifactLoadingOverlay } from './ArtifactLoadingOverlay'
import { LiteraturePaperReader } from './LiteraturePaperReader'
import { parseLiteratureArtifactPath } from './literature-paper-model'
import {
  SpatialImageViewer,
  SpatialModelViewer,
  SpatialWorldViewer,
} from './SpatialArtifactViewers'

interface WorkspacePanelProps {
  artifacts: WorkspaceArtifact[]
  isStreaming: boolean
  onQuoteSelection?: (selection: QuotedSelection) => void
  quotedSelection?: QuotedSelection | null
}

export function WorkspacePanel({ artifacts, isStreaming, onQuoteSelection }: WorkspacePanelProps) {
  const {
    activeArtifactPath,
    activeSceneId,
    conversationId,
  } = useChatContext()
  const { title: projectTitle } = useConversationTitle(conversationId)
  const active = artifacts.find(item => item.path === activeArtifactPath) ?? artifacts[0]
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [active?.path])

  if (activeSceneId && conversationId) {
    return (
      <section
        className="relative h-full min-h-0 min-w-0 overflow-hidden border-r border-[var(--glass-panel-border)]"
        data-workspace-stage-container
      >
        <SpatialStage
          embedded
          sceneId={activeSceneId}
          conversationId={conversationId}
          projectTitle={projectTitle}
          artifacts={artifacts}
          isProjectLoading={isStreaming}
        />
      </section>
    )
  }

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center p-4" data-workspace-canvas>
        <div className="text-center">
          {isStreaming && <span className="mx-auto mb-4 block h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />}
          <p className="text-sm font-medium text-ink-secondary">{isStreaming ? 'Agent 正在构建空间产物…' : '空间产物会显示在这里'}</p>
          <p className="mt-1 text-xs text-ink-muted">生成图、GLB 物体、World manifest 与可观察评审</p>
        </div>
      </div>
    )
  }
  return (
    <section className="flex h-full min-w-0 flex-col border-r border-[var(--glass-panel-border)]" data-workspace-canvas>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <ArtifactBody artifact={active} onQuoteSelection={onQuoteSelection} />
      </div>
    </section>
  )
}

function ArtifactBody({ artifact, onQuoteSelection }: {
  artifact: WorkspaceArtifact
  onQuoteSelection?: (selection: QuotedSelection) => void
}) {
  const {
    conversationId,
    inFlightPaths,
    artifacts,
    setActiveArtifactPath,
  } = useChatContext()
  const beingEdited = inFlightPaths.has(artifact.path)
  const lazy = useGridFSContent(conversationId, artifact.path, !!artifact.gridfsPending && !beingEdited)
  const content = artifact.content || lazy.content

  if (beingEdited) return <ArtifactLoadingOverlay artifact={artifact} />
  if (artifact.gridfsPending && lazy.isLoading && !content) {
    return <div className="flex h-full flex-col gap-3 p-8"><ShimmerBlock className="w-1/3" h={24} /><ShimmerBlock className="flex-1" /></div>
  }
  if (lazy.error) {
    return <div className="p-8 text-sm text-error">无法加载该产物：{lazy.error}</div>
  }
  if (artifact.type === 'image') {
    return conversationId
      ? <SpatialImageViewer key={artifact.path} artifact={artifact} conversationId={conversationId} />
      : <div className="p-8 text-sm text-error">图片所属项目尚未加载。</div>
  }
  if (artifact.type === 'model3d') {
    return conversationId
      ? <SpatialModelViewer artifact={artifact} conversationId={conversationId} />
      : <div className="p-8 text-sm text-error">3D 资产所属项目尚未加载。</div>
  }
  if (artifact.type === 'world') {
    return conversationId
      ? <SpatialWorldViewer artifact={artifact} conversationId={conversationId} content={content} />
      : <div className="p-8 text-sm text-error">世界资产所属项目尚未加载。</div>
  }
  if (parseLiteratureArtifactPath(artifact.path)) {
    return (
      <LiteraturePaperReader
        activeArtifact={artifact}
        content={content}
        allArtifacts={artifacts}
        conversationId={conversationId}
        setActivePath={setActiveArtifactPath}
        onQuoteSelection={onQuoteSelection}
      />
    )
  }
  if (artifact.type === 'document') {
    return <DocumentArtifactBody artifact={artifact} conversationId={conversationId} />
  }

  const captureSelection = () => {
    const selected = window.getSelection()?.toString().trim()
    if (selected && onQuoteSelection) {
      onQuoteSelection({ path: artifact.path, content: selected })
      window.getSelection()?.removeAllRanges()
    }
  }
  return (
    <article
      onMouseUp={captureSelection}
      className="min-h-full px-8 py-7"
      data-workspace-content="unframed"
    >
      {artifact.type === 'markdown' ? (
        <div className="prose prose-sm mx-auto max-w-[76ch] text-ink">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-ink-secondary">{content}</pre>
      )}
    </article>
  )
}

function formatBytes(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '未知大小'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function safeExternalUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function DocumentArtifactBody({ artifact, conversationId }: {
  artifact: WorkspaceArtifact
  conversationId: string | null
}) {
  if (!conversationId || !artifact.sha256) {
    return <div className="p-8 text-sm text-error">该原始文献暂时无法打开。</div>
  }

  const baseUrl = `/api/conversations/${encodeURIComponent(conversationId)}/files/binary?path=${encodeURIComponent(artifact.path)}&v=${encodeURIComponent(artifact.sha256)}`
  const sourceUrl = safeExternalUrl(artifact.source?.canonical_url)
  const isPdf = artifact.mimeType === 'application/pdf'

  return (
    <section className="flex h-full min-h-[520px] flex-col" data-workspace-content="unframed">
      <header className="shrink-0 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink" title={artifact.filename}>{artifact.filename ?? artifact.label}</h2>
            <p className="mt-1 text-xs text-ink-muted">
              {[artifact.mimeType, formatBytes(artifact.sizeBytes), artifact.source?.provider].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {sourceUrl && (
              <a href={sourceUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-outline-variant/20 px-3 py-2 text-xs font-medium text-ink-secondary transition hover:bg-surface-low">
                查看来源
              </a>
            )}
            <a href={`${baseUrl}&download=1`} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary transition hover:opacity-90">
              下载原文
            </a>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted">
          <span title={artifact.sha256}>SHA-256 {artifact.sha256.slice(0, 12)}…</span>
          {artifact.provenance?.retrieved_at && <span>获取于 {new Date(artifact.provenance.retrieved_at).toLocaleString()}</span>}
          {artifact.provenance?.license && <span>许可 {artifact.provenance.license}</span>}
        </div>
      </header>
      {isPdf ? (
        <iframe
          src={baseUrl}
          title={artifact.filename ?? artifact.label}
          className="min-h-0 flex-1 border-0 bg-white"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-ink-muted">
          此文档类型暂不支持内嵌预览，请下载原文件查看。
        </div>
      )}
    </section>
  )
}

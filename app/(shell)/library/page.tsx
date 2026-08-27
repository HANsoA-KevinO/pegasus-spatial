'use client'

import { useRouter } from 'next/navigation'
import { useChatContext } from '@/contexts/ChatContext'
import { useProjects } from '@/hooks/useProjects'
import { ProjectCard } from '@/components/library/ProjectCard'
import { ShimmerBlock } from '@/components/loading/Skeleton'

export default function LibraryPage() {
  const router = useRouter()
  const { loadConversation } = useChatContext()
  const {
    projects,
    page,
    totalPages,
    isLoading,
    loadMore,
    deleteProject,
    renameProject,
  } = useProjects()

  const handleSelect = (id: string) => {
    loadConversation(id)
    router.push('/')
  }

  return (
    <div className="h-full flex-1 overflow-y-auto bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-8 lg:px-10 lg:py-10">
        <header className="mb-7">
          <div>
            <h1 className="text-title font-semibold tracking-tight text-ink">空间创作项目库</h1>
            <p className="mt-2 text-sm text-ink-secondary">
              管理创作简报、持久任务、空间资产与修订关系
            </p>
          </div>
        </header>

        {projects.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map(project => (
              <ProjectCard
                key={project.conversation_id}
                project={project}
                onSelect={handleSelect}
                onDelete={deleteProject}
                onRename={renameProject}
              />
            ))}
          </div>
        ) : isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex min-h-[176px] flex-col rounded-[14px] border border-[var(--glass-panel-border)] bg-[var(--glass-panel-bg)] p-5"
                style={{ boxShadow: 'var(--shadow-ambient)' }}
              >
                <ShimmerBlock className="mb-5 h-10 w-10 rounded-xl" />
                <div className="mt-auto">
                  <ShimmerBlock className="mb-2 w-3/4" h={15} />
                  <ShimmerBlock className="w-1/2" h={11} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[16px] border border-dashed border-ghost-border/75 bg-surface-lowest/55 py-20 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-ctrl bg-surface-low">
              <svg className="h-8 w-8 text-ink-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
              </svg>
            </div>
            <p className="text-sm text-ink-muted">暂无项目</p>
          </div>
        )}

        {page < totalPages && (
          <div className="mt-8 text-center">
            <button
              onClick={loadMore}
              disabled={isLoading}
              className="rounded-ctrl px-6 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
            >
              {isLoading ? '加载中...' : '加载更多'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

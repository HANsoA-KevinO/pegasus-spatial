'use client'

import { useEffect, useRef, useState } from 'react'
import type { ProjectSummary } from '@/hooks/useProjects'

interface ProjectCardProps {
  project: ProjectSummary
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => Promise<boolean> | void
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function ProjectCard({ project, onSelect, onDelete, onRename }: ProjectCardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])
  const value = draft ?? project.title
  const commit = () => {
    const next = value.trim()
    if (next && next !== project.title) void onRename(project.conversation_id, next)
    setDraft(null)
    setEditing(false)
  }
  const fileCount = Object.keys(project.output?.files ?? {}).length

  return (
    <article onClick={() => { if (!editing) onSelect(project.conversation_id) }} className="group relative flex min-h-[176px] cursor-pointer flex-col overflow-hidden rounded-[14px] border border-[var(--glass-panel-border)] bg-[var(--glass-panel-bg)] p-5 shadow-[var(--shadow-glass)] transition hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[var(--shadow-hover)]">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-[linear-gradient(90deg,var(--primary),transparent_70%)] opacity-65" />
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.7"><path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v12.5H7.5A2.5 2.5 0 0 1 5 17V4.5Z"/><path d="M8 8h7M8 11.5h7M8 15h4" strokeLinecap="round"/></svg>
        </div>
        {!editing && (
          <div className="flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
            <button type="button" title="重命名" onClick={event => { event.stopPropagation(); setEditing(true) }} className="rounded-lg bg-surface-low px-2 py-1 text-xs text-ink-muted hover:text-ink">改名</button>
            <button type="button" title="删除" onClick={event => { event.stopPropagation(); onDelete(project.conversation_id) }} className="rounded-lg bg-surface-low px-2 py-1 text-xs text-ink-muted hover:text-error">删除</button>
          </div>
        )}
      </div>
      {editing ? (
        <input ref={inputRef} value={value} maxLength={200} onChange={event => setDraft(event.target.value)} onClick={event => event.stopPropagation()} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') commit(); if (event.key === 'Escape') setEditing(false) }} className="mb-2 w-full rounded-lg bg-surface-low px-2 py-1 text-sm font-semibold text-ink outline-none" />
      ) : (
        <h3 onDoubleClick={event => { event.stopPropagation(); setEditing(true) }} className="line-clamp-2 text-base font-semibold leading-6 text-ink">{project.title}</h3>
      )}
      {project.settings?.research_domain && (
        <span className="mt-2 w-fit max-w-full truncate rounded-full bg-primary/8 px-2 py-1 text-[11px] text-primary">{project.settings.research_domain}</span>
      )}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-ghost-border/55 pt-3 text-[11px] text-ink-muted">
        <span>{fileCount > 0 ? `${fileCount} 个文件` : '尚无文件'}</span>
        <span>更新于 {formatDate(project.updated_at)}</span>
      </div>
    </article>
  )
}

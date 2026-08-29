'use client'

import { useEffect, useRef, useState } from 'react'
import { ProgressiveImage } from '@/components/media/ProgressiveImage'
import type { ProjectSummary } from '@/hooks/useProjects'
import { buildBrowserMediaUrl } from '@/lib/media/browser-url'

interface ProjectCardProps {
  project: ProjectSummary
  onSelect: (id: string) => void
  onDelete: (id: string) => Promise<boolean> | void
  onRename: (id: string, title: string) => Promise<boolean> | void
}

function formatCreatedDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '创建时间未知'
  return `创建于 ${new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)}`
}

function mosaicGridClass(count: number): string {
  if (count === 2) return 'grid-cols-2 grid-rows-1'
  if (count === 3) return 'grid-cols-[1.6fr_1fr] grid-rows-2'
  if (count >= 4) return 'grid-cols-2 grid-rows-2'
  return 'grid-cols-1 grid-rows-1'
}

function mosaicCellClass(count: number, index: number): string {
  return count === 3 && index === 0 ? 'row-span-2' : ''
}

function ProjectCover({ project }: { project: ProjectSummary }) {
  const images = (project.cover_images ?? []).slice(0, 4)
  if (images.length === 0) {
    return (
      <div
        data-project-cover-fallback
        className="absolute inset-0 grid place-items-center overflow-hidden bg-[radial-gradient(circle_at_28%_20%,color-mix(in_srgb,var(--primary)_16%,transparent),transparent_45%),linear-gradient(145deg,var(--surface-lowest),var(--surface-mid))]"
      >
        <div className="grid place-items-center gap-2 text-ink-muted/55">
          <svg className="h-11 w-11" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <path d="m8 33 10-12 7 8 5-6 10 10" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 12h32v24H8z" />
            <circle cx="34" cy="18" r="3" />
          </svg>
          <span className="text-[11px] font-medium tracking-[0.08em]">等待视觉成果</span>
        </div>
      </div>
    )
  }

  return (
    <div
      data-project-cover-count={images.length}
      className={`absolute inset-0 grid gap-px bg-black/20 ${mosaicGridClass(images.length)}`}
      aria-hidden="true"
    >
      {images.map((image, index) => (
        <ProgressiveImage
          key={`${image.asset_id}:${image.path}`}
          src={buildBrowserMediaUrl(image.asset_id, 'thumbnail')}
          alt=""
          fit="cover"
          loading="lazy"
          frameClassName={`h-full min-h-0 w-full min-w-0 ${mosaicCellClass(images.length, index)}`}
          imageClassName="h-full w-full scale-[1.01] object-cover transition-transform duration-500 ease-out group-hover:scale-[1.035]"
        />
      ))}
    </div>
  )
}

export function ProjectCard({ project, onSelect, onDelete, onRename }: ProjectCardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)
  const cancelledRenameRef = useRef(false)
  const menuId = `project-actions-${project.conversation_id}`
  const value = draft ?? project.title

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  useEffect(() => {
    if (!menuOpen) return
    const focusTimer = window.setTimeout(() => menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(), 0)
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) {
        setMenuOpen(false)
        setConfirmingDelete(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      setConfirmingDelete(false)
      window.setTimeout(() => menuButtonRef.current?.focus(), 0)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const restoreMenuButtonFocus = () => {
    window.setTimeout(() => menuButtonRef.current?.focus(), 0)
  }

  const commitRename = async () => {
    const next = value.trim()
    setDraft(null)
    setEditing(false)
    restoreMenuButtonFocus()
    if (!next || next === project.title) return
    try {
      const renamed = await Promise.resolve(onRename(project.conversation_id, next))
      if (renamed === false) setActionError('重命名失败，请稍后重试。')
    } catch {
      setActionError('重命名失败，请稍后重试。')
    }
  }

  const startRename = () => {
    setMenuOpen(false)
    setConfirmingDelete(false)
    setActionError('')
    setDraft(project.title)
    cancelledRenameRef.current = false
    setEditing(true)
  }

  const cancelRename = () => {
    cancelledRenameRef.current = true
    setDraft(null)
    setEditing(false)
    restoreMenuButtonFocus()
  }

  const deleteProject = async () => {
    setDeleting(true)
    setActionError('')
    try {
      const deleted = await Promise.resolve(onDelete(project.conversation_id))
      if (deleted !== false) return
      setConfirmingDelete(false)
      setActionError('删除失败；若项目仍在运行，请先停止 Agent。')
      window.setTimeout(() => deleteButtonRef.current?.focus(), 0)
    } catch {
      setConfirmingDelete(false)
      setActionError('删除失败；若项目仍在运行，请先停止 Agent。')
      window.setTimeout(() => deleteButtonRef.current?.focus(), 0)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <article
      data-project-card
      data-cover-kind={project.cover_kind ?? 'empty'}
      className={`group relative transition duration-300 ${menuOpen ? 'z-30' : 'hover:-translate-y-1'}`}
    >
      <div className="relative aspect-[16/10] overflow-hidden rounded-[18px] border border-[var(--glass-panel-border)] bg-[var(--glass-panel-bg)] shadow-[var(--shadow-glass)] transition duration-300 group-hover:border-primary/35 group-hover:shadow-[var(--shadow-hover)]">
        <ProjectCover project={project} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[2] bg-[linear-gradient(180deg,rgba(9,12,20,0.72)_0%,rgba(9,12,20,0.08)_43%,rgba(9,12,20,0.72)_100%)]" />

        <button
          type="button"
          disabled={editing || menuOpen}
          onClick={() => {
            if (!editing && !menuOpen) onSelect(project.conversation_id)
          }}
          aria-label={`打开项目：${project.title}`}
          className="absolute inset-0 z-10 rounded-[18px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-primary disabled:cursor-default"
        />

        <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 p-4 pr-16">
          {editing ? (
            <input
              ref={inputRef}
              value={value}
              maxLength={200}
              aria-label={`重命名项目：${project.title}`}
              onChange={event => setDraft(event.target.value)}
              onBlur={() => {
                if (cancelledRenameRef.current) {
                  cancelledRenameRef.current = false
                  return
                }
                void commitRename()
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelRename()
                }
              }}
              className="pointer-events-auto w-full rounded-[9px] border border-white/25 bg-black/45 px-3 py-2 text-[15px] font-semibold text-white outline-none backdrop-blur-xl focus:border-white/60"
            />
          ) : (
            <h3 className="line-clamp-2 max-w-full text-[16px] font-semibold leading-6 tracking-[0.01em] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.75)]">
              {project.title}
            </h3>
          )}
        </div>

        <time
          dateTime={project.created_at}
          className="pointer-events-none absolute bottom-3.5 right-3.5 z-20 rounded-full border border-white/15 bg-black/32 px-2.5 py-1 text-[11px] font-medium tracking-[0.02em] text-white/85 shadow-sm backdrop-blur-md"
        >
          {formatCreatedDate(project.created_at)}
        </time>
      </div>

      <button
        ref={menuButtonRef}
        type="button"
        aria-label={`项目操作：${project.title}`}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        onClick={() => {
          setConfirmingDelete(false)
          setMenuOpen(open => !open)
        }}
        className="absolute right-3 top-3 z-40 grid h-9 w-9 place-items-center rounded-full border border-white/18 bg-black/38 text-white/85 shadow-lg backdrop-blur-xl transition hover:bg-black/55 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="8" cy="13" r="1.25" />
        </svg>
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          id={menuId}
          role={confirmingDelete ? 'alertdialog' : 'dialog'}
          aria-label={`项目操作：${project.title}`}
          aria-describedby={confirmingDelete ? `${menuId}-description` : undefined}
          onBlurCapture={event => {
            const nextTarget = event.relatedTarget as Node | null
            if (nextTarget && !event.currentTarget.contains(nextTarget) && !menuButtonRef.current?.contains(nextTarget)) {
              setMenuOpen(false)
              setConfirmingDelete(false)
            }
          }}
          className="absolute right-3 top-14 z-50 w-60 rounded-[12px] border border-[var(--glass-panel-border)] bg-[var(--glass-panel-bg)] p-1.5 text-sm shadow-[var(--shadow-hover)] backdrop-blur-2xl"
        >
          {confirmingDelete ? (
            <div className="p-2">
              <p className="font-semibold text-ink">确认删除这个项目？</p>
              <p id={`${menuId}-description`} className="mt-1 text-xs leading-5 text-ink-muted">项目及其工作空间数据将被删除，此操作不可撤销。</p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  ref={cancelDeleteRef}
                  type="button"
                  disabled={deleting}
                  onClick={() => {
                    setConfirmingDelete(false)
                    window.setTimeout(() => deleteButtonRef.current?.focus(), 0)
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-low hover:text-ink"
                >取消</button>
                <button type="button" disabled={deleting} onClick={() => void deleteProject()} className="rounded-lg bg-error px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-55">{deleting ? '删除中…' : '确认删除'}</button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" onClick={startRename} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left font-medium text-ink-secondary transition hover:bg-surface-low hover:text-ink">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12.9 3.5 3.6 3.6L7.3 16.3l-4.1.5.5-4.1 9.2-9.2Z" strokeLinejoin="round" /><path d="m11.6 4.8 3.6 3.6" /></svg>
                重命名
              </button>
              <div className="my-1 h-px bg-ghost-border/60" />
              <button
                ref={deleteButtonRef}
                type="button"
                onClick={() => {
                  setActionError('')
                  setConfirmingDelete(true)
                  window.setTimeout(() => cancelDeleteRef.current?.focus(), 0)
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left font-medium text-error transition hover:bg-error/8"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4.5 6.5h11M8 3.5h4l.8 1.5H16M6.2 6.5l.6 10h6.4l.6-10M8.5 9v4.5M11.5 9v4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                删除项目
              </button>
            </>
          )}
        </div>
      )}

      {actionError && (
        <p className="mt-2 rounded-lg bg-error/8 px-3 py-2 text-xs leading-5 text-error" role="alert">
          {actionError}
        </p>
      )}
    </article>
  )
}

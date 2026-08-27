'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useChatContext } from '@/contexts/ChatContext'
import { useModels } from '@/hooks/useModels'
import { useConversations } from '@/hooks/useConversation'
import type { ImageAttachment, ModelProvider } from '@/lib/types'
import { buildBrowserMediaUrl } from '@/lib/media/browser-url'
import { ProgressiveImage } from '@/components/media/ProgressiveImage'
import { BrandMark } from '@/components/shell/BrandMark'

const DEFAULT_CREATION_CONTEXT = '开放空间创作'
const QUESTION_MIN_HEIGHT = 104
const QUESTION_MAX_HEIGHT = 220
const MAX_ATTACHMENTS = 6
const MAX_IMAGE_FILE_SIZE = 20 * 1024 * 1024
const MAX_TEXT_FILE_SIZE = 256 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml',
  'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'sh', 'sql',
])
const ACCEPTED_UPLOAD_TYPES = [
  ...IMAGE_TYPES,
  ...Array.from(TEXT_EXTENSIONS, extension => `.${extension}`),
]

interface WorkbenchTextAttachment {
  name: string
  mimeType: string
  content: string
}

type PendingAttachment =
  | {
      id: string
      kind: 'image'
      name: string
      mimeType: string
      size: number
      image: ImageAttachment
    }
  | {
      id: string
      kind: 'text'
      name: string
      mimeType: string
      size: number
      content: string
    }

function useAutoResizeTextarea(value: string, minHeight: number, maxHeight: number) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.overflowY = 'hidden'
    textarea.style.height = `${minHeight}px`

    const contentHeight = textarea.scrollHeight
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, contentHeight))

    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden'
  }, [maxHeight, minHeight, value])

  return textareaRef
}

function fileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

function isTextAttachment(file: File): boolean {
  return file.type.startsWith('text/')
    || ['application/json', 'application/xml', 'application/yaml', 'application/x-yaml', 'application/javascript'].includes(file.type)
    || TEXT_EXTENSIONS.has(fileExtension(file.name))
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function buildResearchProjectMessage(
  question: string,
  domain: string,
  context: string,
  textAttachments: WorkbenchTextAttachment[] = [],
): string {
  const fileContext = textAttachments.map(file => [
    `<reference-file name="${escapeAttribute(file.name)}" mime_type="${escapeAttribute(file.mimeType || 'text/plain')}">`,
    file.content.trim(),
    '</reference-file>',
  ].join('\n')).join('\n\n')

  return [
    `空间创作目标：${question.trim()}`,
    `创作语境：${domain}`,
    context.trim() ? `已有素材与约束：\n${context.trim()}` : '',
    fileContext ? `上传的参考文件：\n${fileContext}` : '',
  ].filter(Boolean).join('\n\n')
}

export function TaskWorkbench({ onSubmit }: {
  onSubmit: (message: string, domain: string, images?: ImageAttachment[]) => void
}) {
  const [question, setQuestion] = useState('')
  const [modelOptionsOpen, setModelOptionsOpen] = useState(false)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)
  const [attachmentError, setAttachmentError] = useState('')
  const questionRef = useAutoResizeTextarea(question, QUESTION_MIN_HEIGHT, QUESTION_MAX_HEIGHT)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modelControlRef = useRef<HTMLDivElement>(null)
  const { model, setModel, loadConversation } = useChatContext()
  const { models, isLoading: modelsLoading } = useModels()
  const { conversations } = useConversations()
  const hasSidebarContent = conversations.length > 0
  const selectedModel = models.find(item => item.id === model)
  const selectedModelName = selectedModel?.name ?? (modelsLoading ? '正在读取模型…' : model)
  const pendingImages = attachments.filter((item): item is Extract<PendingAttachment, { kind: 'image' }> => item.kind === 'image')
  const pendingTextFiles = attachments.filter((item): item is Extract<PendingAttachment, { kind: 'text' }> => item.kind === 'text')
  const hasUnsupportedImages = pendingImages.length > 0 && !modelsLoading && selectedModel?.supportsVision !== true

  useEffect(() => {
    if (!modelOptionsOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!modelControlRef.current?.contains(event.target as Node)) setModelOptionsOpen(false)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setModelOptionsOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [modelOptionsOpen])

  useEffect(() => {
    if (hasUnsupportedImages) {
      setAttachmentError('当前模型不支持图片。附件已保留，请在“推理模型”中切换到多模态模型。')
    } else if (attachmentError.startsWith('当前模型不支持图片')) {
      setAttachmentError('')
    }
  }, [attachmentError, hasUnsupportedImages])

  const processFiles = useCallback(async (files: File[]) => {
    const remaining = Math.max(0, MAX_ATTACHMENTS - attachments.length)
    const candidates = files.slice(0, remaining)
    if (candidates.length === 0) {
      setAttachmentError(`最多添加 ${MAX_ATTACHMENTS} 个参考文件。`)
      return
    }

    setAttachmentError(files.length > remaining ? `最多添加 ${MAX_ATTACHMENTS} 个参考文件，多余文件已忽略。` : '')
    setUploadingCount(candidates.length)
    const accepted: PendingAttachment[] = []
    const errors: string[] = []

    for (const file of candidates) {
      const id = `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`
      try {
        if (IMAGE_TYPES.includes(file.type)) {
          if (file.size > MAX_IMAGE_FILE_SIZE) {
            errors.push(`${file.name} 超过 20MB`)
            continue
          }
          const form = new FormData()
          form.append('file', file)
          const response = await fetch('/api/media/upload', { method: 'POST', body: form })
          const payload = await response.json().catch(() => ({})) as { error?: string; image?: ImageAttachment }
          if (!response.ok || !payload.image || !('assetId' in payload.image)) {
            throw new Error(payload.error ?? '图片上传失败')
          }
          accepted.push({
            id,
            kind: 'image',
            name: file.name,
            mimeType: payload.image.mimeType,
            size: file.size,
            image: payload.image,
          })
          continue
        }

        if (!isTextAttachment(file)) {
          errors.push(`${file.name} 的格式暂不支持`)
          continue
        }
        if (file.size > MAX_TEXT_FILE_SIZE) {
          errors.push(`${file.name} 超过 256KB`)
          continue
        }
        accepted.push({
          id,
          kind: 'text',
          name: file.name,
          mimeType: file.type || 'text/plain',
          size: file.size,
          content: (await file.text()).replaceAll('\0', ''),
        })
      } catch (cause) {
        errors.push(`${file.name}：${cause instanceof Error ? cause.message : '上传失败'}`)
      }
    }

    setAttachments(current => [...current, ...accepted].slice(0, MAX_ATTACHMENTS))
    setUploadingCount(0)
    if (errors.length > 0) setAttachmentError(errors.join('；'))
  }, [attachments.length])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) void processFiles(files)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) void processFiles(files)
  }

  const removeAttachment = (id: string) => {
    setAttachments(current => current.filter(item => item.id !== id))
    setAttachmentError('')
  }

  const submit = () => {
    const trimmed = question.trim()
    if (!trimmed || uploadingCount > 0 || hasUnsupportedImages) return
    const message = buildResearchProjectMessage(
      trimmed,
      DEFAULT_CREATION_CONTEXT,
      '',
      pendingTextFiles.map(file => ({ name: file.name, mimeType: file.mimeType, content: file.content })),
    )
    onSubmit(
      message,
      DEFAULT_CREATION_CONTEXT,
      pendingImages.length > 0 ? pendingImages.map(item => item.image) : undefined,
    )
  }

  const canSubmit = Boolean(question.trim()) && uploadingCount === 0 && !hasUnsupportedImages

  return (
    <div className="relative h-full w-full overflow-y-auto bg-surface px-6 py-7 lg:px-12 lg:py-9">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-55 dark:opacity-35 [background-size:36px_36px]"
        style={{
          backgroundImage: [
            'linear-gradient(color-mix(in srgb, var(--primary) 10%, transparent) 1px, transparent 1px)',
            'linear-gradient(90deg, color-mix(in srgb, var(--primary) 10%, transparent) 1px, transparent 1px)',
          ].join(','),
        }}
      />
      <div className={`relative mx-auto grid gap-6 ${hasSidebarContent ? 'max-w-6xl xl:grid-cols-[minmax(0,1fr)_300px]' : 'max-w-4xl'}`}>
        <section className="rounded-[12px] border border-[var(--paper-edge)] bg-[var(--paper)] p-5 shadow-[var(--shadow-paper)] lg:p-7">
          <header className="mb-5 flex items-start gap-3">
            <BrandMark className="mt-0.5 h-10 w-10 shrink-0" />
            <div>
              <h1 className="text-[28px] font-bold tracking-[-0.035em] text-ink lg:text-[31px]">描述一个想进入的世界</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-secondary">
                说清体验与约束，Agent 会选择合适的图像、3D 造物和世界生成工具。
              </p>
            </div>
          </header>

          <div className="overflow-visible rounded-[14px] border border-ghost-border/75 bg-surface-lowest p-3.5 shadow-[0_12px_36px_color-mix(in_srgb,var(--ink)_8%,transparent)] sm:p-4">
            <span className="mb-2 block text-sm font-semibold text-ink">你想创造什么？</span>
            <div
              id="workbench-composer"
              onDrop={handleDrop}
              onDragOver={event => event.preventDefault()}
              className="overflow-visible rounded-[11px] border border-ghost-border/70 bg-surface transition-[border-color,box-shadow] focus-within:border-primary/70 focus-within:ring-4 focus-within:ring-primary/15"
            >
              <textarea
                ref={questionRef}
                aria-label="你想创造什么？"
                value={question}
                onChange={event => setQuestion(event.target.value)}
                onKeyDown={event => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault()
                    submit()
                  }
                }}
                placeholder="描述空间、用途、材质、光线、镜头与必须保留的元素，例如：一间狭长的深夜电台，低照度钨丝灯、吸音木墙和环形直播控制台。"
                className="block w-full resize-none overflow-y-hidden rounded-t-[10px] bg-transparent px-3.5 pb-2 pt-3 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-muted"
                style={{ minHeight: QUESTION_MIN_HEIGHT, maxHeight: QUESTION_MAX_HEIGHT }}
              />

              {attachments.length > 0 && (
                <div className="grid gap-2 border-t border-ghost-border/55 px-3 py-2.5 sm:grid-cols-2">
                  {attachments.map(item => (
                    <div key={item.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-ghost-border/60 bg-surface-lowest px-2.5 py-2">
                      {item.kind === 'image' ? (
                        <ProgressiveImage
                          src={'assetId' in item.image
                            ? buildBrowserMediaUrl(item.image.assetId, 'thumbnail', item.image.storageDriver)
                            : item.image.url}
                          alt={item.name}
                          fit="cover"
                          frameClassName="h-9 w-9 shrink-0 rounded-md"
                          imageClassName="h-9 w-9 object-cover"
                        />
                      ) : (
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/8 font-mono text-[10px] font-bold uppercase text-primary">
                          {fileExtension(item.name).slice(0, 4) || 'TXT'}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-xs font-medium text-ink">{item.name}</strong>
                        <small className="mt-0.5 block text-[10px] text-ink-muted">{formatFileSize(item.size)}</small>
                      </span>
                      <button type="button" onClick={() => removeAttachment(item.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-muted transition hover:bg-primary/10 hover:text-primary" aria-label={`移除 ${item.name}`}>×</button>
                    </div>
                  ))}
                </div>
              )}

              {(uploadingCount > 0 || attachmentError) && (
                <p className={`border-t border-ghost-border/55 px-3 py-2 text-[11px] ${attachmentError ? 'text-danger' : 'text-ink-muted'}`}>
                  {attachmentError || `正在处理 ${uploadingCount} 个文件…`}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-ghost-border/55 px-2.5 py-2.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingCount > 0 || attachments.length >= MAX_ATTACHMENTS}
                  title="支持图片、TXT、Markdown、CSV、JSON 与常见代码文件"
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] border border-ghost-border/70 bg-surface-low px-3 text-xs font-medium text-ink-secondary transition hover:border-primary/30 hover:text-ink disabled:cursor-wait disabled:opacity-55"
                >
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.65} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m7.25 10.75 4.9-4.9a2.3 2.3 0 1 1 3.25 3.25l-6.55 6.55a4 4 0 0 1-5.66-5.66l6.2-6.2" />
                  </svg>
                  添加参考文件
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_UPLOAD_TYPES.join(',')}
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div ref={modelControlRef} className="relative min-w-0">
                  <button
                    type="button"
                    aria-expanded={modelOptionsOpen}
                    aria-controls="workbench-model-options"
                    onClick={() => setModelOptionsOpen(current => !current)}
                    className={`flex h-9 max-w-[260px] items-center gap-2 rounded-[9px] border px-3 text-left text-xs font-medium transition ${modelOptionsOpen ? 'border-primary/45 bg-primary/8 text-primary' : 'border-ghost-border/70 bg-surface-low text-ink-secondary hover:border-primary/30 hover:text-ink'}`}
                  >
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
                      <path strokeLinecap="round" d="M3 5h14M5.5 10h9M8 15h4" />
                      <circle cx="7" cy="5" r="1.25" fill="currentColor" stroke="none" />
                      <circle cx="12" cy="10" r="1.25" fill="currentColor" stroke="none" />
                      <circle cx="10" cy="15" r="1.25" fill="currentColor" stroke="none" />
                    </svg>
                    <span className="shrink-0">推理模型</span>
                    <span className="truncate text-ink-muted">{selectedModelName}</span>
                    <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${modelOptionsOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m5.5 7.75 4.5 4.5 4.5-4.5" /></svg>
                  </button>

                  {modelOptionsOpen && (
                    <div id="workbench-model-options" role="listbox" aria-label="推理模型" className="absolute bottom-full left-0 z-30 mb-2 max-h-64 w-[min(360px,calc(100vw-4rem))] overflow-y-auto rounded-[10px] border border-[var(--glass-panel-border)] bg-[var(--glass-panel-bg)] p-1.5 shadow-[var(--shadow-glass)] backdrop-blur-xl">
                      {modelsLoading ? (
                        <p className="px-3 py-4 text-center text-xs text-ink-muted">正在读取模型…</p>
                      ) : models.map(item => {
                        const active = item.id === model
                        return (
                          <button
                            key={item.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onClick={() => {
                              setModel(item.id as ModelProvider)
                              setModelOptionsOpen(false)
                            }}
                            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition ${active ? 'bg-primary/12 text-primary' : 'text-ink-secondary hover:bg-surface-low hover:text-ink'}`}
                          >
                            <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${active ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant/35 text-transparent'}`}>
                              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m3.5 8 3 3 6-6" /></svg>
                            </span>
                            <span className="min-w-0 flex-1">
                              <strong className="block truncate text-[13px] font-semibold">{item.name}</strong>
                              {item.description && <small className="mt-0.5 block truncate text-[10.5px] font-normal text-ink-muted">{item.description}</small>}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                <button type="button" onClick={submit} disabled={!canSubmit} className="ml-auto rounded-[9px] bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-lg shadow-primary/15 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40">
                  开始空间创作
                </button>
              </div>
            </div>
          </div>
        </section>

        {hasSidebarContent && (
          <aside className="space-y-5">
            <div className="rounded-2xl border border-[var(--glass-panel-border)] bg-[var(--glass-panel-bg)] p-5 shadow-[var(--shadow-glass)] backdrop-blur-xl">
              <h2 className="mb-3 text-sm font-semibold text-ink">最近项目</h2>
              <div className="space-y-1">
                {conversations.slice(0, 4).map(item => (
                  <button key={item.conversation_id} type="button" onClick={() => loadConversation(item.conversation_id)} className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink-secondary transition hover:bg-surface-low hover:text-ink">
                    <span className="block truncate font-medium">{item.title}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

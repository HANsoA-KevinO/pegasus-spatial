'use client'

import { useState } from 'react'
import { useChatContext } from '@/contexts/ChatContext'
import { useModels } from '@/hooks/useModels'
import { useConversations } from '@/hooks/useConversation'
import type { ModelProvider } from '@/lib/types'
import { BrandMark } from '@/components/shell/BrandMark'

const CREATION_CONTEXTS = [
  '开放空间创作',
  '室内与居住空间',
  '展陈、零售与活动',
  '游戏与虚拟世界',
  '家具、产品与道具',
  '现实空间重建',
]

export function buildResearchProjectMessage(question: string, domain: string, context: string): string {
  return [
    `空间创作目标：${question.trim()}`,
    `创作语境：${domain}`,
    context.trim() ? `已有素材与约束：\n${context.trim()}` : '',
  ].filter(Boolean).join('\n\n')
}

export function TaskWorkbench({ onSubmit }: { onSubmit: (message: string, domain: string) => void }) {
  const [question, setQuestion] = useState('')
  const [context, setContext] = useState('')
  const [domain, setDomain] = useState('开放空间创作')
  const { model, setModel, loadConversation } = useChatContext()
  const { models, isLoading: modelsLoading } = useModels()
  const { conversations } = useConversations()

  const submit = () => {
    const trimmed = question.trim()
    if (!trimmed) return
    const message = buildResearchProjectMessage(trimmed, domain, context)
    onSubmit(message, domain)
  }

  return (
    <div className="relative h-full w-full overflow-y-auto bg-surface px-6 py-9 lg:px-14 lg:py-12">
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
      <div className="mx-auto grid max-w-6xl gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="relative overflow-hidden rounded-[10px] border border-[var(--paper-edge)] bg-[var(--paper)] p-7 shadow-[var(--shadow-paper)] lg:p-10">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-[linear-gradient(90deg,var(--primary-deep)_0_28%,var(--primary)_28%_46%,transparent_46%)]" />
          <div className="mb-8 flex items-center gap-3">
            <BrandMark className="h-11 w-11" />
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">Agentic spatial creation</p>
              <h1 className="mt-1 text-3xl font-bold tracking-[-0.035em] text-ink lg:text-4xl">描述一个想进入的世界</h1>
            </div>
          </div>
          <p className="mb-8 max-w-3xl text-sm leading-7 text-ink-secondary">
            飞马空间 Agent 会根据你的目标自主选择当前已接入的图像生成、3D 造物与世界生成工具。你不需要预先决定执行顺序；每次付费提交、后台状态和派生关系都会被持久记录。现实重建会在对应工具完成真实接入后开放。
          </p>

          <div className="space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-ink">你想创造什么？</span>
              <textarea
                value={question}
                onChange={event => setQuestion(event.target.value)}
                onKeyDown={event => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault()
                    submit()
                  }
                }}
                rows={5}
                placeholder="例如：创造一间可以进入的深夜电台，狭长空间、低照度钨丝灯、吸音木墙和一张用于直播的环形控制台。"
                className="w-full resize-y rounded-2xl border border-ghost-border/70 bg-surface-lowest px-5 py-4 text-base leading-7 text-ink outline-none transition placeholder:text-ink-muted focus:border-primary/70 focus:ring-4 focus:ring-primary/15"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-ink">已有素材、风格与必须保留的约束（可选）</span>
              <textarea
                value={context}
                onChange={event => setContext(event.target.value)}
                rows={3}
                placeholder="可说明参考图路径、空间用途、材质、光线、镜头、不能出现的元素，或希望先得到独立 GLB 物体。"
                className="w-full resize-y rounded-2xl border border-ghost-border/70 bg-surface-lowest px-5 py-4 text-sm leading-6 text-ink outline-none transition placeholder:text-ink-muted focus:border-primary/70 focus:ring-4 focus:ring-primary/15"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-ink-muted">创作语境（不锁定工具）</span>
                <select value={domain} onChange={event => setDomain(event.target.value)} className="w-full rounded-xl border border-ghost-border/70 bg-surface-lowest px-4 py-3 text-sm text-ink outline-none focus:border-primary/70 focus:ring-4 focus:ring-primary/15">
                  {CREATION_CONTEXTS.map(item => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-ink-muted">推理模型</span>
                <select
                  value={model}
                  disabled={modelsLoading}
                  onChange={event => setModel(event.target.value as ModelProvider)}
                  className="w-full rounded-xl border border-ghost-border/70 bg-surface-lowest px-4 py-3 text-sm text-ink outline-none focus:border-primary/70 focus:ring-4 focus:ring-primary/15 disabled:opacity-60"
                >
                  {models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <p className="text-xs text-ink-muted">⌘ / Ctrl + Enter 开始 · 付费提交和资产版本会进入审计记录</p>
              <button type="button" onClick={submit} disabled={!question.trim()} className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-on-primary shadow-lg shadow-primary/15 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40">
                开始空间创作
              </button>
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-[var(--glass-panel-border)] bg-[var(--glass-panel-bg)] p-5 shadow-[var(--shadow-glass)] backdrop-blur-xl">
            <h2 className="text-sm font-semibold text-ink">给 Agent 的创作简报</h2>
            <ul className="mt-4 space-y-3 text-sm text-ink-secondary">
              {['你真正想得到的体验', '可选的创作语境', '素材、风格与硬约束'].map(item => (
                <li key={item} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span className="leading-5">{item}</span></li>
              ))}
            </ul>
          </div>
          {conversations.length > 0 && (
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
          )}
        </aside>
      </div>
    </div>
  )
}

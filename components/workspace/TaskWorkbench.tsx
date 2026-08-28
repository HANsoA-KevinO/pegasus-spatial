'use client'

import { useState } from 'react'
import { useChatContext } from '@/contexts/ChatContext'
import { useConversations } from '@/hooks/useConversation'

const CREATION_CONTEXTS = ['开放空间创作', '室内与居住空间', '展陈、零售与活动', '游戏与虚拟世界']

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
  const { loadConversation } = useChatContext()
  const { conversations } = useConversations()

  const submit = () => {
    if (!question.trim()) return
    onSubmit(buildResearchProjectMessage(question, domain, context), domain)
  }

  return (
    <main className="pmo-spatial-home">
      <div className="pmo-spatial-home-glow" aria-hidden="true" />
      <section className="pmo-spatial-launcher" aria-labelledby="spatial-home-title">
        <div className="pmo-spatial-launcher-kicker">
          <span>01</span>
          <p>从一句话开始，Agent 会自己选择图像、Lux 造物、World 与场景编辑工具</p>
        </div>
        <h1 id="spatial-home-title">把脑海里的空间，<br />搭成可以进入的世界。</h1>
        <p className="pmo-spatial-launcher-copy">描述体验、氛围和必须保留的约束。你不需要先选择工作方式，也不需要等待每个 3D 任务结束。</p>

        <div className="pmo-spatial-composer">
          <textarea
            autoFocus
            value={question}
            onChange={event => setQuestion(event.target.value)}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit() }
            }}
            rows={4}
            aria-label="描述想创造的空间"
            placeholder="例如：搭建一座雨夜中的未来植物研究站。中央是干净的开放工作区，周围有发光植物舱、机械臂和可进入的玻璃温室……"
          />
          <div className="pmo-spatial-composer-footer">
            <div className="pmo-spatial-context-switcher" role="group" aria-label="创作语境">
              {CREATION_CONTEXTS.map(item => <button key={item} type="button" aria-pressed={domain === item} onClick={() => setDomain(item)}>{item}</button>)}
            </div>
            <button type="button" className="pmo-spatial-start" disabled={!question.trim()} onClick={submit}>开始创作 <span aria-hidden="true">↗</span></button>
          </div>
        </div>

        <details className="pmo-spatial-constraints">
          <summary>补充参考素材、风格与硬约束 <span>可选</span></summary>
          <textarea value={context} onChange={event => setContext(event.target.value)} rows={3} placeholder="例如：参考图在 output/spatial/images/；保留中央采光；建筑模块需要作为可独立摆放的 Lux 资产。" />
        </details>
      </section>

      <footer className="pmo-spatial-home-footer">
        <div><span>CAPABILITIES</span><p>图像生成 · Lux 3D 资产 · 混合 Scene · 真实视角观察</p></div>
        {conversations.length > 0 && (
          <div className="pmo-spatial-recents">
            <span>继续最近项目</span>
            {conversations.slice(0, 3).map(item => <button key={item.conversation_id} type="button" onClick={() => loadConversation(item.conversation_id)}><b>{item.title}</b><i>→</i></button>)}
          </div>
        )}
      </footer>
    </main>
  )
}

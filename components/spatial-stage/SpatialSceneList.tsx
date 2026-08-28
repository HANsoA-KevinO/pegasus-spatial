'use client'

import type { SpatialSceneSummary } from '@/hooks/useSpatialScenes'
import { conciseSceneDisplayName } from '@/lib/spatial/presentation-name'

export function SpatialSceneList({ scenes, activeSceneId, isLoading, error, onSelect }: {
  scenes: SpatialSceneSummary[]
  activeSceneId: string | null
  isLoading: boolean
  error: string | null
  onSelect: (sceneId: string) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1 no-scrollbar">
        {isLoading && scenes.length === 0 ? (
          <div className="flex items-center gap-2 px-2 py-4 text-[12px] text-ink-muted">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border border-primary/25 border-t-primary" />
            正在读取模型…
          </div>
        ) : error && scenes.length === 0 ? (
          <div className="rounded-card border border-error/15 bg-error/5 px-3 py-3 text-[12px] leading-5 text-error">{error}</div>
        ) : scenes.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <div className="mx-auto grid h-9 w-9 place-items-center rounded-full border border-primary/15 bg-primary/5 text-primary/60">◇</div>
            <p className="mt-3 text-[13px] font-medium text-ink-secondary">暂无模型</p>
            <p className="mt-1 text-[11px] leading-5 text-ink-muted">Agent 创建空间模型后会在这里出现。</p>
          </div>
        ) : (
          <div className="space-y-1">
            {scenes.map(scene => {
              const active = scene.scene_id === activeSceneId
              const displayName = conciseSceneDisplayName(scene.title)
              return (
                <button
                  key={scene.scene_id}
                  type="button"
                  aria-label={`打开场景模型：${displayName}`}
                  data-model-kind="scene"
                  onClick={() => onSelect(scene.scene_id)}
                  className={`group relative flex min-h-14 w-full items-center gap-3 overflow-hidden rounded-[18px] border px-3 py-2.5 text-left transition ${active ? 'border-primary/30 bg-primary/12 text-primary shadow-[0_10px_28px_color-mix(in_srgb,var(--primary)_12%,transparent)]' : 'border-primary/10 bg-primary/[0.035] text-ink-secondary hover:border-primary/22 hover:bg-primary/[0.07]'}`}
                >
                  {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />}
                  <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-[12px] border ${active ? 'border-primary/20 bg-primary/16 text-primary' : 'border-primary/12 bg-primary/[0.07] text-primary/70'}`}>
                    <SceneModelIcon />
                  </span>
                  <strong className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.015em]">{displayName}</strong>
                </button>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}

export function SceneModelIcon() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.3 6.1 10 2.8l6.7 3.3L10 9.7 3.3 6.1Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m3.3 9.5 6.7 3.6 6.7-3.6M3.3 13l6.7 3.6 6.7-3.6" />
    </svg>
  )
}

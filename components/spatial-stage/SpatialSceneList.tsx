'use client'

import type { SpatialSceneSummary } from '@/hooks/useSpatialScenes'

export function SpatialSceneList({ scenes, activeSceneId, isLoading, error, onSelect }: {
  scenes: SpatialSceneSummary[]
  activeSceneId: string | null
  isLoading: boolean
  error: string | null
  onSelect: (sceneId: string) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-4 mb-2 mt-1 rounded-card border border-outline-variant/10 bg-white/35 px-3 py-2.5 dark:bg-white/[0.025]">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-ink">空间场景</p>
          <span className="font-mono text-[10px] tabular-nums text-ink-faint">{scenes.length} scenes</span>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-ink-muted">Scene 是可反复观察和修改的空间版本。</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 no-scrollbar">
        {isLoading && scenes.length === 0 ? (
          <div className="flex items-center gap-2 px-2 py-4 text-[12px] text-ink-muted">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border border-primary/25 border-t-primary" />
            正在读取 Scene…
          </div>
        ) : error && scenes.length === 0 ? (
          <div className="rounded-card border border-error/15 bg-error/5 px-3 py-3 text-[12px] leading-5 text-error">{error}</div>
        ) : scenes.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <div className="mx-auto grid h-9 w-9 place-items-center rounded-full border border-primary/15 bg-primary/5 text-primary/60">◇</div>
            <p className="mt-3 text-[13px] font-medium text-ink-secondary">暂无 Scene</p>
            <p className="mt-1 text-[11px] leading-5 text-ink-muted">Agent 创建空间世界后会在这里出现。</p>
          </div>
        ) : (
          <div className="space-y-1">
            {scenes.map(scene => {
              const active = scene.scene_id === activeSceneId
              return (
                <button
                  key={scene.scene_id}
                  type="button"
                  onClick={() => onSelect(scene.scene_id)}
                  className={`group flex w-full items-start gap-2.5 rounded-card border px-2.5 py-2.5 text-left transition ${active ? 'border-primary/20 bg-primary/10 shadow-sm' : 'border-transparent hover:border-outline-variant/10 hover:bg-white/35 dark:hover:bg-white/[0.035]'}`}
                >
                  <span className={`mt-0.5 grid h-7 min-w-7 place-items-center rounded-md font-mono text-[10px] font-semibold ${active ? 'bg-primary text-on-primary' : 'bg-surface-low text-ink-muted group-hover:text-primary'}`}>v{scene.current_version}</span>
                  <span className="min-w-0 flex-1">
                    <strong className={`block truncate text-[13px] font-semibold ${active ? 'text-primary' : 'text-ink-secondary'}`}>{scene.title || '未命名 Scene'}</strong>
                    <small className="mt-1 block truncate font-mono text-[10px] text-ink-faint">{scene.scene_id}</small>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="mx-4 mb-4 border-l-2 border-primary/35 pl-3">
        <p className="font-mono text-[10px] font-semibold tracking-[0.12em] text-primary">AUTO REVISION</p>
        <p className="mt-1 text-[11px] leading-4 text-ink-muted">Agent 的每次空间修改都会自动保留版本。</p>
      </div>
    </div>
  )
}

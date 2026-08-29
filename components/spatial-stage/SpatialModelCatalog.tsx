'use client'

import { useId } from 'react'
import type { SpatialModelEntity } from '@/hooks/useSpatialModels'
import type { SpatialSceneSummary } from '@/hooks/useSpatialScenes'
import { conciseSceneDisplayName } from '@/lib/spatial/presentation-name'

export interface SpatialModelCatalogProps {
  scenes: SpatialSceneSummary[]
  models: SpatialModelEntity[]
  activeSceneId: string | null
  activeModelId: string | null
  isLoadingScenes: boolean
  isLoadingModels: boolean
  sceneError: string | null
  modelError: string | null
  onSelectScene: (sceneId: string) => void
  onSelectModel: (modelId: string) => void
}

function looksLikeRawPath(value: string): boolean {
  return /[\\/]/.test(value) || /\.(?:glb|gltf)$/i.test(value)
}

function sceneDisplayName(title: string): string {
  const displayName = conciseSceneDisplayName(title)
  return looksLikeRawPath(displayName) ? '未命名场景' : displayName
}

function objectDisplayName(model: SpatialModelEntity): string {
  const suppliedLabel = model.label.trim()
  return suppliedLabel && !looksLikeRawPath(suppliedLabel) ? suppliedLabel : '未命名物体模型'
}

export function SpatialModelCatalog({
  scenes,
  models,
  activeSceneId,
  activeModelId,
  isLoadingScenes,
  isLoadingModels,
  sceneError,
  modelError,
  onSelectScene,
  onSelectModel,
}: SpatialModelCatalogProps) {
  const catalogId = useId()
  const sceneHeadingId = `${catalogId}-scenes`
  const objectHeadingId = `${catalogId}-objects`

  return (
    <section
      aria-label="模型目录"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="spatial-model-catalog"
    >
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-4 pt-1 no-scrollbar">
        <div className="space-y-5">
          <section aria-labelledby={sceneHeadingId}>
            <CatalogHeading
              id={sceneHeadingId}
              label="场景模型"
              count={scenes.length}
              loading={isLoadingScenes}
            />

            {sceneError && (
              <div
                role="alert"
                className="mb-2 rounded-[12px] border border-error/15 bg-error/[0.045] px-3 py-2 text-[11px] leading-5 text-error"
              >
                场景模型读取失败：{sceneError}
              </div>
            )}

            {isLoadingScenes && scenes.length === 0 ? (
              <LoadingState label="正在读取场景模型…" />
            ) : sceneError && scenes.length === 0 ? null : scenes.length === 0 ? (
              <EmptyState
                icon="scene"
                title="暂无场景模型"
                description="Agent 将空间与物体组装成场景后，会显示在这里。"
              />
            ) : (
              <div className="space-y-1.5" role="group" aria-label={`场景模型，共 ${scenes.length} 项`}>
                {scenes.map(scene => {
                  const active = scene.scene_id === activeSceneId
                  const displayName = sceneDisplayName(scene.title)
                  return (
                    <button
                      key={scene.scene_id}
                      type="button"
                      aria-label={`打开场景模型：${displayName}`}
                      aria-current={active ? 'true' : undefined}
                      data-model-kind="scene"
                      onClick={() => onSelectScene(scene.scene_id)}
                      className={`group relative flex min-h-14 w-full min-w-0 items-center gap-3 overflow-hidden rounded-[16px] border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/45 ${
                        active
                          ? 'border-primary/30 bg-primary/12 text-primary shadow-[0_10px_28px_color-mix(in_srgb,var(--primary)_12%,transparent)]'
                          : 'border-primary/10 bg-primary/[0.035] text-ink-secondary hover:border-primary/22 hover:bg-primary/[0.07]'
                      }`}
                    >
                      {active && <ActiveRail />}
                      <SceneIcon active={active} />
                      <strong className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.015em]">
                        {displayName}
                      </strong>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          <section aria-labelledby={objectHeadingId}>
            <CatalogHeading id={objectHeadingId} label="物体模型" count={models.length} loading={isLoadingModels} />

            {modelError && (
              <div
                role="alert"
                className="mb-2 rounded-[12px] border border-error/15 bg-error/[0.045] px-3 py-2 text-[11px] leading-5 text-error"
              >
                物体模型读取失败：{modelError}
              </div>
            )}

            {isLoadingModels && models.length === 0 ? (
              <LoadingState label="正在读取物体模型…" />
            ) : modelError && models.length === 0 ? null : models.length === 0 ? (
              <EmptyState
                icon="object"
                title="暂无物体模型"
                description="GLB 与 PLY 发布完成后，会合并为一个可切换展示的模型。"
              />
            ) : (
              <div className="space-y-1.5" role="group" aria-label={`物体模型，共 ${models.length} 项`}>
                {models.map(model => {
                  const active = model.job_id === activeModelId
                  const displayName = objectDisplayName(model)
                  return (
                    <button
                      key={model.job_id}
                      type="button"
                      aria-label={`打开物体模型：${displayName}，可切换 GLB 和 PLY`}
                      aria-current={active ? 'true' : undefined}
                      data-model-kind="object"
                      data-model-id={model.job_id}
                      onClick={() => onSelectModel(model.job_id)}
                      className={`group relative flex min-h-14 w-full min-w-0 items-center gap-3 overflow-hidden rounded-[16px] border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/45 ${
                        active
                          ? 'border-[#b98a58]/45 bg-[#b98a58]/14 text-[#805225] shadow-[0_10px_26px_rgba(128,82,37,.11)] dark:text-[#e5bb86]'
                          : 'border-[#b98a58]/15 bg-[#b98a58]/[0.045] text-ink-secondary hover:border-[#b98a58]/30 hover:bg-[#b98a58]/[0.08]'
                      }`}
                    >
                      {active && <ActiveRail warm />}
                      <ObjectIcon active={active} />
                      <strong className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.015em]">
                        {displayName}
                      </strong>
                      <span className="shrink-0 rounded-full border border-current/10 bg-white/25 px-2 py-0.5 font-mono text-[9px] tracking-[0.05em] opacity-70 dark:bg-black/10">
                        GLB + PLY
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}

function CatalogHeading({
  id,
  label,
  count,
  loading = false,
}: {
  id: string
  label: string
  count: number
  loading?: boolean
}) {
  return (
    <div className="mb-2 flex min-h-7 items-center justify-between gap-3 px-1.5">
      <h2 id={id} className="text-[11px] font-semibold uppercase tracking-[0.13em] text-ink-muted">
        {label}
      </h2>
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-ink-muted" aria-label={`${count} 项`}>
        {loading && (
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 animate-spin rounded-full border border-primary/25 border-t-primary motion-reduce:animate-none"
          />
        )}
        {count}
      </span>
    </div>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-20 items-center gap-2 rounded-[14px] border border-primary/10 bg-primary/[0.025] px-3 py-4 text-[12px] text-ink-muted" role="status">
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 animate-spin rounded-full border border-primary/25 border-t-primary motion-reduce:animate-none"
      />
      {label}
    </div>
  )
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: 'scene' | 'object'
  title: string
  description: string
}) {
  return (
    <div className="rounded-[14px] border border-outline-variant/10 bg-white/[0.22] px-3 py-4 text-center dark:bg-white/[0.025]">
      <div className="mx-auto grid h-8 w-8 place-items-center rounded-[10px] border border-outline-variant/15 bg-surface-low text-ink-muted">
        {icon === 'scene' ? <SceneGlyph /> : <ObjectGlyph />}
      </div>
      <p className="mt-2 text-[12px] font-medium text-ink-secondary">{title}</p>
      <p className="mx-auto mt-1 max-w-48 text-[10.5px] leading-[1.55] text-ink-muted">{description}</p>
    </div>
  )
}

function ActiveRail({ warm = false }: { warm?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute inset-y-2 left-0 w-0.5 rounded-full ${warm ? 'bg-[#b98a58]' : 'bg-primary'}`}
    />
  )
}

function SceneIcon({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-[12px] border ${
        active
          ? 'border-primary/20 bg-primary/16 text-primary'
          : 'border-primary/12 bg-primary/[0.07] text-primary/70'
      }`}
    >
      <SceneGlyph />
    </span>
  )
}

function ObjectIcon({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-[12px] border ${
        active
          ? 'border-[#b98a58]/30 bg-[#b98a58]/18 text-[#805225] dark:text-[#e5bb86]'
          : 'border-[#b98a58]/18 bg-[#b98a58]/[0.07] text-[#9a6735] dark:text-[#dfb47f]'
      }`}
    >
      <ObjectGlyph />
    </span>
  )
}

function SceneGlyph() {
  return (
    <svg className="h-[17px] w-[17px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.3 6.1 10 2.8l6.7 3.3L10 9.7 3.3 6.1Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m3.3 9.5 6.7 3.6 6.7-3.6M3.3 13l6.7 3.6 6.7-3.6" />
    </svg>
  )
}

function ObjectGlyph() {
  return (
    <svg className="h-[17px] w-[17px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m10 2.7 6 3.1v7.1l-6 4.1-6-4.1V5.8l6-3.1Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.2 5.9 5.8 3.4 5.8-3.4M10 9.3v7.4" />
    </svg>
  )
}

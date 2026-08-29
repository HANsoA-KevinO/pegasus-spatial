'use client'

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { WorkspaceArtifact } from '@/hooks/useWorkspaceArtifacts'

interface WorkspaceFileExplorerProps {
  artifacts: WorkspaceArtifact[]
  activePath: string | null
  selectedGroup: 'images' | 'models' | null
  inFlightPaths: ReadonlySet<string>
  onSelect: (path: string) => void
}

type AssetPresentationKind = 'image' | 'object' | 'model'
type AssetGroupKey = 'images' | 'models'

interface AssetGroup {
  key: AssetGroupKey
  label: string
  emptyLabel: string
  artifacts: WorkspaceArtifact[]
}

const DEFAULT_EXPANDED_GROUPS: Record<AssetGroupKey, boolean> = {
  images: false,
  models: false,
}

const DEFAULT_FOCUSED_PATHS: Record<AssetGroupKey, string | null> = {
  images: null,
  models: null,
}

function normalizeInFlightPath(path: string): string {
  return path.replace(/^\/workspace\//, '').replace(/^workspace\//, '').replace(/^\//, '')
}

function presentationKind(artifact: WorkspaceArtifact): AssetPresentationKind {
  if (artifact.type === 'image') return 'image'
  return artifact.path.startsWith('output/spatial/objects/') ? 'object' : 'model'
}

function kindAriaLabel(kind: AssetPresentationKind): string {
  if (kind === 'image') return '图片'
  if (kind === 'object') return '物体模型'
  return '3D 模型'
}

export function WorkspaceFileExplorer({
  artifacts,
  activePath,
  selectedGroup,
  inFlightPaths,
  onSelect,
}: WorkspaceFileExplorerProps) {
  const explorerId = useId()
  const [expandedGroups, setExpandedGroups] = useState<Record<AssetGroupKey, boolean>>(DEFAULT_EXPANDED_GROUPS)
  const [focusedPathByGroup, setFocusedPathByGroup] = useState<Record<AssetGroupKey, string | null>>(DEFAULT_FOCUSED_PATHS)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const normalizedInFlight = useMemo(
    () => new Set([...inFlightPaths].map(normalizeInFlightPath)),
    [inFlightPaths],
  )
  const groups = useMemo<AssetGroup[]>(() => [
    {
      key: 'images',
      label: '图片',
      emptyLabel: '暂无图片文件',
      artifacts: artifacts.filter(artifact => artifact.type === 'image'),
    },
    {
      key: 'models',
      label: '3D 模型',
      emptyLabel: '暂无 3D 模型文件',
      artifacts: artifacts.filter(artifact => artifact.type !== 'image'),
    },
  ], [artifacts])

  const focusAsset = (groupKey: AssetGroupKey, path: string | null) => {
    if (!path) return
    const target = itemRefs.current.get(path)
    if (!target) return
    setFocusedPathByGroup(current => ({ ...current, [groupKey]: path }))
    target.focus()
  }

  const handleAssetKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    group: AssetGroup,
    artifact: WorkspaceArtifact,
  ) => {
    const index = group.artifacts.findIndex(candidate => candidate.path === artifact.path)
    const move = (target: WorkspaceArtifact | undefined) => {
      if (!target) return
      event.preventDefault()
      focusAsset(group.key, target.path)
    }

    if (event.key === 'ArrowDown') return move(group.artifacts[Math.min(group.artifacts.length - 1, index + 1)])
    if (event.key === 'ArrowUp') return move(group.artifacts[Math.max(0, index - 1)])
    if (event.key === 'Home') return move(group.artifacts[0])
    if (event.key === 'End') return move(group.artifacts.at(-1))
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(artifact.path)
    }
  }

  const toggleGroup = (key: AssetGroupKey) => {
    setExpandedGroups(current => ({ ...current, [key]: !current[key] }))
  }

  return (
    <section aria-label="创作资产" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 pb-4 pt-1"
        data-testid="workspace-file-explorer"
      >
        <div className="space-y-2.5">
          {groups.map(group => {
            const expanded = expandedGroups[group.key]
            const panelId = `${explorerId}-${group.key}`
            const imageGroup = group.key === 'images'
            const groupSelected = selectedGroup === group.key
            const containsActive = group.artifacts.some(artifact => artifact.path === activePath)
            const hasInFlight = group.artifacts.some(artifact => normalizedInFlight.has(artifact.path))
            const focusedPath = focusedPathByGroup[group.key]
            const focusOwnerIsVisible = Boolean(
              focusedPath && group.artifacts.some(artifact => artifact.path === focusedPath),
            )
            const cardTone = groupSelected
              ? (imageGroup
                  ? 'border-primary/70 bg-primary/[0.075] shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_20%,transparent),0_10px_28px_color-mix(in_srgb,var(--primary)_11%,transparent)]'
                  : 'border-[#b98a58]/70 bg-[#b98a58]/[0.075] shadow-[0_0_0_1px_rgba(185,138,88,.22),0_10px_28px_rgba(128,82,37,.11)]')
              : (imageGroup
                  ? 'border-primary/15 bg-primary/[0.035] shadow-[0_8px_24px_rgba(16,20,32,0.035)]'
                  : 'border-[#b98a58]/20 bg-[#b98a58]/[0.035] shadow-[0_8px_24px_rgba(16,20,32,0.035)]')

            return (
              <section
                key={group.key}
                data-asset-group={group.key}
                data-selected={groupSelected ? 'true' : 'false'}
                className={`overflow-hidden rounded-[16px] border transition-colors ${cardTone}`}
              >
                <button
                  type="button"
                  disabled={group.artifacts.length === 0}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  aria-label={`${expanded ? '收起' : '展开'}${group.label}，共 ${group.artifacts.length} 项${hasInFlight ? '，有文件正在更新' : ''}`}
                  onClick={() => toggleGroup(group.key)}
                  onKeyDown={event => {
                    if (event.key === 'ArrowRight' && !expanded) {
                      event.preventDefault()
                      toggleGroup(group.key)
                    }
                    if (event.key === 'ArrowLeft' && expanded) {
                      event.preventDefault()
                      toggleGroup(group.key)
                    }
                  }}
                  className="group flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-white/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 disabled:cursor-default dark:hover:bg-white/[0.045]"
                >
                  <AssetGroupIcon group={group.key} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold tracking-[-0.01em] text-ink">{group.label}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ink-muted">
                      {group.artifacts.length > 0 ? `${group.artifacts.length} 项文件` : group.emptyLabel}
                      {hasInFlight && (
                        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/45 motion-reduce:animate-none" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                        </span>
                      )}
                    </span>
                  </span>
                  {group.artifacts.length > 0 && (
                    <span
                      aria-hidden="true"
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-muted transition-transform duration-200 ${expanded ? 'rotate-180 bg-white/55 text-ink dark:bg-white/[0.07]' : ''}`}
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </button>

                {expanded && (
                  <div id={panelId} className="border-t border-ghost-border/55 p-2">
                    <div role="listbox" aria-label={`${group.label}，共 ${group.artifacts.length} 项`} className="space-y-1.5">
                      {group.artifacts.map((artifact, index) => {
                        const kind = presentationKind(artifact)
                        const isSelected = artifact.path === activePath
                        const isUpdating = normalizedInFlight.has(artifact.path)
                        const isFocusable = focusOwnerIsVisible
                          ? focusedPath === artifact.path
                          : (containsActive ? isSelected : index === 0)
                        const objectModel = kind === 'object'
                        const rowTone = objectModel
                          ? (isSelected
                              ? 'border-[#b98a58]/45 bg-[#b98a58]/14 text-[#805225] shadow-[0_8px_22px_rgba(128,82,37,.10)] dark:text-[#e5bb86]'
                              : 'border-[#b98a58]/15 bg-[#b98a58]/[0.045] text-ink-secondary hover:border-[#b98a58]/30 hover:bg-[#b98a58]/[0.08]')
                          : (isSelected
                              ? 'border-primary/25 bg-primary/10 text-primary shadow-[0_8px_22px_color-mix(in_srgb,var(--primary)_10%,transparent)]'
                              : 'border-transparent text-ink-secondary hover:border-outline-variant/10 hover:bg-white/55 hover:text-ink dark:hover:bg-white/[0.05]')

                        return (
                          <button
                            key={artifact.path}
                            ref={element => {
                              if (element) itemRefs.current.set(artifact.path, element)
                              else itemRefs.current.delete(artifact.path)
                            }}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            aria-label={`${kindAriaLabel(kind)}：${artifact.label}${isUpdating ? '，正在更新' : ''}`}
                            tabIndex={isFocusable ? 0 : -1}
                            data-asset-kind={kind}
                            data-model-kind={kind === 'image' ? undefined : kind}
                            onFocus={() => setFocusedPathByGroup(current => ({ ...current, [group.key]: artifact.path }))}
                            onClick={() => onSelect(artifact.path)}
                            onKeyDown={event => handleAssetKeyDown(event, group, artifact)}
                            className={`group relative flex min-h-12 w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-[13px] border px-2.5 py-2 text-left transition focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/45 ${rowTone}`}
                          >
                            {isSelected && !objectModel && (
                              <span
                                aria-hidden="true"
                                className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary"
                                style={{ boxShadow: '0 0 7px color-mix(in srgb, var(--primary) 45%, transparent)' }}
                              />
                            )}
                            <AssetKindIcon kind={kind} active={isSelected} />
                            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold tracking-[-0.01em]">{artifact.label}</span>
                            {isUpdating && (
                              <span className="relative mr-1 flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/45 motion-reduce:animate-none" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function AssetGroupIcon({ group }: { group: AssetGroupKey }) {
  if (group === 'images') {
    return (
      <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border border-primary/15 bg-primary/10 text-primary">
        <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.35}>
          <rect x="3" y="3.5" width="14" height="13" rx="2" />
          <circle cx="7.3" cy="7.7" r="1.2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.8 14.5 3.4-3.3 2.1 1.9 2.4-2.8 2.6 4.2" />
        </svg>
      </span>
    )
  }

  return (
    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border border-[#b98a58]/25 bg-[#b98a58]/12 text-[#9a6735] dark:text-[#dfb47f]">
      <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.35}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m10 2.7 6 3.1v7.1l-6 4.1-6-4.1V5.8l6-3.1Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.2 5.9 5.8 3.4 5.8-3.4M10 9.3v7.4" />
      </svg>
    </span>
  )
}

function AssetKindIcon({ kind, active }: { kind: AssetPresentationKind; active: boolean }) {
  if (kind === 'image') {
    return (
      <span aria-hidden="true" className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border ${active ? 'border-primary/20 bg-primary/14 text-primary' : 'border-primary/10 bg-primary/[0.06] text-primary/70'}`}>
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.35}>
          <rect x="3" y="3.5" width="14" height="13" rx="2" />
          <circle cx="7.3" cy="7.7" r="1.2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.8 14.5 3.4-3.3 2.1 1.9 2.4-2.8 2.6 4.2" />
        </svg>
      </span>
    )
  }

  const objectModel = kind === 'object'
  return (
    <span aria-hidden="true" className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border ${objectModel ? 'border-[#b98a58]/25 bg-[#b98a58]/12 text-[#9a6735] dark:text-[#dfb47f]' : 'border-outline-variant/20 bg-surface-low text-ink-muted'}`}>
      <svg className="h-[17px] w-[17px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.35}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m10 2.7 6 3.1v7.1l-6 4.1-6-4.1V5.8l6-3.1Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.2 5.9 5.8 3.4 5.8-3.4M10 9.3v7.4" />
      </svg>
    </span>
  )
}

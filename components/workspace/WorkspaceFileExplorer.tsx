'use client'

import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { WorkspaceArtifact } from '@/hooks/useWorkspaceArtifacts'

interface WorkspaceFileExplorerProps {
  artifacts: WorkspaceArtifact[]
  activePath: string | null
  inFlightPaths: ReadonlySet<string>
  onSelect: (path: string) => void
}

type AssetPresentationKind = 'image' | 'object' | 'model'

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
  inFlightPaths,
  onSelect,
}: WorkspaceFileExplorerProps) {
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const normalizedInFlight = useMemo(
    () => new Set([...inFlightPaths].map(normalizeInFlightPath)),
    [inFlightPaths],
  )
  const activeIsVisible = artifacts.some(artifact => artifact.path === activePath)
  const focusOwnerIsVisible = Boolean(focusedPath && artifacts.some(artifact => artifact.path === focusedPath))

  const focusAsset = (path: string | null) => {
    if (!path) return
    setFocusedPath(path)
    itemRefs.current.get(path)?.focus()
  }

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    artifact: WorkspaceArtifact,
  ) => {
    const index = artifacts.findIndex(candidate => candidate.path === artifact.path)
    const move = (target: WorkspaceArtifact | undefined) => {
      if (!target) return
      event.preventDefault()
      focusAsset(target.path)
    }

    if (event.key === 'ArrowDown') return move(artifacts[Math.min(artifacts.length - 1, index + 1)])
    if (event.key === 'ArrowUp') return move(artifacts[Math.max(0, index - 1)])
    if (event.key === 'Home') return move(artifacts[0])
    if (event.key === 'End') return move(artifacts.at(-1))
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(artifact.path)
    }
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex min-h-52 flex-col items-center justify-center px-5 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-card bg-primary/7 text-primary/65">
          <AssetGridIcon />
        </div>
        <p className="text-xs font-medium text-ink-secondary">暂无可预览资产</p>
        <p className="mt-1 max-w-44 text-[11px] leading-5 text-ink-muted">图片或 GLB / GLTF 模型生成后会自动出现在这里。</p>
      </div>
    )
  }

  return (
    <section aria-label="创作资产" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-2 pb-3 pt-1"
        data-testid="workspace-file-explorer"
      >
        <div role="listbox" aria-label={`创作资产，共 ${artifacts.length} 个`} className="space-y-1.5">
          {artifacts.map((artifact, index) => {
            const kind = presentationKind(artifact)
            const isSelected = artifact.path === activePath
            const isUpdating = normalizedInFlight.has(artifact.path)
            const isFocusable = focusOwnerIsVisible
              ? focusedPath === artifact.path
              : (activeIsVisible ? isSelected : index === 0)
            const objectModel = kind === 'object'
            const rowTone = objectModel
              ? (isSelected
                  ? 'border-[#b98a58]/45 bg-[#b98a58]/14 text-[#805225] shadow-[0_8px_22px_rgba(128,82,37,.10)] dark:text-[#e5bb86]'
                  : 'border-[#b98a58]/15 bg-[#b98a58]/[0.045] text-ink-secondary hover:border-[#b98a58]/30 hover:bg-[#b98a58]/[0.08]')
              : (isSelected
                  ? 'border-primary/25 bg-primary/10 text-primary shadow-[0_8px_22px_color-mix(in_srgb,var(--primary)_10%,transparent)]'
                  : 'border-transparent text-ink-secondary hover:border-outline-variant/10 hover:bg-white/45 hover:text-ink dark:hover:bg-white/[0.05]')

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
                onFocus={() => setFocusedPath(artifact.path)}
                onClick={() => onSelect(artifact.path)}
                onKeyDown={event => handleKeyDown(event, artifact)}
                className={`group relative flex min-h-12 w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-[14px] border px-2.5 py-2 text-left transition focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/45 ${rowTone}`}
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
    </section>
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

function AssetGridIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true">
      <rect x="3.5" y="4" width="7" height="7" rx="1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m15.5 4 4 2.2v4.6l-4 2.7-4-2.7V6.2l4-2.2Z" />
      <rect x="3.5" y="14" width="7" height="6" rx="1.5" />
      <path strokeLinecap="round" d="M13.5 17h7" />
    </svg>
  )
}

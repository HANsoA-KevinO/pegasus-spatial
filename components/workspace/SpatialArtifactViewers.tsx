'use client'

import { createElement, useEffect, useMemo, useState } from 'react'
import type { WorkspaceArtifact } from '@/hooks/useWorkspaceArtifacts'
import { ProgressiveImage } from '@/components/media/ProgressiveImage'

function fileUrl(conversationId: string, artifact: WorkspaceArtifact, extra = ''): string {
  const version = artifact.sha256 ? `&v=${encodeURIComponent(artifact.sha256)}` : ''
  return `/api/conversations/${encodeURIComponent(conversationId)}/files/binary?path=${encodeURIComponent(artifact.path)}${version}${extra}`
}

function formatBytes(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '大小未知'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function SpatialImageViewer({ artifact, conversationId }: {
  artifact: WorkspaceArtifact
  conversationId: string
}) {
  const src = fileUrl(conversationId, artifact, '&w=1600')
  const aspectRatio = artifact.width && artifact.height
    ? `${artifact.width} / ${artifact.height}`
    : '16 / 10'

  return (
    <section className="min-h-full bg-[#101319] px-5 py-6 text-[#eef2f8] sm:px-8 sm:py-8">
      <header className="mx-auto mb-5 flex max-w-5xl flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8da8d8]">生成图像</p>
          <h2 className="mt-1 text-base font-semibold tracking-[-0.01em]">{artifact.label}</h2>
          <p className="mt-1 text-[11px] text-white/45">
            {[artifact.mimeType, artifact.width && artifact.height ? `${artifact.width} × ${artifact.height}` : null, formatBytes(artifact.sizeBytes)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <a className="rounded-md border border-white/15 px-3 py-2 text-[11px] font-medium text-white/75 transition hover:border-[#8da8d8]/70 hover:text-white" href={fileUrl(conversationId, artifact, '&download=1')}>
          下载原图
        </a>
      </header>
      <div className="mx-auto max-w-5xl overflow-hidden rounded-[4px] border border-white/10 bg-[linear-gradient(45deg,#171b22_25%,transparent_25%),linear-gradient(-45deg,#171b22_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#171b22_75%),linear-gradient(-45deg,transparent_75%,#171b22_75%)] bg-[length:24px_24px] shadow-[0_28px_90px_rgba(0,0,0,.38)]" style={{ aspectRatio }}>
        <ProgressiveImage src={src} alt={artifact.label} frameClassName="h-full w-full" imageClassName="h-full w-full object-contain" />
      </div>
    </section>
  )
}

export function SpatialModelViewer({ artifact, conversationId }: {
  artifact: WorkspaceArtifact
  conversationId: string
}) {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const src = fileUrl(conversationId, artifact)

  useEffect(() => {
    let mounted = true
    void import('@google/model-viewer')
      .then(() => { if (mounted) setReady(true) })
      .catch(() => { if (mounted) setFailed(true) })
    return () => { mounted = false }
  }, [])

  return (
    <section className="relative flex min-h-full flex-col overflow-hidden bg-[#0d1117] text-[#eff4fb]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(122,150,195,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(122,150,195,.08)_1px,transparent_1px)] [background-size:44px_44px]" />
      <header className="relative z-10 flex flex-wrap items-end justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-7">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8da8d8]">3D 物体 · GLB</p>
          <h2 className="mt-1 text-base font-semibold">{artifact.label}</h2>
          <p className="mt-1 text-[11px] text-white/45">拖动旋转 · 滚轮缩放 · {formatBytes(artifact.sizeBytes)}</p>
        </div>
        <a className="rounded-md border border-white/15 px-3 py-2 text-[11px] font-medium text-white/75 transition hover:border-[#8da8d8]/70 hover:text-white" href={`${src}&download=1`}>
          下载 GLB
        </a>
      </header>
      <div className="relative z-10 min-h-[520px] flex-1">
        {ready ? createElement('model-viewer', {
          src,
          alt: artifact.label,
          'camera-controls': true,
          'auto-rotate': true,
          'rotation-per-second': '12deg',
          'shadow-intensity': '0.45',
          'environment-image': 'neutral',
          'interaction-prompt': 'auto',
          style: { width: '100%', height: '100%', minHeight: '520px', background: 'transparent' },
        }) : (
          <div className="flex h-full min-h-[520px] items-center justify-center text-center">
            <div>
              <span className={`mx-auto block h-8 w-8 rounded-full border-2 ${failed ? 'border-red-400/70' : 'animate-spin border-white/15 border-t-[#8da8d8]'}`} />
              <p className="mt-4 text-xs text-white/55">{failed ? '3D 查看器加载失败，请下载 GLB 查看' : '正在初始化 3D 查看器…'}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

type WorldManifest = {
  title?: string
  status?: string
  provider?: string
  world_id?: string
  provider_task_id?: string
  viewer_url?: string
  preview_path?: string
  source_image_path?: string
  created_at?: string
  updated_at?: string
  up_axis?: string
  relations?: Array<{
    kind?: string
    artifact_id?: string
  }>
  assets?: Array<{
    key?: string
    kind?: string
    path?: string
    mime_type?: string
    size_bytes?: number
    sha256?: string
  }>
}

function safeManifest(content: string): WorldManifest | null {
  try {
    const value = JSON.parse(content) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as WorldManifest : null
  } catch {
    return null
  }
}

function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function worldStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case 'succeeded': return '已成功'
    case 'published': return '已发布'
    case 'running': return '生成中'
    case 'materializing': return '正在保存资产'
    case 'failed': return '失败'
    case 'unknown': return '结果未知'
    default: return status
  }
}

function worldRelationLabel(kind: string | undefined): string {
  switch (kind) {
    case 'derived_from': return '派生自'
    case 'revision_of': return '修订自'
    case 'conditioned_by': return '参考资产'
    case 'compared_with': return '对比资产'
    default: return kind || '来源'
  }
}

export function SpatialWorldViewer({ artifact, conversationId, content }: {
  artifact: WorkspaceArtifact
  conversationId: string
  content: string
}) {
  const manifest = useMemo(() => safeManifest(content), [content])
  const viewerUrl = safeHttpUrl(manifest?.viewer_url)
  const previewPath = manifest?.preview_path?.replace(/^\/+/, '')
  const previewUrl = previewPath
    ? `/api/conversations/${encodeURIComponent(conversationId)}/files/binary?path=${encodeURIComponent(previewPath)}&w=1600`
    : null
  const status = manifest?.status ?? 'published'
  const relations = Array.isArray(manifest?.relations)
    ? manifest.relations.filter(relation => relation?.kind && relation?.artifact_id).slice(0, 8)
    : []
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : []

  return (
    <section className="min-h-full bg-[#0d1117] p-5 text-[#eff4fb] sm:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-start justify-between gap-5 border-b border-white/10 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#7fb38c] shadow-[0_0_16px_rgba(127,179,140,.75)]" />
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8da8d8]">空间世界 · {worldStatusLabel(status)}</p>
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">{manifest?.title ?? artifact.label}</h2>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-white/45">
              {[manifest?.provider ?? 'Aholo', manifest?.world_id ? `世界 ${manifest.world_id}` : null, manifest?.up_axis ? `${manifest.up_axis}-up` : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          {viewerUrl && (
            <a href={viewerUrl} target="_blank" rel="noreferrer" className="rounded-md bg-[#dce8ff] px-4 py-2.5 text-xs font-semibold text-[#172033] transition hover:bg-white">
              在 Aholo 中打开 ↗
            </a>
          )}
        </header>

        {previewUrl ? (
          <div className="mt-6 overflow-hidden rounded-[4px] border border-white/10 bg-black/30 shadow-[0_28px_90px_rgba(0,0,0,.35)]">
            <ProgressiveImage src={previewUrl} alt={manifest?.title ?? artifact.label} frameClassName="aspect-video w-full" imageClassName="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="mt-6 flex aspect-video items-center justify-center rounded-[4px] border border-dashed border-white/15 bg-white/[0.025]">
            <div className="max-w-sm text-center">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/50">缩略图待同步</p>
              <p className="mt-2 text-xs leading-5 text-white/35">世界清单已保存；可通过 Aholo 打开完整 3DGS，或等待缩略图同步。</p>
            </div>
          </div>
        )}

        <dl className="mt-6 grid gap-px overflow-hidden rounded-[4px] border border-white/10 bg-white/10 sm:grid-cols-3">
          {[
            ['供应商任务', manifest?.provider_task_id ?? '—'],
            ['源图', manifest?.source_image_path ?? '直接文本生成'],
            ['更新时间', manifest?.updated_at ?? manifest?.created_at ?? '—'],
          ].map(([label, value]) => (
            <div key={label} className="bg-[#121720] px-4 py-3">
              <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">{label}</dt>
              <dd className="mt-1 truncate text-[11px] text-white/65" title={value}>{value}</dd>
            </div>
          ))}
        </dl>

        {(assets.length > 0 || relations.length > 0) && (
          <div className="mt-6 grid gap-4 lg:grid-cols-[1.35fr_.65fr]">
            {assets.length > 0 && (
              <section className="border-t border-white/10 pt-4">
                <h3 className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">已发布资产</h3>
                <div className="mt-2 space-y-1.5">
                  {assets.slice(0, 8).map((item, index) => (
                    <div key={`${item.key ?? item.path ?? 'asset'}:${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-white/[0.06] py-2 text-[10px]">
                      <span className="truncate text-white/65" title={item.path}>{item.path ?? item.key ?? `资产 ${index + 1}`}</span>
                      <span className="font-mono text-white/30">{item.size_bytes ? formatBytes(item.size_bytes) : item.kind ?? 'asset'}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {relations.length > 0 && (
              <section className="border-t border-white/10 pt-4">
                <h3 className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">来源关系</h3>
                <div className="mt-2 space-y-1.5">
                  {relations.map((relation, index) => (
                    <div key={`${relation.kind}:${relation.artifact_id}:${index}`} className="rounded-[3px] border border-white/[0.08] bg-white/[0.025] px-3 py-2">
                      <p className="text-[9px] text-[#9eb7df]">{worldRelationLabel(relation.kind)}</p>
                      <p className="mt-1 truncate font-mono text-[9px] text-white/40" title={relation.artifact_id}>{relation.artifact_id}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

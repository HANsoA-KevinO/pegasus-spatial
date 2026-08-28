'use client'

import { createElement, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { WorkspaceArtifact } from '@/hooks/useWorkspaceArtifacts'
import { ProgressiveImage } from '@/components/media/ProgressiveImage'
import { isInternalWorkspacePath, normalizeWorkspacePath } from '@/lib/workspace/path-policy'

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
  const src = fileUrl(conversationId, artifact, '&w=1600&inline=1')
  const aspectRatio = artifact.width && artifact.height
    ? `${artifact.width} / ${artifact.height}`
    : '16 / 10'

  return (
    <section className="min-h-full bg-[#f3f4f7] px-5 py-6 text-[#25293a] sm:px-8 sm:py-8">
      <header className="mx-auto mb-5 flex max-w-5xl flex-wrap items-end justify-between gap-3 border-b border-black/10 pb-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">生成图像</p>
          <h2 className="mt-1 text-base font-semibold tracking-[-0.01em]">{artifact.label}</h2>
          <p className="mt-1 text-[11px] text-[#777d8f]">
            {[artifact.mimeType, artifact.width && artifact.height ? `${artifact.width} × ${artifact.height}` : null, formatBytes(artifact.sizeBytes)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <a className="rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-[11px] font-medium text-ink-secondary shadow-sm transition hover:border-primary/40 hover:text-primary-deep" href={fileUrl(conversationId, artifact, '&download=1')}>
          下载原图
        </a>
      </header>
      <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-black/[0.08] bg-[linear-gradient(45deg,#eef0f4_25%,transparent_25%),linear-gradient(-45deg,#eef0f4_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eef0f4_75%),linear-gradient(-45deg,transparent_75%,#eef0f4_75%)] bg-[length:24px_24px] shadow-[0_24px_70px_rgba(45,50,75,.15)]" style={{ aspectRatio }}>
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
    <section className="relative flex min-h-full flex-col overflow-hidden bg-[#eef0f5] text-[#25293a]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(145,223,194,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(145,223,194,.06)_1px,transparent_1px)] [background-size:44px_44px]" />
      <header className="relative z-10 flex flex-wrap items-end justify-between gap-3 border-b border-black/10 bg-white/55 px-5 py-4 backdrop-blur-xl sm:px-7">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">3D 物体 · GLB</p>
          <h2 className="mt-1 text-base font-semibold">{artifact.label}</h2>
          <p className="mt-1 text-[11px] text-[#777d8f]">拖动旋转 · 滚轮缩放 · {formatBytes(artifact.sizeBytes)}</p>
        </div>
        <a className="rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-[11px] font-medium text-ink-secondary shadow-sm transition hover:border-primary/40 hover:text-primary-deep" href={`${src}&download=1`}>
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
              <span className={`mx-auto block h-8 w-8 rounded-full border-2 ${failed ? 'border-red-400/70' : 'animate-spin border-black/10 border-t-primary'}`} />
              <p className="mt-4 text-xs text-[#71778a]">{failed ? '3D 查看器加载失败，请下载 GLB 查看' : '正在初始化 3D 查看器…'}</p>
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

const WORLD_COVER_EXTENSION = /\.(?:png|jpe?g|webp|gif)$/i

function safeWorldCoverPath(value: string | undefined): string | null {
  if (!value) return null
  try {
    const normalized = normalizeWorkspacePath(value)
    return !isInternalWorkspacePath(normalized) && WORLD_COVER_EXTENSION.test(normalized)
      ? normalized
      : null
  } catch {
    return null
  }
}

export function worldCoverPaths(manifest: WorldManifest | null): string[] {
  if (!manifest) return []
  const candidates = [
    manifest.preview_path,
    ...(manifest.assets ?? [])
      .filter(asset => asset.kind === 'thumbnail' || asset.kind === 'image' || asset.mime_type?.startsWith('image/'))
      .map(asset => asset.path),
    manifest.source_image_path,
  ]
  return [...new Set(candidates.flatMap(candidate => {
    const safe = safeWorldCoverPath(candidate)
    return safe ? [safe] : []
  }))]
}

export function SpatialWorldViewer({ artifact, conversationId, content }: {
  artifact: WorkspaceArtifact
  conversationId: string
  content: string
}) {
  const manifest = useMemo(() => safeManifest(content), [content])
  const coverPaths = useMemo(() => worldCoverPaths(manifest), [manifest])
  const [coverIndex, setCoverIndex] = useState(0)
  useEffect(() => { setCoverIndex(0) }, [content])
  const coverPath = coverPaths[coverIndex] ?? null
  const coverSrc = coverPath
    ? `/api/conversations/${encodeURIComponent(conversationId)}/files/binary?path=${encodeURIComponent(coverPath)}&w=1920&inline=1`
    : null
  const viewerUrl = safeHttpUrl(manifest?.viewer_url)
  const status = manifest?.status ?? 'published'
  const relations = Array.isArray(manifest?.relations)
    ? manifest.relations.filter(relation => relation?.kind && relation?.artifact_id).slice(0, 8)
    : []
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : []

  return (
    <section className="relative h-full min-h-[420px] overflow-hidden bg-[#d8d3c8] text-[#f8f5ee] [container-type:inline-size]">
      {coverSrc ? (
        <ProgressiveImage
          src={coverSrc}
          alt={`${manifest?.title ?? artifact.label} 空间封面`}
          fit="cover"
          frameClassName="absolute inset-0 block h-full w-full"
          imageClassName="h-full w-full object-cover"
          onError={() => setCoverIndex(index => index + 1)}
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_22%,rgba(215,90,59,.18),transparent_28%),linear-gradient(135deg,#6d7069,#333a36)]" />
      )}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(18,22,19,.48),transparent_30%,transparent_58%,rgba(18,22,19,.82))]" />

      <div className="absolute left-5 top-5 flex items-center gap-2 rounded-md border border-white/20 bg-black/25 px-3 py-2 backdrop-blur-md">
        <span className="h-1.5 w-1.5 rounded-full bg-[#9ed1ac] shadow-[0_0_0_4px_rgba(158,209,172,.16)]" />
        <span className="text-[10px] font-semibold tracking-[0.08em]">空间世界 · {worldStatusLabel(status)}</span>
      </div>

      <div className="absolute right-5 top-5 flex gap-2">
        {viewerUrl && <a href={viewerUrl} target="_blank" rel="noreferrer" className="rounded-md border border-white/25 bg-black/25 px-3 py-2 text-[10px] font-semibold text-white backdrop-blur-md transition hover:bg-black/40">Aholo ↗</a>}
        <Link href={`/spatial/${encodeURIComponent(conversationId)}?manifest=${encodeURIComponent(artifact.path)}`} className="rounded-md bg-[#d75a3b] px-4 py-2 text-[10px] font-bold text-white shadow-lg transition hover:bg-[#c94e31]">
          进入空间舞台
        </Link>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 p-5 sm:p-7">
        <div className="min-w-0 max-w-2xl">
          <p className="text-[10px] font-medium text-white/65">{coverPath === manifest?.source_image_path ? '创作参考图封面' : '空间封面'}</p>
          <h2 className="mt-1 truncate font-serif text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">{manifest?.title ?? artifact.label}</h2>
          <p className="mt-2 truncate text-[10px] text-white/65">
            {[manifest?.provider ?? 'Aholo', manifest?.world_id ? `世界 ${manifest.world_id}` : null, manifest?.up_axis ? `${manifest.up_axis}-up` : null, `${assets.length} 个发布资产`].filter(Boolean).join(' · ')}
          </p>
        </div>
        {(assets.length > 0 || relations.length > 0) && <details className="group relative shrink-0 text-right">
          <summary className="cursor-pointer list-none rounded-md border border-white/20 bg-black/25 px-3 py-2 text-[10px] font-semibold backdrop-blur-md">构建信息</summary>
          <div className="absolute bottom-11 right-0 w-72 rounded-lg border border-white/20 bg-[#252a26]/95 p-3 text-left shadow-2xl backdrop-blur-xl">
            <p className="text-[9px] font-semibold text-white/55">{assets.length} 个资产 · {relations.length} 条来源关系</p>
            <div className="mt-2 max-h-40 space-y-1 overflow-auto">
              {assets.slice(0, 5).map((item, index) => <p key={`${item.path}:${index}`} className="truncate text-[9px] text-white/75" title={item.path}>{item.path ?? item.key ?? `资产 ${index + 1}`}</p>)}
              {relations.slice(0, 3).map((relation, index) => <p key={`${relation.kind}:${index}`} className="truncate text-[9px] text-[#ef9b82]">{worldRelationLabel(relation.kind)} · {relation.artifact_id}</p>)}
            </div>
          </div>
        </details>}
      </div>
    </section>
  )
}

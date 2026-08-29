'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { SpatialModelEntity } from '@/hooks/useSpatialModels'
import type {
  SceneObjectInstance,
  SceneSourceArtifact,
} from '@/lib/spatial/scene-types'
import {
  AholoWorldCanvas,
  type SpatialCanvasHandle,
  type SpatialObjectLoadState,
  type SpatialQualityRenderState,
} from './AholoWorldCanvas'

export type SpatialModelEntityViewerModel = SpatialModelEntity

export interface SpatialModelEntityViewerProps {
  conversationId: string
  entity: SpatialModelEntityViewerModel
}

type EntityScopedState<T> = {
  entityId: string
  value: T
}

const IDENTITY_TRANSFORM: SceneObjectInstance['transform'] = {
  position: [0, 0, 0],
  rotation_quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
}

const INITIAL_OBJECT_STATE: SpatialObjectLoadState = {
  status: 'loading',
  instanceIds: [],
  failedInstanceIds: [],
}

const INITIAL_QUALITY_STATE: SpatialQualityRenderState = {
  status: 'glb',
  instanceId: null,
}

function binaryUrl(conversationId: string, artifact: SceneSourceArtifact): string {
  const query = new URLSearchParams({
    path: artifact.workspace_path,
    v: artifact.sha256,
  })
  return `/api/conversations/${encodeURIComponent(conversationId)}/files/binary?${query.toString()}`
}

function entityLabel(entity: SpatialModelEntityViewerModel): string {
  return entity.label.trim() || '未命名物体模型'
}

export function SpatialModelEntityViewer({
  conversationId,
  entity,
}: SpatialModelEntityViewerProps) {
  const canvasRef = useRef<SpatialCanvasHandle>(null)
  const [modeState, setModeState] = useState<EntityScopedState<'glb' | 'ply'>>({
    entityId: entity.job_id,
    value: 'glb',
  })
  const [objectState, setObjectState] = useState<EntityScopedState<SpatialObjectLoadState>>({
    entityId: entity.job_id,
    value: INITIAL_OBJECT_STATE,
  })
  const [qualityState, setQualityState] = useState<EntityScopedState<SpatialQualityRenderState>>({
    entityId: entity.job_id,
    value: INITIAL_QUALITY_STATE,
  })
  const [qualityReload, setQualityReload] = useState<EntityScopedState<number>>({
    entityId: entity.job_id,
    value: 0,
  })

  const qualityMode = modeState.entityId === entity.job_id ? modeState.value : 'glb'
  const currentObjectState = objectState.entityId === entity.job_id
    ? objectState.value
    : INITIAL_OBJECT_STATE
  const currentQualityState = qualityState.entityId === entity.job_id
    ? qualityState.value
    : INITIAL_QUALITY_STATE
  const qualityReloadToken = qualityReload.entityId === entity.job_id ? qualityReload.value : 0
  const name = entityLabel(entity)
  const hasPly = Boolean(entity.ply_artifact)

  const instance = useMemo<SceneObjectInstance | null>(() => {
    if (!entity.glb_artifact) return null
    return {
      instance_id: `model-entity:${entity.job_id}`,
      label: name,
      source_job_id: entity.job_id,
      glb_artifact: entity.glb_artifact,
      ...(entity.ply_artifact
        ? { optional_ply_artifact: entity.ply_artifact }
        : {}),
      normalization: entity.normalization,
      transform: IDENTITY_TRANSFORM,
    }
    // Published model entities are immutable. The polling hook returns fresh
    // object references every 2.5 seconds, so use their durable revision fields
    // to avoid tearing down/reloading the same GPU asset on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.job_id, entity.updated_at, name])

  const instances = useMemo(() => instance ? [instance] : [], [instance])
  const objectUrl = useCallback((candidate: SceneObjectInstance, quality: 'glb' | 'ply') => {
    const artifact = quality === 'ply' ? candidate.optional_ply_artifact : candidate.glb_artifact
    if (!artifact) return ''
    return binaryUrl(conversationId, artifact)
  }, [conversationId])

  const selectMode = (mode: 'glb' | 'ply') => {
    if (mode === 'ply' && !hasPly) return
    setModeState({ entityId: entity.job_id, value: mode })
    setQualityState({
      entityId: entity.job_id,
      value: mode === 'ply'
        ? { status: 'loading', instanceId: null, loadedCount: 0, totalCount: 1 }
        : INITIAL_QUALITY_STATE,
    })
  }

  if (!entity.glb_artifact) {
    return (
      <section
        className="flex h-full min-h-[18rem] items-center justify-center bg-[#05070a] px-6 text-center text-white"
        data-testid="spatial-model-entity-viewer"
      >
        <div role="alert" className="max-w-sm">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-full border border-red-300/20 bg-red-400/10 text-red-200">!</div>
          <h2 className="mt-4 text-base font-semibold">模型尚未准备完成</h2>
          <p className="mt-2 text-xs leading-6 text-white/55">该模型实体还没有可查看的 GLB 表示。</p>
        </div>
      </section>
    )
  }

  const showObjectOverlay = currentObjectState.status === 'loading' || currentObjectState.status === 'error'
  const qualityError = qualityMode === 'ply'
    && currentObjectState.status === 'ready'
    && currentQualityState.status === 'error'

  return (
    <section
      className="relative flex h-full min-h-[18rem] min-w-0 overflow-hidden bg-[#05070a] text-white"
      data-quality-mode={qualityMode}
      data-testid="spatial-model-entity-viewer"
    >
      <AholoWorldCanvas
        ref={canvasRef}
        assetUrl={null}
        format={null}
        upAxis="Z"
        instances={instances}
        objectUrl={objectUrl}
        qualityMode={qualityMode}
        qualityReloadToken={qualityReloadToken}
        captureEnabled={false}
        framingKey={`${entity.job_id}:${entity.glb_artifact.sha256}:${entity.ply_artifact.sha256}`}
        onObjectLoadStateChange={state => setObjectState({ entityId: entity.job_id, value: state })}
        onQualityStateChange={state => setQualityState({ entityId: entity.job_id, value: state })}
      />

      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[min(58%,30rem)] rounded-[14px] border border-white/10 bg-[#11151c]/65 px-3 py-2 shadow-[0_14px_40px_rgba(0,0,0,.28)] backdrop-blur-xl sm:left-4 sm:top-4 sm:px-4">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">物体模型</span>
        <strong className="mt-0.5 block truncate text-[13px] font-semibold tracking-[-0.01em] text-white/88 sm:text-sm">{name}</strong>
      </div>

      <div
        className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-[14px] border border-white/10 bg-[#11151c]/68 p-1 shadow-[0_14px_40px_rgba(0,0,0,.28)] backdrop-blur-xl sm:right-4 sm:top-4"
        role="group"
        aria-label="模型显示质量"
      >
        <button
          type="button"
          aria-pressed={qualityMode === 'glb'}
          onClick={() => selectMode('glb')}
          className="h-8 rounded-[10px] px-3 text-[11px] font-semibold text-white/55 transition hover:bg-white/8 hover:text-white aria-pressed:bg-white/12 aria-pressed:text-white"
        >
          GLB
        </button>
        {hasPly && (
          <button
            type="button"
            aria-pressed={qualityMode === 'ply'}
            onClick={() => selectMode('ply')}
            className="flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[11px] font-semibold text-white/55 transition hover:bg-white/8 hover:text-white aria-pressed:bg-primary aria-pressed:text-on-primary"
          >
            {qualityMode === 'ply' && currentQualityState.status === 'loading' && (
              <span aria-hidden="true" className="h-2.5 w-2.5 animate-spin rounded-full border border-current/35 border-t-current motion-reduce:animate-none" />
            )}
            PLY
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => canvasRef.current?.resetUserView()}
        className="absolute bottom-3 left-3 z-10 flex h-9 items-center gap-2 rounded-[12px] border border-white/10 bg-[#11151c]/65 px-3 text-[11px] font-medium text-white/60 shadow-[0_12px_32px_rgba(0,0,0,.24)] backdrop-blur-xl transition hover:border-white/20 hover:bg-[#171c24]/78 hover:text-white sm:bottom-4 sm:left-4"
        aria-label="重新适配模型视角"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
        </svg>
        适配视角
      </button>

      {showObjectOverlay && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[radial-gradient(circle_at_50%_46%,rgba(20,26,35,.82),rgba(5,7,10,.96)_68%)] px-6 text-center">
          <div role={currentObjectState.status === 'error' ? 'alert' : 'status'} className="max-w-sm">
            <span className={`mx-auto block h-9 w-9 rounded-full border ${currentObjectState.status === 'error' ? 'grid place-items-center border-red-300/25 bg-red-400/10 text-red-200' : 'animate-spin border-white/12 border-t-primary motion-reduce:animate-none'}`}>
              {currentObjectState.status === 'error' ? '!' : null}
            </span>
            <h2 className="mt-4 text-base font-semibold text-white/90">{currentObjectState.status === 'error' ? '模型载入失败' : '正在载入模型'}</h2>
            <p className="mt-2 text-xs leading-6 text-white/50">{currentObjectState.status === 'error' ? currentObjectState.error ?? 'GLB 载入失败，请稍后重试。' : '正在读取 GLB 并自动适配视角。'}</p>
          </div>
        </div>
      )}

      {qualityError && (
        <div role="alert" className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%_-_2rem)] -translate-x-1/2 items-center gap-3 rounded-[13px] border border-amber-200/15 bg-[#17140f]/78 px-3 py-2 text-[11px] text-amber-50/75 shadow-xl backdrop-blur-xl">
          <span>{currentQualityState.error ?? 'PLY 载入失败，当前保留 GLB。'}</span>
          <button
            type="button"
            className="shrink-0 rounded-[8px] border border-white/10 px-2 py-1 font-semibold text-white/75 transition hover:bg-white/8 hover:text-white"
            onClick={() => setQualityReload({ entityId: entity.job_id, value: qualityReloadToken + 1 })}
          >
            重试
          </button>
        </div>
      )}
    </section>
  )
}

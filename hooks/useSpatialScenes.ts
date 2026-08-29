'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SceneViewpoint } from '@/lib/spatial/scene-types'

export interface SpatialSceneSummary {
  scene_id: string
  title: string
  current_version: number
  current_revision_id: string
  agent_viewpoint: SceneViewpoint | null
  updated_at?: string
}

const POLL_INTERVAL_MS = 2500

type SpatialSceneListBody = {
  scenes?: SpatialSceneSummary[]
  error?: string
}

type SharedSceneRequest = {
  controller: AbortController
  consumers: Set<symbol>
  promise: Promise<SpatialSceneListBody>
}

const sharedSceneRequests = new Map<string, SharedSceneRequest>()

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

function fetchSharedSceneList(url: string, signal: AbortSignal): Promise<SpatialSceneListBody> {
  if (signal.aborted) return Promise.reject(abortError())

  let shared = sharedSceneRequests.get(url)
  if (!shared) {
    const created: SharedSceneRequest = {
      controller: new AbortController(),
      consumers: new Set(),
      promise: Promise.resolve({}),
    }
    created.promise = (async () => {
      const response = await fetch(url, { signal: created.controller.signal, cache: 'no-store' })
      const body = await response.json().catch(() => null) as SpatialSceneListBody | null
      if (!response.ok) throw new Error(body?.error ?? `Scene 列表读取失败 (${response.status})`)
      return body ?? {}
    })().finally(() => {
      if (sharedSceneRequests.get(url) === created) sharedSceneRequests.delete(url)
    })
    sharedSceneRequests.set(url, created)
    shared = created
  }

  const consumer = Symbol(url)
  shared.consumers.add(consumer)
  let released = false
  const release = () => {
    if (released) return
    released = true
    shared!.consumers.delete(consumer)
    if (shared!.consumers.size === 0 && sharedSceneRequests.get(url) === shared) {
      sharedSceneRequests.delete(url)
      shared!.controller.abort()
    }
  }
  let rejectAsAborted: (() => void) | null = null
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAsAborted = () => {
      release()
      reject(abortError())
    }
    signal.addEventListener('abort', rejectAsAborted, { once: true })
  })

  return Promise.race([shared.promise, aborted]).finally(() => {
    if (rejectAsAborted) signal.removeEventListener('abort', rejectAsAborted)
    release()
  })
}

export function useSpatialScenes(conversationId: string | null, enabled = true) {
  const [scenes, setScenes] = useState<SpatialSceneSummary[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lifecycleControllerRef = useRef<AbortController | null>(null)
  const requestControllerRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const requestEpochRef = useRef(0)
  const scenesSignatureRef = useRef('[]')

  const refresh = useCallback((signal?: AbortSignal): Promise<void> => {
    if (!conversationId || !enabled) return Promise.resolve()
    if (inFlightRef.current) return inFlightRef.current

    const requestEpoch = requestEpochRef.current
    const url = `/api/conversations/${encodeURIComponent(conversationId)}/spatial/scenes`
    const controller = new AbortController()
    requestControllerRef.current = controller
    const linkedSignals = [lifecycleControllerRef.current?.signal, signal]
      .filter((candidate): candidate is AbortSignal => Boolean(candidate))
    const abortRequest = () => controller.abort()
    for (const linkedSignal of new Set(linkedSignals)) {
      if (linkedSignal.aborted) controller.abort()
      else linkedSignal.addEventListener('abort', abortRequest, { once: true })
    }

    const request = fetchSharedSceneList(url, controller.signal)
      .then(body => {
        if (controller.signal.aborted || requestEpoch !== requestEpochRef.current) return
        const nextScenes = body.scenes ?? []
        const nextSignature = JSON.stringify(nextScenes)
        if (scenesSignatureRef.current !== nextSignature) {
          scenesSignatureRef.current = nextSignature
          setScenes(nextScenes)
        }
        setError(null)
        setHasLoaded(true)
      })
      .finally(() => {
        for (const linkedSignal of new Set(linkedSignals)) {
          linkedSignal.removeEventListener('abort', abortRequest)
        }
        if (requestControllerRef.current === controller) requestControllerRef.current = null
        if (inFlightRef.current === request) inFlightRef.current = null
      })
    inFlightRef.current = request
    return request
  }, [conversationId, enabled])

  useEffect(() => {
    const effectEpoch = requestEpochRef.current + 1
    requestEpochRef.current = effectEpoch
    requestControllerRef.current?.abort()
    inFlightRef.current = null
    lifecycleControllerRef.current?.abort()
    const lifecycleController = new AbortController()
    lifecycleControllerRef.current = lifecycleController
    scenesSignatureRef.current = '[]'
    setScenes(current => current.length === 0 ? current : [])
    setError(null)
    setHasLoaded(false)
    if (!conversationId || !enabled) {
      setIsLoading(false)
      return () => lifecycleController.abort()
    }

    let timer: number | null = null
    setIsLoading(true)
    const poll = async (initial: boolean) => {
      try {
        await refresh(lifecycleController.signal)
      } catch (cause) {
        if (initial && !lifecycleController.signal.aborted && requestEpochRef.current === effectEpoch) {
          setError(cause instanceof Error ? cause.message : 'Scene 列表读取失败')
          setHasLoaded(true)
        }
      } finally {
        if (initial && !lifecycleController.signal.aborted && requestEpochRef.current === effectEpoch) {
          setIsLoading(false)
        }
        if (!lifecycleController.signal.aborted && requestEpochRef.current === effectEpoch) {
          timer = window.setTimeout(() => { void poll(false) }, POLL_INTERVAL_MS)
        }
      }
    }
    void poll(true)

    return () => {
      if (requestEpochRef.current === effectEpoch) requestEpochRef.current += 1
      lifecycleController.abort()
      requestControllerRef.current?.abort()
      requestControllerRef.current = null
      inFlightRef.current = null
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [conversationId, enabled, refresh])

  return { scenes, isLoading, hasLoaded, error, refresh }
}

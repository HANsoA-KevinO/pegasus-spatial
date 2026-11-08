import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { isAgentRunnerEnabled } from '@/lib/agent-runtime/runner'

// Readiness includes the scene execution service. A healthy web page alone
// does not mean the Agent can build or observe a scene.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const startedAt = Date.now()

const MONGO_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'] as const

export async function GET(): Promise<NextResponse> {
  const state = mongoose.connection.readyState as 0 | 1 | 2 | 3
  const mongo = MONGO_STATES[state] ?? 'unknown'
  let renderer: 'ready' | 'unavailable' | 'disabled' = 'disabled'
  if (process.env.SCENE_CODE_WORKER_ENABLED !== '0') {
    renderer = 'unavailable'
    try {
      const response = await fetch(`${(process.env.SCENE_CODE_RENDERER_URL || 'http://127.0.0.1:3201').replace(/\/$/, '')}/health`, { headers: { authorization: `Bearer ${process.env.SCENE_CODE_RENDERER_TOKEN}` }, cache: 'no-store', signal: AbortSignal.timeout(1500) })
      if (response.ok && (await response.json()).ok === true) renderer = 'ready'
    } catch { /* Readiness reports an unreachable renderer without secrets. */ }
  }
  const healthy = state === 1 && renderer !== 'unavailable'

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      uptime_ms: Date.now() - startedAt,
      mongo,
      scene_renderer: renderer,
      agent_runner: isAgentRunnerEnabled() ? 'ready' : 'inline',
    },
    { status: healthy ? 200 : 503 },
  )
}

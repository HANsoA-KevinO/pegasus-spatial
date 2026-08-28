export type ChatSubmissionTransport = 'normal' | 'interrupt'

export interface ChatSubmissionAttempt<T> {
  ok: boolean
  status: number
  code?: string
  value: T
}

export interface RoutedChatSubmission<T> extends ChatSubmissionAttempt<T> {
  transport: ChatSubmissionTransport
  attempts: number
  exhausted: boolean
}

export const MAX_CHAT_SUBMISSION_ATTEMPTS = 5

/**
 * A Run can finish or start while the browser is choosing between the normal
 * turn endpoint and the mid-turn queue endpoint. Only the two stable conflict
 * codes are routing signals; every other failure belongs to the caller.
 */
export function nextChatSubmissionTransport(
  transport: ChatSubmissionTransport,
  status: number,
  code?: string,
): ChatSubmissionTransport | null {
  if (status !== 409) return null
  if (transport === 'normal' && code === 'already_running') return 'interrupt'
  if (transport === 'interrupt' && code === 'no_active_run') return 'normal'
  return null
}

function retryDelayMs(completedAttempts: number): number {
  return Math.min(320, 80 * (2 ** Math.max(0, completedAttempts - 1)))
}

function waitForRetry(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Resolve a Run-boundary race without recursively calling sendMessage. The
 * bounded backoff gives cancellation/finalization enough time to release the
 * active key while keeping the UI responsive.
 */
export async function routeChatSubmission<T>(
  initialTransport: ChatSubmissionTransport,
  submit: (
    transport: ChatSubmissionTransport,
    attempt: number,
  ) => Promise<ChatSubmissionAttempt<T>>,
  options?: {
    maxAttempts?: number
    wait?: (ms: number) => Promise<void>
  },
): Promise<RoutedChatSubmission<T>> {
  const maxAttempts = Math.max(
    1,
    Math.floor(options?.maxAttempts ?? MAX_CHAT_SUBMISSION_ATTEMPTS),
  )
  const wait = options?.wait ?? waitForRetry
  let transport = initialTransport

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await submit(transport, attempt)
    if (result.ok) {
      return { ...result, transport, attempts: attempt, exhausted: false }
    }

    const nextTransport = nextChatSubmissionTransport(
      transport,
      result.status,
      result.code,
    )
    if (!nextTransport) {
      return { ...result, transport, attempts: attempt, exhausted: false }
    }
    if (attempt === maxAttempts) {
      return { ...result, transport, attempts: attempt, exhausted: true }
    }

    await wait(retryDelayMs(attempt))
    transport = nextTransport
  }

  // The loop always returns; keep the invariant explicit for type narrowing.
  throw new Error('Chat submission routing exhausted without a result')
}

export function canAcceptQueuedUserInput<T extends {
  status: string
  cancellation_requested?: boolean
}>(run: T | null | undefined): run is T {
  return Boolean(
    run
    && !run.cancellation_requested
    && (run.status === 'queued' || run.status === 'running'),
  )
}

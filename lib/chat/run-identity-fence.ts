const RUN_IDENTITY_EVENT_TYPES = new Set([
  'run_started',
  'run_state',
  'run_detached',
  'run_recoverable',
])

const TERMINAL_RUN_STATUSES = new Set(['completed', 'cancelled', 'failed'])

export interface RunIdentityFenceInput {
  activeRunId?: string
  expectedRunId?: string
  eventType: string
  eventRunId?: string
  eventStatus?: string
  isCurrentStream: boolean
  /** A newly accepted POST stream may replace the Run that lost the submit race. */
  allowRunReplacement?: boolean
}

export interface RunIdentityFenceResult {
  accepted: boolean
  nextActiveRunId?: string
}

/**
 * Resolve a streamed Run identity without consulting React or transport state.
 * A detached event may name a continuation Run, but only while its source Run
 * still owns the conversation identity.
 */
export function resolveRunIdentityEvent({
  activeRunId,
  expectedRunId,
  eventType,
  eventRunId,
  eventStatus,
  isCurrentStream,
  allowRunReplacement = false,
}: RunIdentityFenceInput): RunIdentityFenceResult {
  if (!isCurrentStream || !RUN_IDENTITY_EVENT_TYPES.has(eventType) || !eventRunId) {
    return { accepted: false, nextActiveRunId: activeRunId }
  }

  if (eventType === 'run_state' && TERMINAL_RUN_STATUSES.has(eventStatus ?? '')) {
    return {
      accepted: expectedRunId === undefined || expectedRunId === eventRunId,
      nextActiveRunId: activeRunId === eventRunId ? undefined : activeRunId,
    }
  }

  if (eventType === 'run_detached') {
    const isHandoff = expectedRunId !== undefined && eventRunId !== expectedRunId
    if (isHandoff) {
      const sourceStillOwnsIdentity = activeRunId === undefined
        || activeRunId === expectedRunId
        || activeRunId === eventRunId
      return sourceStillOwnsIdentity
        ? { accepted: true, nextActiveRunId: eventRunId }
        : { accepted: false, nextActiveRunId: activeRunId }
    }
  } else if (expectedRunId !== undefined && eventRunId !== expectedRunId) {
    return { accepted: false, nextActiveRunId: activeRunId }
  }

  if (
    activeRunId !== undefined
    && activeRunId !== eventRunId
    && !(
      allowRunReplacement
      && (eventType === 'run_started' || eventType === 'run_detached')
    )
  ) {
    return { accepted: false, nextActiveRunId: activeRunId }
  }

  return { accepted: true, nextActiveRunId: eventRunId }
}

import type { DisplayPart } from '../types'

type ToolCallPart = Extract<DisplayPart, { type: 'tool_call' }>

export type LiveToolStartEvent = {
  type: 'tool_start'
  tool: string
  tool_use_id?: string
}

export type LiveToolTargetEvent = {
  type: 'tool_target'
  tool: string
  tool_use_id?: string
  target_path: string
}

export type LiveToolDoneEvent = {
  type: 'tool_done'
  tool: string
  tool_use_id?: string
  file_path?: string
  action?: string
  is_error?: boolean
  content?: string
}

export type LiveToolEvent = LiveToolStartEvent | LiveToolTargetEvent | LiveToolDoneEvent

type ToolPartMessage = {
  role: 'user' | 'assistant'
  parts?: DisplayPart[]
}

function exactToolIndex(parts: readonly DisplayPart[], toolUseId: string): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part.type === 'tool_call' && part.tool_use_id === toolUseId) return index
  }
  return -1
}

function fallbackToolIndex(
  parts: readonly DisplayPart[],
  event: LiveToolEvent,
): number {
  const hasExactIdentity = Boolean(event.tool_use_id)

  // Once the server knows the durable tool_use_id, only an as-yet-unidentified
  // streamed row may adopt it. Never steal a row already bound to another call.
  // Calls execute in assistant-block order, so the oldest matching anonymous
  // row is the correct fallback when several same-name starts were streamed.
  if (hasExactIdentity) {
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]
      if (
        part.type === 'tool_call'
        && part.tool === event.tool
        && part.pending
        && !part.tool_use_id
      ) return index
    }
    return -1
  }

  // Legacy events have no identity. Preserve the former latest-pending
  // fallback for compatibility, but exact-id events never enter this branch.
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part.type === 'tool_call' && part.tool === event.tool && part.pending) {
      return index
    }
  }
  return -1
}

function resolvedToolIndex(parts: readonly DisplayPart[], event: LiveToolEvent): number {
  if (event.tool_use_id) {
    const exact = exactToolIndex(parts, event.tool_use_id)
    if (exact >= 0) return exact
  }
  return fallbackToolIndex(parts, event)
}

/** Apply one live lifecycle event to one assistant message's tool rows. */
export function applyLiveToolEventToParts(
  parts: DisplayPart[],
  event: LiveToolEvent,
): boolean {
  if (event.type === 'tool_start' && !event.tool_use_id) {
    // Each anonymous model-stream start is a distinct content block. Identity
    // enrichment arrives later and binds these rows in FIFO order.
    parts.push({ type: 'tool_call', tool: event.tool, pending: true })
    return true
  }

  const index = resolvedToolIndex(parts, event)

  if (event.type === 'tool_start') {
    if (index >= 0) {
      const part = parts[index] as ToolCallPart
      // A reconnect may replay an exact start after hydration already attached
      // the durable result. Identity replay must not reopen the completed row.
      if (!part.pending && part.tool_use_id === event.tool_use_id) return true
      parts[index] = {
        ...part,
        pending: true,
        ...(event.tool_use_id ? { tool_use_id: event.tool_use_id } : {}),
      }
      return true
    }
    parts.push({
      type: 'tool_call',
      tool: event.tool,
      pending: true,
      ...(event.tool_use_id ? { tool_use_id: event.tool_use_id } : {}),
    })
    return true
  }

  if (index < 0) return false
  const part = parts[index] as ToolCallPart

  if (event.type === 'tool_target') {
    // A late/replayed target must not mutate a terminal row, but reporting a
    // match prevents callers from falling back to a different same-name call.
    if (!part.pending) return true
    parts[index] = {
      ...part,
      ...(event.tool_use_id ? { tool_use_id: event.tool_use_id } : {}),
      target_path: event.target_path,
    }
    return true
  }

  parts[index] = {
    ...part,
    ...(event.tool_use_id ? { tool_use_id: event.tool_use_id } : {}),
    pending: false,
    ...(event.file_path !== undefined ? { file_path: event.file_path } : {}),
    ...(event.action !== undefined ? { action: event.action } : {}),
    ...(event.is_error !== undefined ? { is_error: event.is_error } : {}),
    ...(event.content !== undefined ? { content: event.content } : {}),
  }
  return true
}

/**
 * Apply a lifecycle event across hydrated history plus the reconnect
 * placeholder. Exact tool_use_id matches are searched globally first, so a
 * replayed event updates the durable historical row instead of creating a
 * duplicate row in the placeholder bubble.
 */
export function applyLiveToolEventToMessages<T extends ToolPartMessage>(
  messages: readonly T[],
  preferredMessageIndex: number,
  event: LiveToolEvent,
): { messages: T[]; matched: boolean } {
  const preferred = preferredMessageIndex >= 0 && preferredMessageIndex < messages.length
    ? preferredMessageIndex
    : -1
  const candidateIndices = [
    ...(preferred >= 0 ? [preferred] : []),
    ...messages.map((_, index) => index).reverse().filter(index => index !== preferred),
  ]

  if (event.tool_use_id) {
    for (const messageIndex of candidateIndices) {
      const message = messages[messageIndex]
      if (message.role !== 'assistant' || !message.parts) continue
      if (exactToolIndex(message.parts, event.tool_use_id) < 0) continue
      const nextParts = [...message.parts]
      applyLiveToolEventToParts(nextParts, event)
      const nextMessages = [...messages] as T[]
      nextMessages[messageIndex] = { ...message, parts: nextParts }
      return { messages: nextMessages, matched: true }
    }
  }

  // Starts belong to the current stream bubble. Target/done may fall back to
  // an older anonymous pending row when reconnect hydration won the race.
  const fallbackIndices = event.type === 'tool_start' && preferred >= 0
    ? [preferred]
    : candidateIndices
  for (const messageIndex of fallbackIndices) {
    const message = messages[messageIndex]
    if (message.role !== 'assistant') continue
    const nextParts = [...(message.parts ?? [])]
    if (!applyLiveToolEventToParts(nextParts, event)) continue
    const nextMessages = [...messages] as T[]
    nextMessages[messageIndex] = { ...message, parts: nextParts }
    return { messages: nextMessages, matched: true }
  }

  return { messages: [...messages] as T[], matched: false }
}

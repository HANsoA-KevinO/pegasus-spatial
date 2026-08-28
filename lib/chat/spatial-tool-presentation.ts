import { parseSpatialToolResult } from '../spatial/tool-result'
import type { DisplayPart } from '../types'

const NON_SUCCESS_TERMINAL_STATUSES = new Set(['failed', 'unknown', 'cancelled'])

/**
 * A durable spatial receipt is stronger evidence than a transient SSE flag.
 * In particular, status=unknown must never inherit GenerateImage's green
 * "已生成" presentation even if a legacy event omitted is_error.
 */
export function isToolCallFailure(
  part: Extract<DisplayPart, { type: 'tool_call' }>,
): boolean {
  if (part.is_error) return true
  if (!part.content) return false
  const receipt = parseSpatialToolResult(part.content)
  return Boolean(receipt && NON_SUCCESS_TERMINAL_STATUSES.has(receipt.status))
}

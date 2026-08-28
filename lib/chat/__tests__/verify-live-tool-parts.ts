import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DisplayPart } from '../../types'
import {
  applyLiveToolEventToMessages,
  applyLiveToolEventToParts,
} from '../live-tool-parts'
import { attachPersistedToolResult } from '../persisted-tool-results'
import { isToolCallFailure } from '../spatial-tool-presentation'

const unknownReceipt = JSON.stringify({
  schema_version: 1,
  job_id: 'spimg_unknown',
  kind: 'image',
  status: 'unknown',
  provider: 'fixture',
  error: '供应商可能已经接受请求',
  updated_at: '2026-08-28T00:00:00.000Z',
})
const publishedReceipt = JSON.stringify({
  schema_version: 1,
  job_id: 'spimg_published',
  artifact_id: 'asset_published',
  kind: 'image',
  status: 'published',
  provider: 'fixture',
  workspace_paths: ['output/spatial/images/published.png'],
  updated_at: '2026-08-28T00:00:01.000Z',
})

// The model can stream several same-name starts before execution begins.
// Exact execution identities must bind in assistant-block (FIFO) order, not
// the old reverse scan that swapped the first and second GenerateImage result.
const parts: DisplayPart[] = []
assert.equal(applyLiveToolEventToParts(parts, {
  type: 'tool_start',
  tool: 'GenerateImage',
}), true)
assert.equal(applyLiveToolEventToParts(parts, {
  type: 'tool_start',
  tool: 'GenerateImage',
}), true)
assert.equal(applyLiveToolEventToParts(parts, {
  type: 'tool_start',
  tool: 'GenerateImage',
  tool_use_id: 'tool_image_a',
}), true)
assert.equal(applyLiveToolEventToParts(parts, {
  type: 'tool_target',
  tool: 'GenerateImage',
  tool_use_id: 'tool_image_a',
  target_path: 'output/spatial/images/a.png',
}), true)
assert.equal(applyLiveToolEventToParts(parts, {
  type: 'tool_done',
  tool: 'GenerateImage',
  tool_use_id: 'tool_image_a',
  is_error: true,
  content: unknownReceipt,
}), true)
assert.equal(applyLiveToolEventToParts(parts, {
  type: 'tool_start',
  tool: 'GenerateImage',
  tool_use_id: 'tool_image_b',
}), true)
assert.equal(applyLiveToolEventToParts(parts, {
  type: 'tool_done',
  tool: 'GenerateImage',
  tool_use_id: 'tool_image_b',
  content: publishedReceipt,
}), true)

assert.equal(parts.length, 2)
assert.deepEqual(parts.map(part => part.type === 'tool_call' ? part.tool_use_id : null), [
  'tool_image_a',
  'tool_image_b',
])
const first = parts[0]
const second = parts[1]
assert.equal(first.type === 'tool_call' && first.target_path, 'output/spatial/images/a.png')
assert.equal(first.type === 'tool_call' && first.content, unknownReceipt)
assert.equal(first.type === 'tool_call' && isToolCallFailure(first), true)
assert.equal(second.type === 'tool_call' && second.content, publishedReceipt)
assert.equal(second.type === 'tool_call' && isToolCallFailure(second), false)

// Replayed exact starts are idempotent and cannot reopen a terminal row.
applyLiveToolEventToParts(parts, {
  type: 'tool_start',
  tool: 'GenerateImage',
  tool_use_id: 'tool_image_a',
})
assert.equal(parts[0].type === 'tool_call' && parts[0].pending, false)

// During reconnect, hydration may own the exact pending row while the current
// stream writes into a blank placeholder. The result must update history.
const reconnectMessages = [{
  role: 'assistant' as const,
  parts: [{
    type: 'tool_call' as const,
    tool: 'GenerateImage',
    tool_use_id: 'tool_reconnect',
    pending: true,
  }],
}, {
  role: 'assistant' as const,
  parts: [] as DisplayPart[],
}]
const reconnectApplied = applyLiveToolEventToMessages(
  reconnectMessages,
  1,
  {
    type: 'tool_done',
    tool: 'GenerateImage',
    tool_use_id: 'tool_reconnect',
    is_error: true,
    content: unknownReceipt,
  },
)
assert.equal(reconnectApplied.matched, true)
assert.equal(reconnectApplied.messages[0].parts?.[0].type === 'tool_call'
  && reconnectApplied.messages[0].parts[0].content, unknownReceipt)
assert.equal(reconnectApplied.messages[1].parts?.length, 0)

// A durable unknown receipt remains a failure even if a legacy record omitted
// is_error; a succeeding durable result also clears a stale transient error.
const durableParts: DisplayPart[] = [{
  type: 'tool_call',
  tool: 'GenerateImage',
  tool_use_id: 'tool_durable',
  pending: true,
}]
attachPersistedToolResult(durableParts, {
  type: 'tool_result',
  tool_use_id: 'tool_durable',
  content: unknownReceipt,
})
assert.equal(durableParts[0].type === 'tool_call' && isToolCallFailure(durableParts[0]), true)
if (durableParts[0].type === 'tool_call') durableParts[0].is_error = true
attachPersistedToolResult(durableParts, {
  type: 'tool_result',
  tool_use_id: 'tool_durable',
  content: publishedReceipt,
})
assert.equal(durableParts[0].type === 'tool_call' && durableParts[0].is_error, false)
assert.equal(durableParts[0].type === 'tool_call' && isToolCallFailure(durableParts[0]), false)

const routeSource = readFileSync(join(process.cwd(), 'app/api/chat/route.ts'), 'utf8')
const useChatSource = readFileSync(join(process.cwd(), 'hooks/useChat.ts'), 'utf8')
const llmApiSource = readFileSync(join(process.cwd(), 'lib/agent/llm-api.ts'), 'utf8')
const loopSource = readFileSync(join(process.cwd(), 'lib/agent/loop.ts'), 'utf8')
assert.match(routeSource, /parseSpatialToolResult\(result\.content\)/)
assert.match(routeSource, /tool_use_id: toolUseId/)
assert.match(useChatSource, /applyLiveToolEventToMessages\(prev, targetIndex, event\)/)
assert.match(useChatSource, /shouldRehydrate = true/)
assert.match(useChatSource, /attachPersistedToolResult is the only[\s\S]{0,180}pending: true/)
assert.match(llmApiSource, /onToolUseStart\?\.\(event\.content_block\.name, event\.content_block\.id\)/)
assert.match(loopSource, /provider\.onToolStart\?\.\(tu\.name, tu\.input, tu\.id\)/)
assert.match(loopSource, /provider\.onToolExecuted\?\.\(tu\.name, tu\.input, result, tu\.id\)/)

console.log('live-tool-parts verification passed.')

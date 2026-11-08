import assert from 'node:assert/strict'
import { callAnthropicAPIStream, isRecoverableLLMStreamError, LLMStreamError } from '../llm-api'

const request = { model: 'stream-fixture', max_tokens: 128, system: [], tools: [], messages: [] }
const start = { type: 'message_start', message: { usage: { input_tokens: 7, output_tokens: 0 } } }
const tool = { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-fixture', name: 'Action', input: {} } }
const delta = (partial_json: string) => ({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json } })
const stop = { type: 'content_block_stop', index: 0 }
const finish = { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12, input_tokens: 999 } }
const end = { type: 'message_stop' }
const originalFetch = globalThis.fetch
let cancellations = 0

async function parse(events: unknown[], options: { signal?: AbortSignal; chunkSize?: number; terminator?: string; keepOpen?: boolean } = {}) {
  const wire = new TextEncoder().encode(events.map(event => `data:${JSON.stringify(event)}\r\n\r\n`).join('') + (options.terminator ?? ''))
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < wire.length; i += options.chunkSize ?? wire.length) controller.enqueue(wire.slice(i, i + (options.chunkSize ?? wire.length)))
      if (!options.keepOpen) controller.close()
    },
    cancel() { cancellations += 1 },
  }), { headers: { 'content-type': 'text/event-stream' } })
  return callAnthropicAPIStream(request, 'https://fixture.invalid/v1', 'fixture', undefined, undefined, undefined, undefined, options.signal)
}

try {
  // Truncated JSON, closed tools without message completion, and error events
  // must reject the whole response. No default {} tool call can be returned.
  for (const events of [
    [start, tool, delta('{"position":')],
    [start, tool, delta('{}'), stop],
    [start, tool, delta('{}'), stop, { type: 'error', error: { type: 'overloaded_error' } }],
    [start, tool, delta('{}'), finish, end],
    [start, tool, delta('{}'), stop, finish],
  ]) await assert.rejects(parse(events), LLMStreamError)
  await assert.rejects(parse([start, tool, delta('{"private_source":"unfinished')]), error => {
    assert.ok(isRecoverableLLMStreamError(error))
    assert.equal(error.diagnostics!.transport_eof, true)
    assert.equal(error.diagnostics!.message_stopped, false)
    assert.equal(error.diagnostics!.last_delta, 'input_json_delta')
    assert.deepEqual(error.diagnostics!.open_blocks.map(block => block.type), ['tool_use'])
    assert.equal(error.usage!.input_tokens, 7)
    assert.equal(error.diagnostics!.usage_complete, false)
    assert.ok(!JSON.stringify(error.diagnostics).includes('private_source'), 'diagnostics must not store source, tool input or reasoning text')
    return true
  })
  await assert.rejects(parse([start, tool], { terminator: 'data: {"type":"content_block_delta","index":0,"delta":' }), error => {
    assert.ok(isRecoverableLLMStreamError(error), 'EOF in the middle of an SSE event is a truncated response, not an unrecoverable JSON-format failure')
    return true
  })
  await assert.rejects(parse([start], { terminator: 'data: {invalid-json}\n\n' }), error => {
    assert.ok(error instanceof LLMStreamError)
    assert.equal(isRecoverableLLMStreamError(error), false, 'a complete malformed event must still be rejected as a protocol error')
    return true
  })
  // A socket error after a partial tool must be recoverable and retain its
  // transport cause, while still returning no executable tool response.
  let reads = 0
  const partial = new TextEncoder().encode([start, tool, delta('{"x":')].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) {
      if (reads++ === 0) controller.enqueue(partial)
      else controller.error(Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }))
    },
  }, { highWaterMark: 0 }), { headers: { 'x-request-id': 'fixture-request-123' } })
  await assert.rejects(callAnthropicAPIStream(request, 'https://fixture.invalid/v1', 'fixture'), error => {
    assert.ok(isRecoverableLLMStreamError(error))
    assert.equal(error.diagnostics!.code, 'read_error')
    assert.equal(error.diagnostics!.request_id, 'fixture-request-123')
    assert.equal(error.diagnostics!.transport_eof, false)
    assert.equal(error.diagnostics!.open_blocks[0].type, 'tool_use')
    assert.equal((error.cause as { code: string }).code, 'ECONNRESET')
    return true
  })
  const complete = await parse([start, tool, delta('{"label":"老院子"}'), stop, finish, end], { chunkSize: 3 })
  assert.equal(complete.stop_reason, 'tool_use')
  assert.equal(complete.usage.input_tokens, 7, 'gateway message_delta cannot overwrite authoritative input usage')
  assert.equal(complete.usage.output_tokens, 12)
  assert.deepEqual(complete.content, [{ type: 'tool_use', id: 'tool-fixture', name: 'Action', input: { label: '老院子' } }])
  const initialContent = await parse([start,
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'initial reasoning', signature: 'initial-signature' } }, stop,
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'initial text' } }, { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, end,
  ])
  assert.deepEqual(initialContent.content, [{ type: 'thinking', thinking: 'initial reasoning', signature: 'initial-signature' }, { type: 'text', text: 'initial text' }], 'gateway-prefilled content must round-trip intact')
  // Simulate fifteen minutes passing inside a healthy response. Elapsed wall
  // time alone must not abort extended thinking or reject a complete message.
  const originalNow = Date.now
  let ticks = 0
  Date.now = () => originalNow() + (ticks++ > 0 ? 15 * 60_000 : 0)
  try {
    const longThinking = await parse([start,
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'fixture reasoning' } },
      { type: 'ping' },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'fixture-signature' } },
      stop, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, end,
    ])
    assert.equal(longThinking.stop_reason, 'end_turn')
  } finally { Date.now = originalNow }
  const done = await parse([start, tool, delta('{}'), stop, finish], { terminator: 'data: [DONE]\n\n' })
  assert.equal(done.stop_reason, 'tool_use', 'complete gateway DONE terminal is accepted')
  const cancellationCount = cancellations
  await parse([start, tool, delta('{}'), stop, finish, end], { keepOpen: true })
  assert.equal(cancellations, cancellationCount + 1, 'message_stop must finish and release a connection that remains open')
  const controller = new AbortController(); controller.abort()
  const aborted = await parse([start, tool], { signal: controller.signal })
  assert.equal(aborted.stop_reason, 'aborted')
  assert.deepEqual(aborted.content, [])
  console.log('stream integrity verification passed (provider calls: 0)')
} finally { globalThis.fetch = originalFetch }

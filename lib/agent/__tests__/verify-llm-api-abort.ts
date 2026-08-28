import assert from 'node:assert/strict'

import { callAnthropicAPIStream } from '../llm-api'

const request = {
  model: 'mock-model',
  max_tokens: 64,
  system: [],
  tools: [],
  messages: [],
}

async function withMockFetch(
  implementation: typeof fetch,
  verify: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = implementation
  try {
    await verify()
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function verifyStringReasonTypeErrorIsAnAbort(): Promise<void> {
  const controller = new AbortController()
  controller.abort('interrupt')
  let fetchCalls = 0

  await withMockFetch(async (_input, init) => {
    fetchCalls += 1
    assert.equal(init?.signal?.aborted, true)
    throw new TypeError('invalid_argument')
  }, async () => {
    const result = await callAnthropicAPIStream(
      request,
      'https://mock.invalid',
      'mock-key',
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
    )

    assert.equal(result.stop_reason, 'aborted')
    assert.equal(fetchCalls, 1, 'an aborted fetch must never enter transport retry')
  })
}

async function verifyAbortErrorWithoutSignalStateIsCompatible(): Promise<void> {
  let fetchCalls = 0
  await withMockFetch(async () => {
    fetchCalls += 1
    const error = new Error('request aborted')
    error.name = 'AbortError'
    throw error
  }, async () => {
    const result = await callAnthropicAPIStream(
      request,
      'https://mock.invalid',
      'mock-key',
    )
    assert.equal(result.stop_reason, 'aborted')
    assert.equal(fetchCalls, 1)
  })
}

async function verifyAbortInterruptsTransientResponseBackoff(): Promise<void> {
  const controller = new AbortController()
  let fetchCalls = 0

  await withMockFetch(async () => {
    fetchCalls += 1
    queueMicrotask(() => controller.abort('interrupt'))
    return new Response('temporary upstream failure', { status: 503 })
  }, async () => {
    const startedAt = Date.now()
    const result = await callAnthropicAPIStream(
      request,
      'https://mock.invalid',
      'mock-key',
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
    )

    assert.equal(result.stop_reason, 'aborted')
    assert.equal(fetchCalls, 1, 'abort during backoff must suppress the next attempt')
    assert.ok(
      Date.now() - startedAt < 500,
      'abort must interrupt the 2-second retry backoff immediately',
    )
  })
}

async function verifyAbortInterruptsFetchFailureBackoff(): Promise<void> {
  const controller = new AbortController()
  let fetchCalls = 0

  await withMockFetch(async () => {
    fetchCalls += 1
    setTimeout(() => controller.abort('interrupt'), 10)
    throw new TypeError('upstream transport failure')
  }, async () => {
    const startedAt = Date.now()
    const result = await callAnthropicAPIStream(
      request,
      'https://mock.invalid',
      'mock-key',
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
    )

    assert.equal(result.stop_reason, 'aborted')
    assert.equal(fetchCalls, 1, 'abort during fetch-error backoff must suppress retry')
    assert.ok(
      Date.now() - startedAt < 500,
      'abort must interrupt fetch-error retry backoff immediately',
    )
  })
}

async function verifyPendingStreamReadReturnsPartialResultOnAbort(): Promise<void> {
  const controller = new AbortController()
  const encoder = new TextEncoder()
  let readCalls = 0
  let cancelCalls = 0

  const partialEvents = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":7,"output_tokens":1}}}',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}',
    '',
  ].join('\n')

  const reader = {
    async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
      readCalls += 1
      if (readCalls === 1) {
        return { done: false, value: encoder.encode(partialEvents) }
      }

      return new Promise((_resolve, reject) => {
        const rejectAsAbort = () => {
          const error = new Error('stream read aborted')
          error.name = 'AbortError'
          reject(error)
        }
        controller.signal.addEventListener('abort', rejectAsAbort, { once: true })
        queueMicrotask(() => controller.abort('interrupt'))
      })
    },
    async cancel(): Promise<void> {
      cancelCalls += 1
      throw new Error('reader is already errored')
    },
  }

  await withMockFetch(async () => ({
    ok: true,
    status: 200,
    body: { getReader: () => reader },
  }) as Response, async () => {
    const result = await callAnthropicAPIStream(
      request,
      'https://mock.invalid',
      'mock-key',
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
    )

    assert.equal(result.stop_reason, 'aborted')
    assert.deepEqual(result.content, [{ type: 'text', text: 'partial' }])
    assert.equal(result.usage.input_tokens, 7)
    assert.equal(result.usage.output_tokens, 1)
    assert.equal(readCalls, 2, 'the abort must happen while the second read is pending')
    assert.equal(cancelCalls, 1, 'the errored reader should still be cancelled safely')
  })
}

async function verifyNonAbortStreamReadErrorStillThrows(): Promise<void> {
  const streamError = new Error('stream exploded')
  let cancelCalls = 0
  const reader = {
    async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
      throw streamError
    },
    async cancel(): Promise<void> {
      cancelCalls += 1
    },
  }

  await withMockFetch(async () => ({
    ok: true,
    status: 200,
    body: { getReader: () => reader },
  }) as Response, async () => {
    await assert.rejects(
      callAnthropicAPIStream(request, 'https://mock.invalid', 'mock-key'),
      error => error === streamError,
    )
    assert.equal(cancelCalls, 0, 'ordinary stream errors must not be converted into aborts')
  })
}

async function verifyAbortWhileReadingErrorResponse(status: 422 | 503): Promise<void> {
  const controller = new AbortController()
  let fetchCalls = 0

  await withMockFetch(async () => {
    fetchCalls += 1
    return {
      ok: false,
      status,
      text: () => new Promise<string>((_resolve, reject) => {
        const rejectAsAbort = () => {
          const error = new Error('body read aborted')
          error.name = 'AbortError'
          reject(error)
        }
        controller.signal.addEventListener('abort', rejectAsAbort, { once: true })
        queueMicrotask(() => controller.abort('interrupt'))
      }),
    } as Response
  }, async () => {
    const result = await callAnthropicAPIStream(
      request,
      'https://mock.invalid',
      'mock-key',
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
    )

    assert.equal(result.stop_reason, 'aborted')
    assert.equal(fetchCalls, 1, `status ${status} must not throw or retry after body-read abort`)
  })
}

await verifyStringReasonTypeErrorIsAnAbort()
await verifyAbortErrorWithoutSignalStateIsCompatible()
await verifyAbortInterruptsTransientResponseBackoff()
await verifyAbortInterruptsFetchFailureBackoff()
await verifyPendingStreamReadReturnsPartialResultOnAbort()
await verifyNonAbortStreamReadErrorStillThrows()
await verifyAbortWhileReadingErrorResponse(422)
await verifyAbortWhileReadingErrorResponse(503)

console.log('llm-api abort handling verification passed')

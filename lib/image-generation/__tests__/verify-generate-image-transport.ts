import assert from 'node:assert/strict'
import { ImageGenerationProviderError } from '../errors'
import { NewApiChatImageAdapter } from '../providers/newapi-chat-image'
import { fetchImageGenerationJSON } from '../transport'

function headersThenStalledBody(onHeaders?: () => void): typeof fetch {
  return (async (_url, init) => {
    const signal = init?.signal
    if (!signal) throw new Error('GenerateImage request did not include an AbortSignal')
    onHeaders?.()
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => new Promise((_resolve, reject) => {
        const abort = () => reject(signal.reason ?? new Error('aborted'))
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
      }),
    } as Response
  }) as typeof fetch
}

// The timeout remains armed after response headers and aborts a stalled body.
{
  let sawHeaders = false
  const startedAt = Date.now()
  await assert.rejects(fetchImageGenerationJSON({
    url: 'https://provider.invalid/stalled-body',
    init: { method: 'POST' },
    timeoutMs: 40,
    fetchImpl: headersThenStalledBody(() => { sawHeaders = true }),
  }), error => {
    assert.equal((error as Error).name, 'TimeoutError')
    assert.match((error as Error).message, /timed out/)
    return true
  })
  assert.equal(sawHeaders, true)
  assert.ok(Date.now() - startedAt < 2_000)
}

// Caller cancellation after headers also interrupts body consumption.
{
  let headersSent!: () => void
  const sawHeaders = new Promise<void>(resolve => { headersSent = resolve })
  const controller = new AbortController()
  const request = fetchImageGenerationJSON({
    url: 'https://provider.invalid/abort-after-headers',
    init: { method: 'POST' },
    signal: controller.signal,
    timeoutMs: 5_000,
    fetchImpl: headersThenStalledBody(headersSent),
  })
  await sawHeaders
  const cancellation = new Error('cancelled after provider headers')
  cancellation.name = 'AbortError'
  controller.abort(cancellation)
  await assert.rejects(request, error => {
    assert.equal((error as Error).name, 'AbortError')
    assert.match((error as Error).message, /cancelled after provider headers/)
    return true
  })
}

// Text-to-image uses the one supported NewAPI Chat contract and emits server-only bytes.
{
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const adapter = new NewApiChatImageAdapter({
    apiKey: 'test-key',
    apiBase: 'https://api.test/v1',
    allowPaidCalls: true,
    fetchImpl: (async (url, init) => {
      capturedUrl = String(url)
      capturedInit = init
      return new Response(JSON.stringify({
        choices: [{
          message: {
            images: [{
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${Buffer.from('generated-image').toString('base64')}`,
              },
            }],
          },
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_test' },
      })
    }) as typeof fetch,
  })
  const output = await adapter.generate({ prompt: 'a quiet room', aspectRatio: '16:9' })
  assert.equal(capturedUrl, 'https://api.test/v1/chat/completions')
  assert.equal(capturedInit?.method, 'POST')
  assert.equal(capturedInit?.redirect, 'error')
  const body = JSON.parse(String(capturedInit?.body))
  assert.equal(body.model, 'GPT-image-2')
  assert.deepEqual(body.modalities, ['text', 'image'])
  assert.equal(body.messages[0].role, 'user')
  assert.match(body.messages[0].content, /16:9/)
  assert.equal(new Headers(capturedInit?.headers).get('content-type'), 'application/json')
  assert.equal(output.buffer.toString(), 'generated-image')
  assert.equal(output.mimeType, 'image/png')
  assert.equal(output.providerRequestId, 'req_test')
}

// Single-image editing embeds owned Workspace bytes as a Data URL in the Chat message.
{
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const adapter = new NewApiChatImageAdapter({
    apiKey: 'test-key',
    apiBase: 'https://api.test/v1',
    allowPaidCalls: true,
    fetchImpl: (async (url, init) => {
      capturedUrl = String(url)
      capturedInit = init
      return new Response(JSON.stringify({
        id: 'chatcmpl_image_edit',
        choices: [{
          message: {
            content: [
              { type: 'text', text: 'done' },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/webp;base64,${Buffer.from('edited-image').toString('base64')}`,
                },
              },
            ],
          },
        }],
      }), { status: 200 })
    }) as typeof fetch,
  })
  const output = await adapter.generate({
    prompt: 'move the chair',
    source: {
      assetId: 'asset_parent',
      mimeType: 'image/png',
      buffer: Buffer.from('local-workspace-image'),
    },
  })
  assert.equal(capturedUrl, 'https://api.test/v1/chat/completions')
  const body = JSON.parse(String(capturedInit?.body))
  assert.equal(body.messages[0].content[0].type, 'image_url')
  assert.equal(
    body.messages[0].content[0].image_url.url,
    `data:image/png;base64,${Buffer.from('local-workspace-image').toString('base64')}`,
  )
  assert.deepEqual(body.messages[0].content[1], {
    type: 'text',
    text: 'move the chair',
  })
  assert.equal(output.buffer.toString(), 'edited-image')
  assert.equal(output.mimeType, 'image/webp')
  assert.equal(output.providerRequestId, 'chatcmpl_image_edit')
}

// Provider identity and configuration fingerprint are stable, normalized and secret-free.
{
  const first = new NewApiChatImageAdapter({
    apiKey: 'first-secret',
    apiBase: 'https://API.TEST:443//v1///',
    model: 'GPT-image-2',
  })
  const sameConfiguration = new NewApiChatImageAdapter({
    apiKey: 'different-secret',
    apiBase: 'https://api.test/v1',
    model: 'GPT-image-2',
  })
  const differentModel = new NewApiChatImageAdapter({
    apiKey: 'first-secret',
    apiBase: 'https://api.test/v1',
    model: 'another-image-model',
  })
  assert.equal(first.provider, 'newapi-chat-image-v1')
  assert.match(first.configurationFingerprint, /^[a-f0-9]{64}$/)
  assert.equal(first.configurationFingerprint, sameConfiguration.configurationFingerprint)
  assert.notEqual(first.configurationFingerprint, differentModel.configurationFingerprint)
  assert.doesNotMatch(first.configurationFingerprint, /secret|api\.test/i)
}

// The paid-call gate is enforced inside the adapter before any provider I/O.
{
  let fetchCalls = 0
  const adapter = new NewApiChatImageAdapter({
    apiKey: 'test-key',
    apiBase: 'https://api.test/v1',
    allowPaidCalls: false,
    fetchImpl: (async () => {
      fetchCalls += 1
      throw new Error('must not fetch')
    }) as typeof fetch,
  })
  await assert.rejects(adapter.generate({ prompt: 'must stay local' }), error => {
    assert.ok(error instanceof ImageGenerationProviderError)
    assert.equal(error.code, 'provider_paid_calls_disabled')
    assert.equal(error.requestMayHaveBeenAccepted, false)
    return true
  })
  assert.equal(fetchCalls, 0)
}

// Invalid gateway bases fail locally and never expose data through redirects or URL fields.
for (const apiBase of [
  'ftp://api.test/v1',
  'https://user:password@api.test/v1',
  'https://api.test/v1?token=secret',
  'https://api.test/v1/v1',
]) {
  let fetchCalls = 0
  const adapter = new NewApiChatImageAdapter({
    apiKey: 'test-key',
    apiBase,
    allowPaidCalls: true,
    fetchImpl: (async () => {
      fetchCalls += 1
      throw new Error('must not fetch')
    }) as typeof fetch,
  })
  await assert.rejects(adapter.generate({ prompt: 'must stay local' }), error => {
    assert.ok(error instanceof ImageGenerationProviderError)
    assert.equal(error.code, 'provider_invalid_configuration')
    assert.equal(error.requestMayHaveBeenAccepted, false)
    return true
  })
  assert.equal(fetchCalls, 0)
}

// Oversized Workspace source bytes are rejected before Data URL encoding or provider I/O.
{
  let fetchCalls = 0
  const adapter = new NewApiChatImageAdapter({
    apiKey: 'test-key',
    apiBase: 'https://api.test/v1',
    allowPaidCalls: true,
    maxSourceImageBytes: 3,
    fetchImpl: (async () => {
      fetchCalls += 1
      throw new Error('must not fetch')
    }) as typeof fetch,
  })
  await assert.rejects(adapter.generate({
    prompt: 'edit this',
    source: {
      assetId: 'asset_too_large',
      mimeType: 'image/png',
      buffer: Buffer.from('four'),
    },
  }), error => {
    assert.ok(error instanceof ImageGenerationProviderError)
    assert.equal(error.code, 'provider_source_image_too_large')
    assert.equal(error.requestMayHaveBeenAccepted, false)
    return true
  })
  assert.equal(fetchCalls, 0)
}

// Every unusable HTTP 2xx payload is ambiguous because the generation may have been billed.
for (const testCase of [
  {
    name: 'no message',
    payload: { choices: [] },
    code: 'provider_returned_no_message',
  },
  {
    name: 'no image',
    payload: { choices: [{ message: { content: 'text only' } }] },
    code: 'provider_returned_no_image',
  },
  {
    name: 'invalid base64',
    payload: {
      choices: [{
        message: {
          images: [{ image_url: { url: 'data:image/png;base64,%%%' } }],
        },
      }],
    },
    code: 'invalid_provider_image',
  },
  {
    name: 'invalid schema',
    payload: { choices: { unexpected: true } },
    code: 'invalid_provider_schema',
  },
]) {
  const adapter = new NewApiChatImageAdapter({
    apiKey: 'test-key',
    apiBase: 'https://api.test/v1',
    allowPaidCalls: true,
    fetchImpl: (async () => new Response(JSON.stringify(testCase.payload), {
      status: 200,
    })) as typeof fetch,
  })
  await assert.rejects(adapter.generate({ prompt: testCase.name }), error => {
    assert.ok(error instanceof ImageGenerationProviderError)
    assert.equal(error.code, testCase.code)
    assert.equal(error.requestMayHaveBeenAccepted, true)
    return true
  })
}

// Oversized 2xx image output is also unknown and is not materialized.
{
  const adapter = new NewApiChatImageAdapter({
    apiKey: 'test-key',
    apiBase: 'https://api.test/v1',
    allowPaidCalls: true,
    maxProviderImageBytes: 3,
    fetchImpl: (async () => new Response(JSON.stringify({
      choices: [{
        message: {
          images: [{
            image_url: {
              url: `data:image/png;base64,${Buffer.from('four').toString('base64')}`,
            },
          }],
        },
      }],
    }), { status: 200 })) as typeof fetch,
  })
  await assert.rejects(adapter.generate({ prompt: 'large result' }), error => {
    assert.ok(error instanceof ImageGenerationProviderError)
    assert.equal(error.code, 'provider_image_too_large')
    assert.equal(error.requestMayHaveBeenAccepted, true)
    return true
  })
}

// A provider 4xx is a definitive non-accepted failure; callers may expose a new retry.
{
  const adapter = new NewApiChatImageAdapter({
    apiKey: 'test-key',
    apiBase: 'https://api.test/v1',
    allowPaidCalls: true,
    fetchImpl: (async () => new Response(
      JSON.stringify({ error: { message: 'bad prompt' } }),
      { status: 400 },
    )) as typeof fetch,
  })
  await assert.rejects(adapter.generate({ prompt: 'bad' }), error => {
    assert.ok(error instanceof ImageGenerationProviderError)
    assert.equal(error.requestMayHaveBeenAccepted, false)
    assert.equal(error.code, 'provider_http_400')
    return true
  })
}

// Ambiguous HTTP statuses remain unknown instead of permitting a paid replay.
for (const status of [408, 409, 425, 499, 502]) {
  const adapter = new NewApiChatImageAdapter({
    apiKey: 'test-key',
    apiBase: 'https://api.test/v1',
    allowPaidCalls: true,
    fetchImpl: (async () => new Response(
      JSON.stringify({ error: { message: 'gateway lost upstream response' } }),
      { status },
    )) as typeof fetch,
  })
  await assert.rejects(adapter.generate({ prompt: 'an uncertain request' }), error => {
    assert.ok(error instanceof ImageGenerationProviderError)
    assert.equal(error.requestMayHaveBeenAccepted, true)
    assert.equal(error.code, `provider_http_${status}`)
    return true
  })
}

console.log('GenerateImage transport verification passed.')

import assert from 'node:assert/strict'
import { ImageGenerationProviderError } from '../errors'
import { OpenAIGptImage2Adapter } from '../providers/openai-gpt-image-2'
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

// Text-to-image uses the official generations contract and emits server-only bytes.
{
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const adapter = new OpenAIGptImage2Adapter({
    apiKey: 'test-key',
    apiBase: 'https://api.test/v1',
    fetchImpl: (async (url, init) => {
      capturedUrl = String(url)
      capturedInit = init
      return new Response(JSON.stringify({
        data: [{ b64_json: Buffer.from('generated-image').toString('base64') }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_test' },
      })
    }) as typeof fetch,
  })
  const output = await adapter.generate({ prompt: 'a quiet room', aspectRatio: '16:9' })
  assert.equal(capturedUrl, 'https://api.test/v1/images/generations')
  assert.equal(capturedInit?.method, 'POST')
  const body = JSON.parse(String(capturedInit?.body))
  assert.equal(body.model, 'gpt-image-2')
  assert.equal(body.size, '1536x1024')
  assert.match(body.prompt, /16:9/)
  assert.equal(output.buffer.toString(), 'generated-image')
  assert.equal(output.providerRequestId, 'req_test')
}

// Single-image editing uses multipart bytes, never a caller-provided remote URL.
{
  let capturedInit: RequestInit | undefined
  const adapter = new OpenAIGptImage2Adapter({
    apiKey: 'test-key',
    apiBase: 'https://api.test/v1',
    fetchImpl: (async (_url, init) => {
      capturedInit = init
      return new Response(JSON.stringify({
        data: [{ b64_json: Buffer.from('edited-image').toString('base64') }],
      }), { status: 200 })
    }) as typeof fetch,
  })
  await adapter.generate({
    prompt: 'move the chair',
    source: {
      assetId: 'asset_parent',
      mimeType: 'image/png',
      buffer: Buffer.from('local-workspace-image'),
    },
  })
  assert.ok(capturedInit?.body instanceof FormData)
  const form = capturedInit!.body as FormData
  assert.equal(form.get('model'), 'gpt-image-2')
  assert.equal(form.get('prompt'), 'move the chair')
  assert.ok(form.get('image') instanceof Blob)
  assert.equal(new Headers(capturedInit?.headers).has('content-type'), false)
}

// A provider 4xx is a definitive non-accepted failure; callers may expose a new retry.
{
  const adapter = new OpenAIGptImage2Adapter({
    apiKey: 'test-key',
    apiBase: 'https://api.test/v1',
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

console.log('GenerateImage transport verification passed.')

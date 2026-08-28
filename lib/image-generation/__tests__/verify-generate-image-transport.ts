import assert from 'node:assert/strict'
import { ImageGenerationProviderError } from '../errors'
import { NewApiChatImageAdapter } from '../providers/newapi-chat-image'
import { fetchImageGenerationJSON } from '../transport'

const IMAGE_BYTES = {
  png: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGPgEpH7DwABpAE8k4sOtwAAAABJRU5ErkJggg==', 'base64'),
  jpeg: Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAwT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCbAFAH/9k=', 'base64'),
  webp: Buffer.from('UklGRi4AAABXRUJQVlA4ICIAAABwAQCdASoBAAEAAUAmJZQCdAFAAAD+/DeBV/fU6D4r4AAA', 'base64'),
  gif: Buffer.from('R0lGODlhAQABAIAAAExpcQoUHiH5BAUAAAAALAAAAAABAAEAAAICTAEAOw==', 'base64'),
} as const

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
                url: `data:image/png;base64,${IMAGE_BYTES.png.toString('base64')}`,
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
  assert.ok(output.buffer.equals(IMAGE_BYTES.png))
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
                  url: `data:image/webp;base64,${IMAGE_BYTES.webp.toString('base64')}`,
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
  assert.ok(output.buffer.equals(IMAGE_BYTES.webp))
  assert.equal(output.mimeType, 'image/webp')
  assert.equal(output.providerRequestId, 'chatcmpl_image_edit')
}

// NewAPI gateways may preserve Chat, Images or Responses output envelopes.
// The adapter accepts their common in-body Base64/Data URL variants without
// changing the frozen Chat Completions request endpoint.
for (const testCase of [
  {
    name: 'singleton Chat choice and raw images string',
    payload: {
      id: 'chat_singleton',
      choices: {
        message: {
          images: IMAGE_BYTES.png.toString('base64'),
        },
      },
    },
    expected: IMAGE_BYTES.png,
    mimeType: 'image/png',
    requestId: 'chat_singleton',
  },
  {
    name: 'singleton Chat image object with url',
    payload: {
      id: 'chat_image_url',
      choices: [{
        message: {
          images: {
            url: `data:image/jpeg;base64,${IMAGE_BYTES.jpeg.toString('base64')}`,
          },
        },
      }],
    },
    expected: IMAGE_BYTES.jpeg,
    mimeType: 'image/jpeg',
    requestId: 'chat_image_url',
  },
  {
    name: 'singleton Chat content object with image_url string',
    payload: {
      id: 'chat_content_object',
      choices: [{
        message: {
          content: {
            type: 'image_url',
            image_url: `data:image/webp;base64,${IMAGE_BYTES.webp.toString('base64')}`,
          },
        },
      }],
    },
    expected: IMAGE_BYTES.webp,
    mimeType: 'image/webp',
    requestId: 'chat_content_object',
  },
  {
    name: 'Images data b64_json preferred over a remote url',
    payload: {
      id: 'images_b64_json',
      data: [{
        url: 'https://remote.invalid/must-not-download.png',
        b64_json: IMAGE_BYTES.png.toString('base64'),
      }],
    },
    expected: IMAGE_BYTES.png,
    mimeType: 'image/png',
    requestId: 'images_b64_json',
  },
  {
    name: 'Responses singleton output and content objects',
    payload: {
      id: 'responses_content',
      output: {
        content: {
          type: 'output_image',
          image_base64: IMAGE_BYTES.webp.toString('base64'),
          media_type: 'image/webp',
        },
      },
    },
    expected: IMAGE_BYTES.webp,
    mimeType: 'image/webp',
    requestId: 'responses_content',
  },
  {
    name: 'Responses content b64_json',
    payload: {
      id: 'responses_b64_json',
      output: [{
        content: [{
          type: 'output_image',
          b64_json: IMAGE_BYTES.png.toString('base64'),
        }],
      }],
    },
    expected: IMAGE_BYTES.png,
    mimeType: 'image/png',
    requestId: 'responses_b64_json',
  },
  {
    name: 'Responses image generation call result',
    payload: {
      id: 'responses_result',
      output: [{
        type: 'image_generation_call',
        result: IMAGE_BYTES.png.toString('base64'),
      }],
    },
    expected: IMAGE_BYTES.png,
    mimeType: 'image/png',
    requestId: 'responses_result',
  },
  {
    name: 'top-level image object with explicit GIF MIME',
    payload: {
      id: 'top_level_gif',
      image: {
        image_base64: IMAGE_BYTES.gif.toString('base64'),
        mime_type: 'image/gif',
      },
    },
    expected: IMAGE_BYTES.gif,
    mimeType: 'image/gif',
    requestId: 'top_level_gif',
  },
]) {
  let fetchCalls = 0
  let capturedUrl = ''
  const adapter = new NewApiChatImageAdapter({
    apiKey: 'test-key',
    apiBase: 'https://api.test/v1',
    allowPaidCalls: true,
    fetchImpl: (async (url) => {
      fetchCalls += 1
      capturedUrl = String(url)
      return new Response(JSON.stringify(testCase.payload), { status: 200 })
    }) as typeof fetch,
  })
  const output = await adapter.generate({ prompt: testCase.name })
  assert.equal(fetchCalls, 1)
  assert.equal(capturedUrl, 'https://api.test/v1/chat/completions')
  assert.ok(output.buffer.equals(testCase.expected))
  assert.equal(output.mimeType, testCase.mimeType)
  assert.equal(output.providerRequestId, testCase.requestId)
}

// A remote-only image URL is diagnostic information, never a download target.
{
  let fetchCalls = 0
  const remoteUrl = 'https://remote.invalid/generated.png?token=must-stay-private'
  const adapter = new NewApiChatImageAdapter({
    apiKey: 'test-key',
    apiBase: 'https://api.test/v1',
    allowPaidCalls: true,
    fetchImpl: (async () => {
      fetchCalls += 1
      return new Response(JSON.stringify({ data: [{ url: remoteUrl }] }), { status: 200 })
    }) as typeof fetch,
  })
  await assert.rejects(adapter.generate({ prompt: 'remote-only result' }), error => {
    assert.ok(error instanceof ImageGenerationProviderError)
    assert.equal(error.code, 'provider_returned_no_image')
    assert.match(error.message, /远程 URL 不会被下载/)
    assert.doesNotMatch(error.message, /remote\.invalid|must-stay-private/)
    return true
  })
  assert.equal(fetchCalls, 1)
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
    name: 'base64-looking text in an image field',
    payload: {
      choices: [{ message: { images: 'done' } }],
    },
    code: 'invalid_provider_image',
  },
  {
    name: 'image MIME does not match file bytes',
    payload: {
      choices: [{
        message: {
          images: `data:image/png;base64,${IMAGE_BYTES.jpeg.toString('base64')}`,
        },
      }],
    },
    code: 'invalid_provider_image',
  },
  {
    name: 'generic base64 on an output text part',
    payload: {
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          base64: IMAGE_BYTES.png.toString('base64'),
        }],
      }],
    },
    code: 'provider_returned_no_image',
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
    assert.match(error.message, /响应结构/)
    return true
  })
}

// Parse diagnostics expose shape only: keys, types and array lengths. Scalar
// values such as credentials, URLs, model text and encoded image bytes stay out.
{
  const secret = 'provider-secret-that-must-not-appear'
  const encodedImageBytes = Buffer.alloc(128, 0xab).toString('base64')
  const secretAsKey = 'short-secret-key'
  const encodedBytesAsKey = encodedImageBytes.slice(0, 16)
  const remoteUrl = `https://remote.invalid/result.png?api_key=${secret}`
  const providerText = `gateway diagnostic containing ${secret}`
  const adapter = new NewApiChatImageAdapter({
    apiKey: 'test-key',
    apiBase: 'https://api.test/v1',
    allowPaidCalls: true,
    fetchImpl: (async () => new Response(JSON.stringify({
      api_key: secret,
      [secretAsKey]: true,
      diagnostics: {
        raw_image_bytes: encodedImageBytes,
        remote_url: remoteUrl,
        [encodedBytesAsKey]: 'encoded bytes placed in a property name',
      },
      output: [{
        content: [{ type: 'output_text', text: providerText }],
      }],
    }), { status: 200 })) as typeof fetch,
  })
  await assert.rejects(adapter.generate({ prompt: 'shape-only diagnostics' }), error => {
    assert.ok(error instanceof ImageGenerationProviderError)
    assert.equal(error.code, 'provider_returned_no_image')
    assert.match(error.message, /api_key:string/)
    assert.match(error.message, /\[opaque-key\]:string/)
    assert.match(error.message, /output:array\(len=1\)/)
    assert.doesNotMatch(error.message, new RegExp(secret))
    assert.doesNotMatch(error.message, new RegExp(encodedImageBytes))
    assert.doesNotMatch(error.message, new RegExp(secretAsKey))
    assert.doesNotMatch(error.message, new RegExp(encodedBytesAsKey))
    assert.doesNotMatch(error.message, /raw_image_bytes|remote\.invalid|gateway diagnostic/)
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

// Provider error bodies must never persist or return a configured raw key,
// even when a gateway echoes it outside an Authorization header.
{
  const previousKey = process.env.LLM_API_KEY_TOOLS
  const secret = 'operator-image-secret-never-print'
  process.env.LLM_API_KEY_TOOLS = secret
  try {
    const adapter = new NewApiChatImageAdapter({
      apiKey: secret,
      apiBase: 'https://api.test/v1',
      allowPaidCalls: true,
      fetchImpl: (async () => new Response(
        JSON.stringify({ error: { message: `gateway echoed ${secret}`, api_key: secret } }),
        { status: 400 },
      )) as typeof fetch,
    })
    await assert.rejects(adapter.generate({ prompt: 'redaction fixture' }), error => {
      assert.ok(error instanceof ImageGenerationProviderError)
      assert.doesNotMatch(error.message, new RegExp(secret))
      assert.match(error.message, /\[REDACTED\]/)
      return true
    })
  } finally {
    if (previousKey === undefined) delete process.env.LLM_API_KEY_TOOLS
    else process.env.LLM_API_KEY_TOOLS = previousKey
  }
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

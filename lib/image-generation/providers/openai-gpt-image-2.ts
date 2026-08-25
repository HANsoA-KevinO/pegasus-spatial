import { boundedErrorMessage, ImageGenerationProviderError } from '../errors'
import { fetchImageGenerationJSON } from '../transport'
import type {
  ImageAspectRatio,
  ImageGenerationOutput,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from '../types'

const OFFICIAL_OPENAI_API_BASE = 'https://api.openai.com/v1'

function sizeForAspectRatio(ratio: ImageAspectRatio | undefined): '1024x1024' | '1536x1024' | '1024x1536' {
  if (!ratio || ratio === '1:1') return '1024x1024'
  const [width, height] = ratio.split(':').map(Number)
  return width > height ? '1536x1024' : '1024x1536'
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
    default: return 'png'
  }
}

function parseOutput(data: unknown, requestId?: string): ImageGenerationOutput {
  const payload = data as {
    data?: Array<{ b64_json?: unknown; revised_prompt?: unknown }>
  }
  const first = payload?.data?.[0]
  if (!first || typeof first.b64_json !== 'string' || !first.b64_json) {
    throw new ImageGenerationProviderError('OpenAI returned no generated image bytes', {
      code: 'provider_returned_no_image',
      requestMayHaveBeenAccepted: false,
    })
  }
  let buffer: Buffer
  try {
    buffer = Buffer.from(first.b64_json, 'base64')
  } catch (error) {
    throw new ImageGenerationProviderError('OpenAI returned invalid base64 image bytes', {
      code: 'invalid_provider_image',
      requestMayHaveBeenAccepted: false,
      cause: error,
    })
  }
  if (buffer.length === 0) {
    throw new ImageGenerationProviderError('OpenAI returned an empty generated image', {
      code: 'empty_provider_image',
      requestMayHaveBeenAccepted: false,
    })
  }
  return {
    buffer,
    mimeType: 'image/png',
    revisedPrompt: typeof first.revised_prompt === 'string' ? first.revised_prompt : undefined,
    providerRequestId: requestId,
  }
}

export interface OpenAIGptImage2AdapterOptions {
  apiKey?: string
  model?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Tests only. Production deliberately stays on the official Images API. */
  apiBase?: string
}

export class OpenAIGptImage2Adapter implements ImageGenerationProvider {
  readonly provider = 'openai'
  readonly model: string
  private readonly apiKey?: string
  private readonly fetchImpl?: typeof fetch
  private readonly timeoutMs?: number
  private readonly apiBase: string

  constructor(options: OpenAIGptImage2AdapterOptions = {}) {
    this.apiKey = options.apiKey
    this.model = options.model?.trim()
      || process.env.PEGASUS_SPATIAL_IMAGE_MODEL?.trim()
      || 'gpt-image-2'
    this.fetchImpl = options.fetchImpl
    this.timeoutMs = options.timeoutMs
    this.apiBase = (options.apiBase || OFFICIAL_OPENAI_API_BASE).replace(/\/+$/, '')
  }

  async generate(input: ImageGenerationRequest): Promise<ImageGenerationOutput> {
    const apiKey = this.apiKey || process.env.OPENAI_API_KEY?.trim()
    if (!apiKey) {
      throw new ImageGenerationProviderError('OPENAI_API_KEY is not configured', {
        code: 'provider_not_configured',
        requestMayHaveBeenAccepted: false,
      })
    }

    const requestedRatio = input.aspectRatio
    const ratioInstruction = requestedRatio && requestedRatio !== '1:1'
      ? `\n\nCompose the image for a ${requestedRatio} aspect ratio.`
      : ''
    const prompt = `${input.prompt}${ratioInstruction}`
    const size = sizeForAspectRatio(requestedRatio)

    let url: string
    let init: RequestInit
    if (input.source) {
      url = `${this.apiBase}/images/edits`
      const form = new FormData()
      form.set('model', this.model)
      form.set('prompt', prompt)
      form.set('size', size)
      form.set('n', '1')
      form.set(
        'image',
        new Blob([new Uint8Array(input.source.buffer)], { type: input.source.mimeType }),
        `source.${extensionForMime(input.source.mimeType)}`,
      )
      init = {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      }
    } else {
      url = `${this.apiBase}/images/generations`
      init = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt,
          size,
          n: 1,
        }),
      }
    }

    let response
    try {
      response = await fetchImageGenerationJSON({
        url,
        init,
        signal: input.signal,
        timeoutMs: this.timeoutMs,
        fetchImpl: this.fetchImpl,
      })
    } catch (error) {
      if (error instanceof ImageGenerationProviderError) throw error
      throw new ImageGenerationProviderError(boundedErrorMessage(error), {
        code: error instanceof Error && error.name === 'TimeoutError'
          ? 'provider_timeout'
          : error instanceof Error && error.name === 'AbortError'
            ? 'provider_cancelled'
            : 'provider_transport_error',
        requestMayHaveBeenAccepted: true,
        cause: error,
      })
    }

    if (!response.ok) {
      const message = boundedErrorMessage(response.errorText || `HTTP ${response.status}`)
      throw new ImageGenerationProviderError(
        `OpenAI Images API ${response.status}: ${message}`,
        {
          code: `provider_http_${response.status}`,
          requestMayHaveBeenAccepted: response.status >= 500,
        },
      )
    }
    return parseOutput(response.data, response.requestId)
  }
}

export function createDefaultImageGenerationProvider(): ImageGenerationProvider {
  return new OpenAIGptImage2Adapter()
}

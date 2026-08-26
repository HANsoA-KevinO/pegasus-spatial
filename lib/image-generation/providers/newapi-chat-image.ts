import { createHash } from 'node:crypto'
import { LLM_API_KEY_TOOLS, LLM_BASE_URL } from '../../llm-config'
import { boundedErrorMessage, ImageGenerationProviderError } from '../errors'
import { fetchImageGenerationJSON } from '../transport'
import type {
  ImageGenerationOutput,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from '../types'

const NEWAPI_CHAT_IMAGE_CONTRACT_VERSION = 'newapi-chat-image-v1'
const DEFAULT_NEWAPI_IMAGE_MODEL = 'GPT-image-2'
const DEFAULT_MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_PROVIDER_IMAGE_BYTES = 50 * 1024 * 1024
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

function promptWithAspectRatio(input: ImageGenerationRequest): string {
  if (!input.aspectRatio) return input.prompt
  return `${input.prompt}\n\nRender the image with a ${input.aspectRatio} aspect ratio.`
}

function normalizeApiBase(value: string): string {
  const raw = value.trim()
  if (!raw) return ''

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('NewAPI 地址不是有效 URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('NewAPI 地址只允许 HTTP 或 HTTPS')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('NewAPI 地址不能包含凭证、查询参数或片段')
  }

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.some((segment, index) => (
    segment.toLowerCase() === 'v1' && segments[index + 1]?.toLowerCase() === 'v1'
  ))) {
    throw new Error('NewAPI 地址包含重复的 /v1 路径')
  }
  const pathname = segments.length > 0 ? `/${segments.join('/')}` : ''
  return `${parsed.protocol}//${parsed.host}${pathname}`
}

function configurationFingerprint(apiBase: string, model: string): string {
  return createHash('sha256').update(JSON.stringify({
    contractVersion: NEWAPI_CHAT_IMAGE_CONTRACT_VERSION,
    apiBase,
    model,
  })).digest('hex')
}

function httpResultMayHaveBeenAccepted(status: number): boolean {
  return status >= 500 || status === 408 || status === 409 || status === 425 || status === 499
}

function sourceAsDataUrl(
  input: NonNullable<ImageGenerationRequest['source']>,
  maxBytes: number,
): string {
  const mimeType = input.mimeType.trim().toLowerCase()
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new ImageGenerationProviderError(
      `NewAPI 不支持输入图片类型：${input.mimeType}`,
      {
        code: 'unsupported_source_mime',
        requestMayHaveBeenAccepted: false,
      },
    )
  }
  if (input.buffer.length === 0) {
    throw new ImageGenerationProviderError('输入图片为空', {
      code: 'empty_source_image',
      requestMayHaveBeenAccepted: false,
    })
  }
  if (input.buffer.length > maxBytes) {
    throw new ImageGenerationProviderError(
      `输入图片超过 ${Math.floor(maxBytes / (1024 * 1024))} MiB 上限`,
      {
        code: 'provider_source_image_too_large',
        requestMayHaveBeenAccepted: false,
      },
    )
  }
  return `data:${mimeType};base64,${input.buffer.toString('base64')}`
}

function decodeImageDataUrl(
  value: unknown,
  maxBytes: number,
): { buffer: Buffer; mimeType: string } | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([^\s]+)$/i)
  if (!match) return null

  const mimeType = match[1].toLowerCase()
  const encoded = match[2]
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new ImageGenerationProviderError('NewAPI 返回了无效的图片 Base64', {
      code: 'invalid_provider_image',
      requestMayHaveBeenAccepted: true,
    })
  }

  const paddingBytes = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const estimatedBytes = Math.floor(encoded.length * 3 / 4) - paddingBytes
  if (estimatedBytes > maxBytes) {
    throw new ImageGenerationProviderError('NewAPI 返回图片超过允许的大小上限', {
      code: 'provider_image_too_large',
      requestMayHaveBeenAccepted: true,
    })
  }

  const buffer = Buffer.from(encoded, 'base64')
  const canonicalInput = encoded.replace(/=+$/, '')
  const canonicalOutput = buffer.toString('base64').replace(/=+$/, '')
  if (buffer.length === 0 || buffer.length > maxBytes || canonicalInput !== canonicalOutput) {
    throw new ImageGenerationProviderError('NewAPI 返回了无效的图片 Base64', {
      code: 'invalid_provider_image',
      requestMayHaveBeenAccepted: true,
    })
  }
  return { buffer, mimeType }
}

function imageUrlFromPart(part: unknown): unknown {
  if (!part || typeof part !== 'object') return undefined
  const imageUrl = (part as { image_url?: unknown }).image_url
  if (typeof imageUrl === 'string') return imageUrl
  if (!imageUrl || typeof imageUrl !== 'object') return undefined
  return (imageUrl as { url?: unknown }).url
}

function parseOutput(
  data: unknown,
  maxBytes: number,
  headerRequestId?: string,
): ImageGenerationOutput {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ImageGenerationProviderError('NewAPI 返回结构无效', {
      code: 'invalid_provider_schema',
      requestMayHaveBeenAccepted: true,
    })
  }
  const payload = data as {
    id?: unknown
    choices?: Array<{
      message?: {
        images?: unknown
        content?: unknown
      }
    }>
  }
  if (payload.choices !== undefined && !Array.isArray(payload.choices)) {
    throw new ImageGenerationProviderError('NewAPI 返回结构无效', {
      code: 'invalid_provider_schema',
      requestMayHaveBeenAccepted: true,
    })
  }
  const firstChoice = payload.choices?.[0]
  if (firstChoice !== undefined && (!firstChoice || typeof firstChoice !== 'object')) {
    throw new ImageGenerationProviderError('NewAPI 返回结构无效', {
      code: 'invalid_provider_schema',
      requestMayHaveBeenAccepted: true,
    })
  }
  const message = firstChoice?.message
  if (message !== undefined && (!message || typeof message !== 'object')) {
    throw new ImageGenerationProviderError('NewAPI 返回结构无效', {
      code: 'invalid_provider_schema',
      requestMayHaveBeenAccepted: true,
    })
  }
  if (!message) {
    throw new ImageGenerationProviderError('NewAPI 返回中没有模型消息', {
      code: 'provider_returned_no_message',
      requestMayHaveBeenAccepted: true,
    })
  }

  if (
    (message.images !== undefined && !Array.isArray(message.images))
    || (
      message.content !== undefined
      && typeof message.content !== 'string'
      && !Array.isArray(message.content)
    )
  ) {
    throw new ImageGenerationProviderError('NewAPI 返回结构无效', {
      code: 'invalid_provider_schema',
      requestMayHaveBeenAccepted: true,
    })
  }

  const candidates: unknown[] = []
  if (Array.isArray(message.images)) {
    for (const image of message.images) candidates.push(imageUrlFromPart(image))
  }
  if (Array.isArray(message.content)) {
    for (const part of message.content) candidates.push(imageUrlFromPart(part))
  }

  for (const candidate of candidates) {
    const decoded = decodeImageDataUrl(candidate, maxBytes)
    if (!decoded) continue
    return {
      ...decoded,
      providerRequestId: headerRequestId
        || (typeof payload.id === 'string' ? payload.id : undefined),
    }
  }

  throw new ImageGenerationProviderError('NewAPI 返回中没有可用的 Data URL 图片', {
    code: 'provider_returned_no_image',
    requestMayHaveBeenAccepted: true,
  })
}

export interface NewApiChatImageAdapterOptions {
  apiKey?: string
  apiBase?: string
  model?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Explicit test override; production is gated by SPATIAL_PAID_CALLS_ENABLED. */
  allowPaidCalls?: boolean
  /** Tests only; production defaults are fixed in this adapter. */
  maxSourceImageBytes?: number
  /** Tests only; production defaults are fixed in this adapter. */
  maxProviderImageBytes?: number
}

/**
 * The competition build has one image transport: the proven NewAPI Chat
 * Completions contract used by the original Pegasus. There is deliberately no
 * official Images API fallback, because switching transports after an
 * ambiguous failure could submit the same paid generation twice.
 */
export class NewApiChatImageAdapter implements ImageGenerationProvider {
  readonly provider = NEWAPI_CHAT_IMAGE_CONTRACT_VERSION
  readonly model: string
  readonly configurationFingerprint: string
  private readonly apiKey: string
  private readonly apiBase: string
  private readonly fetchImpl?: typeof fetch
  private readonly timeoutMs?: number
  private readonly allowPaidCalls: boolean
  private readonly maxSourceImageBytes: number
  private readonly maxProviderImageBytes: number
  private readonly configurationError?: string

  constructor(options: NewApiChatImageAdapterOptions = {}) {
    this.apiKey = options.apiKey?.trim() || LLM_API_KEY_TOOLS.trim()
    let apiBase = ''
    let configurationError: string | undefined
    try {
      apiBase = normalizeApiBase(options.apiBase || LLM_BASE_URL)
    } catch (error) {
      configurationError = boundedErrorMessage(error)
    }
    this.apiBase = apiBase
    this.configurationError = configurationError
    this.model = options.model?.trim()
      || process.env.PEGASUS_SPATIAL_IMAGE_MODEL?.trim()
      || DEFAULT_NEWAPI_IMAGE_MODEL
    this.configurationFingerprint = configurationFingerprint(this.apiBase, this.model)
    this.fetchImpl = options.fetchImpl
    this.timeoutMs = options.timeoutMs
    this.allowPaidCalls = options.allowPaidCalls
      ?? process.env.SPATIAL_PAID_CALLS_ENABLED === '1'
    this.maxSourceImageBytes = options.maxSourceImageBytes ?? DEFAULT_MAX_SOURCE_IMAGE_BYTES
    this.maxProviderImageBytes = options.maxProviderImageBytes ?? DEFAULT_MAX_PROVIDER_IMAGE_BYTES
  }

  async generate(input: ImageGenerationRequest): Promise<ImageGenerationOutput> {
    if (!this.allowPaidCalls) {
      throw new ImageGenerationProviderError(
        '付费空间调用尚未启用；请先完成供应商预检。',
        {
          code: 'provider_paid_calls_disabled',
          requestMayHaveBeenAccepted: false,
        },
      )
    }
    if (this.configurationError) {
      throw new ImageGenerationProviderError(this.configurationError, {
        code: 'provider_invalid_configuration',
        requestMayHaveBeenAccepted: false,
      })
    }
    if (!this.apiBase || !this.apiKey) {
      throw new ImageGenerationProviderError(
        'GenerateImage 需要配置 LLM_BASE_URL 和 LLM_API_KEY_TOOLS',
        {
          code: 'provider_not_configured',
          requestMayHaveBeenAccepted: false,
        },
      )
    }

    const prompt = promptWithAspectRatio(input)
    const content = input.source
      ? [
          {
            type: 'image_url',
            image_url: { url: sourceAsDataUrl(input.source, this.maxSourceImageBytes) },
          },
          { type: 'text', text: prompt },
        ]
      : prompt
    const requestBody = {
      model: this.model,
      messages: [{ role: 'user', content }],
      modalities: ['text', 'image'],
    }

    let response
    try {
      response = await fetchImageGenerationJSON({
        url: `${this.apiBase}/chat/completions`,
        init: {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          redirect: 'error',
        },
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
        `NewAPI Chat API ${response.status}: ${message}`,
        {
          code: `provider_http_${response.status}`,
          requestMayHaveBeenAccepted: httpResultMayHaveBeenAccepted(response.status),
        },
      )
    }

    return parseOutput(response.data, this.maxProviderImageBytes, response.requestId)
  }
}

export function createDefaultImageGenerationProvider(): ImageGenerationProvider {
  return new NewApiChatImageAdapter()
}

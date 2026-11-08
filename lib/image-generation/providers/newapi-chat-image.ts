import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { LLM_API_KEY_TOOLS, LLM_BASE_URL } from '../../llm-config'
import { inspectRasterContent } from '../../media/storage'
import { boundedErrorMessage, ImageGenerationProviderError } from '../errors'
import { DEFAULT_IMAGE_GENERATION_TIMEOUT_MS, fetchImageGenerationJSON } from '../transport'
import { MAX_IMAGE_GENERATION_SOURCE_BYTES } from '../types'
import type {
  ImageGenerationOutput,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from '../types'

const NEWAPI_IMAGE_CONTRACT_VERSION = 'newapi-images-v2'
export const DEFAULT_NEWAPI_IMAGE_MODEL = 'gpt-image-2'
const DEFAULT_MAX_PROVIDER_IMAGE_BYTES = 50 * 1024 * 1024
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

interface RequestedImageSize {
  width: number
  height: number
  value: string
}

function requestedImageSize(aspectRatio?: string): RequestedImageSize | null {
  if (!aspectRatio) return null
  const [rawWidth, rawHeight] = aspectRatio.split(':')
  const targetRatio = Number(rawWidth) / Number(rawHeight)
  if (!Number.isFinite(targetRatio) || targetRatio <= 0) {
    throw new ImageGenerationProviderError('图片比例无效', {
      code: 'invalid_aspect_ratio',
      requestMayHaveBeenAccepted: false,
    })
  }
  if (targetRatio > 3 || targetRatio < 1 / 3) {
    throw new ImageGenerationProviderError(
      `GPT-image-2 的长短边比例不能超过 3:1：${aspectRatio}`,
      {
        code: 'provider_aspect_ratio_out_of_range',
        requestMayHaveBeenAccepted: false,
      },
    )
  }

  // GPT-image-2 requires 16px-aligned edges and at least 655,360 pixels.
  // Search the normal-resolution grid for the closest aspect, preferring
  // roughly one megapixel when multiple dimensions represent it exactly.
  const targetPixels = 1024 * 1024
  let best: (RequestedImageSize & { aspectError: number; areaError: number }) | null = null
  for (let width = 512; width <= 1536; width += 16) {
    for (let height = 512; height <= 1536; height += 16) {
      const pixels = width * height
      if (pixels < 655_360) continue
      const aspectError = Math.abs(Math.log((width / height) / targetRatio))
      const areaError = Math.abs(Math.log(pixels / targetPixels))
      if (
        !best
        || aspectError < best.aspectError - Number.EPSILON
        || (Math.abs(aspectError - best.aspectError) <= Number.EPSILON && areaError < best.areaError)
      ) {
        best = {
          width,
          height,
          value: `${width}x${height}`,
          aspectError,
          areaError,
        }
      }
    }
  }
  if (!best) {
    throw new ImageGenerationProviderError(`无法为图片比例 ${aspectRatio} 选择有效尺寸`, {
      code: 'provider_aspect_ratio_unsupported',
      requestMayHaveBeenAccepted: false,
    })
  }
  return { width: best.width, height: best.height, value: best.value }
}

function promptWithAspectRatio(
  input: ImageGenerationRequest,
  requestedSize: RequestedImageSize | null,
): string {
  if (!input.aspectRatio || !requestedSize) return input.prompt
  return `${input.prompt}\n\nRender the image with a ${input.aspectRatio} aspect ratio at ${requestedSize.value}. Preserve the requested composition across the full canvas.`
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

function configurationFingerprint(apiBase: string, model: string, editModel?: string, fallbackModel?: string): string {
  return createHash('sha256').update(JSON.stringify({
    contractVersion: NEWAPI_IMAGE_CONTRACT_VERSION,
    referenceVariant: 'original-if-bounded',
    apiBase,
    model,
    ...(editModel ? { editModel } : {}),
    ...(fallbackModel ? { fallback: { model: fallbackModel, protocol: 'chat_completions' } } : {}),
  })).digest('hex')
}

function httpResultMayHaveBeenAccepted(status: number): boolean {
  return status >= 500 || status === 408 || status === 409 || status === 425 || status === 499
}

// Only New API's explicit pre-dispatch rejections allow a second paid route.
// An upstream 403 can instead be a content-policy decision.
function gatewayRejectedBeforeDispatch(data: unknown): boolean {
  if (!data || typeof data !== 'object' || !('error' in data)) return false
  const error = data.error
  if (!error || typeof error !== 'object' || !('type' in error) || error.type !== 'new_api_error') return false
  const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
  const code = 'code' in error ? error.code : undefined
  return code === 'model_not_found' || code === 'no_available_channel'
    || /^(?:This token has no access to model\b|No available channel for model\b)/i.test(message)
}

function parseErrorBody(text?: string): unknown {
  try { return text ? JSON.parse(text) : undefined } catch { return undefined }
}

export function transportErrorMayHaveBeenAccepted(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined
  const code = String(
    (cause as { code?: unknown } | null)?.code
      || (error as { code?: unknown } | null)?.code
      || '',
  ).toUpperCase()
  // These failures happen before a TCP/TLS connection can deliver the POST.
  // Everything else remains ambiguous: a socket can close after the provider
  // accepted and charged the request but before its synchronous image arrives.
  return !new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'UND_ERR_CONNECT_TIMEOUT',
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ]).has(code)
}

function validateSourceImage(
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
  return mimeType
}

function decodeImageBase64(
  value: unknown,
  maxBytes: number,
): Buffer | null {
  if (typeof value !== 'string') return null
  const encoded = value
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
  return buffer
}

async function parseOutput(
  data: unknown,
  maxBytes: number,
  requestedSize: RequestedImageSize | null,
  headerRequestId?: string,
): Promise<ImageGenerationOutput> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ImageGenerationProviderError('NewAPI 返回结构无效', {
      code: 'invalid_provider_schema',
      requestMayHaveBeenAccepted: true,
    })
  }
  const payload = data as {
    id?: unknown
    data?: Array<{
      b64_json?: unknown
      revised_prompt?: unknown
    }>
  }
  if (payload.data !== undefined && !Array.isArray(payload.data)) {
    throw new ImageGenerationProviderError('NewAPI 返回结构无效', {
      code: 'invalid_provider_schema',
      requestMayHaveBeenAccepted: true,
    })
  }
  const firstImage = payload.data?.[0]
  if (firstImage !== undefined && (!firstImage || typeof firstImage !== 'object')) {
    throw new ImageGenerationProviderError('NewAPI 返回结构无效', {
      code: 'invalid_provider_schema',
      requestMayHaveBeenAccepted: true,
    })
  }

  const buffer = decodeImageBase64(firstImage?.b64_json, maxBytes)
  if (!buffer) {
    throw new ImageGenerationProviderError('NewAPI 返回中没有可用的 Base64 图片', {
      code: 'provider_returned_no_image',
      requestMayHaveBeenAccepted: true,
    })
  }

  if (requestedSize) {
    let metadata: { width?: number; height?: number }
    try {
      metadata = await sharp(buffer, { failOn: 'error' }).metadata()
    } catch (error) {
      throw new ImageGenerationProviderError('NewAPI 返回的图片无法读取尺寸', {
        code: 'invalid_provider_image',
        requestMayHaveBeenAccepted: true,
        cause: error,
      })
    }
    if (metadata.width !== requestedSize.width || metadata.height !== requestedSize.height) {
      throw new ImageGenerationProviderError(
        `NewAPI 未遵守请求尺寸：请求 ${requestedSize.value}，实际 ${metadata.width || '?'}x${metadata.height || '?'}`,
        {
          code: 'provider_aspect_ratio_mismatch',
          requestMayHaveBeenAccepted: true,
        },
      )
    }
  }

  return {
    buffer,
    mimeType: 'image/png',
    revisedPrompt: typeof firstImage?.revised_prompt === 'string'
      ? firstImage.revised_prompt
      : undefined,
    providerRequestId: headerRequestId
      || (typeof payload.id === 'string' ? payload.id : undefined),
  }
}

async function parseChatOutput(
  data: unknown,
  maxBytes: number,
  requestedSize: RequestedImageSize | null,
  requestId?: string,
): Promise<ImageGenerationOutput> {
  const payload = data as {
    id?: string
    choices?: Array<{ message?: {
      images?: Array<{ image_url?: { url?: string } }>
      content?: Array<{ image_url?: { url?: string } }> | string
    } }>
  } | null
  const message = payload?.choices?.[0]?.message
  const parts = [
    ...(Array.isArray(message?.images) ? message.images : []),
    ...(Array.isArray(message?.content) ? message.content : []),
  ]
  const inline = parts.map(part => part?.image_url?.url).find(url =>
    typeof url === 'string' && url.startsWith('data:image/'))
  const encoded = inline?.match(/^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i)?.[1]
  const buffer = decodeImageBase64(encoded, maxBytes)
  if (!buffer) throw new ImageGenerationProviderError('备用生图渠道没有返回可用的内联图片', {
    code: 'provider_returned_no_image', requestMayHaveBeenAccepted: true,
  })
  try {
    const raster = await inspectRasterContent(buffer)
    await sharp(buffer, { pages: 1, failOn: 'warning' }).resize(1, 1).raw().toBuffer()
    if (requestedSize && Math.abs((raster.width / raster.height) / (requestedSize.width / requestedSize.height) - 1) > 0.02) {
      throw new ImageGenerationProviderError(
        `备用渠道未遵守请求画幅：实际 ${raster.width}x${raster.height}`,
        { code: 'provider_aspect_ratio_mismatch', requestMayHaveBeenAccepted: true },
      )
    }
    return { buffer, mimeType: raster.mimeType, providerRequestId: requestId || payload?.id }
  } catch (error) {
    if (error instanceof ImageGenerationProviderError) throw error
    throw new ImageGenerationProviderError('备用生图渠道返回的图片无法解码', {
      code: 'invalid_provider_image', requestMayHaveBeenAccepted: true, cause: error,
    })
  }
}

export interface NewApiChatImageAdapterOptions {
  apiKey?: string
  apiBase?: string
  model?: string
  editModel?: string
  fallbackModel?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Tests only; production defaults are fixed in this adapter. */
  maxSourceImageBytes?: number
  /** Tests only; production defaults are fixed in this adapter. */
  maxProviderImageBytes?: number
}

/**
 * Freeze the routing choices in the receipt fingerprint. One backup attempt
 * is available only when the first route definitively rejected submission.
 */
export class NewApiChatImageAdapter implements ImageGenerationProvider {
  readonly provider = NEWAPI_IMAGE_CONTRACT_VERSION
  readonly model: string
  readonly configurationFingerprint: string
  private readonly apiKey: string
  private readonly apiBase: string
  private readonly fetchImpl?: typeof fetch
  private readonly timeoutMs: number
  private readonly editModel?: string
  private readonly fallbackModel?: string
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
    this.editModel = options.editModel?.trim() || undefined
    this.fallbackModel = options.fallbackModel?.trim() || undefined
    this.configurationFingerprint = configurationFingerprint(this.apiBase, this.model, this.editModel, this.fallbackModel)
    this.fetchImpl = options.fetchImpl
    this.timeoutMs = options.timeoutMs ?? DEFAULT_IMAGE_GENERATION_TIMEOUT_MS
    this.maxSourceImageBytes = options.maxSourceImageBytes ?? MAX_IMAGE_GENERATION_SOURCE_BYTES
    this.maxProviderImageBytes = options.maxProviderImageBytes ?? DEFAULT_MAX_PROVIDER_IMAGE_BYTES
  }

  async generate(input: ImageGenerationRequest): Promise<ImageGenerationOutput> {
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

    const size = requestedImageSize(input.aspectRatio)
    const primary = input.source ? this.editModel ?? this.model : this.model
    const deadline = Date.now() + this.timeoutMs
    try {
      return await this.generateAttempt(input, size, primary, false, this.timeoutMs)
    } catch (error) {
      const remainingMs = deadline - Date.now()
      if (!this.fallbackModel || this.fallbackModel === primary || input.signal?.aborted || remainingMs <= 0
        || !(error instanceof ImageGenerationProviderError) || !error.canUseBackup) throw error
      return this.generateAttempt(input, size, this.fallbackModel, true, remainingMs)
    }
  }

  private async generateAttempt(
    input: ImageGenerationRequest,
    size: RequestedImageSize | null,
    model: string,
    chat: boolean,
    timeoutMs: number,
  ): Promise<ImageGenerationOutput> {
    const prompt = promptWithAspectRatio(input, size)
    let url = `${this.apiBase}/images/generations`
    let body: BodyInit
    let contentType: string | undefined = 'application/json'
    if (chat) {
      const source = input.source
      const content = source ? [
        { type: 'image_url', image_url: { url: `data:${validateSourceImage(source, this.maxSourceImageBytes)};base64,${source.buffer.toString('base64')}` } },
        { type: 'text', text: prompt },
      ] : prompt
      url = `${this.apiBase}/chat/completions`
      body = JSON.stringify({ model, messages: [{ role: 'user', content }], modalities: ['text', 'image'] })
    } else if (input.source) {
      // Validate before constructing the multipart body or entering provider I/O.
      const sourceMimeType = validateSourceImage(input.source, this.maxSourceImageBytes)
      const form = new FormData()
      form.set('model', model)
      form.set('prompt', prompt)
      form.set('size', size?.value || 'auto')
      const extension = sourceMimeType === 'image/jpeg' ? 'jpg' : sourceMimeType.split('/')[1]
      form.set(
        'image',
        new Blob([new Uint8Array(input.source.buffer)], { type: sourceMimeType }),
        `source.${extension}`,
      )
      url = `${this.apiBase}/images/edits`
      body = form
      contentType = undefined
    } else {
      body = JSON.stringify({
        model,
        prompt,
        n: 1,
        size: size?.value || 'auto',
      })
    }

    let response
    try {
      response = await fetchImageGenerationJSON({
        url,
        init: {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            ...(contentType ? { 'Content-Type': contentType } : {}),
            'HTTP-Referer': 'https://pegasus.local',
            'X-Title': 'Pegasus Spatial',
          },
          body,
          redirect: 'error',
        },
        signal: input.signal,
        timeoutMs,
        fetchImpl: this.fetchImpl,
      })
    } catch (error) {
      if (error instanceof ImageGenerationProviderError) throw error
      const mayHaveBeenAccepted = transportErrorMayHaveBeenAccepted(error)
      throw new ImageGenerationProviderError(boundedErrorMessage(error), {
        code: error instanceof Error && error.name === 'TimeoutError'
          ? 'provider_timeout'
          : error instanceof Error && error.name === 'AbortError'
            ? 'provider_cancelled'
            : 'provider_transport_error',
        requestMayHaveBeenAccepted: mayHaveBeenAccepted,
        canUseBackup: !mayHaveBeenAccepted && !input.signal?.aborted,
        cause: error,
      })
    }

    const gatewayRejection = gatewayRejectedBeforeDispatch(response.ok ? response.data : parseErrorBody(response.errorText))
    if (!response.ok || gatewayRejection) {
      const message = boundedErrorMessage(response.errorText || `HTTP ${response.status}`)
      throw new ImageGenerationProviderError(
        `NewAPI ${chat ? 'Chat Completions' : 'Images API'} ${response.status} (${model}): ${message}`,
        {
          code: response.ok ? 'provider_gateway_rejected' : `provider_http_${response.status}`,
          requestMayHaveBeenAccepted: !gatewayRejection && httpResultMayHaveBeenAccepted(response.status),
          canUseBackup: gatewayRejection,
        },
      )
    }

    const output = chat
      ? await parseChatOutput(response.data, this.maxProviderImageBytes, size, response.requestId)
      : await parseOutput(response.data, this.maxProviderImageBytes, size, response.requestId)
    return { ...output, providerModel: model }
  }
}

export function createDefaultImageGenerationProvider(): ImageGenerationProvider {
  return new NewApiChatImageAdapter({
    editModel: process.env.PEGASUS_SPATIAL_IMAGE_EDIT_MODEL,
    fallbackModel: process.env.PEGASUS_SPATIAL_IMAGE_FALLBACK_MODEL,
  })
}

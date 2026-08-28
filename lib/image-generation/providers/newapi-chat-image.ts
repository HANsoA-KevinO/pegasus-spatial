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
  const match = value.trim().match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([^\s]+)$/i)
  if (!match) return null

  const mimeType = match[1].toLowerCase() === 'image/jpg'
    ? 'image/jpeg'
    : match[1].toLowerCase()
  const encoded = match[2]
  return decodeImageBase64(encoded, mimeType, maxBytes)
}

function decodeImageBase64(
  value: unknown,
  mimeTypeValue: unknown,
  maxBytes: number,
): { buffer: Buffer; mimeType: string } | null {
  if (typeof value !== 'string') return null
  const encoded = value.trim()
  const explicitMimeType = typeof mimeTypeValue === 'string'
    ? mimeTypeValue.trim().toLowerCase()
    : ''
  const declaredMimeType = explicitMimeType === 'image/jpg'
    ? 'image/jpeg'
    : explicitMimeType
  if (declaredMimeType && !SUPPORTED_IMAGE_MIME_TYPES.has(declaredMimeType)) {
    throw new ImageGenerationProviderError('NewAPI 返回了不支持的图片类型', {
      code: 'invalid_provider_image',
      requestMayHaveBeenAccepted: true,
    })
  }
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

  const detectedMimeType = detectImageMimeType(buffer)
  if (!detectedMimeType || (declaredMimeType && declaredMimeType !== detectedMimeType)) {
    throw new ImageGenerationProviderError('NewAPI 返回的图片类型与文件内容不一致', {
      code: 'invalid_provider_image',
      requestMayHaveBeenAccepted: true,
    })
  }
  return { buffer, mimeType: detectedMimeType }
}

function detectImageMimeType(buffer: Buffer): string | null {
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (
    buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff
  ) {
    return 'image/jpeg'
  }
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (
    buffer.length >= 6
    && (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')
  ) {
    return 'image/gif'
  }
  return null
}

type ProviderRecord = Record<string, unknown>

interface EncodedImageCandidate {
  value: unknown
  mimeType?: unknown
  allowRawBase64: boolean
}

interface CandidateCollection {
  candidates: EncodedImageCandidate[]
  schemaInvalid: boolean
  sawChatMessage: boolean
}

function isProviderRecord(value: unknown): value is ProviderRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function candidateMimeType(record: ProviderRecord, inherited?: unknown): unknown {
  return record.mime_type ?? record.media_type ?? record.mimeType ?? inherited
}

function collectUrlValue(
  value: unknown,
  state: CandidateCollection,
  mimeType?: unknown,
): void {
  if (typeof value === 'string') {
    state.candidates.push({ value, mimeType, allowRawBase64: false })
    return
  }
  if (!isProviderRecord(value)) {
    if (value !== undefined && value !== null) state.schemaInvalid = true
    return
  }

  const nestedMimeType = candidateMimeType(value, mimeType)
  if (value.b64_json !== undefined) {
    state.candidates.push({ value: value.b64_json, mimeType: nestedMimeType, allowRawBase64: true })
  }
  if (value.image_base64 !== undefined) {
    state.candidates.push({ value: value.image_base64, mimeType: nestedMimeType, allowRawBase64: true })
  }
  if (value.base64 !== undefined) {
    state.candidates.push({ value: value.base64, mimeType: nestedMimeType, allowRawBase64: true })
  }
  if (value.url !== undefined) {
    if (typeof value.url === 'string') {
      state.candidates.push({ value: value.url, mimeType: nestedMimeType, allowRawBase64: false })
    } else {
      state.schemaInvalid = true
    }
  }
}

function collectImageValue(
  value: unknown,
  state: CandidateCollection,
  options: { allowRawString: boolean; mimeType?: unknown },
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectImageValue(item, state, options)
    return
  }
  if (typeof value === 'string') {
    state.candidates.push({
      value,
      mimeType: options.mimeType,
      allowRawBase64: options.allowRawString,
    })
    return
  }
  if (!isProviderRecord(value)) {
    if (value !== undefined && value !== null) state.schemaInvalid = true
    return
  }

  const mimeType = candidateMimeType(value, options.mimeType)
  if (value.b64_json !== undefined) {
    state.candidates.push({ value: value.b64_json, mimeType, allowRawBase64: true })
  }
  if (value.image_base64 !== undefined) {
    state.candidates.push({ value: value.image_base64, mimeType, allowRawBase64: true })
  }
  if (
    value.base64 !== undefined
    && (
      options.allowRawString
      || (typeof value.type === 'string' && /image/i.test(value.type))
    )
  ) {
    state.candidates.push({ value: value.base64, mimeType, allowRawBase64: true })
  }
  if (value.url !== undefined) collectUrlValue(value.url, state, mimeType)
  if (value.image_url !== undefined) collectUrlValue(value.image_url, state, mimeType)

  if (value.source !== undefined) {
    if (isProviderRecord(value.source)) {
      const sourceMimeType = candidateMimeType(value.source, mimeType)
      if (value.source.type === 'base64' && value.source.data !== undefined) {
        state.candidates.push({
          value: value.source.data,
          mimeType: sourceMimeType,
          allowRawBase64: true,
        })
      }
      collectImageValue(value.source, state, {
        allowRawString: true,
        mimeType: sourceMimeType,
      })
    } else if (value.source !== null) {
      state.schemaInvalid = true
    }
  }

  if (value.image !== undefined) {
    collectImageValue(value.image, state, { allowRawString: true, mimeType })
  }
  if (
    value.data !== undefined
    && typeof value.type === 'string'
    && /(?:^|_)image$|base64/i.test(value.type)
  ) {
    state.candidates.push({ value: value.data, mimeType, allowRawBase64: true })
  }
}

function collectContent(
  value: unknown,
  state: CandidateCollection,
  inheritedMimeType?: unknown,
): void {
  if (Array.isArray(value)) {
    for (const part of value) collectContent(part, state, inheritedMimeType)
    return
  }
  if (typeof value === 'string') {
    // Plain model text is not image bytes. A direct Data URL remains a valid
    // image content part, but arbitrary base64-looking prose must not be used.
    state.candidates.push({ value, mimeType: inheritedMimeType, allowRawBase64: false })
    return
  }
  if (!isProviderRecord(value)) {
    if (value !== undefined && value !== null) state.schemaInvalid = true
    return
  }

  const mimeType = candidateMimeType(value, inheritedMimeType)
  collectImageValue(value, state, { allowRawString: false, mimeType })
  if (value.content !== undefined) collectContent(value.content, state, mimeType)
}

function collectPayloadCandidates(payload: ProviderRecord): CandidateCollection {
  const state: CandidateCollection = {
    candidates: [],
    schemaInvalid: false,
    sawChatMessage: false,
  }

  if (payload.choices !== undefined) {
    const choices = Array.isArray(payload.choices)
      ? payload.choices
      : isProviderRecord(payload.choices)
        ? [payload.choices]
        : []
    if (!Array.isArray(payload.choices) && !isProviderRecord(payload.choices)) {
      state.schemaInvalid = true
    }
    for (const choice of choices) {
      if (!isProviderRecord(choice)) {
        state.schemaInvalid = true
        continue
      }
      let sawSupportedChoiceField = false
      if (choice.message !== undefined) {
        sawSupportedChoiceField = true
        if (!isProviderRecord(choice.message)) {
          state.schemaInvalid = true
        } else {
          state.sawChatMessage = true
          if (choice.message.images !== undefined) {
            collectImageValue(choice.message.images, state, { allowRawString: true })
          }
          if (choice.message.content !== undefined) {
            collectContent(choice.message.content, state)
          }
        }
      }
      if (choice.images !== undefined) {
        sawSupportedChoiceField = true
        collectImageValue(choice.images, state, { allowRawString: true })
      }
      if (choice.content !== undefined) {
        sawSupportedChoiceField = true
        collectContent(choice.content, state)
      }
      if (!sawSupportedChoiceField) state.schemaInvalid = true
    }
  }

  if (payload.images !== undefined) {
    collectImageValue(payload.images, state, { allowRawString: true })
  }
  if (payload.image !== undefined) {
    collectImageValue(payload.image, state, { allowRawString: true })
  }
  if (payload.content !== undefined) collectContent(payload.content, state)

  if (payload.data !== undefined) {
    if (Array.isArray(payload.data) || isProviderRecord(payload.data)) {
      collectImageValue(payload.data, state, { allowRawString: false })
    } else {
      state.schemaInvalid = true
    }
  }

  if (payload.output !== undefined) {
    const output = Array.isArray(payload.output)
      ? payload.output
      : isProviderRecord(payload.output)
        ? [payload.output]
        : []
    if (!Array.isArray(payload.output) && !isProviderRecord(payload.output)) {
      state.schemaInvalid = true
    }
    for (const item of output) {
      if (!isProviderRecord(item)) {
        state.schemaInvalid = true
        continue
      }
      const mimeType = candidateMimeType(item)
      collectImageValue(item, state, { allowRawString: false, mimeType })
      if (item.type === 'image_generation_call' && item.result !== undefined) {
        state.candidates.push({ value: item.result, mimeType, allowRawBase64: true })
      }
      if (item.content !== undefined) collectContent(item.content, state, mimeType)
    }
  }

  return state
}

const MAX_SUMMARY_DEPTH = 5
const MAX_SUMMARY_KEYS = 10
const MAX_SUMMARY_ARRAY_ITEMS = 2
const SAFE_SUMMARY_KEYS = new Set([
  'id',
  'object',
  'created',
  'model',
  'choices',
  'index',
  'message',
  'role',
  'images',
  'image',
  'image_url',
  'url',
  'content',
  'type',
  'text',
  'data',
  'b64_json',
  'image_base64',
  'base64',
  'mime_type',
  'media_type',
  'mimeType',
  'source',
  'output',
  'result',
  'status',
  'error',
  'code',
  'detail',
  'request_id',
  'revised_prompt',
  'usage',
  'api_key',
  'diagnostics',
])

function safeSummaryKey(key: string): string {
  return SAFE_SUMMARY_KEYS.has(key) ? key : '[opaque-key]'
}

/**
 * Diagnostic shape only: property names, primitive types and array lengths.
 * No scalar value (including API keys, URLs, model text or image bytes) is
 * included in provider errors.
 */
function summarizeProviderStructure(value: unknown): string {
  const seen = new WeakSet<object>()
  const describe = (current: unknown, depth: number): string => {
    if (current === null) return 'null'
    if (Array.isArray(current)) {
      const prefix = `array(len=${current.length})`
      if (depth >= MAX_SUMMARY_DEPTH || current.length === 0) return prefix
      const samples = current
        .slice(0, MAX_SUMMARY_ARRAY_ITEMS)
        .map(item => describe(item, depth + 1))
      return `${prefix}[${samples.join(',')}${current.length > samples.length ? ',…' : ''}]`
    }
    if (typeof current !== 'object') return typeof current
    if (seen.has(current)) return 'object(circular)'
    if (depth >= MAX_SUMMARY_DEPTH) return 'object'
    seen.add(current)
    const entries = Object.entries(current as ProviderRecord)
    const shown = entries.slice(0, MAX_SUMMARY_KEYS).map(([key, nested]) => (
      `${safeSummaryKey(key)}:${describe(nested, depth + 1)}`
    ))
    seen.delete(current)
    return `{${shown.join(',')}${entries.length > shown.length ? ',…' : ''}}`
  }
  return describe(value, 0).slice(0, 1_200)
}

function outputParseError(
  message: string,
  code: string,
  data: unknown,
): ImageGenerationProviderError {
  return new ImageGenerationProviderError(
    `${message}（响应结构：${summarizeProviderStructure(data)}）`,
    {
      code,
      requestMayHaveBeenAccepted: true,
    },
  )
}

function parseOutput(
  data: unknown,
  maxBytes: number,
  headerRequestId?: string,
): ImageGenerationOutput {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw outputParseError('NewAPI 返回结构无效', 'invalid_provider_schema', data)
  }
  const payload = data as ProviderRecord
  const collected = collectPayloadCandidates(payload)
  let firstDecodeError: ImageGenerationProviderError | undefined
  for (const candidate of collected.candidates) {
    let decoded: { buffer: Buffer; mimeType: string } | null = null
    try {
      decoded = decodeImageDataUrl(candidate.value, maxBytes)
      if (!decoded && candidate.allowRawBase64) {
        if (
          typeof candidate.value === 'string'
          && /^(?:https?|blob):/i.test(candidate.value.trim())
        ) {
          continue
        }
        decoded = decodeImageBase64(candidate.value, candidate.mimeType, maxBytes)
      }
    } catch (error) {
      if (error instanceof ImageGenerationProviderError) {
        firstDecodeError ??= error
        continue
      }
      throw error
    }
    if (!decoded) continue
    return {
      ...decoded,
      providerRequestId: headerRequestId
        || (typeof payload.id === 'string' ? payload.id : undefined),
    }
  }

  if (firstDecodeError) {
    throw outputParseError(firstDecodeError.message, firstDecodeError.code, data)
  }
  if (collected.schemaInvalid) {
    throw outputParseError('NewAPI 返回结构无效', 'invalid_provider_schema', data)
  }
  if (payload.choices !== undefined && !collected.sawChatMessage) {
    throw outputParseError(
      'NewAPI 返回中没有模型消息',
      'provider_returned_no_message',
      data,
    )
  }
  throw outputParseError(
    'NewAPI 返回中没有可用的 Base64 或 Data URL 图片；远程 URL 不会被下载',
    'provider_returned_no_image',
    data,
  )
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

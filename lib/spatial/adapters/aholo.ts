import type {
  SpatialBuildJobRecord,
  SpatialProviderAdapter,
  SpatialProviderPollResult,
  SpatialProviderSubmission,
} from '../types'
import { ProviderDefinitelyNotAcceptedError } from './errors'
import type { SpatialHttpAdapterOptions } from './http-contract'
import { ContractDrivenSpatialHttpAdapter } from './http-contract'
import { createAholoOfficialWireContract } from './official-contracts'
import { uploadAholoReferenceImage, type AholoUploadSource } from './aholo-upload'
import { readOwnedSpatialReference } from './provider-reference-images'

const OFFICIAL_CN_BASE_URL = 'https://api.aholo3d.cn'

class AholoHttpAdapter extends ContractDrivenSpatialHttpAdapter {
  readonly supportedKind = 'world' as const

  constructor(options: Omit<SpatialHttpAdapterOptions, 'provider'> = {}) {
    super({
      baseUrl: OFFICIAL_CN_BASE_URL,
      contract: createAholoOfficialWireContract(),
      authorizationHeader: apiKey => apiKey,
      ...options,
      provider: 'aholo',
    })
  }
}

export interface AholoAdapterOptions extends Omit<SpatialHttpAdapterOptions, 'provider'> {
  sourceImageLoader?: (assetId: string, job: SpatialBuildJobRecord) => Promise<AholoUploadSource | null>
}

function sourceAssetId(job: SpatialBuildJobRecord): string | null {
  const options = job.request_snapshot.provider_options
  if (!options || typeof options !== 'object' || Array.isArray(options)) return null
  const value = (options as Record<string, unknown>).source_asset_id
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Aholo World adapter with the official Asset/OUS pre-upload step. */
export class AholoAdapter implements SpatialProviderAdapter {
  readonly provider = 'aholo'
  private readonly delegate: AholoHttpAdapter
  private readonly baseUrl: string
  private readonly token?: string
  private readonly allowPaidCalls: boolean
  private readonly fetchImpl: typeof fetch
  private readonly sourceImageLoader: (assetId: string, job: SpatialBuildJobRecord) => Promise<AholoUploadSource | null>

  constructor(options: AholoAdapterOptions = {}) {
    const { sourceImageLoader, ...httpOptions } = options
    this.baseUrl = options.baseUrl ?? OFFICIAL_CN_BASE_URL
    this.token = options.token
    this.allowPaidCalls = options.allowPaidCalls === true
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.sourceImageLoader = sourceImageLoader ?? readOwnedSpatialReference
    this.delegate = new AholoHttpAdapter(httpOptions)
  }

  supports(kind: SpatialBuildJobRecord['kind']): boolean {
    return kind === 'world'
  }

  async submit(
    job: SpatialBuildJobRecord,
    context: { providerIdempotencyKey: string; signal?: AbortSignal },
  ): Promise<SpatialProviderSubmission> {
    const assetId = sourceAssetId(job)
    if (!assetId) return this.delegate.submit(job, context)
    if (!this.allowPaidCalls) {
      throw new ProviderDefinitelyNotAcceptedError('aholo paid submissions are disabled; no request was sent.')
    }
    const apiKey = this.token?.trim()
    if (!apiKey) {
      throw new ProviderDefinitelyNotAcceptedError('aholo API token is not configured; no request was sent.')
    }
    const source = await this.sourceImageLoader(assetId, job)
    if (!source) {
      throw new ProviderDefinitelyNotAcceptedError('Aholo source image bytes are unavailable; World was not submitted.')
    }
    const uploadedUrl = await uploadAholoReferenceImage({
      baseUrl: this.baseUrl,
      apiKey,
      source,
      fetchImpl: this.fetchImpl,
      signal: context.signal,
    })
    const providerOptions = {
      ...(job.request_snapshot.provider_options ?? {}),
      source_image_url: uploadedUrl,
    }
    const transientJob: SpatialBuildJobRecord = {
      ...job,
      request_snapshot: { ...job.request_snapshot, provider_options: providerOptions },
    }
    return this.delegate.submit(transientJob, context)
  }

  poll(
    job: SpatialBuildJobRecord,
    context: { signal?: AbortSignal },
  ): Promise<SpatialProviderPollResult> {
    return this.delegate.poll(job, context)
  }
}

export function createAholoAdapterFromEnv(
  options: Omit<AholoAdapterOptions, 'baseUrl' | 'token' | 'allowPaidCalls'> = {},
  env: NodeJS.ProcessEnv = process.env,
): AholoAdapter {
  return new AholoAdapter({
    ...options,
    baseUrl: env.AHOLO_API_BASE_URL || OFFICIAL_CN_BASE_URL,
    token: env.AHOLO_API_KEY || env.AHOLO_API_TOKEN,
    allowPaidCalls: true,
  })
}

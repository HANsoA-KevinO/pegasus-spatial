import type { SpatialHttpAdapterOptions } from './http-contract'
import { ContractDrivenSpatialHttpAdapter, paidSpatialCallsEnabled } from './http-contract'
import { createAholoOfficialWireContract } from './official-contracts'

const OFFICIAL_CN_BASE_URL = 'https://api.aholo3d.cn'

export class AholoAdapter extends ContractDrivenSpatialHttpAdapter {
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

export function createAholoAdapterFromEnv(
  options: Omit<SpatialHttpAdapterOptions, 'provider' | 'baseUrl' | 'token' | 'allowPaidCalls'> = {},
  env: NodeJS.ProcessEnv = process.env,
): AholoAdapter {
  return new AholoAdapter({
    ...options,
    baseUrl: env.AHOLO_API_BASE_URL || OFFICIAL_CN_BASE_URL,
    token: env.AHOLO_API_KEY || env.AHOLO_API_TOKEN,
    allowPaidCalls: paidSpatialCallsEnabled(env),
  })
}

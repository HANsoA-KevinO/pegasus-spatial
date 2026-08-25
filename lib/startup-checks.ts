/**
 * Runtime environment preflight. Called once from `instrumentation.ts` before
 * the server starts serving requests. Anything required to run in production
 * but commonly forgotten (secrets, API keys, deploy URLs) goes here — we fail
 * loud on boot instead of leaving users to trip on obscure errors mid-request.
 */

interface CheckFailure {
  variable: string
  reason: string
}

const MIN_AUTH_SECRET_LEN = 32
const AUTH_SECRET_PLACEHOLDER_VALUES = new Set([
  'change-me-in-production',
  'your-secret-here',
  'replace-with-a-random-secret',
  'replace-with-at-least-32-random-characters',
  'replace-with-a-second-random-secret-at-least-32-characters',
  'replace-with-a-third-random-secret-at-least-32-characters',
  'secret',
])

function hasValidHostAllowlist(value: string | undefined): boolean {
  const entries = value?.split(',').map(item => item.trim().toLowerCase()).filter(Boolean) ?? []
  return entries.length > 0 && entries.every(host => (
    /^[a-z0-9.-]+$/.test(host)
    && !host.startsWith('.')
    && !host.endsWith('.')
    && !host.includes('..')
    && !['localhost', 'metadata.google.internal'].includes(host)
  ))
}

function isProviderReachableHttpsOrigin(value: string | undefined): boolean {
  if (!value?.trim()) return false
  try {
    const parsed = new URL(value)
    const privateHost = /^(localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|.*\.local)$/i.test(parsed.hostname)
    return parsed.protocol === 'https:' && !privateHost && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

export function runStartupChecks(): void {
  const failures: CheckFailure[] = []
  const mediaDriver = process.env.MEDIA_STORAGE_DRIVER?.trim().toLowerCase()

  // AUTH_SECRET: NextAuth signs session JWTs with this. A weak/placeholder value
  // in production means anyone can forge sessions.
  const authSecret = process.env.AUTH_SECRET
  if (!authSecret) {
    failures.push({ variable: 'AUTH_SECRET', reason: 'not set (required)' })
  } else if (authSecret.length < MIN_AUTH_SECRET_LEN) {
    failures.push({
      variable: 'AUTH_SECRET',
      reason: `length ${authSecret.length} < ${MIN_AUTH_SECRET_LEN}`,
    })
  } else if (AUTH_SECRET_PLACEHOLDER_VALUES.has(authSecret)) {
    failures.push({ variable: 'AUTH_SECRET', reason: 'matches a known placeholder value' })
  }

  // LLM gateway credentials. Without these no request can reach the model.
  for (const key of ['LLM_BASE_URL', 'LLM_API_KEY_ORCHESTRATOR', 'LLM_API_KEY_TOOLS']) {
    if (!process.env[key]) failures.push({ variable: key, reason: 'not set (required)' })
  }

  // MongoDB URI. Covered by a throw in lib/db/mongodb.ts too, but catching here
  // surfaces the misconfiguration earlier in the boot sequence.
  if (!process.env.MONGODB_URI) {
    failures.push({ variable: 'MONGODB_URI', reason: 'not set (required)' })
  }

  if (process.env.AGENT_RUNTIME_BACKGROUND_RUNNER === '1') {
    const runnerSecret = process.env.AGENT_RUNTIME_INTERNAL_SECRET
    if (!runnerSecret) {
      failures.push({
        variable: 'AGENT_RUNTIME_INTERNAL_SECRET',
        reason: 'not set (required when the durable background runner is enabled)',
      })
    } else if (runnerSecret.length < MIN_AUTH_SECRET_LEN) {
      failures.push({
        variable: 'AGENT_RUNTIME_INTERNAL_SECRET',
        reason: `length ${runnerSecret.length} < ${MIN_AUTH_SECRET_LEN}`,
      })
    } else if (AUTH_SECRET_PLACEHOLDER_VALUES.has(runnerSecret)) {
      failures.push({ variable: 'AGENT_RUNTIME_INTERNAL_SECRET', reason: 'matches a known placeholder value' })
    } else if (runnerSecret === authSecret) {
      failures.push({
        variable: 'AGENT_RUNTIME_INTERNAL_SECRET',
        reason: 'must be different from AUTH_SECRET',
      })
    }
  }

  // Paid creation is an explicit deployment boundary. A partial provider
  // configuration must stop the process before it can create durable jobs
  // that no worker can safely submit or materialize.
  if (process.env.SPATIAL_PAID_CALLS_ENABLED === '1') {
    if (process.env.SPATIAL_WORKER_ENABLED === '0') {
      failures.push({
        variable: 'SPATIAL_WORKER_ENABLED',
        reason: 'must not be 0 when paid spatial calls are enabled',
      })
    }
    for (const key of ['OPENAI_API_KEY']) {
      if (!process.env[key]?.trim()) failures.push({ variable: key, reason: 'not set (required for paid creation)' })
    }
    const providerMediaVariable = mediaDriver === 'oss'
      ? 'NEXT_PUBLIC_MEDIA_CDN_BASE_URL'
      : 'MEDIA_PUBLIC_BASE_URL'
    const providerMediaValue = mediaDriver === 'oss'
      ? process.env.NEXT_PUBLIC_MEDIA_CDN_BASE_URL || process.env.OSS_CDN_BASE_URL
      : process.env.MEDIA_PUBLIC_BASE_URL
    if (!isProviderReachableHttpsOrigin(providerMediaValue)) {
      failures.push({
        variable: providerMediaVariable,
        reason: 'must be a credential-free public HTTPS origin reachable by Aholo/Lux3D',
      })
    }
    for (const [provider, key, token, hosts] of [
      ['Aholo', 'AHOLO_API_KEY', 'AHOLO_API_TOKEN', 'AHOLO_ASSET_HOST_ALLOWLIST'],
      ['Lux3D', 'LUX3D_API_KEY', 'LUX3D_API_TOKEN', 'LUX3D_ASSET_HOST_ALLOWLIST'],
    ] as const) {
      if (!(process.env[key] || process.env[token])?.trim()) {
        failures.push({ variable: key, reason: `not set (required for paid ${provider} calls)` })
      }
      if (!hasValidHostAllowlist(process.env[hosts])) {
        failures.push({
          variable: hosts,
          reason: 'must contain one or more exact artifact hostnames discovered during H0 smoke testing',
        })
      }
    }
  }

  // GridFS is the isolated self-hosted default. If OSS is selected, its
  // credential and public-CDN configuration is treated atomically.
  if (mediaDriver === 'oss') {
    for (const key of [
      'OSS_REGION',
      'OSS_BUCKET',
      'OSS_ACCESS_KEY_ID',
      'OSS_ACCESS_KEY_SECRET',
      'OSS_CDN_BASE_URL',
      'NEXT_PUBLIC_MEDIA_CDN_BASE_URL',
    ]) {
      if (!process.env[key]) failures.push({ variable: key, reason: 'not set (required for OSS media)' })
    }
    const cdnBase = process.env.OSS_CDN_BASE_URL
    const browserCdnBase = process.env.NEXT_PUBLIC_MEDIA_CDN_BASE_URL
    let serverCdnOrigin: string | undefined
    let browserCdnOrigin: string | undefined
    for (const [variable, value] of [
      ['OSS_CDN_BASE_URL', cdnBase],
      ['NEXT_PUBLIC_MEDIA_CDN_BASE_URL', browserCdnBase],
    ] as const) {
      if (!value) continue
      try {
        const parsed = new URL(value)
        if (parsed.protocol !== 'https:') throw new Error('not HTTPS')
        if (variable === 'OSS_CDN_BASE_URL') serverCdnOrigin = parsed.origin
        else browserCdnOrigin = parsed.origin
      } catch {
        failures.push({ variable, reason: 'must be a complete HTTPS URL' })
      }
    }
    if (serverCdnOrigin && browserCdnOrigin && serverCdnOrigin !== browserCdnOrigin) {
      failures.push({
        variable: 'NEXT_PUBLIC_MEDIA_CDN_BASE_URL',
        reason: 'origin must match OSS_CDN_BASE_URL',
      })
    }
    if (process.env.NODE_ENV === 'production' && !process.env.CRON_SECRET) {
      failures.push({
        variable: 'CRON_SECRET',
        reason: 'not set (required for staged asset cleanup in production)',
      })
    }
  }

  if (failures.length > 0) {
    const lines = [
      '',
      '='.repeat(72),
      '[startup] Refusing to start — environment configuration is invalid:',
      '',
      ...failures.map(f => `  - ${f.variable}: ${f.reason}`),
      '',
      'Generate a strong AUTH_SECRET with: openssl rand -base64 32',
      'See .env.example for the full list of required variables.',
      '='.repeat(72),
      '',
    ]
    console.error(lines.join('\n'))
    process.exit(1)
  }

  console.log('[startup] Environment check passed')
}

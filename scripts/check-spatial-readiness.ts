type Check = {
  name: string
  ok: boolean
  detail: string
}

function present(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function urlCheck(name: string, value: string | undefined, expected?: {
  protocol?: string
  port?: string
  pathname?: string
}): Check {
  if (!present(value)) return { name, ok: false, detail: '未配置' }
  try {
    const parsed = new URL(value!)
    const mismatch = (
      (expected?.protocol && parsed.protocol !== expected.protocol)
      || (expected?.port && parsed.port !== expected.port)
      || (expected?.pathname && parsed.pathname.replace(/^\//, '') !== expected.pathname)
    )
    return {
      name,
      ok: !mismatch,
      detail: mismatch ? '地址未使用 Pegasus Spatial 的隔离值' : `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
    }
  } catch {
    return { name, ok: false, detail: '不是有效 URL' }
  }
}

function hostsCheck(name: string, value: string | undefined): Check {
  const hosts = (value ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean)
  const valid = hosts.length > 0 && hosts.every(host => (
    /^[a-z0-9.-]+$/.test(host)
    && !host.startsWith('.')
    && !host.endsWith('.')
    && !['localhost', 'metadata.google.internal'].includes(host)
  ))
  return {
    name,
    ok: valid,
    detail: valid ? `${hosts.length} 个已冻结产物域名` : '缺少 H0 真实响应得到的产物域名白名单',
  }
}

function providerReachableMediaCheck(): Check {
  const driver = process.env.MEDIA_STORAGE_DRIVER?.trim().toLowerCase() || 'gridfs'
  const raw = driver === 'oss'
    ? process.env.NEXT_PUBLIC_MEDIA_CDN_BASE_URL || process.env.OSS_CDN_BASE_URL
    : process.env.MEDIA_PUBLIC_BASE_URL
  const name = driver === 'oss' ? 'MEDIA CDN' : 'MEDIA_PUBLIC_BASE_URL'
  if (!present(raw)) return { name, ok: false, detail: '未配置供应商可访问的媒体地址' }
  try {
    const url = new URL(raw!)
    const privateHost = /^(localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|.*\.local)$/i.test(url.hostname)
    return {
      name,
      ok: url.protocol === 'https:' && !privateHost && !url.username && !url.password,
      detail: url.protocol === 'https:' && !privateHost ? url.origin : '必须是云端供应商可访问的公网 HTTPS origin',
    }
  } catch {
    return { name, ok: false, detail: '不是有效 URL' }
  }
}

const checks: Check[] = [
  urlCheck('APP_PUBLIC_URL', process.env.APP_PUBLIC_URL, { port: '3200' }),
  urlCheck('MONGODB_URI', process.env.MONGODB_URI, { pathname: 'pegasus_spatial' }),
  {
    name: 'OPENAI_API_KEY',
    ok: present(process.env.OPENAI_API_KEY),
    detail: present(process.env.OPENAI_API_KEY) ? '已配置（未输出）' : '未配置',
  },
  providerReachableMediaCheck(),
  urlCheck('AHOLO_API_BASE_URL', process.env.AHOLO_API_BASE_URL || 'https://api.aholo3d.cn', { protocol: 'https:' }),
  {
    name: 'AHOLO_API_KEY',
    ok: present(process.env.AHOLO_API_KEY || process.env.AHOLO_API_TOKEN),
    detail: present(process.env.AHOLO_API_KEY || process.env.AHOLO_API_TOKEN) ? '已配置（未输出）' : '未配置',
  },
  hostsCheck('AHOLO_ASSET_HOST_ALLOWLIST', process.env.AHOLO_ASSET_HOST_ALLOWLIST),
  urlCheck('LUX3D_API_BASE_URL', process.env.LUX3D_API_BASE_URL || 'https://api.aholo3d.cn', { protocol: 'https:' }),
  {
    name: 'LUX3D_API_KEY',
    ok: present(process.env.LUX3D_API_KEY || process.env.LUX3D_API_TOKEN),
    detail: present(process.env.LUX3D_API_KEY || process.env.LUX3D_API_TOKEN) ? '已配置（未输出）' : '未配置',
  },
  hostsCheck('LUX3D_ASSET_HOST_ALLOWLIST', process.env.LUX3D_ASSET_HOST_ALLOWLIST),
]

const paidEnabled = process.env.SPATIAL_PAID_CALLS_ENABLED === '1'
const report = {
  product: 'Pegasus Spatial',
  checked_at: new Date().toISOString(),
  paid_calls_enabled: paidEnabled,
  live_submission_performed: false,
  checks,
  ready_for_paid_smoke: checks.every(check => check.ok),
}

console.log(JSON.stringify(report, null, 2))
if (paidEnabled && !report.ready_for_paid_smoke) {
  console.error('付费开关已开启，但 H0 门禁未满足；拒绝将此环境视为可提交。')
  process.exitCode = 1
}

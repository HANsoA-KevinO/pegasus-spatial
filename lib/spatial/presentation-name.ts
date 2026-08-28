const GENERIC_MODEL_STEMS = new Set([
  'asset',
  'mesh',
  'model',
  'object',
  'output',
  'scene',
])

const TRAILING_TECHNICAL_TOKENS = new Set([
  'copy',
  'draft',
  'final',
  'generated',
  'latest',
  'preview',
  'render',
  'retry',
  'revised',
  'revision',
])

const PHRASE_LABELS: ReadonlyArray<{ tokens: readonly string[]; label: string }> = [
  { tokens: ['dragon', 'raja'], label: '龙族' },
  { tokens: ['sunset', 'road'], label: '海边夕阳' },
  { tokens: ['coastal', 'road'], label: '海岸公路' },
  { tokens: ['bus', 'stop'], label: '公交站牌' },
]

const TOKEN_LABELS: Readonly<Record<string, string>> = {
  beach: '海滩',
  coast: '海岸',
  coastal: '海岸',
  concept: '概念',
  evening: '黄昏',
  floating: '漂浮',
  garden: '花园',
  greenhouse: '温室',
  image: '图像',
  memory: '记忆',
  module: '模块',
  ocean: '海洋',
  old: '旧',
  reference: '参考',
  road: '公路',
  sea: '海',
  seaside: '海边',
  station: '车站',
  stop: '站牌',
  sunset: '夕阳',
  world: '世界',
}

function withoutExtension(value: string): string {
  return value.replace(/\.[a-z0-9]{1,8}$/i, '')
}

function candidateStem(path: string, type: 'image' | 'model3d'): string {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const fileStem = withoutExtension(segments.at(-1) ?? '')
  if (type !== 'model3d' || !GENERIC_MODEL_STEMS.has(fileStem.toLowerCase())) return fileStem

  for (let index = segments.length - 2; index >= 0; index -= 1) {
    const candidate = withoutExtension(segments[index] ?? '')
    if (!candidate || GENERIC_MODEL_STEMS.has(candidate.toLowerCase())) continue
    if (['objects', 'spatial', 'output'].includes(candidate.toLowerCase())) continue
    return candidate
  }
  return ''
}

function isTechnicalTail(token: string): boolean {
  const lower = token.toLowerCase()
  return TRAILING_TECHNICAL_TOKENS.has(lower)
    || /^v\d+$/i.test(lower)
    || /^\d{8,14}$/.test(lower)
    || /^[a-f0-9]{16,}$/i.test(lower)
}

function titleCase(token: string): string {
  if (!token) return token
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

function readableStem(stem: string): string {
  const rawTokens = decodeURIComponent(stem)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_.-]+/)
    .map(token => token.trim())
    .filter(Boolean)

  while (rawTokens.length > 0 && isTechnicalTail(rawTokens.at(-1)!)) rawTokens.pop()
  const semanticTokens = rawTokens.filter(token => !/^[a-f0-9]{16,}$/i.test(token))
  const chunks: string[] = []

  for (let index = 0; index < semanticTokens.length;) {
    const phrase = PHRASE_LABELS.find(candidate => (
      candidate.tokens.every((token, offset) => semanticTokens[index + offset]?.toLowerCase() === token)
    ))
    if (phrase) {
      chunks.push(phrase.label)
      index += phrase.tokens.length
      continue
    }

    const token = semanticTokens[index]
    chunks.push(TOKEN_LABELS[token.toLowerCase()] ?? (containsCjk(token) ? token : titleCase(token)))
    index += 1
  }

  if (chunks.length === 0) return ''
  return chunks.every(containsCjk) ? chunks.join('') : chunks.join(' ')
}

/**
 * Maps a durable Workspace path to a compact product-facing name. The path
 * remains the stable identity and download target; this value is presentation
 * only. New metadata-backed display names can take precedence here later,
 * while this deterministic mapper keeps legacy assets readable today.
 */
export function spatialArtifactDisplayName(path: string, type: 'image' | 'model3d'): string {
  const summary = readableStem(candidateStem(path, type))
  if (summary) return summary
  return type === 'image' ? '创作参考图' : '3D 物体'
}

/** Remove workflow-only suffixes without erasing meaningful variants. */
export function conciseSceneDisplayName(title: string): string {
  const concise = title
    .trim()
    .replace(/\s*[（(](?:组装预览|自动预览|生成预览|assembled preview|preview)[）)]\s*$/i, '')
    .replace(/\s+(?:scene|场景模型)\s*$/i, '')
    .trim()
  return concise || '未命名场景'
}

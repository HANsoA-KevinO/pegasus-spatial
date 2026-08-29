const GENERIC_MODEL_STEMS = new Set([
  'asset',
  'gaussian',
  'mesh',
  'model',
  'object',
  'output',
  'pointcloud',
  'point_cloud',
  'scene',
  'splat',
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
  { tokens: ['cyberpunk', 'hongyadong', 'modules'], label: '赛博朋克洪崖洞组合场景' },
  { tokens: ['cyberpunk', 'hongyadong'], label: '赛博朋克洪崖洞' },
  { tokens: ['food', 'stall'], label: '美食摊位' },
  { tokens: ['hover', 'car'], label: '悬浮汽车' },
  { tokens: ['mechanical', 'stairs'], label: '机械楼梯' },
  { tokens: ['river', 'boat'], label: '江上小船' },
  { tokens: ['signs', 'lanterns'], label: '招牌与灯笼' },
  { tokens: ['stilted', 'building'], label: '吊脚楼' },
  { tokens: ['dragon', 'raja'], label: '龙族' },
  { tokens: ['sunset', 'road'], label: '海边夕阳' },
  { tokens: ['coastal', 'road'], label: '海岸公路' },
  { tokens: ['bus', 'stop'], label: '公交站牌' },
]

const TOKEN_LABELS: Readonly<Record<string, string>> = {
  architecture: '建筑',
  background: '背景',
  beach: '海滩',
  boat: '小船',
  bridge: '桥梁',
  building: '建筑',
  car: '汽车',
  chongqing: '重庆',
  city: '城市',
  coast: '海岸',
  coastal: '海岸',
  concept: '概念',
  cyberpunk: '赛博朋克',
  evening: '黄昏',
  exterior: '外观',
  floating: '漂浮',
  food: '美食',
  garden: '花园',
  greenhouse: '温室',
  harbor: '港口',
  hongyadong: '洪崖洞',
  hover: '悬浮',
  image: '图像',
  interior: '室内',
  lantern: '灯笼',
  lanterns: '灯笼',
  mechanical: '机械',
  memory: '记忆',
  model: '模型',
  models: '模型',
  modern: '现代',
  module: '模块',
  modules: '模块组合',
  mountain: '山地',
  object: '物体',
  ocean: '海洋',
  old: '旧',
  pavilion: '亭台',
  plaza: '广场',
  reference: '参考',
  river: '江河',
  road: '公路',
  room: '房间',
  scene: '场景',
  sea: '海',
  seaside: '海边',
  sign: '招牌',
  signs: '招牌',
  stair: '楼梯',
  stairs: '楼梯',
  stall: '摊位',
  station: '车站',
  stop: '站牌',
  street: '街道',
  structure: '结构',
  sunset: '夕阳',
  chair: '椅子',
  tower: '塔楼',
  walkway: '步道',
  waterfront: '滨水区',
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

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

function chineseFragment(value: string): string {
  return value.replace(/[a-z]+/gi, '').trim()
}

function readableStem(stem: string): string {
  let decodedStem = stem
  try { decodedStem = decodeURIComponent(stem) } catch { /* malformed legacy paths remain usable */ }
  const rawTokens = decodedStem
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
    const mapped = TOKEN_LABELS[token.toLowerCase()]
    if (mapped) chunks.push(mapped)
    else if (containsCjk(token)) {
      const fragment = chineseFragment(token)
      if (fragment) chunks.push(fragment)
    }
    index += 1
  }

  if (chunks.length === 0) return ''
  return chunks.join('')
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
  return type === 'image' ? '创作参考图' : '三维模型'
}

/** Localize scene-card titles after removing workflow-only suffixes. */
export function conciseSceneDisplayName(title: string): string {
  const concise = title
    .trim()
    .replace(/\s*[（(](?:组装预览|自动预览|生成预览|assembled preview|preview)[）)]\s*$/i, '')
    .replace(/\s+(?:scene|场景模型)\s*$/i, '')
    .trim()
  if (!concise) return '未命名场景'
  return readableStem(concise) || '未命名场景'
}

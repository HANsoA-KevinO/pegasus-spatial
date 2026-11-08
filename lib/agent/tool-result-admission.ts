import type {
  ContentBlock,
  ConversationMessage,
  TextBlock,
  ToolResultBlock,
  ToolResultContent,
} from '../types'
import { estimateTokens } from './compaction'

export interface ToolResultAdmissionOptions {
  messages: ConversationMessage[]
  pendingResults: ContentBlock[]
  result: ToolResultBlock
  toolName: string
  toolInput: Record<string, unknown>
  contextWindow: number
  staticOverheadTokens: number
  /** API-vs-local correction from the latest completed request. */
  inputTokenCorrection?: number
  mainMaxOutputTokens: number
  /** Async-compaction boundary for the next request (fork capacity or B). */
  maxNextInputTokens?: number
  /** When the 50% observation gate constrains F, cap one turn's total growth to preserve runway. */
  maxContextGrowthTokens?: number
}

export interface ToolResultAdmissionResult {
  result: ToolResultBlock
  guarded: boolean
  projectedInputTokens: number
}

function projectedTokens(
  messages: ConversationMessage[],
  pendingResults: ContentBlock[],
  result: ToolResultBlock,
  staticOverheadTokens: number,
  inputTokenCorrection: number,
): number {
  return Math.max(0, estimateTokens([
    ...messages,
    { role: 'user', content: [...pendingResults, result] },
  ]) + staticOverheadTokens + inputTokenCorrection)
}

function textParts(content: ToolResultContent): TextBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content.filter((part): part is TextBlock => part.type === 'text')
}

function stringArg(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function recoveryInstruction(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'RunSceneCode':
      return '构建已执行。使用保留的 build_id 调用 InspectSceneBuild；必要时按 object_keys 缩小索引。不要为了找回构建 ID 而重新构建。'
    case 'InspectSceneBuild':
      return '沿用相同 build_id，指定 object_keys 或 limit/offset 获取较小分页。图片未注入时，用 Read 读取回执中的具体 preview_paths，无需 Glob 搜索。'
    case 'RenderSceneViews':
    case 'CheckSceneConstraints':
    case 'QuerySceneGeometry':
      return '沿用相同 build_id/revision_id，缩小视图或批量查询；构建没有改变。图片未注入时，Read 回执中的具体 preview_paths。没有收到图片不能声称已完成视觉判断。'
    case 'Read': {
      const path = stringArg(input, 'file_path') ?? '(unknown)'
      return `请用 Read(file_path=${path}, offset=起始行, limit=较小行数) 分段读取；先尝试 50～100 行。`
    }
    case 'Grep':
      return '请缩小 pattern 或 path 范围后重试。'
    case 'Glob':
      return '请使用更具体的文件 pattern 后重试。'
    case 'WebSearch':
      return '请拆分查询，减少单次返回的材料范围。'
    case 'ArxivSearchPapers':
      return '请减小 limit，收窄 query/filters，或使用 next_cursor 分页检索。'
    case 'SciverseSearchPapers':
      return '请减小 page_size、收窄结构化条件，或使用 next_cursor/page 分页检索。'
    case 'SciverseSearchEvidence':
      return '请减小 top_k、聚焦 query，或用 filters.doc_id 将召回硬限定在较小候选集内。'
    case 'SciverseListRelations':
      return '请减小 page_size，并按 page 分页读取引用关系。'
    case 'SearchDocument':
      return '请缩小 document_paths、降低 max_results，或使用更精确的字面查询。'
    case 'ArxivFetchPaper':
      return `PDF 与解析后正文已落入 workspace；可用 Glob 检查 references/papers 下 ${stringArg(input, 'arxiv_id') ?? '对应 arXiv 文献'} 的产物，再用 Read 或 SearchDocument 按需读取。`
    case 'SciverseFetchPaper':
      return `Sciverse 全文已落入 workspace；可用 Glob 检查 references/papers 下 ${stringArg(input, 'doc_id') ?? '对应文献'} 的产物，再用 Read 或 SearchDocument 按需读取。`
    case 'Write':
    case 'Edit':
      return `文件状态以 workspace 中的 ${stringArg(input, 'file_path') ?? '(file path)'} 为准。`
    default:
      return '请缩小单次工具结果，或先把结果写入 workspace 后再按需读取。'
  }
}

/** Executed mutations must retain their receipt even when the full geometry or
 * image result cannot fit. Losing this ID previously sent the Agent searching
 * old builds after a successful RunSceneCode. Never retain arbitrary payloads. */
function sceneCodeReceipt(options: ToolResultAdmissionOptions): string | null {
  if (!['PrepareSceneCode', 'RunSceneCode', 'InspectSceneBuild', 'RenderSceneViews', 'QuerySceneGeometry', 'CheckSceneConstraints', 'PublishSceneBuild', 'ExportSceneBuild'].includes(options.toolName)) return null
  for (const part of textParts(options.result.content)) {
    try {
      const data = JSON.parse(part.text) as Record<string, unknown>
      const receipt: Record<string, unknown> = {}
      for (const key of ['status', 'build_id', 'scene_id', 'revision_id', 'base_revision_id', 'base_version', 'version', 'pending', 'entry_path', 'assets_path']) if (typeof data[key] === 'string' || typeof data[key] === 'number' || typeof data[key] === 'boolean') receipt[key] = data[key]
      if (typeof data.error === 'string') receipt.error = data.error.slice(0, 1200)
      const report = data.report as Record<string, unknown> | undefined
      const montage = (data.montage ?? report?.montage) as { workspace_path?: unknown } | undefined
      const views = (data.views ?? report?.views) as Array<{ workspace_path?: unknown }> | undefined
      const paths = [montage?.workspace_path, ...(Array.isArray(views) ? views.map(view => view.workspace_path) : [])].filter((path): path is string => typeof path === 'string' && path.startsWith('output/') && path.length <= 512).slice(0, 8)
      if (paths.length) { receipt.preview_paths = paths; receipt.visual_evidence_delivered = false }
      if (Array.isArray(data.available_cameras)) receipt.available_cameras = data.available_cameras.filter(name => typeof name === 'string').slice(0, 20)
      if (typeof data.acceptance_version === 'number') receipt.acceptance_version = data.acceptance_version
      const checks = data.checks ?? data.constraints ?? report?.constraints
      if (Array.isArray(checks)) { receipt.check_count = checks.length; receipt.checks = checks.filter(check => check && typeof check === 'object').slice(0, 30).map(check => ({ id: String(check.id).slice(0, 200), status: String(check.status).slice(0, 30), required: check.required === true })) }
      if (Object.keys(receipt).length) return JSON.stringify(receipt)
    } catch { /* Non-JSON tools use the generic admission response. */ }
  }
  return null
}

/**
 * Prevent a single tool result from making the *next* main request invalid.
 * This is request admission, not historical compaction, so it runs before the
 * result is ever injected. The tool_result block and ID are always preserved.
 */
export function admitToolResult(
  options: ToolResultAdmissionOptions,
): ToolResultAdmissionResult {
  const reserve = Math.min(
    options.mainMaxOutputTokens,
    Math.max(512, Math.ceil(options.contextWindow * 0.005)),
  )
  const maxInputTokens = options.contextWindow - reserve
  const correction = options.inputTokenCorrection ?? 0
  const currentInputTokens = Math.max(0, estimateTokens(options.messages)
    + options.staticOverheadTokens
    + correction)
  const asyncBoundary = options.maxNextInputTokens ?? maxInputTokens
  const admissionLimit = options.maxContextGrowthTokens
    ? Math.min(maxInputTokens, asyncBoundary, currentInputTokens + options.maxContextGrowthTokens)
    : Math.min(maxInputTokens, asyncBoundary)
  let projected = projectedTokens(
    options.messages,
    options.pendingResults,
    options.result,
    options.staticOverheadTokens,
    correction,
  )
  if (projected <= admissionLimit) {
    return { result: options.result, guarded: false, projectedInputTokens: projected }
  }

  // For any multimodal result, first retain its native text while removing
  // inline raster bytes from the next request.
  if (Array.isArray(options.result.content)) {
    const text = textParts(options.result.content)
    const receipt = sceneCodeReceipt(options)
    const withoutImages: ToolResultBlock = {
      ...options.result,
      content: [
        ...text,
        {
          type: 'text',
          text: `[大型内联图像未注入：下一请求将超过模型窗口]\n${receipt ? `${receipt}\n` : ''}${recoveryInstruction(options.toolName, options.toolInput)}`,
        },
      ],
    }
    projected = projectedTokens(
      options.messages,
      options.pendingResults,
      withoutImages,
      options.staticOverheadTokens,
      correction,
    )
    if (projected <= admissionLimit) {
      return { result: withoutImages, guarded: true, projectedInputTokens: projected }
    }
  }

  const receipt = sceneCodeReceipt(options)
  const guarded: ToolResultBlock = {
    ...options.result,
    content: [
      '[工具已执行，但结果未注入活动上下文：完整载荷超过本轮安全注入预算]',
      `tool: ${options.toolName}`,
      `projected_input: ~${projected.toLocaleString()} tokens`,
      `window: ${options.contextWindow.toLocaleString()} tokens`,
      `admission_limit: ${admissionLimit.toLocaleString()} tokens`,
      ...(receipt ? [`已执行操作的持久回执：${receipt}`] : []),
      recoveryInstruction(options.toolName, options.toolInput),
    ].join('\n'),
    // Retrieval did not deliver the requested material to the model; marking
    // it as an error encourages a smaller paged retry. Durable mutations still
    // succeeded and keep their original status.
    is_error: [
      'Read',
      'Glob',
      'Grep',
      'WebSearch',
      'ArxivSearchPapers',
      'SciverseSearchPapers',
      'SciverseSearchEvidence',
      'SciverseListRelations',
      'SearchDocument',
    ]
      .includes(options.toolName)
      ? true
      : options.result.is_error,
  }
  projected = projectedTokens(
    options.messages,
    options.pendingResults,
    guarded,
    options.staticOverheadTokens,
    correction,
  )
  return { result: guarded, guarded: true, projectedInputTokens: projected }
}

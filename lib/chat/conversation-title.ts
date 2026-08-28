const SPATIAL_GOAL_PREFIX = /^\s*空间创作目标\s*[：:]\s*/

export function cleanConversationTitle(title: string): string {
  const cleaned = title.replace(SPATIAL_GOAL_PREFIX, '').trim()
  return cleaned || '新对话'
}

export function conversationTitleFromMessage(message: string, maxLength = 30): string {
  const firstLine = message.trim().split(/\r?\n/, 1)[0] ?? ''
  const cleaned = cleanConversationTitle(firstLine)
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned
}

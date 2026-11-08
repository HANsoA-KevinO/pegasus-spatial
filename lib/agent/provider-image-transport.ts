import { getOwnedImageAsset, readImageAsset } from '../media/storage'
import type { AgentExecutionContext } from './execution-context'

/** Materialize private local images only at the provider boundary, never in
 * persisted messages, ToolResult JSON or SSE. Useful when no public tunnel exists. */
export async function materializeProviderImages<T>(request: T, context?: AgentExecutionContext): Promise<T> {
  const cache = new Map<string, Promise<unknown>>()
  async function walk(value: unknown): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map(walk))
    if (!value || typeof value !== 'object') return value
    const item = value as Record<string, unknown>
    if (item.type === 'url' && typeof item.url === 'string' && item.url.startsWith('pegasus-asset:')) {
      const id = item.url.slice('pegasus-asset:'.length)
      if (!context) throw new Error('Inline image transport requires an owner-scoped Agent context')
      if (!cache.has(id)) cache.set(id, (async () => {
        const owned = await getOwnedImageAsset(id, context!.userId, context!.conversationId)
        if (!owned) throw new Error('Model image is unavailable in this project')
        const image = await readImageAsset(id, 'model')
        if (!image) throw new Error('Model image bytes are unavailable')
        return { type: 'base64', media_type: owned.variants.model.mimeType, data: image.buffer.toString('base64') }
      })())
      return cache.get(id)!
    }
    return Object.fromEntries(await Promise.all(Object.entries(item).map(async ([key, nested]) => [key, await walk(nested)])))
  }
  return await walk(request) as T
}

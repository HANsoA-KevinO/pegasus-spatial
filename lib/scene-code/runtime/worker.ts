import { SceneHost, type SceneModule } from './host'
import type { SceneRuntimeInit } from '../types'

export function startSceneWorker(program: SceneModule) {
  let host: SceneHost | null = null
  let queue = Promise.resolve()
  self.onmessage = (event: MessageEvent) => {
    const { id, method, input = {} } = event.data
    // Serialize operations: seeking and diagnostic material overrides must not race.
    queue = queue.then(async () => {
      try {
        let result: unknown
        if (method === 'init') { host = new SceneHost(program, input as SceneRuntimeInit); result = { ...await host.start(), quality_aliases: host.qualityAliases() } }
        else {
          if (!host) throw new Error('Scene host is not initialized')
          switch (method) {
            case 'inspect': await host.seek(input.time_s ?? 0); result = host.inspect(); break
            case 'render': result = await host.render(input); break
            case 'frame': result = (await host.frame(input)).descriptor; break
            case 'query': result = await host.query(input.queries ?? [], input.time_s); break
            case 'check': result = await host.check(input.constraints ?? [], input.time_s); break
            case 'pick': result = await host.pick(input.x, input.y, input.view ?? {}); break
            case 'select': result = host.select(input.key ?? null); break
            case 'quality': result = await host.setQuality(input.mode, input.asset); break
            case 'export': result = await host.exportGLB(input.time_s); break
            case 'dispose': host.dispose(); host = null; result = { disposed: true }; break
            default: throw new Error(`Unsupported scene operation: ${method}`)
          }
        }
        self.postMessage({ id, ok: true, result })
      } catch (cause) { const error = cause instanceof Error ? cause : new Error(String(cause)); const details = error as Error & { code?: string; available_cameras?: string[]; suggested_preset?: string }; self.postMessage({ id, ok: false, error: { message: error.message, stack: error.stack, code: details.code, available_cameras: details.available_cameras, suggested_preset: details.suggested_preset } }) }
    })
  }
}

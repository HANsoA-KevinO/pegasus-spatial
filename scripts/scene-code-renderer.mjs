import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { chromium } from 'playwright-core'

const port = Number(process.env.SCENE_CODE_RENDERER_PORT || 3201)
const requestedTimeout = Number(process.env.SCENE_CODE_RENDER_TIMEOUT_MS || 120000)
const timeoutMs = Number.isFinite(requestedTimeout) ? Math.max(1000, Math.min(120000, requestedTimeout)) : 120000
const token = process.env.SCENE_CODE_RENDERER_TOKEN
if (!token || token.length < 24) throw new Error('SCENE_CODE_RENDERER_TOKEN must contain at least 24 characters')
let busy = false
let browser
let launching
async function getBrowser() {
  if (browser?.isConnected()) return browser
  launching ??= chromium.launch({
    headless: true, chromiumSandbox: true,
    executablePath: process.env.SCENE_CODE_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  }).then(instance => { browser = instance; return instance }).finally(() => { launching = undefined })
  return launching
}
const authorized = value => { const expected = Buffer.from(`Bearer ${token}`), actual = Buffer.from(value || ''); return expected.length === actual.length && timingSafeEqual(expected, actual) }
const send = (response, status, value) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)) }
const BROWSER_TRANSFER_CHUNK = 4 * 1024 * 1024

export async function renderCapsule(manifest, bundle, files, signal) {
  signal.throwIfAborted()
  const context = await (await getBrowser()).newContext({ viewport: { width: 1280, height: 960 }, serviceWorkers: 'block' })
  // No cookies, credentials, application origin or external network in this context.
  await context.route('**/*', route => route.abort('blockedbyclient'))
  const close = () => { void context.close().catch(() => {}) }
  signal.addEventListener('abort', close, { once: true })
  if (signal.aborted) { close(); signal.throwIfAborted() }
  try {
    const page = await context.newPage()
    await page.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src blob: data:; img-src blob: data:">`)
    let crashed = false
    page.once('crash', () => { crashed = true })
    let phase = 'transferring frozen inputs'
    try {
      // Bound each Playwright message. Serializing every asset in one call can
      // crash Chromium before any scene code runs, and Array.from copies each byte.
      const input = await page.evaluateHandle(sizes => sizes.map(size => new Uint8Array(size)), [bundle.size, ...files.map(file => file.size)])
      for (const [index, file] of [bundle, ...files].entries()) {
        for (let offset = 0; offset < file.size; offset += BROWSER_TRANSFER_CHUNK) {
          signal.throwIfAborted()
          const chunk = Buffer.from(await file.slice(offset, offset + BROWSER_TRANSFER_CHUNK).arrayBuffer()).toString('base64')
          await page.evaluate(({ input, index, offset, chunk }) => {
            const binary = atob(chunk), target = input[index]
            for (let byte = 0; byte < binary.length; byte++) target[offset + byte] = binary.charCodeAt(byte)
          }, { input, index, offset, chunk })
        }
      }
      phase = 'executing the scene worker'
      return await page.evaluate(async ({ manifest, input }) => {
        const bundle = input[0]
        const worker = new Worker(URL.createObjectURL(new Blob([bundle], { type: 'text/javascript' })))
        let serial = 0
        const pending = new Map()
        worker.onmessage = event => { const request = pending.get(event.data.id); if (!request) return; pending.delete(event.data.id); if (event.data.ok) request.resolve(event.data.result); else request.reject(Object.assign(new Error(event.data.error.message), event.data.error)) }
        worker.onerror = event => { for (const request of pending.values()) request.reject(new Error(event.message)); pending.clear() }
        const call = (method, input, transfer = []) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); worker.postMessage({ id, method, input }, transfer) })
        const assets = manifest.assets.map((asset, index) => ({ ...asset, bytes: input[index + 1].buffer }))
        const renderViews = async (requests, strict = false) => {
          const views = [], view_errors = []
          for (const [index, request] of requests.entries()) {
            try { views.push(await call('render', request)) }
            catch (error) {
              if (strict) throw error
              view_errors.push({ index, name: request.name || request.camera_key || request.preset || `view-${index}`, code: error.code || 'render_failed', message: error.message, available_cameras: error.available_cameras, suggested_preset: error.suggested_preset })
            }
          }
          return { views, view_errors }
        }
        try {
          await call('init', { assets, seed: manifest.seed, width: 960, height: 720 }, assets.map(asset => asset.bytes))
          const operation = manifest.operation || { kind: 'build' }
          if (operation.kind === 'query') return { observations: await call('query', operation) }
          if (operation.kind === 'check') {
            const constraints = await call('check', operation)
            const { views } = operation.render_evidence === false ? { views: [] } : await renderViews(['top','front','side','overview'].map(preset => ({ preset, time_s: operation.time_s || 0 })), true)
            return { constraints: constraints.map(check => ({ ...check, evidence_views: views.map(view => view.name) })), views }
          }
          if (operation.kind === 'inspect') return { snapshot: await call('inspect', operation) }
          if (operation.kind === 'export') return { export: await call('export', operation) }
          const initial = await call('inspect', { time_s: operation.time_s || 0 })
          const requests = operation.views || ['top', 'front', 'side', initial.cameras.some(camera => camera.name === 'entrance') ? 'entrance' : 'overview'].map(preset => ({ preset }))
          if (!operation.views && initial.animated) requests.push({ preset: 'overview', name: 'animation-1.5s', time_s: 1.5 })
          const { views, view_errors } = await renderViews(requests.map(request => ({ ...request, time_s: request.time_s ?? operation.time_s ?? 0 })), operation.kind === 'build')
          const constraints = operation.kind === 'build' ? await call('check', { constraints: manifest.constraints || [], time_s: operation.time_s || 0 }) : []
          const snapshot = await call('inspect', { time_s: operation.time_s || 0 })
          return { snapshot, constraints: constraints.map(check => ({ ...check, evidence_views: views.map(view => view.name) })), views, view_errors, errors: [] }
        } finally { worker.terminate() }
      }, { manifest, input })
    } catch (error) {
      if (crashed) throw new Error(`Chromium page crashed while ${phase}`, { cause: error })
      throw error
    }
  } finally { signal.removeEventListener('abort', close); await context.close().catch(() => {}) }
}

const server = http.createServer(async (request, response) => {
  if (request.url === '/health' && request.method === 'GET') {
    if (request.headers.authorization && !authorized(request.headers.authorization)) return send(response, 401, { ok: false, error: 'Unauthorized' })
    try { await getBrowser(); return send(response, 200, { ok: true, busy, chromium: 'ready' }) }
    catch (error) { console.error('[renderer] Chromium readiness failed:', error.message); return send(response, 503, { ok: false, chromium: 'unavailable' }) }
  }
  if (!authorized(request.headers.authorization)) return send(response, 401, { error: 'Unauthorized' })
  if (request.url !== '/render' || request.method !== 'POST') return send(response, 404, { error: 'Not found' })
  if (busy) return send(response, 429, { error: 'Renderer slot is occupied' })
  busy = true
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`Render exceeded ${timeoutMs / 1000} seconds`)), timeoutMs)
  let watchdog
  controller.signal.addEventListener('abort', () => {
    // A wedged GPU/browser must not leave this service occupied forever.
    // Compose restarts the isolated renderer if closing its context cannot finish.
    watchdog = setTimeout(() => process.exit(70), 5000)
  }, { once: true })
  const disconnected = () => { if (!response.writableEnded) controller.abort(new Error('Render cancelled')) }
  response.on('close', disconnected)
  try {
    let size = 0
    const chunks = []
    for await (const chunk of request) { size += chunk.length; if (size > 256 * 1024 * 1024) throw new Error('Capsule exceeds 256 MiB'); chunks.push(chunk) }
    const parsed = new Request('http://renderer/render', { method: 'POST', headers: { 'content-type': request.headers['content-type'] }, body: Buffer.concat(chunks) })
    const data = await parsed.formData()
    const manifest = JSON.parse(String(data.get('manifest')))
    if (!Array.isArray(manifest.assets) || manifest.assets.length > 64) throw new Error('Invalid capsule manifest')
    const bundle = data.get('bundle')
    if (!(bundle instanceof Blob) || bundle.size > 24 * 1024 * 1024) throw new Error('Invalid compiled runtime bundle')
    const files = []
    for (let index = 0; index < manifest.assets.length; index++) { const file = data.get(`asset-${index}`); if (!(file instanceof Blob)) throw new Error('Missing frozen asset'); files.push(file) }
    const result = await renderCapsule(manifest, bundle, files, controller.signal)
    if (!controller.signal.aborted) send(response, 200, result)
  } catch (error) {
    if (!response.destroyed) send(response, 422, { error: controller.signal.aborted ? controller.signal.reason?.message || 'Render cancelled' : error.message, stack: error.stack, cancelled: controller.signal.aborted })
  } finally { clearTimeout(timer); clearTimeout(watchdog); response.removeListener('close', disconnected); busy = false }
})
server.requestTimeout = 125_000
server.listen(port, process.env.SCENE_CODE_RENDERER_HOST || '127.0.0.1', () => console.log(`Scene renderer listening on ${port} (Chromium sandbox enabled)`))
async function stop() { server.close(); await browser?.close(); process.exit(0) }
process.once('SIGINT', stop); process.once('SIGTERM', stop)

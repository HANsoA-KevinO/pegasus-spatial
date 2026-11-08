/** npm's predev hook starts dependencies; Next remains a normal foreground dev server. */
import { assertSafeLocalEnvironment, ensureLocalMongo, ensureLocalRenderer } from './demo-local'

async function main() {
  assertSafeLocalEnvironment()
  await ensureLocalMongo()
  await ensureLocalRenderer()
  console.log('[dev] MongoDB and sandboxed Chromium ready')
}
main().catch(error => { console.error(`[dev] ${(error as Error).message}`); process.exitCode = 1 })

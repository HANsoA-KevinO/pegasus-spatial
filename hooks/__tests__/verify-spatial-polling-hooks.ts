import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8')
}

for (const [name, collection] of [
  ['useSpatialScenes.ts', 'Scene'],
  ['useSpatialModels.ts', 'Model'],
] as const) {
  const hook = source(name)

  assert.doesNotMatch(hook, /setInterval\s*\(/, `${name} must not schedule overlapping interval polls`)
  assert.match(hook, /window\.setTimeout\(\(\) => \{ void poll\(false\) \}, POLL_INTERVAL_MS\)/)
  assert.match(hook, /if \(inFlightRef\.current\) return inFlightRef\.current/)
  assert.match(hook, new RegExp(`shared${collection}Requests = new Map`))
  assert.match(hook, /requestEpoch !== requestEpochRef\.current/)
  assert.match(hook, /requestEpochRef\.current === effectEpoch/)
  assert.match(hook, /lifecycleController\.abort\(\)/)
  assert.match(hook, /requestControllerRef\.current\?\.abort\(\)/)
  assert.match(hook, /JSON\.stringify\(next(?:Scenes|Models)\)/)
  assert.match(hook, /SignatureRef\.current !== nextSignature/)
}

console.log('spatial polling hook verification passed')

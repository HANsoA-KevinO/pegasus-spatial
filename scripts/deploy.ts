/** Production Compose entry point. Never prints or bakes provider secrets. */
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { runStartupChecks } from '../lib/startup-checks'

const root = path.resolve(import.meta.dirname, '..')
const envPath = path.join(root, '.env.production')
const action = process.argv[2] || 'status'
if (!['prepare', 'up', 'status', 'down', 'logs'].includes(action)) throw new Error('Use prepare, up, status, down or logs')

if (!fs.existsSync(envPath)) {
  if (!['prepare', 'up'].includes(action)) throw new Error('Run npm run deploy:prepare first')
  const local = path.join(root, '.env.local')
  if (!fs.existsSync(local)) throw new Error('Create .env.production from .env.example and fill the gateway and storage configuration first')
  fs.copyFileSync(local, envPath, fs.constants.COPYFILE_EXCL)
  fs.chmodSync(envPath, 0o600)
  console.log('[deploy] Created private production configuration from .env.local')
}

let contents = fs.readFileSync(envPath, 'utf8')
let env = parseEnv(contents)
function defaultValue(key: string, value: string) {
  if (env[key]?.trim()) return
  // Appending deliberately overrides an empty assignment while retaining comments.
  contents += `\n${key}=${JSON.stringify(value)}\n`
  env[key] = value
}
if (['prepare', 'up'].includes(action)) {
  defaultValue('SCENE_CODE_RENDERER_TOKEN', randomBytes(32).toString('hex'))
  defaultValue('CRON_SECRET', randomBytes(32).toString('hex'))
  defaultValue('AGENT_RUNTIME_INTERNAL_SECRET', randomBytes(32).toString('hex'))
  defaultValue('LLM_IMAGE_TRANSPORT', 'inline')
  defaultValue('SCENE_CODE_WORKER_ENABLED', '1')
  defaultValue('SPATIAL_WORKER_ENABLED', '1')
  defaultValue('AGENT_RUNTIME_BACKGROUND_RUNNER', '1')
  defaultValue('AGENT_MAX_TURNS', '200')
  fs.writeFileSync(envPath, contents, { mode: 0o600 })
  fs.chmodSync(envPath, 0o600)
  env = parseEnv(contents)
  Object.assign(process.env, env, { NODE_ENV: 'production' })
  runStartupChecks()
}

if (action === 'prepare') {
  console.log('[deploy] Configuration ready; run npm run deploy:up')
} else {
  const args = action === 'up' ? ['up', '--build', '-d', '--wait', '--wait-timeout', '180']
    : action === 'down' ? ['stop'] : action === 'logs' ? ['logs', '--tail', '100', 'app', 'scene-renderer'] : ['ps']
  const result = spawnSync('docker', ['compose', '--env-file', envPath, ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
  if (action === 'up') console.log('[deploy] Ready: http://localhost:3200 (single user, loopback only)')
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

type JsonRecord = Record<string, unknown>

function record(value: unknown, label: string): JsonRecord {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  return value as JsonRecord
}

function strings(value: unknown, label: string): string[] {
  assert.ok(Array.isArray(value), `${label} must be an array`)
  for (const item of value) assert.equal(typeof item, 'string', `${label} must contain strings`)
  return value as string[]
}

const root = record(JSON.parse(readFileSync(new URL('./behavior-cases.json', import.meta.url), 'utf8')), 'root')
assert.equal(root.schema_version, '1.0')
assert.equal(root.status, 'definitions_only_not_run')
const policy = record(root.execution_policy, 'execution_policy')
assert.equal(policy.network_allowed, false)
assert.equal(policy.model_or_agent_runs_in_ci, false)
assert.equal(policy.model_behavior_results_available, false)
assert.equal(policy.live_replay_required_before_demo, true)

const expensive = strings(root.expensive_tools, 'expensive_tools')
assert.deepEqual(expensive.sort(), ['CreateObject3D', 'CreateWorld3D', 'GenerateImage'].sort())
const cases = (root.cases as unknown[]).map((value, index) => record(value, `cases[${index}]`))
const expectedIds = [
  'direct-object-request',
  'direct-world-request',
  'reference-image-edit',
  'ambiguous-object-or-world',
  'scene-observation-adjustment',
]
assert.deepEqual(cases.map(value => value.id).sort(), expectedIds.sort())

for (const value of cases) {
  assert.equal(typeof value.prompt, 'string')
  assert.ok((value.prompt as string).trim())
  const expected = record(value.expected, `${String(value.id)}.expected`)
  assert.equal(expected.final_language, 'zh-CN')
}

const byId = new Map(cases.map(value => [value.id, record(value.expected, `${String(value.id)}.expected`)]))
assert.deepEqual(byId.get('direct-object-request')?.must_call_one_of, ['CreateObject3D'])
assert.deepEqual(byId.get('direct-world-request')?.must_call_one_of, ['CreateWorld3D'])
assert.deepEqual(byId.get('reference-image-edit')?.must_call_one_of, ['GenerateImage'])
assert.deepEqual(byId.get('ambiguous-object-or-world')?.must_call_one_of, ['AskUserQuestion'])
assert.deepEqual(byId.get('scene-observation-adjustment')?.must_call_one_of, ['TransformSceneObject'])
assert.deepEqual(byId.get('scene-observation-adjustment')?.must_eventually_call, ['CaptureSceneView'])
assert.equal(byId.get('scene-observation-adjustment')?.cost_only_ask_forbidden, true)
for (const id of ['direct-object-request', 'direct-world-request']) {
  assert.deepEqual(byId.get(id)?.optional_before_target, ['GenerateImage'])
}

console.log('spatial-creation behavior definition verification passed')

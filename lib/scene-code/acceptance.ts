import { createHash } from 'node:crypto'
import { SpatialSceneModel } from '../spatial/models'
import { requireSpatialScene } from '../spatial/scene-repository'
import { AgentRun } from '../agent-runtime/models'
import type { SceneMutationIdentity } from '../spatial/scene-types'
import type { SceneAcceptanceContract, SceneConstraint, SceneConstraintResult } from './types'

const KINDS = ['distance', 'contact', 'support', 'no_intersection', 'orientation', 'keep_clear']
export function validateSceneConstraints(value: unknown): SceneConstraint[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('constraints must be an array of at most 100 checks')
  const ids = new Set<string>()
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200 || ids.has(item.id)) throw new Error('Check IDs must be nonempty, unique strings (200 characters maximum)')
    ids.add(item.id)
    if (!KINDS.includes(item.kind)) throw new Error(`Unsupported check kind: ${item.kind}`)
    if (!Array.isArray(item.object_keys) || item.object_keys.length !== 2 || item.object_keys.some((key: unknown) => typeof key !== 'string' || !key || key.length > 200)) throw new Error(`Check ${item.id} must name source and target object keys`)
    if (item.required !== undefined && typeof item.required !== 'boolean') throw new Error(`Check ${item.id}: required must be boolean`)
    for (const key of ['min', 'max', 'tolerance', 'max_angle_deg', 'min_support_fraction']) if (item[key] !== undefined && (typeof item[key] !== 'number' || !Number.isFinite(item[key]) || item[key] < 0)) throw new Error(`Check ${item.id}: ${key} must be finite and nonnegative`)
    if (item.min !== undefined && item.max !== undefined && item.min > item.max) throw new Error(`Check ${item.id}: min exceeds max`)
    if (item.max_angle_deg > 180 || item.min_support_fraction > 1) throw new Error(`Check ${item.id}: angle/fraction is out of range`)
    return { id: item.id, kind: item.kind, object_keys: [...item.object_keys], required: item.required ?? true,
      ...(item.min !== undefined ? { min: item.min } : {}), ...(item.max !== undefined ? { max: item.max } : {}), ...(item.tolerance !== undefined ? { tolerance: item.tolerance } : {}), ...(item.max_angle_deg !== undefined ? { max_angle_deg: item.max_angle_deg } : {}), ...(item.min_support_fraction !== undefined ? { min_support_fraction: item.min_support_fraction } : {}) }
  })
}
export function acceptanceHash(requirements: SceneConstraint[]): string {
  const canonical = validateSceneConstraints(requirements).sort((a, b) => a.id.localeCompare(b.id))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}
/** Required conditions survive deleted files, required:false and changed ranges.
 * Optional diagnostics remain editable. This protects coverage; it does not
 * claim to have independently translated a natural-language request. */
export function retainSceneRequirements(existing: SceneConstraint[], declared: SceneConstraint[]) {
  const requested = validateSceneConstraints(declared), required = new Map(validateSceneConstraints(existing).map(item => [item.id, item]))
  const warnings: string[] = []
  for (const item of requested) {
    const pinned = required.get(item.id)
    if (pinned && acceptanceHash([pinned]) !== acceptanceHash([item])) warnings.push(`required_check_preserved:${item.id}: source changes cannot weaken or replace the accepted condition`)
    else if (!pinned && item.required) required.set(item.id, item)
  }
  for (const item of existing) if (!requested.some(check => check.id === item.id)) warnings.push(`required_check_restored:${item.id}: omission does not remove acceptance coverage`)
  return { requirements: [...required.values()].sort((a, b) => a.id.localeCompare(b.id)), constraints: [...required.values(), ...requested.filter(check => !required.has(check.id))], warnings }
}
export async function freezeSceneAcceptance(sceneId: string, identity: SceneMutationIdentity, declared: SceneConstraint[], update?: { expected_version: number; reason: string }) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const scene = await requireSpatialScene(sceneId, identity), previous = scene.acceptance_contract ?? null
    let merged = retainSceneRequirements(previous?.requirements ?? [], declared)
    if (update) {
      if (!previous || previous.version !== update.expected_version) throw new Error('acceptance_changed: inspect the current acceptance version before changing requirements')
      if (previous.changed_run_id === identity.runId) throw new Error('Required checks cannot be replaced during the same modelling run')
      const run = await AgentRun.findOne({ run_id: identity.runId, user_id: identity.userId, conversation_id: identity.conversationId, trigger: 'user', 'request.internal': { $exists: false } }).lean()
      if (!run?.started_message_id) throw new Error('Acceptance replacement requires a new authenticated user-triggered run; background recovery is not authorization')
      if (typeof update.reason !== 'string' || !update.reason.trim() || update.reason.length > 1000) throw new Error('Acceptance changes require a concise explanation of the new user requirement')
      merged = retainSceneRequirements([], declared)
    }
    const hash = acceptanceHash(merged.requirements)
    if (previous && previous.hash === hash) return { contract: previous, constraints: merged.constraints, warnings: merged.warnings }
    const contract: SceneAcceptanceContract = { version: (previous?.version ?? 0) + 1, hash, requirements: merged.requirements, established_run_id: previous?.established_run_id ?? identity.runId, changed_run_id: identity.runId, change_reason: update?.reason ?? 'Required checks retained and new requirements added' }
    const result = await SpatialSceneModel.updateOne({ scene_id: sceneId, user_id: identity.userId, project_id: identity.projectId, ...(previous ? { 'acceptance_contract.version': previous.version } : { acceptance_contract: null }) }, { $set: { acceptance_contract: contract } })
    if (result.modifiedCount === 1) return { contract, constraints: merged.constraints, warnings: merged.warnings }
  }
  throw new Error('acceptance_changed: concurrent acceptance update; retry the frozen build')
}
export function acceptanceCoverage(contract: SceneAcceptanceContract, results: SceneConstraintResult[]) {
  const issues = contract.requirements.flatMap(requirement => {
    const result = results.find(result => result.id === requirement.id)
    if (!result) return [{ id: requirement.id, status: 'missing', requirement }]
    if (acceptanceHash([result.requirement]) !== acceptanceHash([requirement])) return [{ id: requirement.id, status: 'requirement_changed', requirement }]
    return result.status !== 'satisfied' ? [{ id: requirement.id, status: result.status, requirement, observation: result.observation }] : []
  })
  return { required: contract.requirements.length, satisfied: contract.requirements.length - issues.length, complete: issues.length === 0, issues, spatial_validation: contract.requirements.length ? 'defined' : 'no_requirements_defined' }
}

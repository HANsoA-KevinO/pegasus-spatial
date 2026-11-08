import type { SceneCodeBuild, SceneConstraintResult, SceneObjectDescriptor, SceneRenderedView } from './types'
import { acceptanceCoverage } from './acceptance'

export function compactCheck(check: SceneConstraintResult) {
  const observation = { ...check.observation }
  if (observation.value && typeof observation.value === 'object' && !Array.isArray(observation.value)) {
    observation.value = Object.fromEntries(Object.entries(observation.value).filter(([key]) => !['points', 'segments'].includes(key)))
  }
  return { ...check, observation }
}
export function compactView(view: SceneRenderedView) {
  return { name: view.name, camera: view.camera, mode: view.mode, time_s: view.time_s, width: view.width, height: view.height, image: view.image, workspace_path: view.workspace_path, visible_keys: view.visible_keys.slice(0, 32), visible_key_count: view.visible_keys.length, visible_keys_truncated: view.visible_keys.length > 32, visibility_method: 'frustum_candidates_not_occlusion' }
}
export function buildLegend(views: SceneRenderedView[]) {
  const keys = new Map<number, string>()
  for (const view of views) for (const label of view.labels) keys.set(label.number, label.key)
  return [...keys].sort(([a], [b]) => a - b).slice(0, 64).map(([number, key]) => ({ number, key }))
}
export function buildReceipt(build: SceneCodeBuild) {
  const coverage = build.report && build.acceptance ? acceptanceCoverage(build.acceptance, build.report.constraints) : null
  return { build_id: build.build_id, scene_id: build.scene_id, status: build.status, base_revision_id: build.base_revision_id, base_version: build.base_version, entry_path: build.entry_path, source_hash: build.source_hash, runtime_version: build.runtime_version, error: build.error,
    failure: (build as SceneCodeBuild & { failure?: unknown }).failure,
    acceptance_version: build.acceptance?.version, acceptance_hash: build.acceptance?.hash,
    validation: coverage ? { ...coverage, issues: coverage.issues.map(issue => ({ id: issue.id, status: issue.status, requirement: issue.requirement })) } : null,
    warnings: [...(build.acceptance_warnings ?? []), ...(build.report?.snapshot.warnings ?? [])],
  }
}
export function runFeedback(build: SceneCodeBuild) {
  return { ...buildReceipt(build), object_count: build.report?.snapshot.objects.length,
    available_cameras: build.report?.snapshot.cameras.map(camera => camera.name) ?? [],
    montage: build.report?.montage, views: build.report?.views.map(compactView), legend: buildLegend(build.report?.views ?? []),
    checks: build.report?.constraints.slice(0, 20).map(compactCheck), check_count: build.report?.constraints.length ?? 0,
    units: 'relative_scene_units', instruction: 'Review images and measurements. InspectSceneBuild is paged; use object_keys for details. Missing named cameras are observation request errors, not a reason to rebuild geometry.' }
}
export function inspectFeedback(build: SceneCodeBuild, input: { object_keys?: unknown; depth?: unknown; offset?: unknown; limit?: unknown; technical?: unknown }) {
  let objects = build.report?.snapshot.objects ?? []
  const total = objects.length
  if (Array.isArray(input.object_keys)) { const keys = input.object_keys; objects = objects.filter(object => keys.includes(object.key)) }
  if (typeof input.depth === 'number') {
    const parents = new Map((build.report?.snapshot.objects ?? []).map(object => [object.key, object.parent_key]))
    objects = objects.filter(object => { let depth = 0, key = object.parent_key; const seen = new Set<string>(); while (key && !seen.has(key)) { seen.add(key); depth++; key = parents.get(key) ?? null }; return depth <= Number(input.depth) })
  }
  const matched = objects.length, offset = Math.max(0, Math.floor(Number(input.offset) || 0)), limit = Math.max(1, Math.min(50, Math.floor(Number(input.limit) || 10)))
  const page = objects.slice(offset, offset + limit)
  function descriptor(object: SceneObjectDescriptor) {
    const number = (build.report?.snapshot.objects.findIndex(candidate => candidate.key === object.key) ?? -1) + 1
    if (input.technical) return { ...object, number }
    return { number, key: object.key, parent_key: object.parent_key, label: object.label, semantic_type: object.semantic_type, role: object.role, measured: { bounds: object.measured.bounds, position: object.measured.position, rotation_quaternion: object.measured.rotation_quaternion, scale: object.measured.scale, visible: object.measured.visible, in_scene: object.measured.in_scene, queryable: object.measured.queryable, query_method: object.measured.query_method, materials: object.measured.materials.map(material => ({ name: material.name, type: material.type, color: material.color })) }, source: object.source }
  }
  return { ...runFeedback(build), object_page: { total, matched, offset, limit, returned: page.length, next_offset: offset + page.length < matched ? offset + page.length : null },
    snapshot: build.report ? { time_s: build.report.snapshot.time_s, objects: page.map(descriptor), assets: build.report.snapshot.assets, cameras: build.report.snapshot.cameras, animated: build.report.snapshot.animated, ...(input.technical ? { metrics: build.report.snapshot.metrics } : {}) } : null,
    acceptance: build.acceptance, checks_path: `${build.entry_path.slice(0, build.entry_path.lastIndexOf('/'))}/checks.json` }
}

import assert from 'node:assert/strict'
import { admitToolResult } from '../tool-result-admission'

const buildId = 'scnbuild_immutable_receipt'
const result = admitToolResult({ messages: [], pendingResults: [], toolName: 'RunSceneCode', toolInput: { scene_id: 'scene_test' }, contextWindow: 4000, staticOverheadTokens: 100, mainMaxOutputTokens: 1000,
  result: { type: 'tool_result', tool_use_id: 'call_build', content: JSON.stringify({ schema_version: 1, kind: 'scene_code', build_id: buildId, status: 'ready', base_version: 7, montage: { workspace_path: 'output/spatial/builds/test/views/montage.png' }, available_cameras: ['entry'], report: { constraints: [{ id: 'entry-clear', status: 'violated', required: true }], snapshot: { objects: Array.from({ length: 1000 }, () => ({ key: 'geometry', description: 'large mesh statistics '.repeat(50) })) } } }) },
})
assert.equal(result.guarded, true)
assert.equal(result.result.tool_use_id, 'call_build')
assert.match(String(result.result.content), new RegExp(buildId))
assert.match(String(result.result.content), /entry-clear[^]*violated/)
assert.match(String(result.result.content), /InspectSceneBuild/)
assert.match(String(result.result.content), /montage\.png/)
assert.match(String(result.result.content), /visual_evidence_delivered.*false/)
assert.doesNotMatch(String(result.result.content), /large mesh statistics/)
assert.equal(result.result.is_error, undefined, 'context admission must not turn an executed build into an execution error')
console.log('scene code durable receipt admission passed')

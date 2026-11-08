import assert from 'node:assert/strict'
import { parseAgentTurnLimit, resolveAgentTurnLimit } from '../turn-limits'

assert.equal(resolveAgentTurnLimit('root', {}), 200)
assert.equal(resolveAgentTurnLimit('member', {}), 200)
assert.equal(resolveAgentTurnLimit('root', { AGENT_MAX_TURNS: '500' }), 500)
assert.equal(resolveAgentTurnLimit('root', { AGENT_MAX_TURNS: '500', AGENT_ROOT_MAX_TURNS: '' }), 500)
assert.equal(resolveAgentTurnLimit('member', { AGENT_MAX_TURNS: '500', AGENT_MEMBER_MAX_TURNS: '800' }), 800)
assert.equal(resolveAgentTurnLimit('root', { AGENT_MAX_TURNS: '500', AGENT_MEMBER_MAX_TURNS: '800' }), 500)
assert.equal(resolveAgentTurnLimit('root', { AGENT_ROOT_MAX_TURNS: '0' }), undefined)
assert.equal(parseAgentTurnLimit('24'), 24, 'Historic acceptance limits remain reproducible')
for (const invalid of ['-1', 'Infinity', 'NaN', '2.5', '200oops']) assert.throws(() => parseAgentTurnLimit(invalid), /nonnegative safe integer/)
console.log('Agent turn limits passed: 200 defaults, common/role overrides, unlimited opt-in and invalid settings')

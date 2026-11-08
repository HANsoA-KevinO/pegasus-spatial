import assert from 'node:assert/strict'
import { createAgentProvider } from '../provider'
import { createInMemoryWorkspace } from '../../tools/__test-utils__/in-memory-workspace'
import type { ConversationMessage } from '../../types'

const history: ConversationMessage[] = [
  { role: 'assistant', content: [{ type: 'thinking', thinking: 'completed fixture reasoning', signature: '' }, { type: 'tool_use', id: 'tool1', name: 'Read', input: { file_path: 'output/main.ts' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool1', content: 'fixture source' }] },
]
function request(model: string, messages = history) {
  return createAgentProvider(createInMemoryWorkspace(), new Map(), { model, maxTokens: 1024, temperature: 1 }).buildRequest(messages)
}
for (const model of ['deepseek-flash', 'deepseek-v4-pro', 'deepseek/deepseek-flash']) {
  const thinking = request(model).messages[0].content.find((block: { type: string }) => block.type === 'thinking')
  assert.equal(thinking.thinking, 'completed fixture reasoning', 'DeepSeek must receive the completed unsigned reasoning across tool boundaries')
  assert.equal(thinking.signature, undefined, 'never invent a Claude signature')
}
assert.ok(!request('Claude-opus').messages[0].content.some((block: { type: string }) => block.type === 'thinking'), 'Claude must not receive unsigned thinking')
const signed: ConversationMessage[] = [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'signed fixture', signature: 'original-signature' }] }]
assert.equal(request('Claude-opus', signed).messages[0].content[0].signature, 'original-signature')
const toolOnly: ConversationMessage[] = [{ role: 'assistant', content: [{ type: 'tool_use', id: 'fixture-tool', name: 'Read', input: { file_path: 'output/main.ts' } }] }]
const missing = request('deepseek-flash', toolOnly).messages[0].content[0]
assert.equal(missing.type, 'thinking')
assert.equal(missing.thinking, '', 'a gateway turn with no reasoning uses an empty protocol field, not invented reasoning')
assert.equal(missing.signature, undefined)
assert.equal(request('Claude-opus', toolOnly).messages[0].content[0].type, 'tool_use', 'Claude history must remain untouched')
console.log('Completed thinking history round-trip verification passed (provider calls: 0)')

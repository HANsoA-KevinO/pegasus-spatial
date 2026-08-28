import assert from 'node:assert/strict'
import { cleanConversationTitle, conversationTitleFromMessage } from '../conversation-title'

assert.equal(cleanConversationTitle('空间创作目标：你好 创作语境'), '你好 创作语境')
assert.equal(cleanConversationTitle('空间创作目标: 队列回归测试'), '队列回归测试')
assert.equal(cleanConversationTitle('手动命名项目'), '手动命名项目')
assert.equal(
  conversationTitleFromMessage('空间创作目标：海边日落车站\n\n创作语境：开放空间创作'),
  '海边日落车站',
)
assert.equal(conversationTitleFromMessage(`空间创作目标：${'长'.repeat(31)}`), `${'长'.repeat(30)}...`)

console.log('conversation-title:verify passed')

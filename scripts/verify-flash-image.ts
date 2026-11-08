/** Small, fresh synthetic image request; never replays a stored conversation. */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import sharp from 'sharp'
import { callAnthropicAPIStream } from '../lib/agent/llm-api'

async function main() {
  assert.equal(process.env.RUN_FLASH_IMAGE_ACCEPTANCE, '1', 'Explicit live model test opt-in required')
  const imagePath = process.env.FLASH_ACCEPTANCE_IMAGE
  assert.ok(imagePath, 'Set FLASH_ACCEPTANCE_IMAGE to a synthetic courtyard with a tiled roof, a right-side arch and a bench on the left')
  const image = await sharp(await readFile(imagePath)).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
  const started = Date.now()
  const result = await callAnthropicAPIStream({ model: 'deepseek-flash', max_tokens: 2048, system: [], tools: [], messages: [
    { role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.toString('base64') } },
      { type: 'text', text: '这是一张生成的合成测试图片。请只用三条简短中文回答：1. 屋顶是什么材料？2. 右侧砖墙的通道口是什么形状？3. 木长凳位于院子的哪一侧？仅描述图中可见内容，不调用工具。' },
    ] },
  ] })
  const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  assert.match(text, /瓦/); assert.match(text, /拱|弧/); assert.match(text, /左/)
  await mkdir('/private/tmp/pegasus-flash-runtime', { recursive: true })
  await writeFile('/private/tmp/pegasus-flash-runtime/image-probe.json', JSON.stringify({ model: 'deepseek-flash', source: 'synthetic-generated-reference', elapsed_ms: Date.now() - started, response: text, stop_reason: result.stop_reason, usage: result.usage }, null, 2))
  console.log(`Flash synthetic image input passed (${Date.now() - started} ms): ${text}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })

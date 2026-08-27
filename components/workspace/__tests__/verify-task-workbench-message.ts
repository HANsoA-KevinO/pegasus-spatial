import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(
  join(process.cwd(), 'components', 'workspace', 'TaskWorkbench.tsx'),
  'utf8',
)
const builder = source.match(
  /export function buildResearchProjectMessage[\s\S]+?\n}\n\nexport function TaskWorkbench/,
)?.[0]

assert.ok(builder, 'missing project message builder')
assert.match(builder, /`空间创作目标：\$\{question\.trim\(\)}`/)
assert.match(builder, /`创作语境：\$\{domain}`/)
assert.match(builder, /`已有素材与约束：\\n\$\{context\.trim\(\)}`/)
assert.match(builder, /<reference-file name=/)
assert.doesNotMatch(builder, /请先|固定流程|物体模式|世界模式/)
assert.match(source, /buildResearchProjectMessage\(/)
assert.match(source, /DEFAULT_CREATION_CONTEXT/)
assert.match(source, /推理模型/)
assert.doesNotMatch(source, /创作语境（不锁定工具）/)
assert.doesNotMatch(source, /Agent 会选择合适的图像、3D 造物和世界生成工具/)
assert.match(source, /focus:placeholder:text-transparent/)
assert.match(source, /ACCEPTED_UPLOAD_TYPES/)
assert.match(source, /\/api\/media\/upload/)
assert.doesNotMatch(source, /Agentic spatial creation/i)
assert.doesNotMatch(source, /⌘ \/ Ctrl \+ Enter 开始/)

console.log('task-workbench-message:verify passed')

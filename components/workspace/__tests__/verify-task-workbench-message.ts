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
assert.doesNotMatch(builder, /请先|固定流程|物体模式|世界模式/)
assert.match(source, /buildResearchProjectMessage\(trimmed, domain, context\)/)
assert.match(source, /不锁定工具/)
assert.match(source, /自主选择图像生成、3D 造物、世界生成或现实重建工具/)

console.log('task-workbench-message:verify passed')

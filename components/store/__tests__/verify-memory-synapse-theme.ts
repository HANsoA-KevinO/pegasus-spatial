import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const source = (...parts: string[]) => readFileSync(resolve(root, ...parts), 'utf8')
const field = source('components', 'store', 'MemorySynapseField.tsx')
const globals = source('app', 'globals.css')

assert.match(field, /useTheme/)
assert.match(field, /resolvedTheme === 'dark'/)
assert.match(field, /fieldBlend: GlobalCompositeOperation = isDark \? 'screen' : 'multiply'/)
assert.match(field, /const boost = isDark \? 1\.85 : 1/)
assert.match(field, /const boostFill = isDark \? 1\.4 : 1/)
assert.match(field, /host\.dataset\.synapseTheme = isDark \? 'dark' : 'light'/)
assert.match(field, /\['#b8c8a9', '#b1c4ef', '#e1b97f'\]/)
assert.match(field, /isDark \? '#8fa5d4' : '#a66c58'/)
assert.match(field, /\}, \[resolvedTheme\]\)/)
assert.match(globals, /--mem-fam-a:\s+#74806a/)
assert.match(globals, /--mem-fam-a:\s+#b8c8a9/)
assert.match(globals, /--mem-link:\s+#8fa5d4/)

console.log('memory-synapse-theme:verify passed')

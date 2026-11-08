import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const directory = path.resolve(process.argv[2] || '/tmp/pegasus-three-renderer-fixture')
await mkdir(directory, { recursive: true })
const mocks = {
  'next/link': `import React from 'react'; export default function Link(props) { return React.createElement('a', props, props.children) }`,
  '@/contexts/ChatContext': `export function useChatContext() { return { sendMessage() {} } }`,
  '@/hooks/useGridFSContent': `export function useGridFSContent() { return { content: '' } }`,
}
await build({
  entryPoints: { fixture: 'scripts/fixtures/three-renderer.jsx' }, outdir: directory,
  bundle: true, format: 'esm', splitting: true, jsx: 'automatic', tsconfig: 'tsconfig.json',
  plugins: [{ name: 'app-providers', setup(builder) {
    builder.onResolve({ filter: /^(next\/link|@\/contexts\/ChatContext|@\/hooks\/useGridFSContent)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js', resolveDir: process.cwd() }))
  } }],
})
await writeFile(path.join(directory, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><style>html,body,#root{margin:0;height:100%;background:#202735}#root{position:relative}canvas{display:block}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`)
console.log(directory)

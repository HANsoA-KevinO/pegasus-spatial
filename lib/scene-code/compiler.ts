import { createHash } from 'node:crypto'
import path from 'node:path'
import { build } from 'esbuild'
import type { FrozenCodeSource } from './types'

const PACKAGES = new Set(['three', 'three-bvh-csg', 'three-mesh-bvh', '@sparkjsdev/spark'])
const SOURCE_EXTENSIONS = ['.ts', '.js', '.json', '.glsl', '.vert', '.frag']

/** Only trusted runtime files use the disk resolver. Agent code resolves from a frozen map. */
export async function compileSceneCode(input: { entryPath: string; sources: FrozenCodeSource[]; root: string }): Promise<{ bundle: string; sourceMap: string; hash: string }> {
  const files = new Map(input.sources.map(source => [source.path, source.content]))
  const directory = path.posix.dirname(input.entryPath)
  if (!files.has(input.entryPath)) throw new Error(`Entry not found: ${input.entryPath}`)
  const host = path.join(process.cwd(), 'lib/scene-code/runtime/worker.ts')
  const result = await build({
    stdin: { contents: `import { startSceneWorker } from '@scene-runtime'; import * as program from '@scene-program'; startSceneWorker(program);`, resolveDir: process.cwd(), sourcefile: 'scene-worker-entry.js' },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
    sourcemap: 'external', sourcesContent: true, outfile: 'scene-worker.js', logLevel: 'silent',
    plugins: [{ name: 'frozen-scene-source', setup(builder) {
      builder.onResolve({ filter: /^@scene-runtime$/, namespace: 'file' }, () => ({ path: host }))
      builder.onResolve({ filter: /^@scene-program$/, namespace: 'file' }, () => ({ path: input.entryPath, namespace: 'scene-source' }))
      builder.onResolve({ filter: /.*/, namespace: 'scene-source' }, async args => {
        if (args.path === 'three' || args.path.startsWith('three/addons/') || PACKAGES.has(args.path)) {
          const resolved = await builder.resolve(args.path, { resolveDir: process.cwd(), kind: 'import-statement', namespace: 'file' })
          return resolved.errors.length ? { errors: resolved.errors } : { path: resolved.path }
        }
        if (!args.path.startsWith('./') && !args.path.startsWith('../')) throw new Error(`Unsupported scene import: ${args.path}`)
        if (args.kind === 'dynamic-import') throw new Error('Use static project imports; asset loading goes through ctx.assets.')
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path))
        if (!resolved.startsWith(input.root + '/')) throw new Error(`Import escapes scene project: ${args.path}`)
        const candidates = [resolved, ...SOURCE_EXTENSIONS.map(extension => resolved + extension), ...['.ts', '.js'].map(extension => `${resolved}/index${extension}`)]
        const found = candidates.find(candidate => files.has(candidate))
        if (!found) throw new Error(`Module not found: ${args.path} from ${args.importer}`)
        return { path: found, namespace: 'scene-source' }
      })
      builder.onLoad({ filter: /.*/, namespace: 'scene-source' }, args => {
        const contents = files.get(args.path)
        if (contents === undefined) throw new Error(`Frozen source missing: ${args.path}`)
        // Enforce deterministic modelling and a host-owned render loop. The
        // actual security boundary is the isolated worker + CSP, not this check.
        if (/(?<![\w$])(?:eval|Function|requestAnimationFrame|setInterval)\s*\(|\b(?:Math\.random|Date\.now|performance\.now)\s*\(/.test(contents)) {
          throw new Error(`${args.path}: use ctx.random and update(t, dt); dynamic execution and independent loops are not supported`)
        }
        return { contents, loader: /\.(?:glsl|vert|frag)$/.test(args.path) ? 'text' : args.path.endsWith('.json') ? 'json' : args.path.endsWith('.ts') ? 'ts' : 'js', resolveDir: directory }
      })
    } }],
  })
  const bundle = result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  const sourceMap = result.outputFiles.find(file => file.path.endsWith('.map'))!.text
  return { bundle, sourceMap, hash: createHash('sha256').update(bundle).digest('hex') }
}

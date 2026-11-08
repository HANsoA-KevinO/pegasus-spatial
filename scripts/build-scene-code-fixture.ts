import { compileSceneCode } from '../lib/scene-code/compiler'
import { mkdir, writeFile } from 'node:fs/promises'
const output = process.argv[2]
if (!output) throw new Error('Fixture output directory is required')
const root = 'output/spatial/scenes/code-fixture'
async function main() {
  await mkdir(output, { recursive: true })
  for (const [name, content] of Object.entries({
    good: `export function createScene(ctx){const T=ctx.THREE,scene=new T.Scene();scene.background=new T.Color('#dce5eb');scene.add(new T.HemisphereLight(0xffffff,0x777777,3));for(const [key,x,color] of [['ObjectA',-2,0xb44a31],['ObjectB',2,0x258177]]){const box=ctx.registerObject(key,new T.Mesh(new T.BoxGeometry(2,2,2),new T.MeshStandardMaterial({color})));box.position.set(x,0,1);scene.add(box)}return {scene}}`,
    bad: `export function createScene(){throw new Error('intentional-candidate-failure')}`,
  })) {
    const compiled = await compileSceneCode({ root, entryPath: `${root}/main.ts`, sources: [{ path: `${root}/main.ts`, content, sha256: '' }] })
    await writeFile(`${output}/code-${name}.js`, compiled.bundle)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

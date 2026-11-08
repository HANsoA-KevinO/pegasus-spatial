import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { compileSceneCode } from '../lib/scene-code/compiler'
import { createSceneCodeTemplate } from '../lib/scene-code/template'

const root = 'output/spatial/scenes/verification'
async function execute(source: string, operation?: Record<string, unknown>) {
  const compiled = await compileSceneCode({ root, entryPath: `${root}/main.ts`, sources: [{ path: `${root}/main.ts`, sha256: '', content: source }] })
  const form = new FormData()
  form.set('manifest', JSON.stringify({ seed: 42, assets: [], operation }))
  form.set('bundle', new Blob([compiled.bundle]), 'runtime.js')
  const response = await fetch(`${process.env.SCENE_CODE_RENDERER_URL || 'http://127.0.0.1:3201'}/render`, { method: 'POST', headers: { authorization: `Bearer ${process.env.SCENE_CODE_RENDERER_TOKEN}` }, body: form })
  const data = await response.json()
  if (!response.ok) throw new Error(JSON.stringify(data))
  return data
}
async function main() {
  const source = `import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
export function createScene(ctx){const T=ctx.THREE, scene=new T.Scene();scene.background=new T.Color(0xdce5eb);scene.add(new T.HemisphereLight(0xffffff,0x888888,3));
const material=new T.MeshStandardMaterial({color:0xad5533});
const wall=new Brush(new T.BoxGeometry(6,.5,4),material);wall.position.z=2;wall.updateMatrixWorld();
const hole=new Brush(new T.BoxGeometry(2,2,3),material);hole.position.z=1.4;hole.updateMatrixWorld();
scene.add(ctx.registerObject('wall',new Evaluator().evaluate(wall,hole,SUBTRACTION),{label:'Doorway'}));
const floor=ctx.registerObject('floor',new T.Mesh(new T.BoxGeometry(10,10,.2),material),{role:'terrain'});floor.position.z=-.1;scene.add(floor);
const box=ctx.registerObject('box',new T.Mesh(new T.BoxGeometry(1,1,1),material),{forward:[0,-1,0]});box.position.set(3,-2,1);scene.add(box);ctx.geometry.placeOn(box,floor);
const curve=new T.LatheGeometry([new T.Vector2(.5,0),new T.Vector2(.9,.5),new T.Vector2(.5,1)],32);curve.rotateX(Math.PI/2);const vase=ctx.registerObject('vase',new T.Mesh(curve,material));vase.position.set(-3,-2,0);scene.add(vase);
const posts=ctx.registerObject('posts',new T.InstancedMesh(new T.BoxGeometry(.2,.2,1),material,4));for(let i=0;i<4;i++)posts.setMatrixAt(i,new T.Matrix4().makeTranslation(i-1.5,3,.5));scene.add(posts);
return {scene};}`
  const report = await execute(source)
  assert.equal(report.views.length, 4)
  assert.equal(report.snapshot.objects.length, 5)
  assert.ok(Math.abs(report.snapshot.objects.find((object: { key: string }) => object.key === 'box').measured.bounds.min[2]) < 1e-6)
  const queries = await execute(source, { kind: 'query', queries: [
    { id: 'opening', kind: 'raycast', object_keys: ['wall'], origin: [0,-3,1], direction: [0,1,0] },
    { id: 'solid', kind: 'raycast', object_keys: ['wall'], origin: [2,-3,1], direction: [0,1,0] },
    { id: 'section', kind: 'section', object_keys: ['wall'], normal: [0,0,1], constant: -1 },
    { id: 'support', kind: 'support', object_keys: ['box','floor'], tolerance: .01 },
  ] })
  assert.equal(queries.observations[0].value, null)
  assert.ok(queries.observations[1].value.point)
  assert.ok(queries.observations[2].value.segments.length > 0)
  assert.ok(queries.observations[3].value.touching >= 25)
  assert.equal(queries.observations[3].value.touching, queries.observations[3].value.sampled)
  await assert.rejects(() => compileSceneCode({ root, entryPath: `${root}/main.ts`, sources: [{ path: `${root}/main.ts`, sha256: '', content: `import fs from 'node:fs';export function createScene(){return fs.readFileSync('/secret')}` }] }), /Unsupported scene import/)
  const empty = await execute(createSceneCodeTemplate())
  assert.equal(empty.snapshot.objects.length, 0, 'New source template must not import prior declarative objects')
  assert.equal(empty.views.length, 4)
  const output = process.env.SCENE_CODE_TEST_OUTPUT || '/private/tmp/pegasus-scene-code-results'
  await mkdir(output, { recursive: true })
  for (const view of report.views) { await writeFile(`${output}/${view.name}.png`, Buffer.from(view.png_base64, 'base64')); delete view.png_base64 }
  await writeFile(`${output}/report.json`, JSON.stringify({ report, queries }, null, 2))
  console.log(`Scene code browser verification passed: ${output}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })

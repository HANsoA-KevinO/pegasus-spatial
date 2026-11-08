import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { compileSceneCode } from '../lib/scene-code/compiler'
const root = 'output/spatial/scenes/advanced-verification'
const url = process.env.SCENE_CODE_RENDERER_URL || 'http://127.0.0.1:3201'
const output = '/private/tmp/pegasus-scene-code-advanced'
type Asset = { alias: string; kind: string; path: string; mime_type: string; bytes: Buffer }
async function execute(source: string, operation: Record<string, unknown> = { kind: 'build' }, assets: Asset[] = [], signal?: AbortSignal) {
  const compiled = await compileSceneCode({ root, entryPath: `${root}/main.ts`, sources: [{ path: `${root}/main.ts`, content: source, sha256: '' }] })
  const form = new FormData(); form.set('bundle', new Blob([compiled.bundle]), 'worker.js')
  form.set('manifest', JSON.stringify({ seed: 42, assets: assets.map(({ bytes, ...asset }) => ({ ...asset, size_bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })), operation }))
  for (const [index, asset] of assets.entries()) form.set(`asset-${index}`, new Blob([new Uint8Array(asset.bytes)]), 'asset')
  const response = await fetch(url + '/render', { method: 'POST', headers: { authorization: `Bearer ${process.env.SCENE_CODE_RENDERER_TOKEN}` }, body: form, signal })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error)
  return result
}
const simple = `export function createScene(ctx){const T=ctx.THREE,scene=new T.Scene();scene.background=new T.Color('#dce5eb');scene.add(new T.HemisphereLight(0xffffff,0x777777,3));const box=ctx.registerObject('box',new T.Mesh(new T.BoxGeometry(2,1,1),new T.MeshStandardMaterial({color:0x7e3522})));scene.add(box);return {scene}}`
function ply() {
  const fields = ['x','y','z','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3','opacity','f_dc_0','f_dc_1','f_dc_2']
  const points: Buffer[] = []
  for (let x = -4; x <= 4; x++) for (let y = -6; y <= 6; y++) for (const z of [-2,2]) { const bytes = Buffer.alloc(56); [x/4,y/3,z/4,-2,-2,-2,1,0,0,0,4,1,-.3,-.5].forEach((value,index)=>bytes.writeFloatLE(value,index*4)); points.push(bytes) }
  return Buffer.concat([Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${points.length}\n${fields.map(field=>'property float '+field+'\n').join('')}end_header\n`), ...points])
}
async function save(name: string, view: { png_base64: string }) { await writeFile(`${output}/${name}.png`, Buffer.from(view.png_base64, 'base64')) }
async function main() {
  await mkdir(output, { recursive: true })
  const checks: string[] = []
  const largeInputs = Array.from({ length: 7 }, (_, index) => ({
    alias: `large-${index}`, kind: 'data', path: `large-${index}.json`, mime_type: 'application/json',
    bytes: Buffer.from(JSON.stringify('x'.repeat(13 * 1024 * 1024) + index)),
  }))
  const largeSource = `export function createScene(ctx){const scene=new ctx.THREE.Scene();for(let i=0;i<7;i++){const data=ctx.assets.readData('large-'+i);if(data.length!==13*1024*1024+1||data.at(4*1024*1024)!=='x'||data.at(-1)!==String(i))throw Error('corrupted frozen input '+i)}return {scene}}`
  const large = await execute(largeSource, { kind: 'inspect' }, largeInputs)
  assert.equal(large.snapshot.assets.filter((asset: { loaded: boolean }) => asset.loaded).length, 7)
  checks.push('91 MiB of frozen inputs reach the worker without crashing Chromium')
  const glb = await readFile('scripts/fixtures/textured-box.glb')
  const mixedSource = `export async function createScene(ctx){const T=ctx.THREE,scene=new T.Scene();scene.background=new T.Color('#dce5eb');scene.add(new T.HemisphereLight(0xffffff,0x777777,3));for(let i=0;i<2;i++){const object=await ctx.assets.loadGLB('model');const size=ctx.geometry.bounds(object).getSize(new T.Vector3());object.scale.setScalar(2/size.z);object.position.x=i*3;scene.add(ctx.registerObject('model-'+i,object))}await ctx.assets.loadGLB('unused');const floor=ctx.registerObject('floor',new T.Mesh(new T.BoxGeometry(10,6,.2),new T.MeshStandardMaterial({color:0x8c8867})),{role:'terrain'});floor.position.set(1.5,0,-.1);scene.add(floor);return {scene}}`
  const assets = ['model','unused'].map(alias => ({ alias, kind: 'glb', path: `${alias}.glb`, mime_type: 'model/gltf-binary', bytes: glb }))
  const mixed = await execute(mixedSource, { kind: 'build' }, assets)
  assert.deepEqual(mixed.snapshot.assets.map((asset: { loaded: boolean; instances_in_scene: number }) => [asset.loaded,asset.instances_in_scene]), [[true,2],[true,0]])
  await save('textured-glb-and-code',mixed.views[3]); checks.push('existing textured GLB + native mesh, clone reuse, loaded versus placed')
  const exported = await execute(mixedSource, { kind:'export', time_s:0 },assets)
  assert.equal(exported.export.status,'exported'); const bytes = Buffer.from(exported.export.bytes_base64,'base64'); assert.equal(bytes.toString('ascii',0,4),'glTF'); assert.equal(bytes.readUInt32LE(8),bytes.length)
  const gltf = JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString()); assert.ok(gltf.images.length>0)
  checks.push('static GLB retains embedded textures')
  const animated = simple.replace('return {scene}', `const canvas=ctx.createCanvas(32,32),paint=canvas.getContext('2d');paint.fillStyle='#e4bc49';paint.fillRect(0,0,32,32);paint.fillStyle='#1230ab';paint.fillRect(0,0,16,16);const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;box.material.map=texture;box.material.needsUpdate=true;return {scene,update(t,dt){box.rotation.z=t;box.position.z=ctx.random()*.01+t*.2}}`)
  const request = { kind:'render',views:[{preset:'overview',time_s:0},{preset:'overview',time_s:1},{preset:'overview',time_s:1}] }
  const first = await execute(animated,request), second = await execute(animated,request)
  assert.equal(first.views[1].png_base64,first.views[2].png_base64); assert.equal(first.views[1].png_base64,second.views[1].png_base64); assert.notEqual(first.views[0].png_base64,first.views[1].png_base64)
  await save('procedural-texture-t0',first.views[0]); await save('procedural-texture-t1',first.views[1]); checks.push('OffscreenCanvas texture produces pixels; seeded fixed-step animation reproducible')
  const shader = simple.replace('new T.MeshStandardMaterial({color:0x7e3522})', `new T.ShaderMaterial({vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'void main(){gl_FragColor=vec4(.1,.8,.4,1.0);}'})`)
  const shaderView = await execute(shader,{kind:'render',views:[{preset:'overview'}]}); await save('shader',shaderView.views[0])
  const query = await execute(shader,{kind:'query',queries:[{kind:'distance',object_keys:['box','box']}]}); assert.equal(query.observations[0].status,'unknown'); assert.match(query.observations[0].reason,/GPU deformation/)
  const unsupported = await execute(shader,{kind:'export'}); assert.equal(unsupported.export.status,'unsupported'); checks.push('GLSL pixels; GPU query and GLB export explicitly unsupported without query geometry')
  await assert.rejects(()=>execute(shader.replace('vec4(.1,.8,.4,1.0)','INVALID_SHADER_SYMBOL')),/Shader compilation failed/)
  await assert.rejects(()=>execute(`export async function createScene(ctx){await ctx.assets.loadGLB('missing')}`),/Missing or incompatible authorized asset/)
  checks.push('bad shader and missing asset report execution errors')
  // Disconnected closed components: testing just the first vertex would miss
  // the small component wholly inside the reservation volume.
  const containment = simple.replace('return {scene}',`const group=new T.Group();for(const x of [-5,0]){const part=new T.Mesh(new T.BoxGeometry(.2,.2,.2),new T.MeshStandardMaterial());part.position.x=x;group.add(part)}scene.add(ctx.registerObject('group',group));return {scene}`)
  const hit = await execute(containment,{kind:'query',queries:[{kind:'intersection',object_keys:['box','group']}]});assert.equal(hit.observations[0].value.containment,true);checks.push('mesh component containment catches hidden interior parts')
  const splatAsset = {alias:'splat',kind:'ply',path:'fixture.ply',mime_type:'application/ply',bytes:ply()}
  const splatSource = `export async function createScene(ctx){const T=ctx.THREE,scene=new T.Scene();scene.background=new T.Color('#cbd6df');scene.add(ctx.registerObject('splat',await ctx.assets.loadSplat('splat')));return {scene}}`
  const splatRequest={kind:'render',views:[{camera:{name:'splats',position:[4,-6,3],target:[0,0,0],up:[0,0,1],fov_deg:56}}]}
  const splat = await execute(splatSource,splatRequest,[splatAsset]); await save('ply',splat.views[0])
  const empty = await execute(splatSource.replace("scene.add(ctx.registerObject('splat',await ctx.assets.loadSplat('splat')))","await ctx.assets.loadSplat('splat')"),splatRequest,[splatAsset])
  const crop = async (view: { png_base64: string }) => sharp(Buffer.from(view.png_base64,'base64')).extract({left:100,top:100,width:700,height:500}).removeAlpha().raw().toBuffer()
  const baseline = await crop(empty.views[0]), pixels = await crop(splat.views[0]); let changed=0
  for(let index=0;index<pixels.length;index++)if(Math.abs(pixels[index]-baseline[index])>20)changed++
  assert.ok(changed>1000,'PLY loaded but did not contribute actual scene pixels')
  const spzSource = `import {writeSpz,SplatMesh} from '@sparkjsdev/spark';export async function createScene(ctx){const T=ctx.THREE,scene=new T.Scene();scene.background=new T.Color('#cbd6df');const root=await ctx.assets.loadSplat('splat');let packed;root.traverse(node=>{if(node.extSplats)packed=node.extSplats});const {fileBytes}=await writeSpz(packed,{version:2});const mesh=new SplatMesh({fileBytes,fileName:'fixture.spz',covSplats:true,extSplats:true});await mesh.initialized;scene.add(ctx.registerObject('spz',mesh));return {scene}}`
  const spz = await execute(spzSource,splatRequest,[splatAsset]);await save('spz',spz.views[0]); checks.push('PLY and SPZ decode and produce actual pixels in shared Worker host')
  const spzPixels=await crop(spz.views[0]);changed=0;for(let index=0;index<spzPixels.length;index++)if(Math.abs(spzPixels[index]-baseline[index])>20)changed++;assert.ok(changed>1000,'SPZ produced no scene pixels')
  // A shorter configured service deadline exercises the exact production
  // timeout path; client cancellation independently destroys a stuck Worker.
  const controller=new AbortController();setTimeout(()=>controller.abort(),1500)
  await assert.rejects(()=>execute('export function createScene(){while(true){}}',{kind:'build'},[],controller.signal))
  for(let attempt=0;attempt<30;attempt++){const health=await(await fetch(url+'/health')).json();if(!health.busy)break;await new Promise(resolve=>setTimeout(resolve,100))}
  await execute(simple,{kind:'inspect'})
  await assert.rejects(()=>execute('export function createScene(){while(true){}}'),/exceeded|cancelled/)
  await execute(simple,{kind:'inspect'}); checks.push('cancel and execution deadline terminate infinite loops; next build remains usable')
  await writeFile(`${output}/results.json`,JSON.stringify({passed:checks,paid_asset_generations:0},null,2));console.log(JSON.stringify({passed:checks,output},null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})

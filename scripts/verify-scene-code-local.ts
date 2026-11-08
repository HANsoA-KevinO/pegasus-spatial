/** Opt-in acceptance against the running local app; no model/provider calls. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import mongoose from 'mongoose'
import { createConversation, updateConversationFields } from '../lib/db/repository'
import { DEMO_USER_ID } from '../lib/demo-identity'
import { createScenePublicationWorkspace } from '../lib/spatial/scene-workspace'
import { executeSpatialSceneTool } from '../lib/tools/spatial-scene'
import { freezeSceneCode } from '../lib/scene-code/source'
import { getSceneCodeBuild, terminal } from '../lib/scene-code/repository'
import { publishSceneBuild, exportSceneProject } from '../lib/scene-code/service'
import { requireSpatialScene } from '../lib/spatial/scene-repository'
import { readImageAsset } from '../lib/media/storage'
import { startManagedLocalApp, stopManagedLocalApp, assertSafeLocalEnvironment } from './demo-local'

const out = '/private/tmp/pegasus-local-acceptance'
async function main() {
  if (process.env.RUN_SCENE_CODE_LOCAL_ACCEPTANCE !== '1') throw new Error('Set RUN_SCENE_CODE_LOCAL_ACCEPTANCE=1; creates a named synthetic test project, retaining existing data')
  assertSafeLocalEnvironment()
  await mkdir(out, { recursive: true })
  const conversation = await createConversation(DEMO_USER_ID, { settings: { orchestrator_model: 'main_pro', memory_enabled: false } })
  const id = conversation.conversation_id
  await updateConversationFields(id, DEMO_USER_ID, { title: '部署验收 · 合成院落', user_input: '本地部署管线测试，未调用模型或付费生成。' })
  const scope = { projectId: id, conversationId: id, userId: DEMO_USER_ID, actorId: 'root', runId: `local-acceptance-${id}` }
  const identity = (toolUseId: string) => ({ ...scope, toolUseId })
  const workspace = await createScenePublicationWorkspace({ conversationId: id, userId: DEMO_USER_ID })
  const receipt = await executeSpatialSceneTool('CreateSpatialScene', { title: '合成院落 · 部署验收' }, { workspace, executionContext: { userId: DEMO_USER_ID, conversationId: id, workspaceId: id, runId: scope.runId, isRoot: true, allowedTools: ['*'] }, invocation: { toolUseId: 'create', actionId: 'create', turn: 1 } })
  assert.ok(!receipt.is_error, receipt.content)
  const project = JSON.parse(receipt.content), root = project.entry_path.slice(0, -'/main.ts'.length)
  const assetPath = 'output/spatial/objects/deployment/instrument.glb'
  const glb = await readFile('scripts/fixtures/textured-box.glb')
  await workspace.writeDocument({ path: assetPath, filename: 'instrument.glb', buffer: glb, mimeType: 'model/gltf-binary', source: { provider: 'local-test-fixture' }, provenance: { retrieved_at: new Date().toISOString() } })
  await workspace.writeText(project.assets_path, JSON.stringify({ assets: [
    { alias: 'instrument', path: assetPath, kind: 'glb' }, { alias: 'loaded-only', path: assetPath, kind: 'glb' },
  ] }))
  await workspace.writeText(`${root}/bench.ts`, `export function makeBench(T){const group=new T.Group(),wood=new T.MeshStandardMaterial({color:0x7d4935,roughness:.8});const seat=new T.Mesh(new T.BoxGeometry(2,.7,.16),wood);seat.position.z=.65;group.add(seat);for(const x of [-.8,.8])for(const y of [-.24,.24]){const leg=new T.Mesh(new T.BoxGeometry(.14,.14,.58),wood);leg.position.set(x,y,.29);group.add(leg)}return group}`)
  const source = `import {makeBench} from './bench'
export async function createScene(ctx){
 const T=ctx.THREE, scene=new T.Scene();scene.background=new T.Color('#dce5eb');
 scene.add(new T.HemisphereLight(0xe4f1ff,0x826b56,2.5));const sun=new T.DirectionalLight(0xffe7bc,3);sun.position.set(4,-6,10);scene.add(sun);
 const floor=ctx.registerObject('floor',new T.Mesh(new T.BoxGeometry(9,8,.2),new T.MeshStandardMaterial({color:0xb7ad92,roughness:.9})),{label:'院子地面',role:'terrain'});floor.position.z=-.1;scene.add(floor);
 const arch=new T.Shape();arch.moveTo(-2.4,0);arch.lineTo(2.4,0);arch.lineTo(2.4,3.2);arch.lineTo(-2.4,3.2);arch.closePath();const door=new T.Path();door.moveTo(-.7,0);door.lineTo(-.7,1.8);door.absarc(0,1.8,.7,Math.PI,0,true);door.lineTo(.7,0);door.closePath();arch.holes.push(door);
 const wall=ctx.registerObject('arch-wall',new T.Mesh(new T.ExtrudeGeometry(arch,{depth:.3,bevelEnabled:false,curveSegments:32}),new T.MeshStandardMaterial({color:0xc29573})),{label:'带贯通拱门的院墙'});wall.rotation.x=Math.PI/2;wall.position.y=2.8;scene.add(wall);
 const bench=ctx.registerObject('bench',makeBench(T),{label:'木长凳'});bench.position.set(-2,-.4,0);scene.add(bench);ctx.geometry.placeOn(bench,floor);
 const instrument=ctx.registerObject('instrument',await ctx.assets.loadGLB('instrument'),{label:'现有纹理 GLB'});instrument.scale.setScalar(.65);instrument.position.set(2,-.5,0);scene.add(instrument);ctx.geometry.placeOn(instrument,floor);
 await ctx.assets.loadGLB('loaded-only');
 const entrance=new T.PerspectiveCamera(50,4/3,.01,200);entrance.up.set(0,0,1);entrance.position.set(8,-11,8);entrance.lookAt(0,0,1);
 return {scene,cameras:{entrance}}
}`
  await workspace.writeText(project.entry_path, source)
  await workspace.writeText(project.checks_path, JSON.stringify({ constraints: [
    { id: 'bench-supported', kind: 'support', object_keys: ['bench', 'floor'], tolerance: .02 },
    { id: 'bench-instrument-gap', kind: 'distance', object_keys: ['bench', 'instrument'], min: 1 },
  ] }))
  async function finish(buildId: string) {
    const deadline = Date.now() + 135000
    for (;;) {
      const build = await getSceneCodeBuild(buildId, scope)
      if (terminal(build.status)) return build
      assert.ok(Date.now() < deadline, `Timed out: ${buildId} ${build.status}`)
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  const build = await freezeSceneCode({ identity: identity('first'), workspace, sceneId: project.scene_id })
  let ready = await finish(build.build_id)
  assert.equal(ready.status, 'ready', ready.error || '')
  assert.ok(ready.report!.constraints.every(check => check.status === 'satisfied'), JSON.stringify(ready.report!.constraints))
  assert.equal(ready.report!.snapshot.assets.find(asset => asset.alias === 'instrument')!.instances_in_scene, 1)
  assert.equal(ready.report!.snapshot.assets.find(asset => asset.alias === 'loaded-only')!.loaded, true)
  assert.equal(ready.report!.snapshot.assets.find(asset => asset.alias === 'loaded-only')!.instances_in_scene, 0)
  assert.equal(ready.report!.views.length, 4)
  assert.equal((await publishSceneBuild(ready, identity('publish'), 1, '部署验收：多文件代码、拱门、长凳及现有纹理 GLB')).status, 'published')
  // A source error must produce a located error without replacing v2.
  await workspace.writeText(project.entry_path, 'export function createScene(ctx){\n throw new Error("deployment-intentional-error")\n}')
  const bad = await finish((await freezeSceneCode({ identity: identity('bad'), workspace, sceneId: project.scene_id })).build_id)
  assert.equal(bad.status, 'failed'); assert.match(bad.error || '', /deployment-intentional-error/)
  assert.equal(bad.failure!.path, project.entry_path)
  assert.equal((await requireSpatialScene(project.scene_id, scope)).current_version, 2)
  await workspace.writeText(project.entry_path, source)
  // Stop the actual Next server, queue while it is down, then restart. Only the
  // application's persistent worker processes this build; no in-script worker.
  assert.equal(await stopManagedLocalApp(), true)
  const recovery = await freezeSceneCode({ identity: identity('restart'), workspace, sceneId: project.scene_id })
  await startManagedLocalApp()
  ready = await finish(recovery.build_id)
  assert.equal(ready.status, 'ready', ready.error || '')
  const published = await publishSceneBuild(ready, identity('publish-recovery'), 2, '部署验收：服务重启后恢复持久构建')
  assert.equal(published.status, 'published')
  const cancel = await freezeSceneCode({ identity: identity('cancel'), workspace, sceneId: project.scene_id })
  const cancelled = await fetch(`http://127.0.0.1:3200/api/conversations/${id}/scene-code/${cancel.build_id}`, { method: 'DELETE' })
  assert.equal(cancelled.status, 200); assert.equal((await cancelled.json()).status, 'cancelled')
  await writeFile(`${out}/project.zip`, await exportSceneProject(ready))
  const montage = await readImageAsset(ready.report!.montage!.image.assetId)
  assert.ok(montage); await writeFile(`${out}/engineering-views.png`, montage.buffer)
  const scene = await requireSpatialScene(project.scene_id, scope)
  const result = { model_calls: 0, paid_asset_calls: 0, conversation_id: id, scene_id: scene.scene_id, build_id: ready.build_id, revision_id: scene.current_revision_id, version: scene.current_version, url: `http://localhost:3200/spatial/${id}?scene=${scene.scene_id}`, objects: ready.report!.snapshot.objects.map(object => ({ key: object.key, label: object.label })), checks: ready.report!.constraints, code_error_located: true, queued_build_resumed_after_server_restart: true, cancellation_verified: true }
  await writeFile(`${out}/result.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => mongoose.disconnect())

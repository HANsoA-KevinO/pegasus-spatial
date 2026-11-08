import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { createConversation } from '../lib/db/repository'
import { connectDB } from '../lib/db/mongodb'
import { createScenePublicationWorkspace } from '../lib/spatial/scene-workspace'
import { createSpatialScene, getCurrentSpatialSceneRevision, mutateSpatialScene, requireSpatialScene, restoreSpatialSceneRevision } from '../lib/spatial/scene-repository'
import { cancelSceneCodeBuild, getSceneCodeBuild, readSceneBlob, SceneCodeBuildModel, SceneCodeSlotModel, terminal } from '../lib/scene-code/repository'
import { freezeSceneCode, prepareSceneCode } from '../lib/scene-code/source'
import { startSceneCodeWorker } from '../lib/scene-code/build-worker'
import { exportSceneProject, publishSceneBuild, resolveBuildTarget } from '../lib/scene-code/service'
import { unzipSync } from 'fflate'
import { materializeProviderImages } from '../lib/agent/provider-image-transport'
import { observeBuild } from '../lib/scene-code/service'
import { executeSpatialSceneTool, type SpatialSceneToolName } from '../lib/tools/spatial-scene'
import { RETIRED_SCENE_EDIT_TOOLS } from '../lib/scene-code/types'
import type { SceneWorldSource } from '../lib/spatial/scene-types'

async function main() {
  if (!/\/pegasus_scene_code_test(?:\?|$)/.test(process.env.MONGODB_URI || '')) throw new Error('Requires isolated pegasus_scene_code_test DB')
  await connectDB(); await mongoose.connection.dropDatabase()
  await Promise.all([SceneCodeBuildModel.syncIndexes(), SceneCodeSlotModel.syncIndexes()])
  const conversation = await createConversation('scene-code-test-user')
  const scope = { projectId: conversation.conversation_id, conversationId: conversation.conversation_id, userId: 'scene-code-test-user', actorId: 'root', runId: 'code-test' }
  const identity = (toolUseId: string) => ({ ...scope, toolUseId })
  const created = await createSpatialScene({ identity: identity('create'), title: 'Source test', commandHash: 'create' })
  assert.equal(created.status, 'applied'); if (created.status !== 'applied') throw new Error('Scene not created')
  const sceneId = created.scene.scene_id
  const workspace = await createScenePublicationWorkspace({ conversationId: scope.projectId, userId: scope.userId })
  const toolRuntime = { workspace, executionContext: { userId: scope.userId, conversationId: scope.conversationId, workspaceId: scope.projectId, runId: scope.runId, isRoot: true, allowedTools: ['*'] }, invocation: { toolUseId: 'create-code-project', actionId: 'create-code-project', turn: 1 } }
  const toolCreated = JSON.parse((await executeSpatialSceneTool('CreateSpatialScene', { title: 'Code-first creation' }, toolRuntime)).content)
  assert.equal(toolCreated.mode, 'code'); assert.ok(toolCreated.entry_path && toolCreated.assets_path && toolCreated.checks_path)
  assert.ok(workspace.exists(toolCreated.entry_path), 'Create returns an already prepared source project')
  const authored = (await workspace.readText(toolCreated.entry_path)) + '\n// authored after creation'
  await workspace.writeText(toolCreated.entry_path, authored)
  const createReplay = JSON.parse((await executeSpatialSceneTool('CreateSpatialScene', { title: 'Code-first creation' }, toolRuntime)).content)
  assert.equal(createReplay.scene_id, toolCreated.scene_id); assert.equal(createReplay.replayed, true)
  assert.equal(await workspace.readText(toolCreated.entry_path), authored, 'Create replay must not overwrite authored source')
  for (const name of RETIRED_SCENE_EDIT_TOOLS) {
    const retired = await executeSpatialSceneTool(name as SpatialSceneToolName, { scene_id: toolCreated.scene_id }, toolRuntime)
    assert.equal(retired.is_error, true); assert.equal(JSON.parse(retired.content).status, 'source_edit_required')
  }
  assert.equal((await requireSpatialScene(toolCreated.scene_id, scope)).current_version, 1, 'Retired tools must not mutate draft scenes')
  const draftRestore = await executeSpatialSceneTool('RestoreSpatialScene', { scene_id: toolCreated.scene_id, revision_version: 1 }, toolRuntime)
  assert.equal(JSON.parse(draftRestore.content).status, 'unsupported_history')
  const archived = await createSpatialScene({ identity: identity('old-data-fixture'), title: 'Archived declarative data', world: { source_job_id: 'old-job', up_axis: 'Y', artifacts: [{ workspace_path: 'unavailable-old-world.spz' }] } as unknown as SceneWorldSource, commandHash: 'old-data-fixture' })
  assert.equal(archived.status, 'applied'); if (archived.status !== 'applied') throw new Error('Fixture not created')
  const fresh = await prepareSceneCode(archived.scene.scene_id, identity('fresh-project'), workspace)
  assert.deepEqual(JSON.parse((await workspace.readText(fresh.assets_path))!), { assets: [] }, 'Old assets must not be automatically migrated')
  assert.equal((await requireSpatialScene(archived.scene.scene_id, scope)).current_version, 1, 'Preparing source must preserve stored history')
  const prepared = await prepareSceneCode(sceneId, identity('prepare'), workspace)
  await prepareSceneCode(sceneId, identity('prepare-again'), workspace)
  const entry = prepared.entry_path, assetPath = prepared.assets_path
  const source = `export function createScene(ctx){const T=ctx.THREE,scene=new T.Scene();scene.background=new T.Color('#dce5eb');const floor=ctx.registerObject('floor',new T.Mesh(new T.BoxGeometry(10,10,.2),new T.MeshStandardMaterial()),{role:'terrain'});floor.position.z=-.1;scene.add(floor);const box=ctx.registerObject('box',new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({color:0xad5522})));scene.add(box);ctx.geometry.placeOn(box,floor);scene.add(new T.HemisphereLight(0xffffff,0x888888,3));return {scene}}`
  await workspace.writeText(entry, source)
  const required = [{ id: 'grounded', kind: 'support' as const, object_keys: ['box','floor'], tolerance: .01 }]
  await workspace.writeText(`${entry.slice(0,entry.lastIndexOf('/'))}/checks.json`,JSON.stringify({constraints:required}))
  const buildInput = { identity: identity('build1'), workspace, sceneId }
  const first = await freezeSceneCode(buildInput)
  assert.equal((await freezeSceneCode(buildInput)).build_id, first.build_id)
  await assert.rejects(() => freezeSceneCode({ ...buildInput, seed: 27 }), /different build arguments/)
  await workspace.writeText(entry, source + '\n// mutable source changed after freezing')
  assert.equal((await getSceneCodeBuild(first.build_id, scope)).sources.find(source => source.path === entry)!.content, source)
  const worker = startSceneCodeWorker()
  async function finish(id: string) { const deadline = Date.now() + 130_000; for (;;) { const build = await getSceneCodeBuild(id, scope); if (terminal(build.status)) return build; if (Date.now() > deadline) throw new Error('Build did not finish'); await new Promise(resolve => setTimeout(resolve, 200)) } }
  try {
    const ready = await finish(first.build_id)
    assert.equal(ready.status, 'ready', ready.error || '')
    assert.equal(ready.report!.constraints[0].status, 'satisfied')
    assert.ok(ready.report!.views.every(view => view.image && !view.png_base64))
    assert.equal(ready.report!.snapshot.objects.find(object => object.key === 'box')!.source.path, entry)
    const zip = unzipSync(await exportSceneProject(ready))
    assert.ok(zip['index.html'] && zip['scene-worker.js'] && zip['source/main.ts'])
    assert.ok((await readSceneBlob(ready.bundle_blob_id!, ready)).length > 0)
    const published = await publishSceneBuild(ready, identity('publish1'), 1, 'Publish code')
    assert.equal(published.status, 'published')
    const publishedRevision = await getCurrentSpatialSceneRevision(await requireSpatialScene(sceneId, scope))
    assert.equal(publishedRevision.program!.build_id, ready.build_id)
    assert.equal((await resolveBuildTarget({ revision_id: publishedRevision.revision_id }, scope)).build.build_id, ready.build_id)
    await assert.rejects(() => resolveBuildTarget({ revision_id: publishedRevision.revision_id }, { ...scope, userId: 'different-owner' }), /not found/)
    await assert.rejects(() => resolveBuildTarget({ revision_id: publishedRevision.revision_id }, { ...scope, projectId: 'different-project' }), /not found/)
    await assert.rejects(() => resolveBuildTarget({ build_id: ready.build_id, scene_id: 'different-scene' }, scope), /does not match/)
    assert.equal((await publishSceneBuild(ready, identity('stale'), 1, 'Stale')).status, 'scene_changed')
    await restoreSpatialSceneRevision({ identity: identity('restore-legacy'), sceneId, version: 1, commandHash: 'restore' })
    assert.equal((await getCurrentSpatialSceneRevision(await requireSpatialScene(sceneId, scope))).program, null)
    await restoreSpatialSceneRevision({ identity: identity('restore-code'), sceneId, version: 2, commandHash: 'restore-code' })
    assert.equal((await getCurrentSpatialSceneRevision(await requireSpatialScene(sceneId, scope))).program!.build_id, ready.build_id)
    await workspace.writeText(entry, 'export function createScene(ctx) { throw new Error("intentional-user-source-error") }')
    const bad = await freezeSceneCode({ identity: identity('bad'), workspace, sceneId })
    assert.equal((await finish(bad.build_id)).status, 'failed')
    assert.equal((await requireSpatialScene(sceneId, scope)).current_version, 4)
    await workspace.writeText(entry, source)
    const cancelled = await freezeSceneCode({ identity: identity('cancel'), workspace, sceneId })
    await cancelSceneCodeBuild(cancelled.build_id, scope)
    assert.equal((await finish(cancelled.build_id)).status, 'cancelled')
    const recovered = await freezeSceneCode({ identity: identity('recover'), workspace, sceneId })
    await SceneCodeBuildModel.updateOne({ build_id: recovered.build_id }, { $set: { status: 'running', attempts: 1, lease: { owner: 'dead', token: 'dead', expires_at: new Date(0) } } })
    assert.equal((await finish(recovered.build_id)).status, 'ready')
    // Removing the file requirement cannot make a floating cube publishable.
    const checksPath = `${entry.slice(0,entry.lastIndexOf('/'))}/checks.json`
    await workspace.writeText(checksPath,JSON.stringify({constraints:[]}))
    await workspace.writeText(entry,source.replace('ctx.geometry.placeOn(box,floor);','box.position.z=1;'))
    const omission = await freezeSceneCode({identity:identity('omission'),workspace,sceneId})
    assert.equal(omission.constraints.length,1)
    assert.ok(omission.acceptance_warnings!.some(warning=>warning.includes('restored:grounded')))
    const negative = await finish(omission.build_id)
    assert.equal(negative.status,'ready');assert.equal(negative.report!.constraints[0].status,'violated')
    assert.equal((await publishSceneBuild(negative,identity('reject-omission'),4,'Must not pass')).status,'acceptance_incomplete')
    await workspace.writeText(checksPath,JSON.stringify({constraints:[{...required[0],required:false,tolerance:100}]}))
    const weakened = await freezeSceneCode({identity:identity('weakened'),workspace,sceneId})
    assert.equal(weakened.constraints[0].required,true);assert.equal(weakened.constraints[0].tolerance,.01)
    assert.ok(weakened.acceptance_warnings!.some(warning=>warning.includes('preserved:grounded')))
    assert.equal((await finish(weakened.build_id)).report!.constraints[0].status,'violated')
    await workspace.writeText(entry,source)
    await workspace.writeText(checksPath,JSON.stringify({constraints:required}))
    const beforeChange = await freezeSceneCode({identity:identity('before-contract-change'),workspace,sceneId})
    const beforeReady = await finish(beforeChange.build_id)
    const gap = {id:'small-gap',kind:'distance' as const,object_keys:['box','floor'],max:.02}
    const added = await freezeSceneCode({identity:identity('contract-change'),workspace,sceneId,constraints:[...required,gap]})
    assert.equal(added.acceptance!.version,beforeChange.acceptance!.version+1)
    await finish(added.build_id)
    assert.equal((await publishSceneBuild(beforeReady,identity('old-contract-publish'),4,'Stale checks')).status,'acceptance_changed')
    await assert.rejects(()=>freezeSceneCode({identity:identity('same-run-reset'),workspace,sceneId,constraints:[],acceptanceUpdate:{expected_version:added.acceptance!.version,reason:'remove checks'}}),/same modelling run/)
    await assert.rejects(()=>freezeSceneCode({identity:{...identity('background-reset'),runId:'background-run'},workspace,sceneId,constraints:[],acceptanceUpdate:{expected_version:added.acceptance!.version,reason:'remove checks'}}),/authenticated user/)
    // A new authenticated user requirement can intentionally change a contract;
    // this is not available to the modelling code or background recovery.
    await mongoose.connection.db!.collection('agent_runs').insertOne({run_id:'new-user-run',user_id:scope.userId,conversation_id:scope.conversationId,trigger:'user',started_message_id:'new-user-message',request:{message:'Keep grounded and use the new requested gap'}})
    const authorized = await freezeSceneCode({identity:{...identity('user-contract-change'),runId:'new-user-run'},workspace,sceneId,constraints:[...required,{...gap,max:.1}],acceptanceUpdate:{expected_version:added.acceptance!.version,reason:'New user requested gap range'}})
    assert.equal(authorized.acceptance!.requirements.find(check=>check.id==='small-gap')!.max,.1)
    assert.equal((await finish(authorized.build_id)).status,'ready')
    const ref=ready.report!.views[0].image!
    const transport={messages:[{source:{type:'url',url:`pegasus-asset:${ref.assetId}`}}]}
    const transported=await materializeProviderImages(transport,{userId:scope.userId,conversationId:scope.conversationId,runId:'image',isRoot:true})
    assert.equal((transported.messages[0].source as unknown as {type:string}).type,'base64')
    await assert.rejects(()=>materializeProviderImages(transport,{userId:'other-owner',conversationId:scope.conversationId,runId:'image',isRoot:true}),/unavailable in this project/)
    const partial=await observeBuild(beforeReady,{kind:'render',views:[{preset:'top'},{camera_key:'missing-camera'},{preset:'front'}]},workspace)
    assert.equal(partial.views!.length,2);assert.equal(partial.view_errors![0].code,'camera_not_found');assert.equal(partial.view_errors![0].suggested_preset,'overview')
    const race = await freezeSceneCode({ identity: identity('race-build'), workspace, sceneId })
    const raceReady = await finish(race.build_id)
    await mutateSpatialScene({ identity: identity('race-update'), sceneId, commandHash: 'race', summary: 'Concurrent update', mutate: snapshot => snapshot })
    assert.equal((await publishSceneBuild(raceReady, identity('race-publish'), 4, 'Stale base')).status, 'scene_changed')
    console.log(JSON.stringify({ passed: ['freeze/idempotence/arguments', 'actual browser build and source map', 'byte-free PNG publication', 'project ZIP', 'atomic publish and stale CAS', 'code history and draft restore boundary', 'code-project creation/replay preserves authored source', 'retired edit tools cannot mutate', 'no automatic declarative conversion', 'source failure preserves current scene', 'cancel', 'lease recovery', 'required checks survive deletion and weakening', 'contract changes invalidate old builds', 'authenticated new user requirement update', 'private image transport ownership', 'partial view errors preserve valid images', 'constraint violation is not execution failure'], scene_id: sceneId, assets_path: assetPath }))
  } finally { await worker.stop(); await mongoose.disconnect() }
}
main().catch(error => { console.error(error); void mongoose.disconnect(); process.exitCode = 1 })

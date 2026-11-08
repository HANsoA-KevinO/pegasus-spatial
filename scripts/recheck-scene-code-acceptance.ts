/** Deterministic replay of saved live acceptance; never calls a model. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import mongoose from 'mongoose'
import { connectDB } from '../lib/db/mongodb'
import { createScenePublicationWorkspace } from '../lib/spatial/scene-workspace'
import { getSceneCodeBuild, terminal } from '../lib/scene-code/repository'
import { freezeSceneCode } from '../lib/scene-code/source'
import { startSceneCodeWorker } from '../lib/scene-code/build-worker'
import { observeBuild, exportSceneProject } from '../lib/scene-code/service'
import { readImageAsset } from '../lib/media/storage'
import { SCENE_CODE_RUNTIME_VERSION, sceneAssetManifest, type SceneConstraint, type SceneCodeBuild } from '../lib/scene-code/types'
import { acceptanceHash } from '../lib/scene-code/acceptance'

async function main() {
  if (!/\/pegasus_scene_agent_test(?:\?|$)/.test(process.env.MONGODB_URI || '')) throw new Error('Requires isolated pegasus_scene_agent_test DB')
  const tracePath = process.env.SCENE_CODE_RECHECK_TRACE
  if (!tracePath) throw new Error('SCENE_CODE_RECHECK_TRACE must identify the saved live acceptance trace')
  const trace = JSON.parse(await readFile(tracePath, 'utf8'))
  const output = process.env.SCENE_CODE_RECHECK_OUTPUT || '/private/tmp/pegasus-scene-recheck'
  await mkdir(output, { recursive: true }); await connectDB()
  const scope = { projectId: trace.conversation_id, conversationId: trace.conversation_id, userId: 'scene-agent-acceptance-user' }
  const workspace = await createScenePublicationWorkspace({ conversationId: scope.projectId, userId: scope.userId })
  const worker = startSceneCodeWorker(), results: unknown[] = []
  try {
    const publications = trace.events.filter((event: { event: string; tool: string }) => event.event === 'tool_result' && event.tool === 'PublishSceneBuild')
    assert.equal(publications.length, 3, 'Expected courtyard, selected edit and interior publications')
    for (const event of publications) {
      const receipt = JSON.parse(event.result.content), original = await getSceneCodeBuild(receipt.build_id, scope)
      const backup = new Map<string, string | null>()
      for (const source of original.sources) { backup.set(source.path, await workspace.readText(source.path)); await workspace.writeText(source.path, source.content) }
      let build: SceneCodeBuild
      try {
        build = await freezeSceneCode({ identity: { ...scope, runId: `deterministic-recheck-${randomUUID()}`, toolUseId: original.build_id, actorId: 'acceptance-replay' }, workspace, sceneId: original.scene_id, entryPath: original.entry_path, assetsPath: original.assets_path, constraints: original.constraints, seed: original.seed })
      } finally { for (const [path, content] of backup) if (content !== null) await workspace.writeText(path, content) }
      const deadline = Date.now() + 130_000
      while (!terminal(build.status)) { assert.ok(Date.now() < deadline, 'Replay build timed out'); await new Promise(resolve => setTimeout(resolve, 200)); build = await getSceneCodeBuild(build.build_id, scope) }
      assert.equal(build.status, 'ready', build.error ?? 'Replay failed')
      assert.equal(build.runtime_version, SCENE_CODE_RUNTIME_VERSION)
      assert.deepEqual(build.sources, original.sources, 'Replay must preserve every frozen source byte')
      assert.deepEqual(build.assets.map(sceneAssetManifest), original.assets.map(sceneAssetManifest), 'Replay must preserve asset bytes and normalization')
      assert.equal(build.seed, original.seed); assert.deepEqual(build.dependencies, original.dependencies)
      // Retained contracts may reorder checks; order is not a requirement
      // change. Compare canonical definitions, while recording both hashes.
      assert.equal(acceptanceHash(build.constraints), acceptanceHash(original.constraints))
      for (const condition of build.report!.constraints.filter(check => check.required)) assert.equal(condition.status, 'satisfied', `${event.phase}: retained ${condition.id}`)
      const courtyard = event.phase !== 'interior', reservation = 'entry-clearance'
      const checks: SceneConstraint[] = [
        ...build.report!.snapshot.objects.filter(object => object.measured.in_scene && !['floor', reservation].includes(object.key)).map(object => ({ id: `independent-route-${object.key}`, kind: 'keep_clear' as const, object_keys: [reservation, object.key] })),
        ...(courtyard ? [
          { id:'independent-bench-support',kind:'support' as const,object_keys:['bench','floor'],tolerance:.02 },
          { id:'independent-bench-gap',kind:'distance' as const,object_keys:['bench','south-wall'],min:.35,max:.45 },
        ] : [
          ...['chair','table'].map(key=>({id:`independent-support-${key}`,kind:'support' as const,object_keys:[key,'floor'],tolerance:.02})),
          {id:'independent-chair-table-gap',kind:'distance' as const,object_keys:['chair','table'],min:.25,max:.35},
        ]),
      ]
      const measured = await observeBuild(build, { kind: 'check', constraints: checks }, workspace)
      for (const condition of measured.constraints!) assert.equal(condition.status, 'satisfied', `${event.phase}: ${condition.id}: ${JSON.stringify(condition.observation)}`)
      await writeFile(`${output}/${event.phase}.json`, JSON.stringify({ original_build_id: original.build_id, replay_build_id: build.build_id, source_hash: build.source_hash, runtime: build.runtime_version, independent: measured.constraints, report: build.report }, null, 2))
      const montage = build.report!.montage
      if (montage) { const image = await readImageAsset(montage.image.assetId); if (image) await writeFile(`${output}/${event.phase}.png`, image.buffer) }
      await writeFile(`${output}/${event.phase}.zip`, await exportSceneProject(build))
      const exported = await observeBuild(build, {kind:'export',time_s:0,format:'glb'},workspace) as unknown as {export:{status:string;bytes_base64?:string}}
      assert.equal(exported.export.status,'exported', 'Standard material acceptance scene must export a static GLB')
      await writeFile(`${output}/${event.phase}.glb`,Buffer.from(exported.export.bytes_base64!,'base64'))
      results.push({ phase:event.phase, original_build_id:original.build_id, replay_build_id:build.build_id, original_runtime:original.runtime_version, replay_runtime:build.runtime_version, source_assets_seed_dependencies_identical:true, requirements_identical:true, combined_hash_identical:build.source_hash===original.source_hash, retained_checks:build.report!.constraints.length, independent_checks:checks.length, all_satisfied:true, project_and_glb_exported:true })
    }
    await writeFile(`${output}/results.json`,JSON.stringify({model_calls:0,results},null,2)); console.log(JSON.stringify({model_calls:0,results,output},null,2))
  } finally { await worker.stop(); await mongoose.disconnect() }
}
main().catch(error=>{console.error(error);void mongoose.disconnect();process.exitCode=1})

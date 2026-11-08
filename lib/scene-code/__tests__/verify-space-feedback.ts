import assert from 'node:assert/strict'
import * as THREE from 'three'
import { GeometrySession, type SceneRegistry } from '../runtime/geometry'
import { acceptanceCoverage, acceptanceHash, retainSceneRequirements, validateSceneConstraints } from '../acceptance'
import type { SceneAcceptanceContract, SceneConstraint } from '../types'

const scene = new THREE.Scene(), registry: SceneRegistry = new Map()
function register(key: string, object: THREE.Object3D) { scene.add(object); registry.set(key, { key, object, metadata: {} }); return object }
const material = new THREE.MeshBasicMaterial()
const floor = register('floor', new THREE.Mesh(new THREE.BoxGeometry(10, 10, .2), material)); floor.position.z = -.1
// The exact thin-leg layout that the original 5x5 AABB grid missed.
const bench = new THREE.Group(), seat = new THREE.Mesh(new THREE.BoxGeometry(1.4, .45, .06), material)
seat.position.z = .42; bench.add(seat)
for (const x of [-.55, .55]) for (const y of [-.15, .15]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(.08, .08, .39), material); leg.position.set(x, y, .195); bench.add(leg) }
register('bench', bench)
const support: SceneConstraint = { id: 'grounded', kind: 'support', object_keys: ['bench','floor'], tolerance: .01 }
function measure() { scene.updateMatrixWorld(true); return new GeometrySession(registry) }
let query = measure()
const result = query.check(support), value = result.observation.value as { sampled: number; touching: number; support_fraction: number; coverage: string }
assert.equal(result.status, 'satisfied', 'thin feet must pass without adding a base plate')
assert.ok(value.touching >= 16); assert.equal(value.support_fraction, 1); assert.match(value.coverage, /not all feet/)
query.dispose(); bench.position.z = .3
query = measure(); assert.equal(query.check(support).status, 'violated', 'a floating object must fail'); query.dispose()
bench.position.z = -.05
query = measure(); assert.equal(query.check(support).status, 'violated', 'penetrating feet must fail'); query.dispose(); bench.position.z = 0
const smallFloor = register('partial-floor', new THREE.Mesh(new THREE.BoxGeometry(.7, 2, .2), material)); smallFloor.position.set(-.5, 0, -.1)
query = measure(); const partial = query.check({ ...support, object_keys: ['bench','partial-floor'] }); assert.equal(partial.status, 'violated'); assert.ok((partial.observation.value as { missed_target: number }).missed_target > 0); query.dispose()

// Open/compound objects outside a clearance volume do not require a solid
// containment test: separated bounds are already a conclusive proof.
const shelf = register('shelf', new THREE.Mesh(new THREE.PlaneGeometry(2.2,2), material)); shelf.rotation.x = Math.PI / 2; shelf.position.set(.4, 2.12, 1)
const clearance = register('entry', new THREE.Mesh(new THREE.BoxGeometry(1.2,2.5,2.2), material)); clearance.position.set(0,-1.25,1.1)
query = measure(); const separated = query.check({ id: 'entry-clear', kind: 'keep_clear', object_keys: ['shelf','entry'] }); assert.equal(separated.status, 'satisfied'); assert.equal(separated.observation.method, 'disjoint_world_mesh_bounds'); query.dispose()
const rodA = register('rod-a', new THREE.Mesh(new THREE.BoxGeometry(4,.1,.1), material)), rodB = register('rod-b', new THREE.Mesh(new THREE.BoxGeometry(4,.1,.1), material))
rodA.rotation.z = rodB.rotation.z = Math.PI / 4; rodB.position.set(-.3,.3,0)
scene.updateMatrixWorld(true); assert.ok(new THREE.Box3().setFromObject(rodA).intersectsBox(new THREE.Box3().setFromObject(rodB)))
query = measure(); assert.equal(query.check({ id:'rods', kind:'no_intersection', object_keys:['rod-a','rod-b'] }).status, 'satisfied', 'overlapping AABBs must not be called a collision'); query.dispose()
const openA = register('open-a', new THREE.Mesh(new THREE.PlaneGeometry(2,2), material)), openB = register('open-b', new THREE.Mesh(new THREE.PlaneGeometry(2,2), material))
openA.rotation.x = openB.rotation.x = Math.PI / 4; openB.position.set(0,.1,-.1)
query = measure(); const unknown = query.check({id:'open',kind:'no_intersection',object_keys:['open-a','open-b']}); assert.equal(unknown.status,'unknown'); assert.match(unknown.observation.reason!,/containment unverifiable/); query.dispose()
registry.get('rod-a')!.metadata.query_geometry_required = true
query = measure(); assert.equal(query.query({kind:'intersection',object_keys:['rod-a','shelf']}).status,'unknown','GPU deformation may not use undeformed bounds as evidence'); query.dispose()

const required: SceneConstraint[] = [{id:'gap',kind:'distance',object_keys:['bench','wall'],min:.35,max:.45,required:true}, {id:'shelf-clear',kind:'keep_clear',object_keys:['shelf','entry'],required:true}]
const retained = retainSceneRequirements(required, [{...required[0],min:0,max:99,required:false}])
assert.equal(retained.requirements.length,2); assert.equal(retained.constraints.find(check=>check.id==='gap')!.min,.35); assert.equal(retained.constraints.find(check=>check.id==='gap')!.required,true)
assert.ok(retained.warnings.some(warning=>warning.includes('restored:shelf-clear')))
const contract: SceneAcceptanceContract = { version:1,hash:acceptanceHash(required),requirements:required,established_run_id:'run',changed_run_id:'run',change_reason:'fixture' }
const coverage = acceptanceCoverage(contract, [result])
assert.equal(coverage.complete,false); assert.equal(coverage.issues.length,2)
assert.throws(()=>validateSceneConstraints([{...required[0],min:10,max:1}]),/min exceeds max/)
assert.throws(()=>validateSceneConstraints([required[0],required[0]]),/unique/)
console.log('space feedback regressions passed: thin feet, floating/penetrating/partial support, separated open mesh, AABB overlap, unknown, protected coverage')

// Compound solids are a union. Global even/odd rays used to cancel two
// overlapping closed boxes and falsely certify a reservation inside them.
const compound = new THREE.Group()
for (const x of [-.2,.2]) { const part = new THREE.Mesh(new THREE.BoxGeometry(2,2,2),material); part.position.x=x; compound.add(part) }
register('compound',compound)
const insideProbe=register('inside-probe',new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2),material))
query=measure();const compoundHit=query.query({kind:'intersection',object_keys:['compound','inside-probe']});assert.equal((compoundHit.value as {intersects:boolean}).intersects,true);query.dispose()
const joined=new THREE.Group()
for(const x of [-1,1]) {const part=new THREE.Mesh(new THREE.BoxGeometry(1,.5,3),material);part.position.set(x,0,1.5);joined.add(part)}
const lintel=new THREE.Mesh(new THREE.BoxGeometry(3,.5,1),material);lintel.position.z=2.5;joined.add(lintel);register('joined-arch',joined)
insideProbe.position.z=1
query=measure();const clearArch=query.check({id:'joined-opening',kind:'keep_clear',object_keys:['joined-arch','inside-probe']});assert.equal(clearArch.status,'satisfied','touching closed mesh parts must not be welded into an open assembly');query.dispose()

function combineBoxes(innerReversed: boolean) {
  const values: number[]=[]
  for(const [index,size] of [2,innerReversed?1:2].entries()) {
    const geometry=new THREE.BoxGeometry(size,size,size).toNonIndexed(),position=geometry.getAttribute('position')
    for(let triangle=0;triangle<position.count;triangle+=3) for(const corner of innerReversed && index===1 ? [0,2,1] : [0,1,2]) values.push(position.getX(triangle+corner)+(innerReversed?0:index===0?-.2:.2),position.getY(triangle+corner),position.getZ(triangle+corner))
    geometry.dispose()
  }
  return new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(values,3))
}
register('merged-overlap',new THREE.Mesh(combineBoxes(false),material));insideProbe.position.z=0
query=measure();assert.equal((query.query({kind:'intersection',object_keys:['merged-overlap','inside-probe']}).value as {intersects:boolean}).intersects,true,'overlap within one mesh must use nonzero winding');query.dispose()
register('hollow-shell',new THREE.Mesh(combineBoxes(true),material))
query=measure();assert.equal(query.check({id:'cavity',kind:'no_intersection',object_keys:['hollow-shell','inside-probe']}).status,'satisfied','a correctly oriented cavity must remain empty');query.dispose()
insideProbe.position.x=.75
query=measure();assert.equal((query.query({kind:'intersection',object_keys:['hollow-shell','inside-probe']}).value as {intersects:boolean}).intersects,true,'shell material must remain occupied');query.dispose()

console.log('mesh union regressions passed: overlapping solids, touching assembly, merged overlap and hollow cavity')

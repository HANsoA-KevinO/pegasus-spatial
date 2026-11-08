import React, { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { ThreeSceneRuntime } from '../../components/spatial-stage/three-scene-runtime'
import { SpatialStage } from '../../components/spatial-stage/SpatialStage'
import { SceneCodeCanvas } from '../../components/spatial-stage/SceneCodeCanvas'

// This fixture imports the production renderer and Stage. Only unrelated app
// providers are replaced by build-three-renderer-fixture.mjs.
const host = document.getElementById('root')
let reactRoot
window.threeFixture = {
  runtime: null, input: null, states: [], quality: [], selected: [], poses: [],
  mount(input) {
    reactRoot?.unmount(); reactRoot = null
    this.runtime?.dispose()
    host.innerHTML = ''; host.style.height = '720px'; host.style.width = '1280px'
    host.tabIndex = 0
    this.input = input; this.states = []; this.quality = []; this.selected = []; this.poses = []
    this.runtime = new ThreeSceneRuntime(host, {
      onState: (loading, error) => this.states.push({ loading, error }),
      onQualityStateChange: state => this.quality.push(state),
      onSelectInstance: id => this.selected.push(id),
      onCameraChange: pose => this.poses.push(pose),
    })
    this.runtime.sync(input)
  },
  sync(changes) { this.input = { ...this.input, ...changes }; this.runtime.sync(this.input) },
  async capture(viewpoint, revision) {
    const blob = await this.runtime.capture(viewpoint, revision)
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsDataURL(blob)
    })
  },
  async makeSpz() {
    const { writeSpz } = await import('@sparkjsdev/spark')
    const mesh = this.runtime.entries.get('glb-box').quality.mesh
    const { fileBytes } = await writeSpz(mesh.extSplats, { version: 2 })
    return URL.createObjectURL(new Blob([fileBytes], { type: 'application/octet-stream' }))
  },
  mountStage() {
    reactRoot?.unmount()
    this.runtime?.dispose(); this.runtime = null
    host.innerHTML = ''; host.style.height = ''; host.style.width = ''
    reactRoot = createRoot(host)
    reactRoot.render(<SpatialStage conversationId="renderer-fixture" projectTitle="Fixture" artifacts={[]} isProjectLoading={false} />)
  },
  mountCode(build='good', revision='code-rev1') {
    reactRoot?.unmount(); this.runtime?.dispose(); this.runtime = null
    host.innerHTML=''; host.style.height='720px';host.style.width='1280px';host.style.display='flex';host.style.flexDirection='column'
    this.codeRef=createRef();this.selected=[];this.poses=[]
    reactRoot=createRoot(host)
    this.syncCode(build,revision)
  },
  syncCode(build,revision) {
    reactRoot.render(<SceneCodeCanvas ref={this.codeRef} conversationId="renderer-fixture" program={{build_id:build}} revisionId={revision} cameraMode="user" onSelectInstance={key=>this.selected.push(key)} onCameraChange={pose=>this.poses.push(pose)} />)
  },
}

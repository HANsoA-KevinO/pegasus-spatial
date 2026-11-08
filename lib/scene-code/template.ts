/** A source-first project starts empty; assets and geometry are authored in code. */
export function createSceneCodeTemplate() {
  return `// Three.js source is the scene truth. Z-up, relative units.
// ctx: THREE, renderer, assets, registerObject, random, geometry, createCanvas.
export async function createScene(ctx) {
  const T = ctx.THREE
  const scene = new T.Scene()
  scene.background = new T.Color('#dce5eb')
  const sky = new T.HemisphereLight(0xdcecff, 0x6e695c, 2)
  sky.position.set(0, 0, 10)
  scene.add(sky)
  const sun = new T.DirectionalLight(0xffedcf, 3)
  sun.position.set(8, -6, 12)
  sun.castShadow = true
  scene.add(sun)
  // Author geometry, materials and layout here, or import project modules.
  // Authorized GLB / texture / PLY / SPZ assets are declared in assets.json.
  return { scene }
}
`
}

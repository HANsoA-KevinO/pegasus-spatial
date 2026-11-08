# Three.js 源码、观察与空间验证

工程：`output/spatial/scenes/<scene-id>/main.ts`、`assets.json`、可选 `checks.json`。支持多文件静态相对导入、JSON 参数、GLSL 文本导入。依赖固定为 Three.js 0.183.2、Spark 2.4.0、three-bvh-csg 0.0.18、three-mesh-bvh 0.9.18；允许 import three、three/addons/*、three-bvh-csg、three-mesh-bvh。没有 Node、任意网络或运行时安装。

组装还原场景时，优先使用已检查的 GLB 做主体。用源码安排组合、灯光、视角，以及有明确尺寸或形状的补充几何。以下例子假设已有院门和石凳资产，并用源码补平整铺地。

```ts
export async function createScene(ctx) {
  const T = ctx.THREE
  const scene = new T.Scene()
  scene.background = new T.Color('#cddce6')
  scene.add(new T.HemisphereLight(0xffffff, 0x756b59, 2))
  const sun = new T.DirectionalLight(0xffe4bf, 3)
  sun.position.set(8, -6, 12)
  scene.add(sun)

  const floor = new T.Mesh(
    new T.BoxGeometry(8, 8, 0.2),
    new T.MeshStandardMaterial({ color: '#ad9986' }),
  )
  floor.position.z = -0.1
  scene.add(ctx.registerObject('floor', floor, { role: 'terrain' }))

  const gate = await ctx.assets.loadGLB('gate')
  scene.add(ctx.registerObject('courtyard-gate', gate, { label: '院门', semantic_type: 'gate' }))
  ctx.geometry.placeOn(gate, floor, { at: [0, -3], clearance: 0 })

  const stool = await ctx.assets.loadGLB('stool')
  scene.add(ctx.registerObject('stone-stool', stool, { label: '石凳', semantic_type: 'seat' }))
  ctx.geometry.placeOn(stool, floor, { at: [2, 1], clearance: 0 })

  return { scene, cameras: {
    entrance: { name: 'entrance', position: [0, -6, 1.6], target: [0, 0, 1.6], up: [0, 0, 1], fov_deg: 55 }
  } }
}
```

按真实构建检查 GLB 朝向和尺寸后调整参数。门洞、台阶、饰边等补充几何可使用 Shape/ExtrudeGeometry、曲线、自定义 BufferGeometry、实例阵列或 CSG。制作贯通开口时，可用 `three-bvh-csg` 的 `Brush` 和 `Evaluator` 做 `SUBTRACTION`，随后用实际截面或射线核对。

`registerObject(key, object, metadata)` 返回原对象；不自动加入 scene、不插入覆盖层。稳定 key 用于选中、图中编号和查询；名称和语义不能证明几何。metadata 可含 label、semantic_type、description、role、局部 forward、anchors、query_geometry。GLB 默认登记整体，内部部件由作者明确登记。查询几何必须是已正确定位的 Object3D；GPU 顶点位移必须提供它，否则相关测量 unknown。ShaderMaterial 自动按可能位移处理。

```json
{"assets":[
  {"alias":"gate","path":"output/spatial/objects/courtyard-gate/model.glb","kind":"glb"},
  {"alias":"stool","path":"output/spatial/objects/stone-stool/model.glb","kind":"glb"}
]}
```

kind 为 glb、texture、ply、spz 或 data；全部来自当前授权 Workspace。GLB 嵌入纹理，不允许外链。loadGLB 返回独立实例并复用几何/材质，处理已有坐标基或默认 Y→Z、底部中心；如需修改单实例材质请 clone。loadTexture 返回 sRGB Texture；全景设置 EquirectangularReflectionMapping。loadSplat 保留 PLY/SPZ 视觉；readData 读取 JSON。`loaded:true` 不代表已放入场景，必须看 instances_in_scene。

Lux3D 同一任务产出的 `model.glb` 和 `gaussian.ply` 会在构建时自动配对。源码照常用 `loadGLB` 放置物体，舞台可以按需切到高质量 PLY，Agent 的几何检查继续用 GLB。需要明确配对时，给 GLB 条目写 `paired_ply`，值为清单中的 PLY alias。用 `loadSplat` 直接放置整景 PLY 或 SPZ 时，始终使用该高斯资产显示。

ctx.geometry：

- `placeOn(object, surface, {at?:[x,y], clearance?:number})`：目标水平位置向下射线，按源网格底部落放。随后查询支撑采样，不声称完整物理稳定。
- `alignAgainstWall(object, wall, {normal:[x,y,z], gap:number})`：沿显式墙法向投影实际网格表面，按间隙平移。
- `faceTowards(object, targetObjectOrVector3, {forward?:[x,y,z]})`：Z-up 水平旋转，forward 可取登记值，不推断 GLB 正面。
- `distribute(objects, {direction:[x,y,z], start:[x,y,z], gap:number})`：沿显式方向按实际投影范围等间隔排列。
- `bounds(object)` 返回世界包围盒，不能当作实体表面或碰撞证明。

动画：返回 `update(t, dt)`；宿主固定 dt=1/30，时间取最近帧，倒退时从相同种子重新创建。使用 ctx.random，禁止 Math.random、Date.now、独立 render loop。ctx.createCanvas 创建 OffscreenCanvas，配合 CanvasTexture 可画程序纹理。源码拥有 scene 的灯光、雾、背景，宿主拥有 renderer、相机、画布和 ACES/sRGB 管线。

仅在用户要求相应空间关系时采用这些检查。通道示例还需要在源码登记 `entry-reservation` 查询几何。

```json
{"constraints":[
  {"id":"chair-grounded","kind":"support","object_keys":["stone-stool","floor"],"tolerance":0.02,"required":true},
  {"id":"clear-gap","kind":"distance","object_keys":["stone-stool","courtyard-gate"],"min":0.3,"max":0.5,"required":true},
  {"id":"entry-clear","kind":"keep_clear","object_keys":["entry-reservation","stone-stool"],"required":true}
]}
```

预留通道是明确登记的闭合查询网格，可 invisible；必须指定其真实范围与容差，并覆盖通道内可能构成障碍的对象，不能只检查一个物体就声称整条通道畅通。RunSceneCode 默认读取工程根目录 checks.json；也可显式提供 checks_path 或 constraints。必需条件保存在 Scene 的验收契约中；删除文件、删检查、改 required:false、改对象或放宽容差都不会移除原条件。CheckSceneConstraints 只是额外观察，不会事后更改构建发布门槛。只有新的用户要求确实改变验收目标时，Root 才可在新的用户触发运行中用 acceptance_update（当前 expected_version 与变更原因）替换条件；不能用它跳过尚未解决的失败。

技术错误返回 failed；正常执行但检查 violated 或 unknown 是有效测量。unknown 先看方法、原因、查询几何和覆盖范围，再修查询几何或补充证据；不能删检查来宣布完成。有理由怀疑验证器出错时保留条件与最小复现，明确报告工具问题。不要增添不属于设计的底板、隐藏支撑或其他几何去迎合采样。修改后重新构建；发布会校验完整条件、当前验收版本和 Scene 基础版本。

QuerySceneGeometry 的 distance 是最近三角面间距。intersection 在实际网格包围范围分离时可以证明不相交；范围重叠时继续做三角面求交和闭合网格包含判断。Group/实例按各闭合 Mesh 的实体并集解释，部件重叠不会抵消占据；同一 Mesh 内用带方向的穿越保留正确朝向的空腔。开放或非流形体可能返回 unknown；复杂壳体可提供明确的 query_geometry，不必简化实际视觉模型。support 结合最低表面带的实际顶点与 5×5 底部列采样，默认要求全部采样点在容差内得到支撑，并拒绝穿入目标表面；它不能证明所有椅脚、重心或物理稳定性。检查 support_fraction、missed_target、gap 和 coverage，不把一个接触点当成整物体可靠落地。section 返回指定平面上的三角截线。RenderSceneViews 的截面为实际网格剪裁；诊断材质不代表 Shader 位移外观，用 beauty 图核对。

每次观察核对 build_id、revision_id、time_s、object_keys。俯视看动线和占地，正面/侧面看高度与支撑，入口相机看人眼尺度，远景看轮廓。所有数值是相对场景单位；用户没有尺度标定时不要改称米。所有视图的可见 key 是视锥候选，不声称逐像素无遮挡。图片编号映射 key，语义树只定位，不承担空间推理。

先读 RunSceneCode 的拼图、检查摘要和编号映射；需要细节时用 InspectSceneBuild 的 object_keys 或 offset/limit（默认 10 条）分页，technical 按需开启。相机名从 available_cameras 选；不存在的入口机位可改用 overview 或显式 camera，无须为观察请求错误重建几何。同批请求 partial 时仍使用成功视图，只补失败项。上下文裁剪回执中的 preview_paths 是确切图片路径；直接 Read 这些路径，不要反复 Glob、重建或寻找新 Scene。visual_evidence_delivered:false 表示图片尚未交付视觉上下文，不能声称已经看过。最后分别记录实际测量、图像判断、已覆盖的对象/范围和仍未知之处。

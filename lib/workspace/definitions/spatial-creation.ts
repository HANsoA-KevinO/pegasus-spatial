import { WorkspaceDefinition } from '../../types'

/**
 * Durable workspace for image, object and world creation.
 *
 * Reserved paths document product semantics only; they do not pre-create
 * files. Build IDs remain runtime values, so placeholder declarations are
 * examples rather than fixed output filenames.
 */
export const spatialCreationWorkspace: WorkspaceDefinition = {
  name: 'spatial-creation',
  description: 'Three.js 源码场景、图像、3D 资产、构建版本与可观察评审工作区',
  policy: {
    allowedRoots: ['output', 'analysis', 'notes', 'references', '.sci-pegasus'],
    internalRoot: '.sci-pegasus',
    allowedRootFiles: ['MAP.md'],
    maxFiles: 500,
    maxDepth: 8,
    maxPathLength: 512,
    maxSegmentLength: 128,
    reservedPaths: [
      {
        path: 'MAP.md',
        description: '用户可见空间创作产物的可选语义索引',
        resolver: { type: 'field', field: 'output.map' },
      },
      {
        path: 'output/spatial/images/<asset-id>.png',
        description: '生成或修订的场景参考图与物体参考图；文件名由资产 ID 决定',
        resolver: { type: 'field', field: 'output.spatial.images' },
      },
      {
        path: 'output/spatial/objects/<build-id>/manifest.json',
        description: 'Lux3D GLB 物体、供应商任务、哈希、输入与血缘 manifest',
        resolver: { type: 'field', field: 'output.spatial.objects' },
      },
      {
        path: 'output/spatial/worlds/<build-id>/manifest.json',
        description: 'Aholo World 资产、世界入口、供应商任务、输入与血缘 manifest',
        resolver: { type: 'field', field: 'output.spatial.worlds' },
      },
      {
        path: 'output/spatial/scenes/<scene-id>/main.ts',
        description: 'Three.js 场景入口；Write/Edit 多文件源码，RunSceneCode 执行候选，PublishSceneBuild 原子发布',
        resolver: { type: 'field', field: 'output.spatial.scenes' },
      },
      {
        path: 'output/spatial/scenes/<scene-id>/assets.json',
        description: '源码工程的授权 GLB、纹理、PLY/SPZ 与数据资产清单',
        resolver: { type: 'field', field: 'output.spatial.scene_assets' },
      },
      {
        path: 'output/spatial/scenes/<scene-id>/checks.json',
        description: '用户明确的必需空间条件与可选诊断；几何检查不能代替视觉判断',
        resolver: { type: 'field', field: 'output.spatial.scene_checks' },
      },
      {
        path: 'output/spatial/builds/<build-id>/views/<view-id>.png',
        description: '绑定不可变构建、相机与时间的工程视图和截图证据',
        resolver: { type: 'field', field: 'output.spatial.build_views' },
      },
      {
        path: 'output/spatial/reviews/<artifact-id>.md',
        description: '基于可观察产物的 verified / inferred / unknown 评审与修订建议',
        resolver: { type: 'field', field: 'output.spatial.reviews' },
      },
      {
        path: '.sci-pegasus/settings/project.md',
        description: '项目内部的空间创作偏好与供应商决策记录',
        resolver: { type: 'field', field: 'settings.spatial_creation' },
      },
    ],
  },
}

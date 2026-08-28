# Pegasus Spatial Scene 真实联调记录（2026-08-27）

## 结论

本轮没有发起新的 Lux3D 付费生成。系统通过 Lux3D 官方任务查询接口恢复一条已经成功、但曾被旧版输出槽位映射误判为失败的任务，并完成了以下真实闭环：

1. 将 standalone GLB、可选高质量 PLY 和 manifest 镜像并发布到 Workspace；
2. 将 GLB 作为可编辑实例加入已有 Aholo World Scene；
3. 通过 `TransformSceneObject` 产生自动 Scene revisions；
4. 通过 `FocusSceneObject` 和 `CaptureSceneView` 获取 Viewer 的真实像素；
5. 将 PNG 发布到 `output/spatial/reviews/<observation-id>/view.png`；
6. 以 `observation_id` 绑定后续绝对变换，再次截图复核。

Aholo 公共 World 创建接口的供应商侧失败仍按独立问题追踪；它没有阻塞 Scene、GLB、revision 或观察反馈主线。

## 已发布资产

- Object import Job：`spjob_ed843649341d1e919ad06e9cb103a16c3b15bb14`
- Workspace 前缀：`output/spatial/objects/task-import-03ebb7b8631445a6/`
- GLB：5,807,560 bytes，SHA-256 `1e76fb2a9f4dfe22ecd705177b851a1c20d99e4f6d333f934438b8c24deb02c0`
- PLY：113,699,681 bytes，SHA-256 `41136a23d75dc29a3043133b446be3de1e0fc1018463bdf22ebacdb2f4c8468d`
- Scene：`scene_8938f58957064ef7eed9e945766b014c`

GLB 元数据由正式发布路径解析，而不是诊断脚本猜测：

- glTF 2.0；
- Y-up；
- 1 mesh / 1 primitive；
- 41,245 vertices / 57,408 triangles；
- 2 张内嵌 PNG texture；
- 无外部资源依赖；
- 原始 bounds 约为 `0.767 × 0.780 × 0.771`。

PLY 只作为用户主动开启的高质量视觉替身；默认舞台不加载 113 MB PLY，不用它参与选择、结构判断或变换真值。

## Revision 与幂等证据

- v1：导入真实 Aholo World；
- v2：加入 Lux GLB 椅子；
- v3–v4：通过绝对坐标调整位置、旋转和缩放；
- v5：根据 v4 观察图下移物体；
- v6：根据 v5 观察图二次校准高度。

同一 Lux 导入命令重放后仍返回相同 Job 和 Scene v2；同一变换 tool call 重放后仍保持原 revision，并返回 `replayed: true`。没有产生重复发布或重复 revision。

## 观察闭环修复

真实联调发现并修复了三个此前静态测试没有覆盖的问题：

1. Aholo SDK 的 `readRenderResultAsync` 要求启用 `viewer.config.isExtraCopyBeforeScreenEnabled`；
2. camera/resize 后必须等待 SDK render boundary，不能立即读取旧 framebuffer；
3. 媒体归属查询必须同时传入 `asset_id + user_id + conversation_id`，此前遗漏 `user_id` 会导致完成接口返回 404。

另外增加了黑帧质量门。多个活动舞台可以竞争领取同一持久 render command；若某个刚挂载或失效的舞台只读到均匀黑色 framebuffer，它不能上传并完成命令，而应让 lease 到期后由健康舞台接管。

有效 Agent 观察图为 1024×720 PNG，并同时返回：

- Scene revision ID；
- Agent viewpoint（position、target、up、fov）；
- observation ID；
- Workspace path；
- 一个可直接进入多模态上下文的 media 引用。

## 明确边界

- Aholo World 3DGS 是整体视觉世界，不提供可局部语义编辑的结构对象；
- Lux GLB 是 Scene 中可选择和变换的物体真值；
- Scene 坐标是相对坐标，不代表真实米制；
- 当前没有地面语义、碰撞、重力或自动落地，Agent 必须通过观察图迭代校准；
- PLY 不参与结构判断；
- 本轮没有使用网页端私有创建接口，也没有创建新的付费 Lux 任务。

## 操作入口

安全导入已经成功的 Lux3D 任务：

```bash
npm run spatial:object:import-task -- \
  --project-id <conversation-id> \
  --task-id <existing-successful-lux-task-id> \
  --scene-id <scene-id> \
  --label <object-label> \
  --position 0,0,0 \
  --rotation-deg 0,0,0 \
  --scale 1,1,1
```

该入口只轮询和镜像已有任务，不调用 Lux 创建端点；它创建独立的确定性 import Job，绝不重开历史 terminal Job。

# 系统架构

Pegasus Spatial 是一个单体 Next.js 应用。对话、Agent 执行、空间任务、Workspace、Scene Revision 与媒体索引统一持久化到 MongoDB；耗时的供应商任务由独立后台 worker 接管，不依赖某个浏览器请求一直保持连接。

```text
Browser
  ├── Chat Workspace
  ├── File / Image / GLB preview
  └── Spatial Stage
          │
Next.js APIs
  ├── Conversation + Agent Loop
  ├── Workspace + Media
  ├── Spatial Scene + Observation
  └── Render command bridge
          │
MongoDB
  ├── conversations / Agent runtime
  ├── workspace revisions
  ├── spatial jobs / receipts
  ├── scenes / scene revisions
  └── media metadata / GridFS
          │
Spatial Worker
  ├── NewAPI image generation
  ├── Lux3D object generation
  ├── Aholo World generation
  └── artifact validation + publication
```

## Agent 执行层

- `lib/agent/`：Root Agent 主循环、模型调用、工具结果准入、消息队列和上下文管理。
- `lib/agent-runtime/`：持久 Run、lease、崩溃恢复、后台执行和失败隔离。
- `lib/agent-team/`：Agent 身份、显式工具授权、成员协作、任务与消息投递。
- `lib/skills/`：按需加载的空间创作和图像生成方法说明。

Root 默认拥有完整空间能力。成员 Agent 只有在 `allowed_tools` 中被明确授权后才能调用生成或 Scene 修改工具；wildcard 不会隐式获得昂贵能力。

## 空间任务层

`SpatialBuildJob` 统一承载图像、物体与 World 任务：

```text
prepared → submitting → submitted → running → materializing → published
                         ├→ failed
                         ├→ unknown
                         └→ cancelled
```

主要设计：

- 幂等键为 `project_id + run_id + tool_use_id`。
- 外部任务 ID 一旦获得，必须先持久化再返回。
- 已知外部任务可在重启后继续轮询、下载和发布。
- 供应商是否已接受无法确认时进入 `unknown`，系统不会自动再次提交。
- 供应商短期地址会立即镜像到本方媒体存储，并验证 MIME、文件 magic、大小和 SHA-256。
- `published` 任务可以重建相同 ToolResult，不重复调用供应商。

## Scene、源码与 Revision

代码场景以多文件 Three.js 源码为真值；源码、授权资产字节、依赖、种子和检查被编译冻结为不可变 SceneCodeBuild。Revision 引用 build，不引用可变源码路径。构建队列与付费生成任务独立，具备幂等、租约、取消、120 秒总时限及持久终态通知。

SpatialScene 保存当前 revision 指针和保留的验收契约。发布校验完整 required 条件、验收版本及基础 Scene 版本，原子 CAS 创建新 revision；删检查或放宽容差不能绕过要求。新用户明确改变目标时才允许替换条件。恢复历史产生新 revision，不覆盖旧记录。新建 Scene 直接准备源码工程，不自动转换旧声明式场景。旧编辑工具退役，历史数据保留；恢复仅支持已发布代码构建。

## 执行、观察与用户舞台

浏览器使用隔离 iframe 中的 Worker + OffscreenCanvas；独立 Chromium 服务使用相同冻结 bundle 执行 Agent 的建模、工程视图、几何查询与导出，用户舞台关闭仍可工作。只允许固定依赖与授权资产；执行代码不获取应用 Cookie、数据库、供应商密钥或任意网络。部署服务为非 root Chromium sandbox，并使用内部网络和资源限制。

源码支持任意 Three.js 几何、CSG、程序纹理、Shader、动画、GLB 与 Spark PLY/SPZ。Z-up、相对单位，动画固定 1/30 秒，颜色管线 ACES/sRGB。GLB 处理坐标基、底部中心与实例复用；资产读取和实际加入场景分别报告。

Agent 通过四视图、轴向、比例、对象编号和稳定 key 定位对象，再查询实际网格距离、射线、截面、支撑采样、相交与指定区域净空。语义登记不是空间证明；包围盒重叠不是实体穿插；采样不是物理稳定性；缺少 GPU 查询几何时返回 unknown。观察绑定 build/revision/time，不把后续变化用于旧请求。详见 [Scene 系统](SCENE_SYSTEM.md)。

用户只浏览、聚焦、选中、查看历史和截图反馈，全部修改由 Agent 写回源码。用户相机独立，反馈携带实际相机、对象 key、revision、build 和时间。新程序初始化成功才替换旧程序，失败保留旧版本并显示实际 revision。旧数据的只读显示代码暂存，不作为新系统的兼容保证或验收要求。

## Workspace 与媒体

用户可见产物使用稳定逻辑路径：

```text
output/spatial/images/
output/spatial/objects/<build-id>/
output/spatial/worlds/<build-id>/
output/spatial/scenes/<scene-id>/
output/spatial/builds/<build-id>/
output/spatial/reviews/<observation-id>/
```

Workspace 以路径级 head 和不可变 revision 作为权威，写入通过 CAS 避免静默覆盖。媒体默认存储在 GridFS，也可以配置 OSS/CDN；浏览器只接收受控的公开 URL。

## 恢复边界

系统允许恢复：

- 已持久化 external ID 的供应商任务；
- 已下载但尚未发布的临时资产；
- 已发布但 ToolResult 尚未返回的任务；
- 中断的 Agent Run 和后台成员任务；
- Scene、Revision、Agent viewpoint 与 Observation。

系统不会自动恢复为新的付费提交：

- 无法证明供应商未接受的 `unknown` 任务；
- 用户已经获得成功候选后的额外候选；
- 输入、供应商或模型快照已经改变的任务。

## 部署边界

- Web 默认监听 `127.0.0.1:3200`。
- Mongo 默认监听 `127.0.0.1:27019`，数据库名为 `pegasus_spatial`。
- Docker 网络、volume、GridFS bucket 与 OSS prefix 都使用 `pegasus-spatial` 命名空间。
- 公网部署必须由外部网关提供 HTTPS、身份认证和请求限制。

## 当前非目标

- CAD 精度与真实米制；
- 碰撞、重力和物理仿真；
- OpenUSD / RenderCloud Scene Compiler；
- 对 Aholo 3DGS 世界进行局部语义编辑；
- 服务端无头 3D Viewer。

# Pegasus Spatial

> 🏆 **VentureD Hackathon 2026 · Deep Space Disrupt Award（空间智能赛道冠军）**
>
> 2026 年 8 月，杭州 · 群核科技支持的 Deep Space 赛道 · 参赛项目名：Spatial Pegasus。

**Pegasus Spatial（飞马空间 Agent）**是一套自然语言驱动的 **AI 世界编译器与空间创作工作台**。多模态 Agent 理解文字、参考图和空间约束，将创意转成概念图、独立 3D 资产和可继续编辑的三维场景。

项目以 Three.js 源码和不可变构建为场景真值，保留资产来源与修改历史。用户浏览、选中物体并提交截图意见；Agent 修改源码，依据工程视图、实际网格测量与明确约束持续迭代。

项目正在转向**记忆空间还原**：用几张老照片、一段口述记忆，让被时代带走的空间成为可以走进去的世界。当前正完善混合建模与 Agent 的观察、修改闭环；照片中不可见的结构和记忆中的不确定细节需要明确区分，不能视为精确测绘。

从同一个对话入口，Agent 根据目标、现有资产和观察结果，组合程序化几何、Lux3D 造物、全景环境、可选 Aholo World、场景编辑与截图工具。

## 核心能力

- 从文字或参考图生成概念美术和资产参考图。
- 直接编写多文件 Three.js：任意几何、CSG、曲面、实例阵列、程序纹理、Shader 和动画，与 GLB 混合渲染。
- 使用 Lux3D 创建复杂形态的 GLB 资产，可独立选择、移动、旋转和缩放。
- 使用 2:1 全景图构建远景环境，与近中景 GLB 资产组成混合空间；可选 Aholo World 探索固定观察点的 3DGS 背景。
- 通过隔离 Worker 和随部署提供的 Chromium 服务执行冻结构建，用户关闭舞台仍可观察、测量和导出。
- 查看带坐标轴、比例和对象编号的工程图，查询实际网格距离、支撑采样、相交与通道净空。
- 通过保留的必需条件和版本 CAS 原子发布；用户只读浏览、选中、截图反馈和历史恢复。
- 保存用户视角与 Agent 视角，从真实渲染画面继续提出修改。
- 查询真实 GLB 或程序化网格表面，为地形上的物体放置提供位置依据。
- 将耗时的外部 3D 任务持久化到后台，完成后自动通知并恢复 Agent 工作。
- 通过幂等 receipt、外部任务接管和 `unknown` 状态避免重复付费提交。

## 本地快速配置部署

### 环境要求

- Node.js 22+
- npm 10+
- Docker Desktop 或 Docker Engine
- Docker Compose v2

### 1. 安装与配置

```bash
git clone https://github.com/HANsoA-KevinO/pegasus-spatial.git
cd pegasus-spatial
npm install
cp .env.example .env.local
```

编辑 `.env.local`，配置模型网关和不同的随机密钥：

```env
LLM_BASE_URL=https://your-newapi.example.com/v1
LLM_API_KEY_ORCHESTRATOR=...
LLM_API_KEY_TOOLS=...

SCENE_CODE_RENDERER_TOKEN=至少24字符的独立随机密钥
AGENT_RUNTIME_INTERNAL_SECRET=另一条至少32字符的独立随机密钥
CRON_SECRET=第三条独立随机密钥
```

使用资产生成时再配置 `AHOLO_API_KEY` / `LUX3D_API_KEY`，并把真实产物域名写入：

```env
AHOLO_ASSET_HOST_ALLOWLIST=...
LUX3D_ASSET_HOST_ALLOWLIST=...
```

默认媒体存储为本地 Mongo GridFS，无需额外对象存储。需要使用 OSS/CDN 时，再配置 `.env.example` 中的 `OSS_*` 与 `NEXT_PUBLIC_MEDIA_CDN_BASE_URL`。

### 2. 一键启动本地环境

```bash
npm run local:up
```

该命令会检查配置，启动本地 Mongo 与 Chromium 渲染服务，并在回环地址启动 Web 应用：

```text
http://localhost:3200
```

常用维护命令：

```bash
npm run local:status   # 检查配置、Mongo 与 Web 状态，不打印密钥
npm run local:down     # 停止 Web、渲染服务和 Mongo，保留本地数据卷
```

应用采用本地单用户模式，不需要注册、登录或手工建表。默认只监听 `127.0.0.1`；如需开放到局域网或公网，应在反向代理或网关层增加 HTTPS 与身份认证。

### 3. 分步开发启动

需要直接查看 Next.js 日志或调试代码时，在没有后台 Web 占用端口时启动：

```bash
npm run dev
```

`predev` 会自动启动 Mongo 和渲染服务。本机已有 Chromium 时，可通过 `.env.local` 中的 `SCENE_CODE_CHROMIUM_EXECUTABLE_PATH` 指定其绝对路径，直接使用本机启用 sandbox 的渲染服务。

### 4. 容器化部署

```bash
cp .env.example .env.production
# 填写生产配置与密钥
docker compose --env-file .env.production up --build -d
```

生产环境必须使用 HTTPS 的模型网关和媒体地址，并在外层网关提供访问控制。完整说明见 [本地与容器部署](docs/DEPLOYMENT.md)。

## 关键配置

| 配置 | 用途 | 默认值 |
|---|---|---|
| `MONGODB_URI` | 对话、任务、Scene Revision 与 Workspace 持久化 | `mongodb://127.0.0.1:27019/pegasus_spatial` |
| `LLM_BASE_URL` | NewAPI 模型网关 | 无 |
| `LLM_API_KEY_ORCHESTRATOR` | Root Agent 模型调用 | 无 |
| `LLM_API_KEY_TOOLS` | 工具模型与图像生成 | 无 |
| `PEGASUS_SPATIAL_IMAGE_MODEL` | 图像模型精确别名 | `GPT-image-2` |
| `AHOLO_API_KEY` | Aholo World | 无 |
| `LUX3D_API_KEY` | Lux3D 资产生成 | 无 |
| `SPATIAL_WORKER_CONCURRENCY` | 后台空间任务处理并发 | `8` |
| `SCENE_CODE_RENDERER_TOKEN` | 应用与隔离渲染服务之间的独立凭据 | 无 |
| `SCENE_CODE_RENDERER_URL` | Chromium 服务地址 | `http://127.0.0.1:3201` |
| `MEDIA_STORAGE_DRIVER` | `gridfs` 或 `oss` | `gridfs` |

`LLM_BASE_URL` 不得包含内嵌账号、密码、query 或 fragment。非生产环境只有回环地址允许明文 HTTP；公网与生产部署必须使用 HTTPS。

## Agent 工具

空间创作的主要工具包括：

- `GenerateImage`
- `CreateObject3D`
- `CreateWorld3D`
- `GetSpatialJob` / `WaitSpatialJob`
- `InspectSpatialArtifact`
- `CreateSpatialScene` / `InspectSpatialScene`
- `PrepareSceneCode` / `RunSceneCode` / `InspectSceneBuild`
- `RenderSceneViews` / `QuerySceneGeometry` / `CheckSceneConstraints`
- `PublishSceneBuild` / `ExportSceneBuild`
- `RestoreSpatialScene`
- `SetSceneViewpoint` / `FocusSceneObject` / `CaptureSceneView`
- `QuerySceneSurface`

新系统统一使用 Three.js 源码；创建 Scene 即准备代码工程。旧声明式编辑工具已退役，不自动转换旧场景；已有资产可主动导入新工程。详见 [源码协议、工具与验证边界](docs/SCENE_SYSTEM.md)。

外部 3D 生成任务采用持久队列：工具将任务写入本地队列后返回任务 ID 与当前状态，后台 worker 负责向供应商提交、持久化外部任务 ID、轮询、下载、校验、发布和完成通知。`prepared` 表示已入队，尚不代表供应商接受。Agent 可以在等待 3D 资产时继续生成下一组参考图或处理其他场景工作。

## 资产与版本

```text
output/spatial/images/
output/spatial/objects/<build-id>/
output/spatial/worlds/<build-id>/
output/spatial/scenes/<scene-id>/
output/spatial/builds/<build-id>/
output/spatial/reviews/<observation-id>/
```

每次成功的 Scene 修改都会自动创建新 Revision。Agent 只操作当前 Scene，不需要手工管理 revision ID；并发修改通过 CAS 防止静默覆盖。资产关系可记录 `derived_from`、`revision_of`、`conditioned_by` 和 `compared_with`。

## 验证

提交代码或制作发布包前运行：

```bash
npm run project-prompt:verify
npm run spatial:verify
npm run spatial:verify:mongo
npm run spatial:verify:local-e2e
npm run tool-contracts:verify
npm run multi-agent:verify
npx tsc --noEmit
npm run lint
npm run build
npm audit --audit-level=high
```

真实 WebGL 回归可运行 `npm run spatial:verify:three-browser`（需 Python Playwright、Chromium 与 Pillow）。它在独立临时页面中验证 GLB、PLY/SPZ 像素、全景、求交、相机截图和版本隔离，不启动数据库或 Agent。

上述验证不会发起真实付费生成。供应商真实调用应通过单独的 smoke 命令完成：

```bash
npm run spatial:preflight:local
npm run spatial:smoke:image -- --help
npm run spatial:smoke:lux -- --help
npm run spatial:smoke:aholo -- --help
```

## 架构文档

- [系统架构](docs/ARCHITECTURE.md)
- [本地与容器部署](docs/DEPLOYMENT.md)
- [多 Agent 执行契约](docs/AGENT_TEAM_V1.md)
- [空间 Scene 系统](docs/SCENE_SYSTEM.md)
- [代码来源与上游基线](UPSTREAM.md)

## 能力边界

当前版本不宣称 CAD 精度、真实米制、碰撞正确性、物理仿真或 OpenUSD 场景编译。全景图承担无限远视觉环境；Aholo World 用于可选的固定观察点体积背景探索，不承诺局部语义编辑或可自由漫游的场景几何。可编辑空间结构以程序化网格、独立 GLB 实例和 Scene Revision 为准。

## 许可

本仓库目前未声明开源许可证。未经项目所有者明确许可，不得以 MIT、Apache-2.0 或其他开源许可证重新分发。

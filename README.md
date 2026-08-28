# Pegasus Spatial

**Pegasus Spatial（飞马空间 Agent）**是一个用自然语言驱动图像生成、3D 造物、世界生成与现实重建能力的空间创作 Agent。

用户从一个对话入口描述目标。Agent 根据对象是独立物体、完整世界还是现实场地，自主选择可用工具、追踪外部任务、保留修订血缘并交付可检查资产。产品不设“物体 / 世界”预选模式，也不规定外部能力必须按某个次序执行。

## 评委本地演示

这是用于检查已预生成、已持久化成果的**评委安全审阅模式**。比赛电脑需要一次性满足以下前置：

- 已安装并启动 Docker Desktop 或 Docker Engine，当前用户可访问 daemon。
- 已安装 Docker Compose v2，并能拉取或已缓存官方 `mongo:7` 镜像。
- 已运行 `npm install`，并完成 `.env.local`（其中 `SPATIAL_PAID_CALLS_ENABLED=0`）。

前置完成后，现场启动只有一个命令：

```bash
npm run demo:up
```

脚本会检查 Docker/Compose 和安全配置，自动启动并等待隔离的本地持久存储，然后在回环地址启动 Web 应用。评委直接打开
`http://localhost:3200` 即可进入工作台；没有登录、注册、邀请码或密码，也不需要安装数据库客户端。
演示数据保存在本机专用 Docker volume 中，刷新、Web 进程重启和安全停止都不会丢失。

```bash
npm run demo:status   # 只报告配置、Web 和本地存储是否就绪，不打印密钥
npm run demo:down     # 安全停止，不删除容器或数据卷
```

开发机已经通过 Homebrew 等方式运行 MongoDB 时，也可以把
`MONGODB_URI` 指向 `mongodb://127.0.0.1:27017/pegasus_spatial`。启动器只在
Docker 隔离端口 `27019` 和本机标准端口 `27017` 之间选择，仍会拒绝远程主机与其他数据库。
需要和已有的 `3200` 服务并行预览分支时，可使用独立端口；PID 与日志也会按端口隔离：

```bash
PEGASUS_DEMO_PORT=3201 npm run demo:up
PEGASUS_DEMO_PORT=3201 npm run demo:status
PEGASUS_DEMO_PORT=3201 npm run demo:down
```

`demo:up` 强制要求 `SPATIAL_PAID_CALLS_ENABLED=0`，因此禁止**新的空间付费提交**；配置缺失、连接远程数据库或 3200 端口已有任何服务时都会拒绝启动或接管。已经持久化了外部任务 ID 的旧任务仍可恢复查询与发布；普通聊天仍可能使用已配置的 NewAPI，所以零外部调用审阅时不应发送新聊天请求。

无账号模式只适用于现场单机 Demo：服务默认只监听 `127.0.0.1`，浏览器请求统一映射到一个固定的本地内部身份。如需对局域网或公网开放，必须在前置网关重新加入访问控制。

`demo:up` 不代表现场自然语言真实生成已经放行。真实生成必须在 H0 完成域名白名单、供应商 operator smoke 和预算确认后，由团队按现场手册受控启动；它不是评委一键安全审阅命令的能力。

## 第一阶段能力

- `GenerateImage`：通过 NewAPI Chat Completions 完成文生图与单图修订，固定使用精确模型别名 `GPT-image-2`。
- `CreateObject3D`：从文字或 Workspace 参考图创建 Lux3D GLB 物体。
- `CreateWorld3D`：从文字或单张场景图提交 Aholo World。
- `GetSpatialJob` / `WaitSpatialJob`：跟踪已知外部任务，不重复付费提交。
- `InspectSpatialArtifact`：检查已发布资产、manifest 和血缘。
- 图片查看、GLB orbit 预览、World manifest 与 Aholo 打开入口。

默认 Project Guide 为 `spatial-creation@1`，默认 Skill 目录只暴露 `spatial-creation`。Sci-Pegasus 的 `materials-discovery@1`、文献工具与研究 Skills 仍保留在代码中，但不进入新空间项目的默认工具面。

## 持久任务契约

```text
prepared → submitting → submitted → running → materializing → published
                         ├→ failed
                         ├→ unknown
                         └→ cancelled
```

- 幂等键由 `project_id + run_id + tool_use_id` 构成。
- 获得供应商任务 ID 后先持久化，再继续等待与物化。
- 服务重启只接管已知外部任务；无法确认是否已提交的任务进入 `unknown`，不自动重试。
- 生成工具默认由 Root Agent 使用；Root 可以通过持久 `allowed_tools` 明确授权 Member，wildcard 不会自动开放昂贵工具。真实提交必须显式设置 `SPATIAL_PAID_CALLS_ENABLED=1`。
- 产品不设置项目级图片或 3D 任务数量上限。3D 请求全部进入持久队列；`SPATIAL_WORKER_CONCURRENCY` 只限制本机瞬时提交、轮询与物化吞吐，不是 Agent 或项目额度。

## Workspace

```text
output/spatial/images/
output/spatial/objects/<build-id>/
output/spatial/worlds/<build-id>/
output/spatial/reviews/
```

资产可记录 `derived_from`、`revision_of`、`conditioned_by` 和 `compared_with`。Critic 判断只使用 `verified / inferred / unknown`，不把图像或生成模型宣称为已验证的 CAD 精度、真实尺度、碰撞或物理仿真。

## 隔离参数

| 项目 | Pegasus Spatial |
|---|---|
| npm / Compose / image | `pegasus-spatial` |
| Web | `http://localhost:3200` |
| Mongo host | `127.0.0.1:27019` |
| Mongo database | `pegasus_spatial` |
| GridFS bucket | `pegasus_spatial_media` |
| OSS prefix | `NEXT_PUBLIC_PEGASUS_SPATIAL_MEDIA_PREFIX=raster-assets/pegasus-spatial` |
| 浏览器访问 | 无账号、无 Cookie，固定本地 Demo 身份 |
| Docker network / volumes | `pegasus-spatial-*` |

底层 Workspace 内部路径暂保留 `.sci-pegasus/` 以兼容已验证的 CAS、版本库与多 Agent ACL；它是数据库内的虚拟路径，不会使新应用连接 Sci-Pegasus 的 Mongo、媒体或 Docker volume。

## 开发者配置

```bash
cp .env.example .env.local
# 填写 LLM 与供应商凭证；不需要账号或会话密钥

npm install
docker compose up -d mongo
npm run dev
```

打开 `http://localhost:3200`。默认 `SPATIAL_PAID_CALLS_ENABLED=0`；只有在完成真实 API smoke test 后才将其改为 `1`。

日常比赛演示请使用上方 `npm run demo:up`，以下分步命令仅用于开发和故障排查。

图像能力复用 Agent 的 NewAPI 配置：`LLM_BASE_URL` 与 `LLM_API_KEY_TOOLS`。第一阶段不使用
`OPENAI_API_KEY`，也不提供图像供应商选择器或运行期自动 fallback；文生图和单图修订都通过
`/chat/completions` 的旧 Pegasus 兼容协议调用 `GPT-image-2`。

`LLM_BASE_URL` 不得内嵌用户名、密码、query 或 fragment。正式付费和生产环境必须使用 HTTPS；
只有非生产环境的 `localhost`、`127.0.0.0/8` 或 `::1` 回环地址允许明文 HTTP。readiness 会把任何
HTTP 地址标为“不具备正式付费就绪条件”，即使它可以用于本机开发。
如果旧 NewAPI 暂时只有公网 HTTP，可在非生产本机联调时显式设置
`PEGASUS_SPATIAL_ALLOW_INSECURE_NEWAPI_HTTP=1`；这是有泄露 Tool Key、提示词和源图风险的临时逃生口，
生产环境仍会拒绝启动，readiness 也不会把它判为正式付费就绪。

OSS 的对象前缀使用非敏感的单一变量 `NEXT_PUBLIC_PEGASUS_SPATIAL_MEDIA_PREFIX`。服务端写入、
服务端公开 URL 和浏览器 CDN URL 都读取它；值不得带首尾 `/` 或路径穿越片段。旧变量
`PEGASUS_SPATIAL_MEDIA_PREFIX` 已弃用；迁移期间若仍存在，其值必须与新变量完全一致，否则启动拒绝继续。

先运行只读门禁（不会访问供应商，也不会产生费用）：

```bash
npm run spatial:preflight:local
```

门禁要求用首次真实响应冻结 Aholo/Lux3D 产物下载域名白名单。脚本只报告密钥是否存在，不输出密钥值，也不会把“配置存在”冒充真实生成已验证。

```bash
cp .env.example .env.production
# 填写所有必需凭证
docker compose up --build
```

## 验证

```bash
npm run project-prompt:verify
npm run spatial:verify
npm run spatial:verify:mongo
npm run spatial:verify:demo-e2e
npm run tool-contracts:verify
npm run multi-agent:verify
npx tsc --noEmit
npm run lint
npm run build
```

真实 Aholo、Lux3D 和 NewAPI GPT Image 提交必须单独运行 smoke test，不应由单元测试或普通 build 触发。
`spatial:verify:demo-e2e` 使用随机命名、仅限回环地址的临时 Mongo 数据库和终态 fixture，覆盖无登录直达、内部归属隔离、空间 Job 卡片/API、页面刷新与 Web 进程重启恢复；它不会提交聊天、模型或任何供应商任务，并在验证后只清理本轮临时测试数据库。
完整的 H0 凭证门禁、崩溃演练、真实预生成资产要求和现场降级方案见
[48 小时验收与现场手册](docs/PEGASUS_SPATIAL_48H_RUNBOOK.md)。

空间工具适配器以供应商正式契约为准：[Aholo / Lux3D API Reference](https://labs.aholo3d.cn/api-docs/api-reference)、[Aholo 3DGS Skill](https://labs.aholo3d.cn/api-docs/skills/aholo-3dgs-reconstruction) 与 [Lux3D Skill](https://labs.aholo3d.cn/api-docs/skills/lux3d)。图像生成则固定使用已经在旧 Pegasus 验证的 NewAPI Chat Completions 契约；运行时不会切换到 OpenAI Images API 或其他图像供应商。

## 能力边界

第一阶段不实现 OpenUSD / RenderCloud Scene Compiler、物体级 Aholo World 写回、CAD 精度、真实尺度、碰撞、路径规划或物理仿真。混合 3DGS + GLB Viewer 是核心交付完成后的可选实验，不得阻塞主演示。

## 来源与许可

本项目从 Sci-Pegasus 的独立源码快照建立。基线、未继承 Git 历史的原因和重分发注意事项见 [UPSTREAM.md](UPSTREAM.md)。未确认原始权利与许可之前，不要宣称本仓库采用 MIT 或其他许可证。

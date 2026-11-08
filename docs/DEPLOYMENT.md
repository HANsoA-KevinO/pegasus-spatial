# 本地与容器部署

## 1. 本地单用户部署

### 前置环境

- Node.js 22+
- npm 10+
- Docker Engine 或 Docker Desktop
- Docker Compose v2.24+

安装依赖并创建本地配置：

```bash
npm install
cp .env.example .env.local
```

填写模型网关、Root 模型 Key 和工具模型 Key。需要生成资产时再配置 Aholo / Lux3D；代码建模和导入现有 GLB 不需要发起付费生成。`CRON_SECRET` 与 `AGENT_RUNTIME_INTERNAL_SECRET` 使用不同的随机字符串，代码建模另需独立的 `SCENE_CODE_RENDERER_TOKEN`（至少 24 字符），应用与渲染服务使用同一值。

运行：

```bash
npm run local:up
```

这个命令会：

1. 检查 Docker 与 Compose；
2. 拒绝远程或名称不匹配的 Mongo URI；
3. 启动并等待 Mongo 与 Chromium 渲染服务健康检查；
4. 在 `127.0.0.1:3200` 启动 Next.js；
5. 保存受管进程 PID 与本地日志路径。

```bash
npm run local:status
npm run local:down
```

`local:down` 只停止服务，不删除容器和数据卷。

## 2. 开发模式

```bash
npm run dev
```

`predev` 自动检查 `.env.local`，启动本项目的 Mongo 和渲染服务，然后在前台运行正常的 Next.js dev。已有服务会复用，运行地址为 http://localhost:3200。不要与 `npm run local:up` 同时启动 Web；后者运行同一套开发服务，但将 Web 放在后台，适合直接打开网页测试。

渲染服务默认使用 Docker 中的 Chromium。若已有本机 Chromium，可在 `.env.local` 设置 `SCENE_CODE_CHROMIUM_EXECUTABLE_PATH` 为可执行文件的绝对路径；启动器改用本机非 root、启用 sandbox 的 Chromium，监听 `127.0.0.1:3201`，日志位于系统临时目录的 `pegasus-spatial-renderer.log`。它不复用用户浏览器资料。`npm run local:down` 会停止受管 Web、渲染服务和 Mongo，保留数据卷。

现有网关若只提供公网 HTTP，可在**开发模式**显式设置 `PEGASUS_SPATIAL_ALLOW_INSECURE_NEWAPI_HTTP=1` 使用原有配置；该例外不用于生产模式。真实项目测试应新建项目；旧声明式场景不提供兼容保证。

本地验收可按需执行：

```bash
RUN_SCENE_CODE_LOCAL_ACCEPTANCE=1 npm run scene-code:verify:local
```

它在现有数据库中新建明确命名的合成项目，验证多文件代码、纹理 GLB 导入、构建和原子发布、错误定位、取消以及 Web 服务重启后恢复队列。纹理 GLB 使用仓库中的合成测试资产。不会删除已有项目，不调用模型或资产生成接口。执行期间会重启本地受管 Web，不应与正在进行的创作同时运行。

2026-11-06 本机复核使用 Next.js dev、本机 sandboxed Chromium 和 Docker Mongo。上述持久构建验收通过；另外从真实网页完成了对象选中、只读详情、截图上传、对象 key / build / revision 对应检查，并由网关 `Claude-opus` 实际接收图片和回复。未新增图片或 3D 资产生成任务。项目初始化事件引起的无任务模型唤醒已修复；创建成员、成员进度和错误等实际协作事件仍保留通知。模型与普通页面连通通过，不代表真实地点的还原质量已经验收。

同日真实图像输入测试暴露了一次上游流中断：第三次模型请求持续约 515 秒，网关记录 `stream_status.end_reason=scanner_error`、`connection reset by peer`，随后应用发现缺少完整消息结尾。这是网关到上游的连接错误；本地没有按总思考时长切断请求。

流中断诊断会记录请求标识、事件计数、最后事件、未关闭内容块和已报告用量，不记录半截源码或思考正文。未完成的工具调用不执行；处于模型请求阶段的 EOF / 读取中断会将 Run 保留为 `recoverable`，由用户继续或恢复，保留之前完整的工具检查点。恢复需要重新请求中断的这一轮，不能继续传输原连接上的半截思考或工具 JSON。该处理改善应用恢复，不代表上游连接故障已经消除。

### Flash 实际链路验收

```bash
# 需要运行在 27021 的独立测试 Mongo 和已就绪的本地渲染服务。
RUN_FLASH_RUNTIME_ACCEPTANCE=1 npm run scene-code:verify:flash
```

该命令会实际调用网关 `deepseek-flash`，不调用图片或 3D 资产生成。它使用 `pegasus_flash_runtime_test` 数据库、3202 测试应用、3203 故障注入代理和独立 Next 缓存；主应用 3200 及其项目配置保持独立。测试包括源码工具流 EOF、连接重置、同一 Run 从完整检查点恢复、场景发布及编译错误修复。结果和调用统计保存至 `/private/tmp/pegasus-flash-runtime/`。这套固定验收首先测试运行与几何闭环，不将其当作照片还原的美术质量评分。

单独验证图像输入时，运行 `RUN_FLASH_IMAGE_ACCEPTANCE=1 FLASH_ACCEPTANCE_IMAGE=/path/to/courtyard.png node --env-file=.env.local node_modules/jiti/lib/jiti-cli.mjs scripts/verify-flash-image.ts`。请使用包含瓦屋顶、右侧拱门和左侧长凳的合成院落图。

DeepSeek 的 Anthropic 接口在工具调用后要求传回完整思考内容，不以 Claude 签名是否存在为条件。对网关返回的无思考工具轮次，适配层使用空 `thinking` 协议字段表示未收到思考，保留已有内容，不编造正文或签名；原生 Claude 仍遵循签名规则。参见 [DeepSeek 接口兼容说明](https://api-docs.deepseek.com/guides/anthropic_api/)。

2026-11-06 最终 Flash 实测通过：记录 69 次模型请求（67 次成功、2 次预先安排的断流）、63 次工具调用。首次场景构建与 EOF 恢复约 6 分 22 秒，选中修改与连接重置恢复约 3 分 48 秒，编译错误修复约 48 秒，最终发布至 v4；独立测量检查通过，完整工程包已导出，没有创建付费图片或 3D 资产任务。另一个不含项目上下文的新请求使用合成院落参考图，约 4.4 秒完成瓦屋顶、右侧拱门和左侧长凳的识别。详细记录见 [验收结果](../evals/spatial-creation/results/flash-runtime-2026-11-06.json)。这次也纠正了验收脚本用 Group 的 `position` 代替实际空间位置的问题：判断修改应比较执行后几何范围和测量，而非只比较根节点变换。

## 3. 完整容器部署

```bash
npm run deploy:prepare
npm run deploy:up
npm run deploy:status
```

`deploy:prepare` 在 `.env.production` 不存在时从 `.env.local` 复制配置，补齐缺少的随机密钥，以 `0600` 权限保存，再执行生产检查。已有值不覆盖。生产模型网关需要 HTTPS；仅能提供 HTTP 的网关应继续使用本地开发模式。`deploy:down` 停止容器并保留卷，`deploy:logs` 查看应用与渲染日志。

镜像编译时仅传入两项公开的 `NEXT_PUBLIC_*` 媒体配置，确保浏览器 CDN 地址与运行时一致；供应商密钥和数据库凭证只在启动时注入。生产使用 Webpack 构建 standalone 镜像。

Compose 会启动：

- `app`：Next.js standalone image，容器端口 3200；
- `mongo`：MongoDB 7，宿主机仅暴露 `127.0.0.1:27019`；
- `scene-renderer`：独立 Chromium 服务，非 root 用户、Chromium sandbox、只读根文件系统、临时目录与内存限制；生产不发布端口，位于内部网络；
- 独立 network 与持久 volume。

`docker-compose.local.yml` 仅在开发时把渲染端口映射到 `127.0.0.1:3201`。源码不接收应用 Cookie、数据库或供应商密钥；编译产物与授权资产字节通过独立令牌传递。手动启动原生服务可用 `npm run scene-code:renderer`，需要安装匹配的 Chromium，并按需设置 `SCENE_CODE_CHROMIUM_EXECUTABLE_PATH`。不要关闭 Chromium sandbox。

停止但保留数据：

```bash
docker compose down
```

删除 volume 会永久移除本地对话、Workspace、任务和 Scene 数据，不应作为普通重启步骤。

## 4. 配置分组

### 模型网关

```env
LLM_BASE_URL=https://newapi.example.com/v1
LLM_API_KEY_ORCHESTRATOR=...
LLM_API_KEY_TOOLS=...
PEGASUS_SPATIAL_IMAGE_MODEL=gpt-image-2
PEGASUS_SPATIAL_IMAGE_EDIT_MODEL=
PEGASUS_SPATIAL_IMAGE_FALLBACK_MODEL=
```

生图别名区分大小写。可指定独立的 Images 编辑模型，以及支持 Chat Completions 生图的备用别名（例如网关已启用的 nanobanana2）。只有网关明确在提交前拒绝主模型或主模型连接未建立时，才尝试备用模型一次。

生产环境必须使用 HTTPS。明文 HTTP 只允许非生产回环地址；临时兼容开关不能让公网 HTTP 通过生产 readiness。

### 空间供应商

```env
AHOLO_API_BASE_URL=https://api.aholo3d.cn
AHOLO_API_KEY=...
AHOLO_ASSET_HOST_ALLOWLIST=...

LUX3D_API_BASE_URL=https://api.aholo3d.cn
LUX3D_API_KEY=...
LUX3D_ASSET_HOST_ALLOWLIST=...
```

allowlist 只能填写真实成功响应中出现的精确 hostname，不使用通配符。

### 代码构建与观察

```env
SCENE_CODE_RENDERER_URL=http://127.0.0.1:3201
SCENE_CODE_RENDERER_TOKEN=...
SCENE_CODE_WORKER_ENABLED=1
LLM_IMAGE_TRANSPORT=inline
```

容器应用的 renderer URL 由 Compose 设置为内部服务。默认一个构建槽、120 秒总时限，构建任务与付费生成任务分别持久化。`inline` 在提供给模型时读取当前所有者的图片字节，适合本地 GridFS；字节不写入对话或工具结果记录。

### 后台任务

```env
SPATIAL_WORKER_ENABLED=1
SPATIAL_WORKER_CONCURRENCY=8
SPATIAL_WORKER_POLL_MS=2000
SPATIAL_WORKER_LEASE_MS=90000
```

并发值限制本机提交、轮询和物化吞吐，不代表供应商配额。设置过高可能触发供应商限流。

### 媒体存储

本地默认：

```env
MEDIA_STORAGE_DRIVER=gridfs
MEDIA_PUBLIC_BASE_URL=http://localhost:3200
NEXT_PUBLIC_PEGASUS_SPATIAL_MEDIA_PREFIX=raster-assets/pegasus-spatial
```

本地上传和预览使用 GridFS。浏览器通过同源 `/api/media/` 读取图片。模型请求在传输时临时读取资产字节，聊天历史和上下文预算使用资产引用。Lux3D 与 Aholo 的图像参考由 Worker 在创建 3D 任务前通过供应商 Asset/OUS 接口上传，任务队列保留所选资产 ID。

OSS 模式还需要配置：

```env
MEDIA_STORAGE_DRIVER=oss
OSS_REGION=...
OSS_BUCKET=...
OSS_ACCESS_KEY_ID=...
OSS_ACCESS_KEY_SECRET=...
OSS_ENDPOINT=...
OSS_CDN_BASE_URL=https://media.example.com
NEXT_PUBLIC_MEDIA_CDN_BASE_URL=https://media.example.com
```

## 5. 首次供应商校验

只读预检：

```bash
npm run spatial:preflight:local
```

真实 smoke 必须显式执行，不会被普通 build 或单元测试自动触发：

```bash
npm run spatial:smoke:image -- --help
npm run spatial:smoke:lux -- --help
npm run spatial:smoke:aholo -- --help
```

确认真实成功后，记录供应商任务 ID、产物 hostname、MIME、magic、字节数与 SHA-256，再更新 allowlist。

## 6. 发布前验证

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

## 7. 公网部署要求

应用内置的是本地单用户身份，不是公网账号系统。对局域网或公网开放前必须增加：

- HTTPS；
- 用户身份认证；
- 访问频率与请求体限制；
- 独立密钥管理；
- Mongo 备份与恢复；
- OSS/CDN 的最小权限与跨域策略；
- 供应商费用监控。

## 8. Agent 轮次

主 Agent 和成员每次执行默认最多 200 次主模型响应，一次响应可调用多个工具。`AGENT_MAX_TURNS` 设置通用值，`AGENT_ROOT_MAX_TURNS` / `AGENT_MEMBER_MAX_TURNS` 按角色覆盖；显式设为 0 可取消轮次上限，取消、费用预算等其他边界仍独立生效。验收脚本使用 `SCENE_CODE_ACCEPTANCE_MAX_TURNS`，默认 200。本次历史 Opus 验收使用的是调整前每任务 24 轮，原记录不变。

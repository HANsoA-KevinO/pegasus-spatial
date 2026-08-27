# Pegasus Spatial · 48 小时验收与现场手册

本文只描述真实门禁和操作顺序，不把配置存在、Mock 测试或预制截图冒充供应商真实生成。

## 0. 现场部署与规则基线

- 继续使用本地 Mongo，不改为纯文件持久化。评委演示不需要任何数据库操作；从零运行时只增加 Docker 这一个前置，本地开发使用 `docker compose up -d mongo` 和 `npm run dev`，不需要云 Mongo 账号、连接串或手工建表。
- 当前比赛要求以用户已提供的 VentureD 通知和海报为基线。腾讯文档《Venture D 软件支持清单及领取方式》是 AI Ping、Zion、Qoder 等福利的领取说明，可见内容未出现 Aholo、Lux3D、群核或额外比赛规则。
- 本项目从主办方/赛题平台提供的资源中仅领取和使用 Aholo；LLM 与生图使用自有 NewAPI。Zion 兑换码 `VentureD2026` 不影响本项目，不需要领取或接入赞助模型。
- 现有资料未明确授权赛前真实生成；在没有新证据时，赛前仅做零费用验证，真实付费 smoke 从正式 H0 后开始。
- 密钥轮换经用户决定本轮暂缓，不阻塞本地开发；但严禁在文档、日志、截图或 Git 中记录密钥。

## 1. H0–H4 真实能力冻结

1. 从 `.env.example` 创建 `.env.local`。图像生成复用受控的既有 NewAPI 配置：填写 `LLM_BASE_URL` 与
   `LLM_API_KEY_TOOLS`，不要增加 `OPENAI_API_KEY`；不得把任何真实密钥写入仓库、报告或日志。
   `LLM_BASE_URL` 不得包含用户名、密码、query 或 fragment。正式付费配置必须使用 HTTPS；回环
   HTTP 只用于非生产本机开发，不能通过正式付费 readiness。
   若旧 NewAPI 尚无 HTTPS，只能在隔离的非生产联调环境显式设置
   `PEGASUS_SPATIAL_ALLOW_INSECURE_NEWAPI_HTTP=1`；该配置会暴露传输风险，生产启动与正式 readiness
   仍会拒绝它，现场演示前必须撤销或补上 HTTPS。
2. 保持 `SPATIAL_PAID_CALLS_ENABLED=0`，运行：

   ```bash
   npm run spatial:preflight:local
   ```

   若启用 OSS，确认非敏感的 `NEXT_PUBLIC_PEGASUS_SPATIAL_MEDIA_PREFIX` 在构建和运行环境中取同一值；
   readiness 会拒绝非法前缀或与旧 `PEGASUS_SPATIAL_MEDIA_PREFIX` 冲突的配置。

3. Operator smoke 实现且 `--dry-run` 通过后，在正式 H0 后先填写 `docs/LIVE_SMOKE_LOG.md` 的预算、余额下限和单次人工授权，再分别做一次 NewAPI `GPT-image-2` 文生图、单图修订、Aholo World 和 Lux3D G1 最小真实请求。逐项记录请求时间、任务 ID、最终状态、脱敏响应字段、产物 MIME、文件 magic、字节数和 SHA-256；未经该流程不得提交。
4. 从真实成功响应中提取 Aholo/Lux3D 产物 hostname，写入精确的 `*_ASSET_HOST_ALLOWLIST`。禁止使用通配符、任意 URL 或重定向扩展白名单。
5. 图像路由必须保持唯一：`LLM_BASE_URL` 上的 `/chat/completions`、`LLM_API_KEY_TOOLS` 和区分大小写的精确别名 `GPT-image-2`。不测试或配置 `/images/generations`、`/images/edits`、provider selector 或自动 fallback；任一真实图像用例失败时先修复这条固定路由。
6. 再次运行 readiness。只有全部门禁通过，才可显式设置 `SPATIAL_PAID_CALLS_ENABLED=1`。

Operator smoke 的普通聊天全局开关始终保持 `0`。每次先运行 `--prepare --project-id <conversation-id> --phase H0 --purpose <fixed>`，记录返回的 `smoke_id`；只有逐字提供 `--confirm AUTHORIZE_ONE_PAID_SUBMISSION` 的 `--submit` 可以发起一次供应商请求。`--status` 与 `--resume` 永不从 prepared 状态提交。未核销的 `unknown` 会按项目和供应商跨 phase 阻止新提交；只有核对供应商账单后，才能用带操作员、理由和精确确认文本的 `--reconcile-unknown` 写入不可覆盖的核销记录，原任务仍保持 `unknown`。完整命令见 `docs/PRE_START_CHECKLIST.md`。

## 2. 发布前自动验收

```bash
npm run project-prompt:verify
npm run spatial:verify
npm run spatial:verify:mongo
npm run tool-contracts:verify
npm run multi-agent:verify
npx tsc --noEmit
npm run lint
npm run build
```

其中 `spatial:behavior-contracts` 只校验五类 tool-trace 验收定义没有漂移，绝不冒充真实模型行为结果。H0 仍需逐例重放
`evals/spatial-creation/behavior-cases.json`，保存实际工具调用、询问与付费次数。

本地服务启动后，再运行无账号直达、不会提交付费任务的浏览器 smoke：

```bash
python3 scripts/verify-spatial-ui-smoke.py --base-url http://localhost:3200
```

Mongo 故障测试只能指向名称以 `_test` 结尾的隔离数据库。不得对演示或生产数据库运行 drop-database fixture。

## 3. 必做故障演练

- 提交请求前崩溃：可以证明供应商未接受时，允许同一 durable intent 恢复或一次自动重试。
- 请求可能已送达、但没有外部任务 ID：状态必须为 `unknown`；不得自动重提。
- 已有外部任务 ID 后重启：只接管原任务的轮询、镜像和发布。
- 供应商完成、短期 URL 下载后崩溃：从本方 durable staging 恢复，不再次依赖已过期 URL。
- Workspace 整组发布中第 N 个文件失败：公共文件数必须保持为 0；重试后整组一次可见。
- Workspace 已提交、ToolResult 尚未返回时崩溃：恢复同一 `published` 结果，不新建供应商任务。
- 三个并发昂贵请求：同一项目只允许两个共享槽；图像与 3D 任务必须竞争同一组槽。
- Member 使用 wildcard grant：仍看不到且无法直接执行 `GenerateImage`、`CreateObject3D`、`CreateWorld3D`。

## 4. 预生成真实演示资产

在真实门禁通过后，通过产品聊天入口生成并保存：

- 2 个 Aholo World Build；
- 2 个 Lux3D GLB Object Build；
- 至少 1 个由 Workspace 参考图约束的 Build；
- 至少 1 组带 `revision_of` 或 `conditioned_by` 的修订关系。

每个 Build 都保留 `job_id`、供应商任务 ID、manifest、Workspace 路径、SHA-256、缩略图/截图和耗时。演示资产必须来自真实供应商响应；失败产物与本地占位不得标成成功 Build。

## 5. 现场演示顺序

1. 在单一聊天入口提出完整 World 请求，让 Root 自主判断是否需要参考图。
2. 展示新任务的持久 Job 卡片，然后继续对话，不在界面里紧密轮询。
3. 打开一份预生成真实 World manifest，并通过 Aholo 链接审阅完整世界。
4. 在同一聊天提出独立物体请求，打开已发布 GLB 做轨道旋转和缩放。
5. 基于已有资产提出修订，展示新资产的来源关系与旧资产仍然可查。
6. 演示一次服务刷新：相同 job 继续更新，且没有第二次付费提交。

如果网络或供应商排队影响现场，明确说明正在运行的真实任务状态，同时使用预生成的真实 Build 保证审阅连续性。不得伪造成功、几何精度、真实尺度、碰撞、物理可用性、OpenUSD Scene Compiler 或物体级 Aholo 写回。

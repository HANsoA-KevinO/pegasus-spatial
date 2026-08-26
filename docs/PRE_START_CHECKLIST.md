# Pegasus Spatial：开赛前准备与 Go / No-Go

更新时间：2026-08-27
目标：把开赛前的剩余工作收敛到可执行门禁。所有结论只基于已经观察到的事实；未做真实付费验证的能力不得写成“已通过”。

## 0. 当前事实快照

| 项目 | 当前状态 | 结论 |
|---|---|---|
| 本机配置 | `.env.local` 已配置，文件权限为 `0600` | 通过；密钥不得进入 Git、文档、终端截图或聊天 |
| Mongo | `127.0.0.1:27019/pegasus_spatial`，容器 `healthy` | 通过；比赛继续使用本机 Mongo，不要求评委配置云数据库 |
| Web 应用 | 本机 `3200` 已启动，`/login` 返回 HTTP 200 | 基础服务通过；这不等于登录、聊天、刷新和重启 E2E 已全部通过 |
| NewAPI | 唯一 `GPT-image-2` 适配器已迁移 | 实现已就位；当前地址是公网 HTTP，只能通过显式开发例外本机联调，不能视为正式安全配置 |
| 公网媒体 | OSS/CDN 前缀为 `raster-assets/pegasus-spatial` | 1×1 测试文件的写入、源站读取、CDN 读取、CORS 和删除探针均通过 |
| Aholo | 只读 World list 返回 HTTP 200，World 数为 0 | 只读鉴权通过；尚未提交或完成任何付费 World |
| Lux3D | key 已配置 | entitlement 和真实生成尚未做付费验证；不得声称 Lux 只读探针或造物能力已通过 |
| 产物域名白名单 | `AHOLO_ASSET_HOST_ALLOWLIST`、`LUX3D_ASSET_HOST_ALLOWLIST` 均为空 | 预期状态；必须从首次真实响应提取精确 hostname 后再填写，禁止猜测或使用通配符 |
| 付费门禁 | `SPATIAL_PAID_CALLS_ENABLED=0` | 通过；普通聊天不能发起付费提交 |
| 真实供应商提交 | 0 次 | 尚无 GPT Image、Aholo 或 Lux3D 的真实成功产物 |
| Operator smoke | `spatial:smoke:aholo`、`spatial:smoke:lux`、`spatial:smoke:image` 尚未实现 | 当前不可运行；本文中的这些命令只是待实现契约，不是现成命令 |

## 1. 当前 Go / No-Go 结论

- **本地零费用开发：Go。** Mongo、应用、配置和 OSS/CDN 基础设施可继续支持开发。
- **Aholo 只读接入：Go。** 仅限已经通过的 World list 查询；不能据此宣称世界生成成功。
- **真实付费端到端：No-Go。** Operator smoke 尚未实现，成本授权尚未填写，Lux entitlement 未验证，真实产物白名单仍为空。
- **NewAPI 正式比赛链路：No-Go。** 当前公网 HTTP 只允许开发联调；在 HTTPS 或等价加密传输就位前，不传输敏感输入，也不把它列为正式安全链路。
- **现场完整 3D 演示：No-Go。** 当前没有真实 World 或 GLB；可以演示已实现的界面与持久任务设计，但必须明确这是能力准备状态，不是供应商成功结果。

## 2. 今晚剩余工作（按顺序）

### P0-1：锁定当前基线并验证

- [ ] 审阅唯一 NewAPI 适配器和媒体前缀改动，确认不存在旧双适配器入口、密钥、真实签名 URL 或供应商响应原文。
- [ ] 运行零费用门禁：

```bash
npm run project-prompt:verify
npm run spatial:verify
npm run spatial:verify:mongo
npm run tool-contracts:verify
npm run multi-agent:verify
npx --no-install tsc --noEmit
npm run lint
npm run build
git diff --check
```

- [ ] 记录 `npm run spatial:preflight:local` 的剩余红项；允许白名单因“等待首次真实响应”保持为空，但不得把 NewAPI 公网 HTTP 误记为正式通过。

### P0-2：实现独立 Operator smoke

以下命令**目前尚未实现，不得运行或写成已通过**：

```bash
npm run spatial:smoke:aholo -- --dry-run
npm run spatial:smoke:lux -- --dry-run
npm run spatial:smoke:image -- --dry-run --mode text
npm run spatial:smoke:image -- --dry-run --mode edit --input-path <workspace-path>
```

实现时必须满足：

- [ ] `--dry-run` 只检查本机配置、输入和供应商可提供的只读鉴权，供应商提交次数必须为 0；Lux dry-run 通过也不代表 entitlement 或 GLB 生成已通过。
- [ ] `--prepare --purpose <fixed-purpose>` 只创建 durable intent，不调用供应商；同一 project + phase budget + purpose 原子占位。
- [ ] 只有已有 intent 携带 `--submit --smoke-id <id> --confirm AUTHORIZE_ONE_PAID_SUBMISSION` 才能提交一次。
- [ ] `--status` 和 `--resume` 只能读取或恢复同一任务，不能重新进入 provider submit。
- [ ] 请求可能已被供应商接受但未拿到外部 ID 时进入 `unknown`，占用预算且禁止自动重试。
- [ ] smoke 复用正式 adapter、SpatialBuildJob、receipt 和 worker，不建立第二套临时路径。
- [ ] 普通聊天始终受 `SPATIAL_PAID_CALLS_ENABLED=0` 保护；operator 授权不得顺带打开全局付费开关。

### P0-3：完成零费用用户路径演练

- [ ] 验证注册/登录、创建对话、基础聊天、刷新页面和服务重启；不要只以 `/login` 返回 200 作为 E2E 通过依据。
- [ ] 运行 `npm run spatial:verify:ui`，确认过程不调用 GPT Image、Aholo 或 Lux3D 的付费创建接口。
- [ ] 用 stub/Mongo 验证 Root-only、Member wildcard 禁权、共享双槽、跨账号 404 和重启恢复。
- [ ] 再做一次 OSS/CDN 小文件探针；确认测试对象已删除，并保留 `raster-assets/pegasus-spatial` 隔离前缀。

### P0-4：解决正式传输与授权问题

- [ ] 为 NewAPI 提供源站 TLS、可信 HTTPS 反向代理或加密隧道；单纯把 `http://` 改成 `https://` 不算解决。
- [ ] 若今晚无法完成安全传输，把 NewAPI 标为明早降级项：Aholo/Lux 走纯文本直达，不依赖参考图；不要以开发 HTTP 例外冒充正式配置。
- [ ] 向主办方确认赛前是否允许真实付费生成，并把确认人、时间和证据位置写入 `docs/LIVE_SMOKE_LOG.md`；今晚只确认规则，首次付费提交仍留到正式 H0。
- [ ] 填写币种/额度单位、各供应商单次上限、H0 总预算、余额下限和人工停止条件；未填写不得提交。
- [ ] 查明 Lux entitlement 的官方验证方式。若只有付费任务能证明 entitlement，则留到 H0 的单次授权测试，不做未经授权的提前提交。

### P0-5：建立恢复点后停止新增功能

- [ ] 确认 `.env.local`、日志和探针产物均未进入 Git。
- [ ] 提交当前改动，创建开赛前 tag，配置并推送 remote；本机和远程应能检出同一 tag。
- [ ] 在 `docs/LIVE_SMOKE_LOG.md` 保留 H0 上限：Aholo 1、Lux3D 1、NewAPI 文生图 1、NewAPI 单图修订 1。
- [ ] 睡前不再增加第二阶段功能，不在疲劳状态下修改 durable 状态机或发起真实付费请求。

## 3. 明早开赛前复核

只做复核，不新增产品范围；第一步先确认不会误付费：

- [ ] `.env.local` 仍为 `0600`，`SPATIAL_PAID_CALLS_ENABLED=0`。
- [ ] Mongo 仍为 `healthy`，数据库仍是 `pegasus_spatial`，端口仍只绑定 `127.0.0.1:27019`。
- [ ] 应用在 `3200` 启动；登录、聊天、刷新、重启的零费用路径通过。
- [ ] OSS/CDN 外网读取与 CORS 仍通过；测试对象删除成功。
- [ ] Operator smoke 已实现且全部 `--dry-run` 为绿；如果尚未实现，真实付费端到端继续 No-Go。
- [ ] NewAPI 正式传输已安全化；否则明确采用不依赖图像参考的降级方案。
- [ ] 余额、预算、比赛规则和人工授权均已填写；任何一项为空都不提交。
- [ ] 当前 commit/tag、恢复命令、演示降级话术可以离线查看。

## 4. H0 边界

- 第 3 节未全部通过，或 Operator smoke 仍未实现时，不做真实付费提交。
- H0 上限仍是 Aholo 1、Lux3D 1、NewAPI 文生图 1、NewAPI 单图修订 1；逐项授权、逐项提交，不并发抢跑。
- Lux entitlement 只有在经授权的真实 Object 任务成功后才算通过。
- 首次产物只提取精确 hostname，Job 进入 `configuration_blocked`；人工写入 allowlist 并重启 worker 后恢复原 Job，不创建新 Job。
- 已有外部 ID 的超时任务继续后台轮询；`unknown` 或无法确认扣费时停止该供应商的新提交，禁止自动重试。
- 每个真实任务按 `docs/LIVE_SMOKE_LOG.md` 留证，且不得记录 API key、Authorization 或完整签名 URL。

## 5. Go / No-Go 门禁

### 开赛前 Local Go

- [x] `.env.local` 已配置且权限为 `0600`；
- [x] 本地 Mongo healthy，应用 `3200/login` 返回 200；
- [x] OSS/CDN 的写、读、CDN、CORS、删除探针通过；
- [x] Aholo World list 只读鉴权通过，当前 0 worlds；
- [x] 全局付费开关为 `0`，真实供应商提交数为 0；
- [ ] 登录/聊天/刷新/重启的完整零费用 E2E 通过；
- [ ] Operator smoke 已实现且 dry-run 提交数为 0；
- [ ] NewAPI 正式 HTTPS 或等价加密传输通过；
- [ ] 成本停止线、比赛规则和人工授权已填写；
- [ ] 代码已提交、打 tag 并推送远程。

**当前判定：Local Go，真实付费链路 No-Go。**

### T+2 Full-scope Go

- [ ] Aholo、Lux3D、NewAPI 各至少有一个经授权且可验证的成功结果；
- [ ] Aholo/Lux allowlist 来自真实响应，原 Job 在配置后完成发布；
- [ ] 至少一份真实 World 与一份真实 GLB 可立即审阅；
- [ ] 服务重启未产生第二次付费提交；
- [ ] manifest、hash、耗时、来源关系和失败边界均已留证。

状态映射：只有 `published` 算 Full-scope Go；`running`、`still_running` 或 `configuration_blocked` 只能算 Degraded Go；`unknown` 对该供应商的新付费提交是 No-Go；`failed` 不自动重试。

降级边界：

- Aholo 未通过：只展示 Agent 规划和届时已经验证的其它能力；不得宣称已有 3D 世界。
- Lux3D 未通过：移除物体成功演示；不得用占位 GLB 或录像冒充真实结果。
- NewAPI 未通过或传输不安全：保留 Aholo/Lux 纯文本直达，不临时加入第二图像供应商。
- Aholo 与 Lux 同时失败：只展示图像概念、Agent 决策和持久任务设计，并明确空间供应商尚未通过。
- HTTPS、媒体读取、镜像/哈希、原子发布、权限隔离或防重复提交任一硬门禁失败：停止受影响的 live 路径，不放宽安全校验抢救现场。

# Pegasus Spatial：开赛前准备与 Go / No-Go

更新时间：2026-08-27
目标：把开赛前的剩余工作收敛到可执行门禁。所有结论只基于已经观察到的事实；未做真实付费验证的能力不得写成“已通过”。

## 0. 当前事实快照

| 项目 | 当前状态 | 结论 |
|---|---|---|
| 本机配置 | `.env.local` 已配置，文件权限为 `0600` | 通过；密钥不得进入 Git、文档、终端截图或聊天 |
| Mongo | `127.0.0.1:27019/pegasus_spatial` 最近一次健康检查通过；服务可按需停止 | 通过；每次启动前仍须以 `npm run demo:status` 重检，不要求评委配置云数据库 |
| Web 应用 | `3200` 的无登录直达、内部归属隔离、Job API 校准、刷新和 Web 进程重启 E2E 已通过；服务不保证一直常驻 | 零费用恢复路径通过；每次演示前仍须以 `npm run demo:status` 重检 |
| NewAPI | 唯一 `GPT-image-2` 适配器已迁移 | 实现已就位；当前地址是公网 HTTP，只能通过显式开发例外本机联调，不能视为正式安全配置 |
| 公网媒体 | OSS/CDN 前缀为 `raster-assets/pegasus-spatial` | 1×1 测试文件的写入、源站读取、CDN 读取、CORS 和删除探针均通过 |
| Aholo | 只读 World list 返回 HTTP 200，World 数为 0 | 只读鉴权通过；尚未提交或完成任何付费 World |
| Lux3D | key 已配置 | entitlement 和真实生成尚未做付费验证；不得声称 Lux 只读探针或造物能力已通过 |
| 赛事信息基线 | 用户已提供的赛事通知与海报是当前规则基线；另已核对《Venture D 软件支持清单及领取方式》 | 后者是 AI Ping、Zion、Qoder 等软件福利领取说明，可见内容未出现 Aholo、Lux3D、群核或额外比赛规则；不将其当作付费测试授权 |
| 外部能力选型 | 本项目从主办方/赛题平台提供的资源中仅领取和使用 Aholo；LLM 与生图使用自有 NewAPI | 不依赖 Zion 或其他赞助模型，也不需要为了参赛额外领取它们；Lux3D 若用于独立物体演示，其鉴权/额度仍是独立技术依赖，不由该福利文档证明 |
| 产物域名白名单 | `AHOLO_ASSET_HOST_ALLOWLIST`、`LUX3D_ASSET_HOST_ALLOWLIST` 均为空 | 预期状态；必须从首次真实响应提取精确 hostname 后再填写，禁止猜测或使用通配符 |
| 提交边界 | 供应商凭证、资产域名白名单、持久 receipt | 正常 Agent 无额外付费总开关；依靠具体配置与防重放契约 |
| 真实供应商提交 | 0 次 | 尚无 GPT Image、Aholo 或 Lux3D 的真实成功产物 |
| Operator smoke | 命令、durable intent、单次授权和恢复测试已实现 | Aholo/Lux `--dry-run` 为绿且提交数为 0；Image 因当前 NewAPI 为公网 HTTP 正确 fail closed；没有执行真实提交 |
| 密钥风险 | 用户明确决定本轮暂不轮换已配置密钥 | 记为用户接受的已知风险，不作为本轮本地开发阻塞项；不得在文档、日志、截图或提交中记录密钥值 |

## 1. 当前 Go / No-Go 结论

- **本地零费用开发：Go。** Mongo、应用、配置和 OSS/CDN 基础设施可继续支持开发。
- **Aholo 只读接入：Go。** 仅限已经通过的 World list 查询；不能据此宣称世界生成成功。
- **真实付费端到端：No-Go。** Operator smoke 实现和零提交测试已通过，但成本授权尚未填写，Lux entitlement 未验证，真实产物白名单仍为空。
- **NewAPI 正式比赛链路：No-Go。** 当前公网 HTTP 只允许开发联调；在 HTTPS 或等价加密传输就位前，不传输敏感输入，也不把它列为正式安全链路。
- **现场完整 3D 演示：No-Go。** 当前没有真实 World 或 GLB；可以演示已实现的界面与持久任务设计，但必须明确这是能力准备状态，不是供应商成功结果。

### 部署口径：保留本地 Mongo

保留 Mongo 会给“从零克隆并运行”增加一个 Docker 前置，但不需要评委注册云数据库、填写连接串或手工建表。开发启动为 `docker compose up -d mongo` 后运行 `npm run dev`；全栈容器启动由仓库的 Compose 文件管理。现场评审仅使用已启动的本机服务，没有额外数据库操作。

这个轻量部署成本换来任务恢复、防重复付费、Workspace CAS 和刷新后状态保留，因此本阶段按现有“本地应用 + 本地 Mongo + OSS/CDN”继续，不改为纯文件持久化。

## 2. 今晚剩余工作（按顺序）

### P0-1：锁定当前基线并验证

- [x] 已审阅唯一 NewAPI 适配器和媒体前缀改动；旧双适配器入口已移除。按 `.env.local` 当前值做的精确值扫描为 0 命中；通用模式只命中隔离测试中的合成凭证 fixture，均不等于本机配置值。未发现真实密钥、签名 URL 或供应商响应原文进入受检改动。
- [x] 以下零费用门禁均已通过；其中 Mongo recovery 覆盖提交后崩溃恢复和 Operator smoke 持久恢复，production build、TypeScript、ESLint 与 diff 检查也均为绿：

```bash
npm run project-prompt:verify
npm run spatial:verify
npm run spatial:verify:mongo
npm run tool-contracts:verify
npm run chat-contracts:verify
npm run multi-agent:verify
npx --no-install tsc --noEmit
npm run lint
npm run build
git diff --check
```

- [x] `npm run spatial:preflight:local` 已成功完成检查并记录剩余红项；`ready_for_paid_smoke=false` 是当前正确结果：Aholo/Lux 精确 allowlist 仍等待首次真实响应，NewAPI 公网 HTTP 仍被正式传输门禁拒绝。

### P0-2：实现独立 Operator smoke

以下命令已经实现。`--dry-run` 不创建 intent、不访问供应商、不产生费用：

```bash
npm run spatial:smoke:aholo -- --dry-run
npm run spatial:smoke:lux -- --dry-run
npm run spatial:smoke:image -- --dry-run --mode text
npm run spatial:smoke:image -- --dry-run --mode edit \
  --project-id <conversation-id> --input-path <workspace-path>
```

Image edit 的 `--dry-run` 还必须提供 `--project-id <conversation-id>`，以验证输入图片确实属于当前 Workspace。当前 NewAPI 是非回环 HTTP，因此两个 Image dry-run 会在传输门禁处失败且供应商提交数仍为 0；这是预期的正式安全阻断，不得用开发例外绕过。

真实 H0 操作严格分为四步；`--prepare` 只创建 durable intent 和正式 Job/receipt，仍然是 0 次供应商提交：

```bash
# 1. 冻结一次目的与输入；phase + purpose 必须固定
npm run spatial:smoke:aholo -- --prepare \
  --project-id <conversation-id> --phase H0 --purpose aholo-world-1 \
  --prompt "<最小世界描述>"

# 2. 只读查看
npm run spatial:smoke:aholo -- --status --smoke-id <spsmoke_id>

# 3. 填完 LIVE_SMOKE_LOG 的预算后，逐字人工确认一次
npm run spatial:smoke:aholo -- --submit --smoke-id <spsmoke_id> \
  --confirm AUTHORIZE_ONE_PAID_SUBMISSION

# 4. 只恢复已有 external id；永远不会从 prepared 发起提交
npm run spatial:smoke:aholo -- --resume --smoke-id <spsmoke_id>
```

把命令名替换为 `spatial:smoke:lux` 或 `spatial:smoke:image` 即可。Image 使用 `--mode text|edit`；edit 还需 `--input-path`。同一 project + phase + purpose 只允许一个冻结 intent；每个 phase 内 Aholo、Lux、Image text、Image edit 各只有一个预算槽，换 purpose 也不能绕过。

实现时必须满足：

- [x] `--dry-run` 只检查本机配置和输入，供应商提交次数固定为 0；Lux dry-run 通过也不代表 entitlement 或 GLB 生成已通过。
- [x] `--prepare --purpose <fixed-purpose>` 只创建 durable intent，不调用供应商；同一 project + phase + purpose 及 provider/mode 预算均原子占位。
- [x] 只有已有 intent 携带 `--submit --smoke-id <id> --confirm AUTHORIZE_ONE_PAID_SUBMISSION` 才能提交一次。
- [x] `--status` 和 `--resume` 只能读取或恢复同一任务；`--resume` 对 prepared/authorized 明确拒绝进入 provider submit。
- [x] 请求可能已被供应商接受但未拿到外部 ID 时进入 `unknown`，消耗该阶段预算且禁止自动重试。
- [x] 未核销的 `unknown` 会按 project + provider budget 跨 phase 阻止后续 prepare/authorize/submit；Image text/edit 共用该供应商停止线，不能换 phase 或 mode 绕过。
- [x] 同一 project + provider 的付费边界由 Mongo 唯一 guard 串行化；调用供应商前再次校验 guard 所有权。过期 Spatial `submitting` 与 Image receipt 会先恢复为 `unknown` 并同步 intent，不能由陈旧状态绕过停止线。
- [x] smoke 复用正式 adapter、SpatialBuildJob、GenerateImage receipt、worker processor 与 Workspace CAS，不建立第二套临时提交路径。
- [x] 普通聊天不经过额外付费总开关；operator smoke 仍是局部、逐 intent 的人工授权路径。
- [x] Aholo/Lux 首次成功若白名单为空，只持久化精确 hostname 并进入 `configuration_blocked`；配置 allowlist 后恢复同一 external job，不重复提交。

`docs/LIVE_SMOKE_LOG.md` 的预算字段是人工门禁，CLI 不会替操作员解析或校验 Markdown。操作员必须在运行 `--submit` 前逐项填写并人工复核；精确确认文本只是第二道单次授权，不能替代预算检查。

### P0-3：完成零费用用户路径演练

- [x] `npm run spatial:verify:demo-e2e` 已验证无登录直达、固定内部归属隔离、Job API 校准、页面刷新和 Web 进程重启恢复；供应商调用数为 0。
- [x] E2E 的历史 ToolResult 从 `prepared` 经真实 Job API 校准到 `published`，且不伪造 Workspace 资产入口。
- [x] 用 stub/Mongo 验证 Root-only、Member wildcard 禁权、共享双槽、内部 owner 归属隔离和重启恢复。
- [ ] 基础聊天会访问自有 NewAPI，不属于“零外部调用”E2E；仅在传输与演示授权就绪后单独验证，不把工作台首页 200 冒充聊天通过。
- [x] OSS/CDN 小文件探针已验证写入、源站读取、CDN 读取、CORS 和删除；测试对象已删除，隔离前缀保持为 `raster-assets/pegasus-spatial`。

### P0-4：解决正式传输与成本授权问题

- [ ] 为 NewAPI 提供源站 TLS、可信 HTTPS 反向代理或加密隧道；单纯把 `http://` 改成 `https://` 不算解决。
- [ ] 若今晚无法完成安全传输，把 NewAPI 标为明早降级项：Aholo/Lux 走纯文本直达，不依赖参考图；不要以开发 HTTP 例外冒充正式配置。
- [x] 整理现有赛事资料基线：用户提供的通知/海报为当前比赛要求；腾讯文档是软件福利领取清单，可见内容没有新增比赛规则。
- [x] 冻结能力选型：只领取/使用 Aholo；LLM 和生图固定走自有 NewAPI；Zion 兑换码 `VentureD2026` 只是福利信息，项目不依赖它，也不强制领取赞助模型。
- [ ] 由于现有资料未明确赛前真实生成授权，赛前不做付费提交；正式 H0 后再按预算和单次人工确认执行 Operator smoke。
- [ ] 填写币种/额度单位、各供应商单次上限、H0 总预算、余额下限和人工停止条件；未填写不得提交。
- [ ] 查明 Lux entitlement 的官方验证方式。若只有付费任务能证明 entitlement，则留到 H0 的单次授权测试，不做未经授权的提前提交。

密钥轮换本轮按用户决定暂缓，不列为 P0 阻塞项。这不改变密钥可能暴露的已知风险，也不允许在任何留证中写入密钥本身。

### P0-5：建立恢复点后停止新增功能

- [x] 已确认 `.env.local`、日志和探针产物均未进入 Git；精确配置值扫描为 0 命中，通用模式命中仅限隔离测试的合成 fixture。
- [x] 当前实现已提交；最终恢复点使用 tag `prestart-2026-08-27-final`，并生成同名仓库外 Git bundle。
- [ ] 配置并推送 remote；本机和远程应能检出同一 tag。
- [x] `docs/LIVE_SMOKE_LOG.md` 已保留 H0 上限：Aholo 1、Lux3D 1、NewAPI 文生图 1、NewAPI 单图修订 1。
- [x] 第一阶段功能范围已冻结；后续只做明早复核与正式 H0，不再增加第二阶段功能或赛前付费请求。

## 3. 明早开赛前复核

只做复核，不新增产品范围；第一步先确认不会误付费：

- [ ] `.env.local` 仍为 `0600`，供应商凭证和精确产物域名已配置且未进入日志。
- [ ] 运行 `npm run demo:status`；Mongo 为 `healthy`、数据库为 `pegasus_spatial`，端口只绑定 `127.0.0.1:27019`。
- [ ] 应用在回环 `3200` 启动；无登录直达、Job 卡片、刷新和 Web 重启的零费用路径通过；聊天另按 NewAPI 门禁验证。
- [ ] OSS/CDN 外网读取与 CORS 仍通过；测试对象删除成功。
- [x] Operator smoke 已实现；Aholo/Lux `--dry-run` 为绿，Image 因公网 HTTP 正确 fail closed，三者提交数均为 0。
- [ ] NewAPI 正式传输已安全化；否则明确采用不依赖图像参考的降级方案。
- [ ] 现有规则基线已记录，且余额、预算和单次人工授权均已填写；后三项任何一项为空都不提交。
- [x] 当前 commit、`prestart-2026-08-27-final` tag、离线 bundle、恢复命令和演示降级话术均已固定在本地恢复点中。

## 4. H0 边界

- 第 3 节未全部通过，或 Operator smoke 仍未实现时，不做真实付费提交。
- H0 上限仍是 Aholo 1、Lux3D 1、NewAPI 文生图 1、NewAPI 单图修订 1；逐项授权、逐项提交，不并发抢跑。
- Lux entitlement 只有在经授权的真实 Object 任务成功后才算通过。
- 首次产物只提取精确 hostname，Operator Job 进入 `configuration_blocked`。人工写入精确 allowlist 后，优先用同一 provider 和同一 `smoke_id` 执行 `npm run spatial:smoke:<provider> -- --resume --smoke-id <spsmoke_id>`，CLI 新进程会立即重读 `.env.local`。`prepared` 阶段普通 worker 不接管 Operator Job；一旦 external id 已持久化，Job 会切回 worker gate，因此重启应用/worker使其加载新配置后也可恢复同一任务。两条路径都不得创建新 Job或再次提交。
- 已有外部 ID 的超时任务继续后台轮询；`unknown` 或无法确认扣费时停止该供应商的新提交，禁止自动重试。
- 只有在供应商后台完成人工核账并留下依据后，才可用原 provider 对原 smoke id 执行 `--reconcile-unknown --smoke-id <id> --confirm RECONCILE_UNKNOWN_AFTER_PROVIDER_ACCOUNTING --actor <operator> --reason <核账依据>`。该命令只追加不可覆盖的审计事实，原 intent 永远保持 `unknown`；随后新的 phase/purpose 才可建立新 intent。
- 每个真实任务按 `docs/LIVE_SMOKE_LOG.md` 留证，且不得记录 API key、Authorization 或完整签名 URL。

## 5. Go / No-Go 门禁

### 开赛前 Local Go

- [x] `.env.local` 已配置且权限为 `0600`；
- [x] 本地 Mongo 与 `3200/` 工作台最近一次验证通过；演示前须用 `npm run demo:status` 重检；
- [x] OSS/CDN 的写、读、CDN、CORS、删除探针通过；
- [x] Aholo World list 只读鉴权通过，当前 0 worlds；
- [x] 全局付费开关为 `0`，真实供应商提交数为 0；
- [x] 现有比赛要求与软件福利清单已区分记录，项目不依赖 Zion 或赞助模型；
- [x] 无登录直达、内部归属隔离、Job API、刷新与 Web 重启的零费用 E2E 通过，Mongo crash/recovery 与 Operator 持久恢复测试通过；
- [x] project/spatial/tool/chat/multi-agent 契约测试、production build、TypeScript、ESLint、diff 检查与本地 preflight 均已执行并得到预期结果；
- [x] Operator smoke 已实现；Aholo/Lux dry-run 通过、Image HTTPS 门禁正确拒绝，提交数均为 0；
- [ ] 基础聊天 live 已在安全 NewAPI 传输和演示授权就绪后完成验证；
- [ ] NewAPI 正式 HTTPS 或等价加密传输通过；
- [ ] 成本停止线和单次人工授权已填写；
- [x] 本地代码已提交，最终 tag 固定为 `prestart-2026-08-27-final`，并生成同名 Git bundle；
- [ ] remote 已配置，且同一 tag 已推送并可从远程检出。

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

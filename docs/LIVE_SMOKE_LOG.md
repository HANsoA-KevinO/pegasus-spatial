# Pegasus Spatial：真实 Smoke 留证

本文件只保存脱敏事实，不得写入 API key、完整签名 URL、Cookie、Authorization、上传凭证或响应原文。开始真实付费测试前必须先填写“授权与成本停止线”。

## 赛事与软件福利事实基线

- 当前比赛要求以用户已提供的 VentureD 通知和海报为基线。
- 已核对腾讯文档[《Venture D 软件支持清单及领取方式》](https://docs.qq.com/aio/DVk5vaWRuZUVoQ1Nr)。其可见内容是 AI Ping、Zion、Qoder 等软件福利的领取说明，未出现 Aholo、Lux3D、群核或额外比赛规则。
- Zion 福利兑换码是 `VentureD2026`，但 Pegasus Spatial 不依赖 Zion，无需为本项目领取。
- 技术选型已冻结：本项目从主办方/赛题平台提供的资源中仅领取和使用 Aholo；LLM 和生图使用自有 NewAPI；现有资料不要求使用或领取赞助模型。Lux3D 如继续用于独立物体演示，其 entitlement 与额度必须通过自身的官方接口独立验证，不由该腾讯文档证明。
- 上述文档没有说明赛前真实生成是否被允许，因此不把“没写禁止”推断为“已授权”。默认在正式 H0 后再做单次人工授权的付费 smoke。
- 用户决定本轮暂不轮换已配置密钥，并接受对应已知风险。该决定不作为本轮本地开发阻塞项，但本日志及其他文档、截图和 Git 提交仍严禁记录任何密钥值。

## 授权与成本停止线

- 比赛正式开始时间：`[待填写，含时区]`
- 赛前真实生成授权范围：`[未确认；默认不提交]`
- 规则/授权证据位置：`[当前为用户提供的通知、海报及上述腾讯文档；如有新的主办方说明，只记链接/本机安全路径]`
- 币种或额度单位：`[待填写]`
- 余额检查时点：`[待填写]`
- Aholo 单次最大预算 / 余额下限：`[待填写]`
- Lux3D 单次最大预算 / 余额下限：`[待填写]`
- NewAPI 单次最大预算 / 余额下限：`[待填写]`
- H0 总预算：`[待填写]`
- 人工停止条件：`[待填写]`
- H0 最大提交数：Aholo `1`；Lux3D `1`；NewAPI 文生图 `1`；NewAPI 单图修订 `1`

未填写上述字段时，所有 operator smoke 只能运行 `--dry-run`。

## Operator 命令契约

- `--dry-run`：0 次供应商提交，不创建 smoke intent；输出必须显示 `supplier_submissions: 0`。
- `--prepare --project-id ... --phase ... --purpose ...`：冻结 durable intent 和正式 Job/receipt，但不调用供应商。把返回的 `smoke_id` 记入下方模板。
- `--submit --smoke-id ... --confirm AUTHORIZE_ONE_PAID_SUBMISSION`：唯一允许跨越付费边界的命令；每个 intent 最多一次，不使用产品路径里的自动预提交重试。
- `--status`：纯读取并同步 durable 状态。
- `--resume`：只轮询、镜像或发布已有 external id/已保存图片；prepared/authorized 状态绝不提交。
- Aholo/Lux 首次产物白名单为空时，输出只包含脱敏 hostname；完整签名 URL 不进入 intent、日志或终端。填写精确 allowlist 后，优先运行同一 provider、同一 smoke id 的 `npm run spatial:smoke:<provider> -- --resume --smoke-id <spsmoke_id>`，CLI 新进程会立即重读 `.env.local`。`prepared` 阶段普通 worker不接管 Operator Job；external id 持久化后会切回 worker gate，因此重启应用/worker加载新配置也能恢复同一任务。无论哪条路径都不得重新提交。
- `unknown` 表示供应商可能已接受但没有可恢复证据：project + provider budget 会跨 phase 阻止新的 prepare/authorize/submit；Image text/edit 也共用停止线。不得更换 phase、purpose 或 mode 规避，不得重提。
- 同一 project + provider 同时只能有一个持有 Mongo 提交 guard 的 Operator smoke。guard 在调用供应商前会再次核验；`published`/确定失败后释放，`unknown` 仅在留下人工核账记录后释放。
- 供应商后台人工核账完成后，才可运行 `npm run spatial:smoke:<provider> -- --reconcile-unknown --smoke-id <id> --confirm RECONCILE_UNKNOWN_AFTER_PROVIDER_ACCOUNTING --actor <operator> --reason <核账依据>`。该命令只写不可覆盖的 reconciliation 记录，原 intent 仍为 `unknown`，不会恢复或重放它。

预算与余额字段是人工门禁，CLI 不会解析本文件。`--confirm AUTHORIZE_ONE_PAID_SUBMISSION` 只证明本次命令获得单次人工确认，不替代提交前的预算、余额和比赛时间复核。

## Smoke 记录模板

每次执行前复制本节；同一 provider + smoke ID 只能对应一个 durable intent。

### `[provider] / [smoke-id]`

- 固定 purpose / phase budget key：`[待填写]`
- 是否由赛前技术测试提前执行：`[否/是；若是，本次计入 H0 上限且正式开始后不得重复]`
- 人工确认文本：`[待填写]`
- 开始时间：`[待填写，含时区]`
- 结束/最后观察时间：`[待填写，含时区]`
- 本方 job/receipt ID：`[待填写]`
- 外部任务 ID：`[Operator 输出固定为 SHA-256 hash；如需普通 ID，只从供应商控制台人工核对，不复制签名 URL]`
- 输入 hash：`[待填写]`
- 状态轨迹：`[prepared → ...]`
- 是否出现 ambiguous/unknown：`[否/是；说明但不重提]`
- 提交次数：`[必须为 0 或 1]`
- 供应商状态：`[待填写]`
- 产物 hostname：`[逐项列出；不写完整签名 URL]`
- MIME / magic / 字节数 / SHA-256：`[逐产物填写]`
- Workspace 路径：`[待填写]`
- 重启恢复结果：`[待填写]`
- UI 刷新后结果：`[待填写]`
- 费用/额度变化：`[待填写]`
- 提交前预计最大扣费 / 提交后余额：`[待填写]`
- 结论：`[pass / still_running / configuration_blocked / unknown / failed]`
- 后续动作：`[待填写]`

## T+2 结论

- Aholo：`[Full-scope Go / Degraded Go / No-Go]`
- Lux3D：`[Full-scope Go / Degraded Go / No-Go]`
- NewAPI：`[Full-scope Go / Degraded Go / No-Go]`
- 已启用的精确 allowlist：`[只写 hostname]`
- 明确关闭的能力：`[待填写]`
- 对外表述边界：`[待填写]`

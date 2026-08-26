# Pegasus Spatial：真实 Smoke 留证

本文件只保存脱敏事实，不得写入 API key、完整签名 URL、Cookie、Authorization、上传凭证或响应原文。开始真实付费测试前必须先填写“授权与成本停止线”。

## 授权与成本停止线

- 比赛正式开始时间：`[待填写，含时区]`
- 赛前真实生成授权范围：`[禁止 / 仅允许技术测试但产物不可参赛 / 测试产物可用于演示 / 未确认]`
- 确认人及证据位置：`[待填写；只写链接/本机安全路径，不复制敏感正文]`
- 币种或额度单位：`[待填写]`
- 余额检查时点：`[待填写]`
- Aholo 单次最大预算 / 余额下限：`[待填写]`
- Lux3D 单次最大预算 / 余额下限：`[待填写]`
- NewAPI 单次最大预算 / 余额下限：`[待填写]`
- H0 总预算：`[待填写]`
- 人工停止条件：`[待填写]`
- H0 最大提交数：Aholo `1`；Lux3D `1`；NewAPI 文生图 `1`；NewAPI 单图修订 `1`

未填写上述字段时，所有 operator smoke 只能运行 `--dry-run`。

## Smoke 记录模板

每次执行前复制本节；同一 provider + smoke ID 只能对应一个 durable intent。

### `[provider] / [smoke-id]`

- 固定 purpose / phase budget key：`[待填写]`
- 是否由赛前技术测试提前执行：`[否/是；若是，本次计入 H0 上限且正式开始后不得重复]`
- 人工确认文本：`[待填写]`
- 开始时间：`[待填写，含时区]`
- 结束/最后观察时间：`[待填写，含时区]`
- 本方 job/receipt ID：`[待填写]`
- 外部任务 ID：`[仅记录普通 ID；若供应商 ID 含秘密则写 hash]`
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

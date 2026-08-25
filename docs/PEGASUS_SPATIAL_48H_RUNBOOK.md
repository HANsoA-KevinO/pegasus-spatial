# Pegasus Spatial · 48 小时验收与现场手册

本文只描述真实门禁和操作顺序，不把配置存在、Mock 测试或预制截图冒充供应商真实生成。

## 1. H0–H4 真实能力冻结

1. 从 `.env.example` 创建全新的 `.env.local`，不得复制 Pegasus 或 Sci-Pegasus 的密钥。
2. 保持 `SPATIAL_PAID_CALLS_ENABLED=0`，运行：

   ```bash
   node --env-file=.env.local node_modules/jiti/lib/jiti-cli.mjs scripts/check-spatial-readiness.ts
   ```

3. 分别用官方账号做一次 GPT Image、Aholo World、Lux3D G1 最小真实请求；记录请求时间、任务 ID、最终状态、响应字段、产物 MIME、文件 magic、字节数和 SHA-256。
4. 从真实成功响应中提取 Aholo/Lux3D 产物 hostname，写入精确的 `*_ASSET_HOST_ALLOWLIST`。禁止使用通配符、任意 URL 或重定向扩展白名单。
5. GPT Image 2 只有在官方 Images API 的生成和单图编辑都成功后才作为静态供应商。如果凭证或能力不通过，先实现并验证固定的替代 adapter；运行期不得自动换供应商。
6. 再次运行 readiness。只有全部门禁通过，才可显式设置 `SPATIAL_PAID_CALLS_ENABLED=1`。

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

本地服务启动后，再运行不会登录、不会提交付费任务的浏览器 smoke：

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

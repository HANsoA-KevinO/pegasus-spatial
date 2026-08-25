# Pegasus Spatial

**Pegasus Spatial（飞马空间 Agent）**是一个用自然语言驱动图像生成、3D 造物、世界生成与现实重建能力的空间创作 Agent。

用户从一个对话入口描述目标。Agent 根据对象是独立物体、完整世界还是现实场地，自主选择可用工具、追踪外部任务、保留修订血缘并交付可检查资产。产品不设“物体 / 世界”预选模式，也不规定外部能力必须按某个次序执行。

## 第一阶段能力

- `GenerateImage`：文生图与单图修订，默认模型 `gpt-image-2`。
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
- 付费工具仅 Root Agent 可用，并且必须显式设置 `SPATIAL_PAID_CALLS_ENABLED=1`。
- 项目同时最多运行两个昂贵任务。

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
| OSS prefix | `pegasus-spatial/raster-assets/` |
| Auth cookies | `pegasus-spatial.*` / `__Secure-pegasus-spatial.*` |
| Docker network / volumes | `pegasus-spatial-*` |

底层 Workspace 内部路径暂保留 `.sci-pegasus/` 以兼容已验证的 CAS、版本库与多 Agent ACL；它是数据库内的虚拟路径，不会使新应用连接 Sci-Pegasus 的 Mongo、媒体或 Docker volume。

## 本地启动

```bash
cp .env.example .env.local
# 生成独立密钥、填写 LLM 与供应商凭证

docker compose up -d mongo
npm install
npm run dev
```

打开 `http://localhost:3200`。默认 `SPATIAL_PAID_CALLS_ENABLED=0`；只有在完成真实 API smoke test 后才将其改为 `1`。

先运行只读门禁（不会访问供应商，也不会产生费用）：

```bash
node --env-file=.env.local node_modules/jiti/lib/jiti-cli.mjs scripts/check-spatial-readiness.ts
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
npm run tool-contracts:verify
npm run multi-agent:verify
npx tsc --noEmit
npm run lint
npm run build
```

真实 Aholo、Lux3D 和 GPT Image 提交必须单独运行 smoke test，不应由单元测试或普通 build 触发。
完整的 H0 凭证门禁、崩溃演练、真实预生成资产要求和现场降级方案见
[48 小时验收与现场手册](docs/PEGASUS_SPATIAL_48H_RUNBOOK.md)。

工具适配器以供应商正式契约为准：[Aholo / Lux3D API Reference](https://labs.aholo3d.cn/api-docs/api-reference)、[Aholo 3DGS Skill](https://labs.aholo3d.cn/api-docs/skills/aholo-3dgs-reconstruction)、[Lux3D Skill](https://labs.aholo3d.cn/api-docs/skills/lux3d) 与 [OpenAI Image Generation](https://developers.openai.com/api/docs/guides/image-generation)。运行时不会依赖未经文档化的网关字段自动切换供应商。

## 能力边界

第一阶段不实现 OpenUSD / RenderCloud Scene Compiler、物体级 Aholo World 写回、CAD 精度、真实尺度、碰撞、路径规划或物理仿真。混合 3DGS + GLB Viewer 是核心交付完成后的可选实验，不得阻塞主演示。

## 来源与许可

本项目从 Sci-Pegasus 的独立源码快照建立。基线、未继承 Git 历史的原因和重分发注意事项见 [UPSTREAM.md](UPSTREAM.md)。未确认原始权利与许可之前，不要宣称本仓库采用 MIT 或其他许可证。

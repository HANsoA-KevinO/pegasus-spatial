# Aholo World 真实生成测试记录（2026-08-27）

## 结论

当前 Aholo API Key 可以完成鉴权、官方 OUS 资产上传和 World 任务创建，但本轮所有 `ai_gen` World 都在公开进度字段被置为 `1.0` 时标记为失败。

共同终态为：

```text
HTTP detail: 200
status: FAILED
progress: 1
scene: ai_gen
message: null
code: null
imagery/splats/semantics: empty
```

`progress` 的公开契约是 `[0.0, 1.0]`，因此 `progress=1` 在字段语义上表示 **100%**，不是“第一阶段”。但服务端也可能在失败终态统一把 progress 置为 1，所以它不能证明所有计算阶段真的完成。本轮 6 个 World 从创建到失败只持续 19–40 秒；官方教程给出的正常量级是全景图 3–5 分钟、3DGS 约 20 分钟。结合积分记录中的“扣 10 → 失败退回 10”，更准确的判断是：任务被正式受理并计费，但很快在供应商生成、质检或最终产物发布链路失败。

现有证据已经排除 Pegasus Spatial 的输入归属、公开媒体 URL、文件扩展名、官方资产上传、prompt 组合和媒体压缩变体等主要客户端原因。公开 World detail 契约没有 `error`、`failureReason` 或 trace ID，响应头也没有 request ID，因此客户端无法取得更精确的内部异常。继续重复提交同类任务不会增加诊断信息；必须由 Aholo/赛事技术支持使用 World ID 和创建时间查询服务端日志。

当前最可能的两类根因是：

1. 赛事账号的 API SpatialGen 路由或 feature flag 没有正确绑定；
2. Aholo 当前 AI 空间生成后端发生服务异常或最终产物质检/发布异常。

## 网页端两阶段对照（新增证据）

同一账号随后在 Aholo 网页端创建 AI World。网页流程明确分成两步：

1. 普通源图生成 360° 全景；
2. 用户确认全景后，点击“开始高斯生成”再构建 3DGS。

在网页已经显示可旋转全景、尚未点击或尚未完成高斯生成时，使用公开只读接口查询同一 World，得到：

```text
status: RUNNING
progress: 0.6
assets.imagery.panoUrl: present
assets.splats: empty
```

这与网页状态完全一致，也证明同一账号、额度和底层 SpatialGen 至少能够完成全景阶段。与之相对，本轮 6 个 OpenAPI 创建的 World 均在 19–40 秒内失败，且 `panoUrl` 和全部 splat 产物都为空。

约二十余分钟后再次使用同一个公开详情接口只读查询，网页任务已经到达：

```text
status: SUCCEEDED
progress: 1.0
assets.imagery.panoUrl: present
assets.splats.urls.spzPath: present
assets.splats.urls.plyPath: present
assets.splats.urls.lodMetaPath: present
```

因此账号、赛事额度、全景生成和 3DGS 服务均已得到同账号真实成功证据。故障可以进一步锁定为公开 World generation 的创建路由、API 专属 feature flag 或其自动两阶段编排，而不是账号级能力或高斯服务整体不可用。

因此不能把故障解释为 Pegasus Spatial “把普通源图直接交给高斯生成、跳过全景”。客户端只调用公开的 `POST /world/v1/generations`；官方 Skill 将其定义为文案/单图到 3D 世界的一次创建调用，公开 API 也没有提供“确认全景”或“开始高斯”的第二个端点。按照公开契约，两阶段应由服务端自动编排。

当前更精确的故障范围是：

- 网页端私有编排能够先生成全景；
- OpenAPI 创建链路在形成可用 `panoUrl` 之前就失败，或其自动阶段衔接发生异常；
- 网页端点击“开始高斯生成”后最终已经得到完整 splat，账号级 3DGS 能力和底层高斯服务已被排除，只剩 OpenAPI 路由/feature flag/自动编排问题。

网页端使用的内部交互不是公开契约，本项目不复制或调用其私有接口；应由 Aholo 修复或说明公开 OpenAPI 的预期阶段语义。

余额不足、API Key 无效、整个 API 网关不可用和普通输入参数错误均已被证据排除。

## 全链路只读探针

| 能力 | 结果 | 结论 |
|---|---|---|
| 文档站 `/api-docs/intro` | HTTP 200 | 文档站可达 |
| 实时 OpenAPI JSON/YAML | HTTP 200 | OpenAPI 3.0.3，公开版本 `1.0.0` |
| `GET /asset/v1/token` | HTTP 200，schema 正确 | Key 有效；资产服务可用 |
| OUS 域名 | `ous-cos.kujiale.com` | 与官方 Skill 一致 |
| `POST /world/v1/list` | HTTP 200 | World 读取 API 可用 |
| `GET /world/v1/{worldId}` | 6/6 HTTP 200 | World 详情 API 可用 |
| `GET /lux3d/v1/generate/task/list` | HTTP 200，`c=0` | 同一 Key 可访问 Lux；账号/网关不是整体失效 |
| 无效 Key 控制 | HTTP 200，`c=-1, m=invalid appKey` | 鉴权确实生效，但实际错误 envelope 与 OpenAPI 声称的 HTTP 401 不一致 |

6 个 World 全部为 `FAILED`、`progress=1`、`scene=ai_gen`、无产物。详情响应仅带 `nginx`、日期和 content type，没有可交给客户端追踪的 request/trace ID。

## OpenAPI、SDK、Skill 与发行说明反查

- 当前 OpenAPI 的 `POST /world/v1/generations` 明确支持纯文案、单图和图文组合。
- 官方 TypeScript World SDK `1.3.0` 发布于 2026-06-29，README 和类型同样支持 prompt-only、image-only、图文组合；创建实现只是原样 POST body，没有隐藏字段。
- 官方 Skill 的创建请求与当前实现一致：`x-source: skills`、可选 `name/prompt/cover`、至多一条 `{type:"image", url}`。
- 2026-06-29 发行说明所说“世界生成仅支持图片输入”是指 `resources` 的媒体类型只允许 image，而不是禁止 prompt；SDK 同期 README 明确写了 prompt and/or image。
- 2026-08-25 发行说明只有 Lux3D 变更，没有 World breaking change；World SDK 自 2026-06-29 后没有新版本。
- OpenAPI 文件最后修改时间为 2026-08-25，但 World 的最近公开发行说明仍停留在 2026-06-29，未公告可以解释本次失败的变更或已知事故。

公开契约本身存在两处可观测不一致，但它们不是本次创建失败的直接原因：

1. `WorldOpenApiProjectScene` enum 只列出 `model | space`，同一 OpenAPI 的成功示例和线上实际响应却使用 `ai_gen`；
2. World 鉴权错误文档写 HTTP 401 `ApiError`，线上实际返回 HTTP 200 的旧式 `{c,m,d,f}` envelope。

核对来源：

- https://labs.aholo3d.cn/api-docs/intro
- https://labs.aholo3d.cn/api-docs/openapi.json
- https://labs.aholo3d.cn/api-docs/release-notes
- https://github.com/manycoretech/aholo-spatial-sdk

## 已验证的客户端链路

1. API Key 对 `POST /world/v1/list` 鉴权成功。
2. `GET /asset/v1/token` 成功返回官方 OUS 上传凭证。
3. 输入图片通过 `ous-cos.kujiale.com` 的官方 OUS 接口上传成功。
4. OUS 状态到达 `5` 并返回可用于 World 创建的资产 URL。
5. `POST /world/v1/generations` 接受请求并返回 World ID。
6. World 状态按 `PENDING → PREPROCESSING → RUNNING → FAILED` 演进。
7. 每个 Operator intent 都恰好提交一次；后续操作只轮询已知外部任务，没有自动重提。

实现已逐字段对照 Aholo 官方 Skill：

- World 创建请求携带 `x-source: skills`。
- `resources` 结构为单个 `{ type: "image", url }`。
- OUS 单文件上传使用 MD5、multipart `file` 和 `ous-token-v2`。
- 轮询 `/ous/api/v2/upload/status`，仅在状态 `5` 后创建 World。

## 对照矩阵

| 对照 | 输入 | 供应商是否接受 | 终态 | 说明 |
|---|---|---:|---|---|
| URL 直传 | Workspace HTTPS 图片 URL | 否 | HTTP 400 | 官方明确要求先走资产模块；据此补齐 OUS 上传 |
| 图片 + prompt | 16:9 PNG，短边 941 | 是 | FAILED / progress 100% | 分辨率低于官方建议值，不作为最终判断 |
| 图片 + prompt | 4:3，1448×1086，模型 WebP 变体 | 是 | FAILED / progress 100% | 满足尺寸要求 |
| 仅图片 | 同一 4:3 WebP | 是 | FAILED / progress 100% | 排除 prompt 与图片组合问题 |
| 仅图片 | 同一资产的 2.27MB 原始 PNG | 是 | FAILED / progress 100% | 排除模型变体压缩与 WebP 格式问题 |
| 仅文本 | 不上传图片 | 是 | FAILED / progress 100% | 排除图片、媒体存储和 OUS 为共同根因 |

初次 OpenAPI 诊断时账号列表只包含本轮失败任务；随后网页端任务成功后，公开 World list/detail 已可读到该成功记录及完整 pano、SPZ、PLY、LOD 产物。

## 网页成功 World 的安全导入验证

新增操作员命令 `npm run spatial:world:import-web`，用于把账号中已经成功的网页 World 接入 Pegasus Spatial。它不读取浏览器 cookie，不调用网页私有创建接口，也不会新建或重新提交供应商任务；它只使用公开 World list/detail 读取既有成功记录，然后走现有的下载校验、持久 staging、Workspace 原子发布和 Scene Revision 逻辑。

本轮真实结果：

- World Job 已发布，包含全景图、SPZ、PLY、LOD metadata 与 manifest；
- SPZ 为 6,678,571 bytes，PLY 为 30,169,908 bytes，所有文件均记录 MIME、SHA-256 和不可变 Workspace revision；
- 创建 `极简会客大厅混合 Scene`，当前版本为 v1，World source 固定指向已发布 Job；
- 同一命令重放返回同一 Job、同一 Scene v1，`replayed=true`，没有重复下载、重复发布或新增 revision；
- 导入过程没有新增 Aholo 生成任务，也没有新的积分消耗。

这条旁路的用途是解除混合 Viewer 的开发阻塞，不替代公开创建 API。产品中的 `CreateWorld3D` 仍只使用公开契约；网页私有两阶段接口继续仅作为诊断证据，不进入 Agent 工具面。

### 本地 Viewer 实测与 SDK 兼容修复

导入后的真实 SPZ 已在 Pegasus Spatial 空间舞台中完成浏览器实测。初次接入暴露了两个与供应商生成无关的 Viewer 兼容问题：

1. `@manycore/aholo-viewer@1.8.1` 的 SPZ/PLY 解码、排序与转码 worker 默认通过 Blob URL 包装 module worker；当前内嵌浏览器环境中 worker 启动错误不会被 SDK promise 传播，表现为 `parseSplatData` 永久 pending；
2. SDK worker pool 使用 `hardwareConcurrency - 1`，在只报告一个硬件线程的环境中会得到零 worker。

项目现已精确锁定 `1.8.1`，并在 `postinstall` 执行可重复、签名校验严格的安装补丁：三个 worker 改为直接加载 SDK 自带 module worker URL，worker pool 最小值改为一。补丁对未知 SDK 文件签名 fail closed，避免静默修改未来版本。Viewer 自身另有 60 秒解码超时，避免加载异常时界面永久停留在“正在构建”。

补丁后真实 6.37 MiB SPZ 成功解码、绘制并进入 ready。另一个可见问题是初始相机不能把全景型 3DGS 当成普通外部模型从包围盒外向内观察；Aholo AI World 以拍摄中心为原点，外部视角会看到不可读的高斯外壳。当前规则会检测主包围盒是否包含捕获原点：包含时从 `[0, 0, 0]` 向前初始化；不包含时才使用普通包围盒 framing。真实舞台复测已显示可辨识的室内落地窗场景，Camera 为捕获原点。

## 本轮保留的代码修正

Aholo World 现在读取经 Workspace 授权的不可变 `original` 图片变体，而不是面向多模态模型上下文优化的 `model` 变体。

这不是本次服务端失败的根因，但仍是正确的质量边界：本次同一资产的 `model` 变体为 184KB WebP，`original` 为 2.27MB PNG。World 生成依赖源图纹理与空间细节，不应复用高压缩的 LLM 输入变体。

## 测试图片

- `fixtures/spatial/world-reference-interior-v2.png`
- 1448×1086，4:3 PNG，短边 1086
- 无人物、横版、直线广角室内、均匀光照
- Workspace：`output/spatial/images/world-reference-interior-v2.png`

它满足 Aholo 官方教程列出的主要输入要求。官方教程说明图片是主要驱动力，并建议横版、无人、广角、光线均匀、短边至少 1024：

- https://studio.aholo3d.cn/resources/tutorials/how-to-create-3d-world-ai-spatial-gen

## 给 Aholo / 主办方的最小问题单

> 使用赛事账号创建 AI 空间生成 World 时，API Key 鉴权、官方 OUS 上传和 `/world/v1/generations` 创建均成功。图片+提示词、仅图片、仅文本三种输入都能进入 RUNNING，但 19–40 秒后统一变为 FAILED；`progress=1.0`（100%），详情不返回 message/code/error，assets 全空，积分均先扣 10 后失败退回 10。同一 Key 的 Asset、World read 和 Lux list 均正常。请核对该账号的 API SpatialGen feature flag/路由、生成服务日志与最终产物质检/发布日志。我们可以私下提供 6 个 World ID 和精确创建时间用于定位。

不要在公开 issue、仓库、演示日志或聊天截图中发布 API Key、原始 World ID、供应商临时资产 URL或 OUS token。

## 恢复条件

最优先的二分测试是在 Aholo 网页端用同一账号、同一张原图创建一次：

- 网页端成功、OpenAPI 失败：锁定 API SpatialGen 路由/feature flag；
- 网页端也失败：锁定账号级能力或生成后端故障；
- 网页端返回可见错误：把错误文案连同 World ID 一并交给技术支持。

Aholo 确认账号权限或服务恢复后，再使用一个新的 Operator phase/purpose 发起一次最小 smoke。成功标准：

1. World 最终状态为 `SUCCEEDED`，而不是在 progress 100% 后转为 `FAILED`；
2. 最终返回 pano 与至少一种 splat 产物（SPZ/PLY/LOD）；
3. 从实际产物 URL 提取精确 hostname，写入 `AHOLO_ASSET_HOST_ALLOWLIST`；
4. 恢复同一已知外部任务完成镜像与 Workspace 发布，不重复提交；
5. 在混合 Viewer 中打开真实 World。

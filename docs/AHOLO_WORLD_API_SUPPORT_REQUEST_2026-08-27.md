# Aholo AI World 公开 API 创建失败问题单

日期：2026-08-27
产品：Aholo AI 空间生成 / World API
影响：公开 API 无法创建可用的 AI World；同账号网页端可以完成全景与 3DGS

## 1. 希望协助确认的问题

同一个 Aholo 账号、API Key 和赛事额度下：

- 网页端 AI 空间生成可以先生成可旋转全景，再由用户点击“开始高斯生成”，最终得到 SPZ、PLY 与 LOD；
- 公开 `POST /world/v1/generations` 可以返回 World ID，任务也会进入运行态，但所有正式受理的 `ai_gen` 任务都很快转为 `FAILED`；
- 失败任务没有生成 `panoUrl`，也没有任何 splat 产物；公开详情未返回错误码、错误消息或 trace ID；
- 每次任务均先扣除 10 积分，失败后退回 10 积分。

请协助确认：公开 World generation 是否应自动完成“源图/文本 → 全景 → 3DGS”的两阶段编排？当前赛事账号是否缺少 API SpatialGen feature flag，或者公开创建路由存在服务异常？

## 2. 期望行为与实际行为

### 期望行为

依据公开 OpenAPI、官方 SDK 与官方 Skill，客户端调用一次：

```http
POST https://api.aholo3d.cn/world/v1/generations
Authorization: <redacted>
Content-Type: application/json
x-source: skills
```

服务端接受 `prompt` 和/或至多一张已通过官方资产模块上传的图片，并异步生成 World。成功终态应包含全景图及至少一种 splat 产物。

### 实际行为

所有被正式受理的公开 API 任务最终表现一致：

```json
{
  "status": "FAILED",
  "progress": 1,
  "scene": "ai_gen",
  "message": null,
  "code": null,
  "assets": {
    "imagery": null,
    "splats": null,
    "semantics": null
  }
}
```

公开响应未提供可用于客户端定位的 failure reason 或 request/trace ID。

## 3. 已完成的对照测试

| 用例 | 输入 | 创建是否返回 World ID | 终态 | 产物 |
|---|---|---:|---|---|
| 纯文本 | 宽敞室内展厅 prompt | 是 | FAILED / progress=1 | 无 pano、SPZ、PLY、LOD |
| 图片 + prompt | 16:9 PNG，短边 941 | 是 | FAILED / progress=1 | 全空 |
| 图片 + prompt | 4:3，1448×1086 WebP | 是 | FAILED / progress=1 | 全空 |
| 仅图片 | 同一 4:3 WebP | 是 | FAILED / progress=1 | 全空 |
| 仅图片 | 同一图片的 2.27 MB 原始 PNG | 是 | FAILED / progress=1 | 全空 |
| 网页端同账号 | 网页先生成全景，再点击生成高斯 | 是 | SUCCEEDED | pano、SPZ、PLY、LOD 均存在 |

此外，最初直接传递普通 HTTPS 文件 URL 时，公开接口正确返回：

```text
文件链接不对，请使用 资产 模块相关接口上传文件
```

随后我们完全按照官方资产流程接入：

1. `GET /asset/v1/token` 获取 OUS 上传凭证；
2. 使用 MD5、multipart `file` 和 `ous-token-v2` 上传；
3. 轮询 OUS 状态到 `5`；
4. 将资产模块返回的 URL 放入 `resources: [{ type: "image", url }]`；
5. 再调用 `POST /world/v1/generations`。

修正后创建请求被正式受理并返回 World ID，因此普通文件 URL 问题已经排除，不是当前失败的原因。

## 4. 同账号网页端成功对照

网页端流程显示两个明确阶段：

1. 源图生成 360° 全景；
2. 用户确认全景后点击“开始高斯生成”。

在网页任务处于中间阶段时，使用同一 API Key 调用公开只读详情接口，可以观测到：

```text
status = RUNNING
progress = 0.6
panoUrl = present
SPZ / PLY / LOD = absent
```

网页任务最终完成后，公开详情变为：

```text
status = SUCCEEDED
progress = 1
panoUrl = present
spzPath = present
plyPath = present
lodMetaPath = present
```

这证明以下能力在同一账号上实际可用：

- 赛事额度与账号权限；
- 全景生成；
- 3DGS 生成；
- World list/detail 读取；
- 最终资产下载。

故障范围更接近公开创建路由、API 专属 feature flag，或公开接口对两个生成阶段的自动衔接，而不是账号整体不可用。

## 5. 其他正常能力

- `POST /world/v1/list`：成功；
- `GET /world/v1/{worldId}`：成功；
- `GET /asset/v1/token` 与官方 OUS 上传：成功；
- Lux3D task list 与真实 Lux3D GLB/PLY 生成：成功；
- 无效 Key 控制组：能够稳定返回 `invalid appKey`；
- 网页端成功 World 的 SPZ/PLY 已通过公开详情读取，并在我们的 Aholo Viewer 中完成真实渲染。

## 6. 已排除的客户端因素

- API Key 无效或额度不足；
- 整体 API 网关故障；
- 普通远程图片 URL 未走资产模块；
- 图片尺寸、PNG/WebP 格式或压缩变体；
- prompt 导致失败；
- 图片导致失败；
- Pegasus 重复提交：每个 Operator intent 只提交一次，后续只轮询已知 World ID；
- 3DGS 服务整体不可用：同账号网页任务已经成功生成完整 splat。

## 7. 希望 Aholo 工程团队核查

1. 私密附件中的 6 个 World ID 对应服务端创建、全景、自动阶段衔接、质检与发布日志；
2. 赛事账号/API Key 是否缺少仅影响公开 AI World creation 的 product entitlement 或 feature flag；
3. `POST /world/v1/generations` 是否应自动完成网页端所示的两个阶段；
4. 是否存在公开 API 创建 AI World 的已知事故、队列路由差异或输入策略变更；
5. 为什么失败终态统一为 `progress=1`，但 `message/code` 与全部 assets 为空；
6. 能否在公开详情中增加稳定的 failure code、failure reason 与 trace/request ID；
7. 如果公开接口目前不负责自动两阶段编排，能否提供或正式公开以下能力：
   - 创建/重新生成全景；
   - 确认全景并启动 3DGS；
   - 查询两个阶段的独立状态。

## 8. 最小复现请求

以下示例省略真实 Key 和资产 URL：

```bash
curl -X POST 'https://api.aholo3d.cn/world/v1/generations' \
  -H 'Authorization: <API_KEY>' \
  -H 'Content-Type: application/json' \
  -H 'x-source: skills' \
  --data '{
    "name": "API World reproduction",
    "prompt": "宽敞的当代室内展厅休息区，中央天窗，清晰纵深，开放动线，无人，光线均匀。",
    "resources": []
  }'
```

图片用例中的 `resources[0].url` 来自官方资产模块上传完成后的响应，不是任意第三方 URL。

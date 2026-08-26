# Pegasus Spatial 隔离契约

## 固定命名空间

| 层 | Pegasus Spatial 值 |
|---|---|
| npm / Compose project | `pegasus-spatial` |
| Web | `3200` |
| Mongo host | `127.0.0.1:27019` |
| Mongo database | `pegasus_spatial` |
| Internal workspace | `.sci-pegasus/` |
| Auth cookies | `pegasus-spatial.*` / `__Secure-pegasus-spatial.*` |
| Browser active conversation | `pegasus_spatial_active_conversation_id` |
| Internal HMAC headers | `x-pegasus-spatial-agent-runner-*` |
| Docker network/volumes | `pegasus-spatial-*` |
| GridFS media bucket | `pegasus_spatial_media` |
| OSS object prefix | `NEXT_PUBLIC_PEGASUS_SPATIAL_MEDIA_PREFIX=pegasus-spatial/raster-assets` |

## 强制规则

- `MONGODB_URI` 没有默认回退；运行脚本也必须显式提供 URI。
- durable runner 使用独立的 `AGENT_RUNTIME_INTERNAL_SECRET`，不回退复用 `AUTH_SECRET`。
- 不复制 Pegasus 的 `.env`、数据库、volume、Cookie、对象存储 bucket/prefix 或内部密钥。
- OSS 前缀不是密钥，必须由 server/browser 共用的 `NEXT_PUBLIC_PEGASUS_SPATIAL_MEDIA_PREFIX` 定义；旧私有变量与其不一致时启动失败。
- Docker Compose 把 Mongo 只映射到 host loopback 的 `27019`，并使用独立 volume。
- `_archive/`、`_temp/` 和根目录旧镜像包不进入 Docker build context，也不应进入未来版本控制。

若未来需要迁移 Pegasus 中的真实数据，应另写显式、可审计、一次性的迁移程序；不要通过连接同一数据库实现“临时兼容”。

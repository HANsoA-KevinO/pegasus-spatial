# Pegasus Spatial

**Pegasus Spatial** is a natural-language spatial creation agent that can choose among image generation, 3D object creation, Aholo World generation, and reality reconstruction capabilities.

The product has one conversational entry point and no object/world mode selector. Provider APIs remain independent tools; the Agent chooses the smallest useful combination, tracks durable external jobs, preserves asset lineage, and exposes inspectable outputs.

The default Project Guide is `spatial-creation@1`, and its default Skill catalog contains only `spatial-creation`. The inherited `materials-discovery@1` guide and research Skills remain in the repository for explicit legacy use but are not part of a new spatial project's default surface.

## V1 tools

- `GenerateImage`: text-to-image and single-image editing through the single
  NewAPI Chat Completions route, using the exact model alias `GPT-image-2`.
- `CreateObject3D`: text/image to a mirrored Lux3D GLB artifact.
- `CreateWorld3D`: text/single image to an Aholo World job.
- `GetSpatialJob` / `WaitSpatialJob`: observe a known durable external job without resubmitting it.
- `InspectSpatialArtifact`: inspect published assets, manifests, and lineage.
- Image viewing, GLB orbit preview, and Aholo World manifest/open affordances.

Paid spatial tools are Root-only and fail closed unless `SPATIAL_PAID_CALLS_ENABLED=1`. External job idempotency is scoped by `project_id + run_id + tool_use_id`; ambiguous submissions enter `unknown` and are never automatically replayed.

## Isolation

- App/package/Compose namespace: `pegasus-spatial`
- Web: `http://localhost:3200`
- Mongo: `127.0.0.1:27019/pegasus_spatial`
- GridFS bucket: `pegasus_spatial_media`
- OSS prefix: `NEXT_PUBLIC_PEGASUS_SPATIAL_MEDIA_PREFIX=pegasus-spatial/raster-assets`
- Auth cookies and Docker resources use the `pegasus-spatial` namespace.

The internal virtual Workspace path remains `.sci-pegasus/` for compatibility with the tested CAS/version/ACL implementation. Database, media, cookies, networks, and volumes are isolated from Sci-Pegasus.

## Start and verify

```bash
cp .env.example .env.local
# Replace secrets and add provider credentials.
docker compose up -d mongo
npm install
npm run dev
```

Open `http://localhost:3200`. Do not enable paid calls before completing live provider smoke tests.

`GenerateImage` reuses `LLM_BASE_URL` and `LLM_API_KEY_TOOLS`; it does not use
`OPENAI_API_KEY` or a runtime provider selector. The NewAPI base URL must not
contain embedded credentials, a query string, or a fragment. Paid/production
configuration requires HTTPS. Plain HTTP is accepted by startup only for a
non-production loopback URL and is never considered paid-ready by the readiness
check.

The OSS object prefix is the non-sensitive, intentionally public
`NEXT_PUBLIC_PEGASUS_SPATIAL_MEDIA_PREFIX`. Server writers, server URL builders,
and browser CDN URLs all consume that one value. Leading/trailing slashes and
path-traversal segments are rejected. The legacy private variable may coexist
only when its value is exactly equal; a mismatch fails startup.

For a legacy public-HTTP NewAPI, local development may explicitly set
`PEGASUS_SPATIAL_ALLOW_INSECURE_NEWAPI_HTTP=1`. This is an unsafe escape hatch,
never passes paid readiness, and remains rejected in production.

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

The five spatial Agent behavior cases under `evals/spatial-creation/` are
definition-only CI contracts. They deliberately allow different useful tool
combinations and must be replayed with the frozen live model before the demo;
their presence is not a claim that live provider behavior has passed.

V1 does not claim OpenUSD scene compilation, object-level Aholo writeback, CAD precision, real scale, collision correctness, path planning, or physical simulation. See [UPSTREAM.md](UPSTREAM.md) before redistribution; no authoritative license file was inherited.

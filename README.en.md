# Pegasus Spatial

**Pegasus Spatial** is a natural-language spatial creation agent that can choose among image generation, 3D object creation, Aholo World generation, and reality reconstruction capabilities.

The product has one conversational entry point and no object/world mode selector. Provider APIs remain independent tools; the Agent chooses the smallest useful combination, tracks durable external jobs, preserves asset lineage, and exposes inspectable outputs.

The default Project Guide is `spatial-creation@1`, and its default Skill catalog contains only `spatial-creation`. The inherited `materials-discovery@1` guide and research Skills remain in the repository for explicit legacy use but are not part of a new spatial project's default surface.

## Judge demo

This is a **judge-safe review mode** for pre-generated, persisted results. The
competition machine has these one-time prerequisites:

- Docker Desktop or Docker Engine is installed, its daemon is running, and the
  current user can access it.
- Docker Compose v2 is installed, and the official `mongo:7` image is cached or
  can be pulled.
- `npm install` and `.env.local` setup are complete, with
  `SPATIAL_PAID_CALLS_ENABLED=0`.

After those prerequisites, the demo starts with one command:

```bash
npm run demo:up
```

The command checks Docker/Compose and safe configuration; starts and waits for
isolated local persistence; then launches the web app on loopback. Judges open
`http://localhost:3200` directly. There is no login, registration, invite code,
password, database client, or database credential to manage.

```bash
npm run demo:status   # configuration, persistence, and web health; no secrets
npm run demo:down     # stops services without deleting the Mongo volume
```

Demo startup refuses missing configuration, remote Mongo targets, any existing
listener on port 3200, or any setting other than
`SPATIAL_PAID_CALLS_ENABLED=0`. That flag blocks **new paid spatial
submissions**. A persisted job with a known external ID may still resume
polling/materialization, and ordinary chat may still use configured NewAPI; do
not send a new chat prompt during a zero-external-call review.

`demo:up` does not claim that live natural-language generation is enabled. Live
generation is a team-controlled startup after the H0 download-host allowlists,
provider operator smoke tests, and budget authorization pass. It is not part of
the judge-safe one-command review mode.

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
- OSS prefix: `NEXT_PUBLIC_PEGASUS_SPATIAL_MEDIA_PREFIX=raster-assets/pegasus-spatial`
- Browser access has no account/session cookie and uses one fixed local Demo owner.

The internal virtual Workspace path remains `.sci-pegasus/` for compatibility with the tested CAS/version/ACL implementation. Database, media, cookies, networks, and volumes are isolated from Sci-Pegasus.

## Start and verify

```bash
cp .env.example .env.local
# Replace secrets and add provider credentials.
npm install
docker compose up -d mongo
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
npm run spatial:verify:demo-e2e
npm run tool-contracts:verify
npm run multi-agent:verify
npx tsc --noEmit
npm run lint
npm run build
```

`spatial:verify:demo-e2e` uses a randomly named loopback-only temporary
database and terminal fixtures. It verifies direct local access, internal owner
isolation, Spatial Job UI/API, refresh, and web-process restart recovery
without sending chat, model, Aholo, or Lux3D requests. Only that guarded test
database is removed afterward.

The account-free build is for a single-machine competition Demo only. The app
binds to `127.0.0.1`; exposing it to a LAN or the public Internet requires an
authenticated access-control gateway.

The five spatial Agent behavior cases under `evals/spatial-creation/` are
definition-only CI contracts. They deliberately allow different useful tool
combinations and must be replayed with the frozen live model before the demo;
their presence is not a claim that live provider behavior has passed.

V1 does not claim OpenUSD scene compilation, object-level Aholo writeback, CAD precision, real scale, collision correctness, path planning, or physical simulation. See [UPSTREAM.md](UPSTREAM.md) before redistribution; no authoritative license file was inherited.

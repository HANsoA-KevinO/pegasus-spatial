# Pegasus Spatial

> 🏆 **VentureD Hackathon 2026 · Deep Space Disrupt Award — Deep Space Track Champion**
>
> August 2026, Hangzhou · Deep Space track supported by Manycore Tech · Competition project name: Spatial Pegasus.

**Pegasus Spatial** is a natural-language **AI World Compiler and spatial creation workspace**. A multimodal Agent interprets text, reference images, and spatial constraints to turn ideas into concept art, independent 3D assets, and editable scenes.

Three.js source and immutable builds preserve scene truth, provenance, and revision history. Users browse, select, and send screenshot feedback; the Agent edits source and checks engineering views and actual mesh measurements.

The project is moving toward **memory-space reconstruction**: turning a few old photographs and spoken memories into spaces people can enter. Hybrid modelling and the Agent observation/edit loop are being developed; unseen geometry and uncertain recollections are distinguished from known facts.

Through one conversation, the Agent combines procedural geometry, generated Lux3D assets, panoramas, optional Aholo World backgrounds, scene editing, and rendered observations.

## Highlights

- Generate concept art and asset references from text or Workspace images.
- Author multi-file Three.js geometry, CSG, curves, instances, procedural textures, shaders, and animations alongside GLB assets.
- Generate complex GLB assets with Lux3D, with independent selection and transforms.
- Combine 2:1 panoramic environments with editable GLB assets; optionally explore Aholo World 3DGS backgrounds from fixed viewpoints.
- Execute frozen builds in an isolated Worker and bundled Chromium service, including when the user stage is closed.
- Inspect labelled engineering views, mesh distances, support samples, intersections, and reserved clearances.
- Browse and select without direct editing; publish checked builds atomically against retained requirements and restore revision history.
- Capture real rendered viewpoints and continue editing from visual feedback.
- Query actual GLB mesh surfaces to guide object placement on terrain.
- Run long 3D jobs asynchronously and resume the Agent when results arrive.
- Prevent duplicate paid submissions with durable receipts and explicit `unknown` states.

## Quick local setup

Requirements: Node.js 20+, npm 10+, Docker, and Docker Compose v2.

```bash
git clone https://github.com/HANsoA-KevinO/pegasus-spatial.git
cd pegasus-spatial
npm install
cp .env.example .env.local
```

Configure at least the model gateway and spatial providers in `.env.local`:

```env
LLM_BASE_URL=https://your-newapi.example.com/v1
LLM_API_KEY_ORCHESTRATOR=...
LLM_API_KEY_TOOLS=...
SCENE_CODE_RENDERER_TOKEN=an-independent-random-secret-of-at-least-24-characters
AGENT_RUNTIME_INTERNAL_SECRET=another-independent-random-secret-of-at-least-32-characters
CRON_SECRET=a-third-independent-random-secret
```

Then start the local stack:

```bash
npm run local:up
```

Open `http://localhost:3200`.

```bash
npm run local:status   # configuration, Mongo, and Web health without secrets
npm run local:down     # stop services while preserving the local data volume
```

For direct development logs:

```bash
npm run dev
```

The predev hook starts MongoDB and the rendering service. Set
`SCENE_CODE_CHROMIUM_EXECUTABLE_PATH` to use an installed native Chromium instead
of the rendering container. Configure Aholo / Lux3D only when generating assets;
source modelling and importing existing GLB assets do not require paid generation.

For a containerized deployment:

```bash
cp .env.example .env.production
# Fill in production credentials and HTTPS endpoints.
docker compose --env-file .env.production up --build -d
```

The application uses a local single-user mode and listens on loopback by default. Put an authenticated HTTPS gateway in front of it before exposing it to a LAN or the public Internet. See [Deployment](docs/DEPLOYMENT.md) for the complete configuration.

## Main Agent tools

- `GenerateImage`
- `CreateObject3D`
- `CreateWorld3D`
- `GetSpatialJob` / `WaitSpatialJob`
- `InspectSpatialArtifact`
- `CreateSpatialScene` / `InspectSpatialScene`
- `PrepareSceneCode` / `RunSceneCode` / `InspectSceneBuild`
- `RenderSceneViews` / `QuerySceneGeometry` / `CheckSceneConstraints`
- `PublishSceneBuild` / `ExportSceneBuild`
- `RestoreSpatialScene`
- `SetSceneViewpoint` / `FocusSceneObject` / `CaptureSceneView`
- `QuerySceneSurface`

The system uses Three.js source throughout. Creating a Scene prepares its code project. Declarative edit tools are retired; old scenes are not automatically migrated. Existing assets can be explicitly imported into a new project. See [Scene system](docs/SCENE_SYSTEM.md) for execution, observation, and verification boundaries.

External 3D generation uses a durable queue. The tool queues the job locally and returns its ID and current status. A background worker submits it to the provider, persists the external task ID, polls, validates, mirrors, publishes, and reports the finished artifact. A `prepared` status means the job is queued; it does not yet establish provider acceptance.

## Workspace outputs

```text
output/spatial/images/
output/spatial/objects/<build-id>/
output/spatial/worlds/<build-id>/
output/spatial/scenes/<scene-id>/
output/spatial/builds/<build-id>/
output/spatial/reviews/<observation-id>/
```

Every successful scene mutation creates a new immutable revision. Concurrent updates use CAS, and restored history is written as a new revision rather than overwriting the past.

## Verification

```bash
npm run project-prompt:verify
npm run spatial:verify
npm run spatial:verify:mongo
npm run spatial:verify:local-e2e
npm run tool-contracts:verify
npm run multi-agent:verify
npx tsc --noEmit
npm run lint
npm run build
npm audit --audit-level=high
```

These checks do not submit paid provider jobs. Run live provider smoke tests separately after reviewing configuration and cost.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Multi-Agent runtime contract](docs/AGENT_TEAM_V1.md)
- [Spatial Scene system](docs/SCENE_SYSTEM.md)
- [Upstream provenance](UPSTREAM.md)

## Scope

The current release does not claim CAD precision, real-world metric scale, collision correctness, physics simulation, or OpenUSD scene compilation. Panoramas provide an infinitely distant visual environment. Aholo World is an optional experiment in volumetric backgrounds for fixed viewpoints, without guarantees of local semantic editing or freely navigable scene geometry. Editable structure consists of procedural meshes, independent GLB instances and Scene Revisions.

## License

No open-source license is currently declared for this repository. Redistribution under MIT, Apache-2.0, or another open-source license requires explicit permission from the project owner.

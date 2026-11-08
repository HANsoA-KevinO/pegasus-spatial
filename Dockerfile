# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Pegasus Spatial production image — Next.js 16 standalone output.
# Three stages: deps → builder → runner.
#
# Debian glibc is used because `sharp` prebuilt
# binaries are linux-glibc; alpine's musl needs extra `libc6-compat` work.
# ---------------------------------------------------------------------------

# =============================================================================
# Stage 1 · deps — install npm dependencies in a clean layer that only changes
# when package.json / package-lock.json change.
# =============================================================================
FROM node:22-trixie-slim AS deps
WORKDIR /app

ENV NPM_CONFIG_LOGLEVEL=warn

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

# =============================================================================
# Stage 2 · builder — compile the Next.js standalone bundle.
# =============================================================================
FROM node:22-trixie-slim AS builder
WORKDIR /app

# Only public browser configuration belongs in build arguments. Provider and
# database credentials are injected at runtime through the private env file.
ARG NEXT_PUBLIC_MEDIA_CDN_BASE_URL
ARG NEXT_PUBLIC_PEGASUS_SPATIAL_MEDIA_PREFIX

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_MEDIA_CDN_BASE_URL=$NEXT_PUBLIC_MEDIA_CDN_BASE_URL \
    NEXT_PUBLIC_PEGASUS_SPATIAL_MEDIA_PREFIX=$NEXT_PUBLIC_PEGASUS_SPATIAL_MEDIA_PREFIX

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `next.config.ts` already declares `output: 'standalone'`, so the build emits
# .next/standalone/{server.js, node_modules/...} with only runtime deps.
RUN npm run build -- --webpack

# =============================================================================
# Stage 3 · runner — minimal production image.
# =============================================================================
FROM node:22-trixie-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3200

# Sharp ships its platform libvips dependency. tini forwards signals and reaps
# child processes; curl is used by the readiness probe.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tini \
      curl \
 && rm -rf /var/lib/apt/lists/*

# Run as a dedicated non-root user.
RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nextjs

# Copy standalone bundle. The `.next/standalone/` directory contains a
# self-contained app (server.js + minimum node_modules + necessary code).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/config ./config

USER nextjs
EXPOSE 3200

# Health check — calls /api/health which exercises the Mongo connection.
# Container is marked unhealthy if the endpoint can't be reached.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3200/api/health || exit 1

# `tini` reaps zombies and forwards SIGTERM cleanly to node, so
# instrumentation-node.ts's graceful shutdown path runs.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]

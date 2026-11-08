import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Independent dev cache for the isolated live gateway/recovery acceptance.
  distDir: process.env.PEGASUS_TEST_DIST_DIR || '.next',
  devIndicators: false,
  // ali-oss is a Node-only storage client. Keeping it external also avoids
  // Turbopack eagerly resolving urllib's optional proxy-agent lazy import;
  // proxy support is not enabled by this application.
  serverExternalPackages: ['ali-oss', 'esbuild'],
  outputFileTracingIncludes: { '/*': ['./lib/scene-code/runtime/**/*', './lib/spatial/object-alignment.ts', './node_modules/three/**/*', './node_modules/@sparkjsdev/spark/**/*', './node_modules/three-bvh-csg/**/*', './node_modules/three-mesh-bvh/**/*', './node_modules/esbuild/**/*', './node_modules/@esbuild/**/*'] },
  // Standalone output trims ~500MB image down to ~150MB by bundling only the
  // node_modules actually imported at runtime. The Dockerfile COPYs from
  // .next/standalone/ instead of the whole project.
  output: 'standalone',
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
};

export default nextConfig;

# mediasoup's postinstall downloads a prebuilt worker keyed on the BUILD HOST's kernel
# major (only kernel-6/7 assets exist upstream) and its smoke test fails on musl — so
# build on a kernel-6+ host and keep the base Debian, never alpine.

FROM oven/bun:1.3.14-slim AS base
WORKDIR /app

FROM base AS manifests
COPY package.json bun.lock bunfig.toml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/e2e/package.json apps/e2e/
COPY packages/api/package.json packages/api/
COPY packages/auth/package.json packages/auth/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/env/package.json packages/env/
COPY packages/ui/package.json packages/ui/

# ---- build: SPA + bundled server ---------------------------------------------------
FROM manifests AS build
# --ignore-scripts: nothing here executes mediasoup; runtime-deps runs its postinstall.
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
# VITE_SERVER_URL stays unset (.env files are dockerignored) → same-origin dist/.
RUN bun run --filter web build
# --splitting keeps boot.ts's deferred `import("./index")` lazy (see boot.ts docstring);
# NODE_ENV is inlined at build time — unset would bake in the logger's pino-pretty branch.
# --sourcemap is deliberate: readable stack traces from self-hosters' bug reports are
# worth the ~5MB of .map files.
RUN NODE_ENV=production bun build apps/server/src/boot.ts \
  --target=bun --splitting --minify --sourcemap \
  --outdir apps/server/dist \
  --external mediasoup --external @libsql/client --external libsql

# ---- runtime-deps: the unbundleable native packages --------------------------------
FROM base AS runtime-deps
COPY apps/server/package.json /tmp/server.json
COPY packages/db/package.json /tmp/db.json
# No lockfile in this stage — the guard rejects range versions so the three top-level
# packages can't drift (their transitive deps still resolve fresh each build).
RUN bun -e "const server = await Bun.file('/tmp/server.json').json(); \
  const db = await Bun.file('/tmp/db.json').json(); \
  const deps = { \
    mediasoup: server.dependencies.mediasoup, \
    '@libsql/client': db.dependencies['@libsql/client'], \
    libsql: db.dependencies.libsql, \
  }; \
  for (const [name, version] of Object.entries(deps)) { \
    if (!/^\d/.test(version ?? '')) throw new Error(name + ' must be pinned exactly, got: ' + version); \
  } \
  await Bun.write('package.json', JSON.stringify({ name: 'konus-la-runtime', \
    dependencies: deps, trustedDependencies: ['mediasoup'] }, null, 2));"
RUN bun install
# A missing/non-executable worker means the postinstall compiled from source or 404'd.
RUN test -x node_modules/mediasoup/worker/out/Release/mediasoup-worker

# ---- runtime -----------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/konus.db
# boot.ts reads the root version for backup filenames.
COPY package.json ./
COPY --from=runtime-deps /app/node_modules node_modules
COPY --from=build /app/apps/server/dist apps/server/dist
# The bundled migrate.ts resolves `migrations/` next to the bundle.
COPY --from=build /app/packages/db/src/migrations apps/server/dist/migrations
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT??3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["bun", "apps/server/dist/boot.js"]

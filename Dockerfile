# Build-host constraint: mediasoup's postinstall downloads a prebuilt worker whose
# tarball name is keyed on the BUILD HOST's kernel major, and only kernel-6/7 assets
# exist upstream. CI builds on ubuntu-24.04 (kernel 6); an older local kernel makes the
# postinstall silently fall back to a source compile, which the `test -x` guard below
# turns into a loud build failure.
#
# Debian slim, never alpine: the prebuilt worker's smoke test fails on musl and also
# falls back to a source compile. The image ships the workspace and runs TS source
# directly — mediasoup forces node_modules into the image anyway, so bundling or
# `--compile` buys nothing.

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

# ---- web-build: bake the same-origin SPA -------------------------------------------
FROM manifests AS web-build
# --ignore-scripts: the only trusted postinstall is mediasoup's worker download, which
# the web build doesn't need.
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
# VITE_SERVER_URL stays unset (.env files are dockerignored) → same-origin dist/.
RUN bun run --filter web build

# ---- install: production node_modules + prebuilt mediasoup worker ------------------
FROM manifests AS install
RUN bun install --frozen-lockfile --production
# Isolated linker (bunfig.toml): mediasoup resolves under apps/server/node_modules,
# symlinked into the root .bun store. A missing or non-executable worker binary means
# the postinstall compiled from source or 404'd — fail the build loudly.
RUN test -x apps/server/node_modules/mediasoup/worker/out/Release/mediasoup-worker
COPY . .

# ---- runtime -----------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/konus.db
COPY --from=install /app ./
COPY --from=web-build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT??3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["bun", "apps/server/src/boot.ts"]

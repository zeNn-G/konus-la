# Phase 8 — deployment

Implementation spec, distilled from wayfinder map
[#98](https://github.com/zeNn-G/konus-la/issues/98). Accompanied by
[ADR 0009](../adr/0009-single-image-single-port-deployment.md) (single image +
single-port media), which supersedes the ROADMAP's "bun-server + caddy compose stack *is*
the deployment" framing and the `40000–40100` media port range. Three research docs fix
the load-bearing external facts: [WebRtcServer single-port media](../research/webrtcserver-single-port.md)
([#99](https://github.com/zeNn-G/konus-la/issues/99)),
[Dokploy/Coolify deploy paths](../research/platform-deploy-paths.md)
([#100](https://github.com/zeNn-G/konus-la/issues/100)), and the
[changesets release flow](../research/changesets-release-flow.md)
([#101](https://github.com/zeNn-G/konus-la/issues/101)).

## Scope

**In:** one public Docker image (`ghcr.io/zenn-g/konus-la`, amd64+arm64) serving SPA +
API + WS + mediasoup on `:3000`, media on one UDP+TCP port; in-process TS boot sequence
(secret → IP detect → pre-migration backup → migrate → serve); same-origin SPA serving;
`deploy/` compose recipe (app + Caddy + optional Watchtower); Dokploy & Coolify guides;
changesets release pipeline (version PR → `v*` tag → chained image build, first release
`v1.0.0`); CI gate; smoke-test runbook; README "Self-Host" section.

**Out (per map):** Kubernetes / any orchestrator · TURN / coturn (revisit on real
connection failures — clients only dial the SFU outbound, TCP fallback rides the media
port; docs get a troubleshooting note) · backups beyond pre-migration snapshots +
"copy the file" · staging environments · image signing / SBOM / provenance · tegami ·
Web Push / PWA install · split web/API hosting (the `VITE_SERVER_URL` build-time
override keeps it *possible* for power users; unsupported in v1 docs).

## Deployment model — charter

One image is the whole product (Sharkord-style). It serves the SPA, the ORPC API, the
WS realtime channel, and mediasoup media from a single container on plain HTTP `:3000`.
TLS is the host's concern: raw VPSs pair it with Caddy via the shipped compose file;
Dokploy/Coolify run the bare image behind their own Traefik. Updates are
**stop-and-swap** — the host-published media port forbids start-first/rolling updates on
every target platform, and voice rooms are in-memory by design
([ADR 0007](../adr/0007-voice-in-memory-rooms-ws-seats.md)), so seconds of downtime per
update is the accepted contract. Same volume/DB survives the swap.

## Precursor PR — `WebRtcServer` single-port media

Lands as an ordinary PR to `main` **before Phase 8 build issues are cut** (before or in
parallel with this spec PR). Not a build issue: the Dockerfile, compose file, platform
guides, and firewall docs all hard-commit to "publish exactly one media port", so the
switch must be merged fact, not speculation. Full detail in the
[research doc](../research/webrtcserver-single-port.md); the shape:

- `worker.createWebRtcServer({ listenInfos: [udp, tcp] })` — both entries on
  `MEDIA_PORT` (default `40000`), `ip: "0.0.0.0"`, `announcedAddress: PUBLIC_IP`. All
  transports of the worker multiplex over that one UDP+TCP port pair (ICE credentials
  demultiplex peers). We run exactly one worker, so the deployment publishes exactly one
  port.
- `media.ts` passes `webRtcServer` instead of `listenInfos`; `transportListenInfos()`
  is deleted; `preferUdp: true` stays (it filters/prioritizes the server's candidates).
- **Worker respawn must recreate the `WebRtcServer`** — it dies with its worker, so the
  same boot path that respawns the worker (`apps/server/src/sfu` / `worker-manager.ts`)
  recreates the server; a rebind `EADDRINUSE` fails the boot into the existing
  crash-loop breaker. A `getWebRtcServer()` accessor lives next to
  `setSfuWorker`/`sfuWorker()` in `packages/api/src/voice/sfu.ts` so vitest can inject
  its own (mirrors the current worker seam).
- Env renames (no aliases — nothing is deployed yet): `MEDIASOUP_ANNOUNCED_IP` →
  `PUBLIC_IP`; new `MEDIA_PORT` (default `40000`); `MEDIASOUP_RTC_MIN_PORT` /
  `MEDIASOUP_RTC_MAX_PORT` deleted (dead config once every transport rides the server).
- Verified in dev with a normal voice call before any Docker work starts.

## Config surface

One required var. Everything else defaults or derives.

| Var | Status | Default / derivation |
| --- | --- | --- |
| `APP_URL` | **required** | — (the instance's public origin, e.g. `https://chat.example.com`) |
| `PUBLIC_IP` | optional | auto-detected at boot (HTTPS echo chain, below) |
| `MEDIA_PORT` | optional | `40000` — host port **must equal** container port (announced candidates carry it) |
| `PORT` | optional | `3000` |
| `DATABASE_URL` | optional | `file:/data/konus.db` (Dockerfile `ENV`) |
| `BETTER_AUTH_SECRET` | optional | auto-generated once, persisted at `/data/.auth-secret`; env overrides |
| `BACKUP_RETENTION` | optional | `5` |
| `MEDIASOUP_MAX_INCOMING_BITRATE`, `MAX_GUILDS_PER_USER`, `MAX_DM_GROUP_SIZE` | optional | current defaults |

Derivations happen in `boot.ts` **before** the env module loads (it validates
`process.env` at import): `BETTER_AUTH_URL = APP_URL`, `CORS_ORIGIN = APP_URL` — with
same-origin serving the CORS/Origin checks (HTTP CORS + the `/ws` CSWSH guard) keep
running unchanged, they just compare same-origin values. Dev keeps today's `.env`
untouched; `APP_URL` is a production-boot concept, not an env-schema rewrite.

**`PUBLIC_IP` detection** (research §4): env override → HTTPS echo over built-in
`fetch` — 2–3 IPv4-forced providers in sequence (`api4.ipify.org`,
`checkip.amazonaws.com`, `ipv4.icanhazip.com`), ~3 s timeout each, first well-formed
IPv4 wins → both fail in production = **boot fails** (a wrong announce address is
up-but-broken voice, worse than down). Dev falls back to `127.0.0.1` as today. No STUN,
no IPv6 in v1.

## Boot sequence — `apps/server/src/boot.ts`

All in-process TypeScript; no shell entrypoint. The container CMD is
`bun apps/server/src/boot.ts`; that one Bun process runs the sequence, then becomes the
server (dynamic-imports the current entry so env derivation precedes env validation):

1. **Secret** — `BETTER_AUTH_SECRET` unset? Read `/data/.auth-secret`; absent → generate
   (32+ bytes, crypto-random), write `0600`, log `auth secret: generated and persisted`.
   Env set → log `auth secret: from env`.
2. **Derive** — inject `BETTER_AUTH_URL`/`CORS_ORIGIN` from `APP_URL`.
3. **IP detect** — as above; log the source (`env` / provider name) and the address.
4. **Pending-migration check** — read the drizzle journal
   (`packages/db/src/migrations/`) against the DB's migration state. Only if a
   migration is pending:
   - **Backup** — `VACUUM INTO '/data/backups/pre-migration-<UTC ISO timestamp>-v<appVersion>.db'`
     (single consistent snapshot regardless of WAL state; the server isn't serving yet).
     `<appVersion>` = the image's root `package.json` version — the version you roll
     back *to*.
   - **Prune** — keep the newest `BACKUP_RETENTION` (default 5) by count, delete older.
     Count-based pruning survives crash-loop retries (each retry rotates within N).
5. **Migrate** — drizzle `migrate()` over the libsql client. Log each applied tag.
6. **Serve** — start the existing `Bun.serve` entry (SFU boot stays fire-and-forget as
   today).

**Failed migration = fail fast, exit 1.** Final log line states: which migration
failed, the error, the backup path, and the recovery contract — *data untouched
(migrations are transactional + a snapshot sits next to the DB); roll back to the
previous image tag and it boots again*. Docker restart policy will crash-loop retry —
harmless (retries re-backup only while a migration is still pending) and loud, which is
the point. No maintenance-mode server.

**Boot log shape:** same pino logger as the server; one line per auto-decision (secret
source, detected IP + source, backup path or "no migration pending", each migration
applied, listen port) — the smoke-test runbook greps these lines.

## `/health` + `HEALTHCHECK`

`GET /health` → `200 {"status":"ok"}`, registered before SPA serving. No DB ping —
`Bun.serve` only starts after migrations succeed, so answering HTTP already means boot
completed; a periodic `SELECT 1` adds only a false-positive path (slow disk → Coolify
yanks the app off the proxy). The current `/` → `"OK"` route is replaced by SPA serving;
`/health` is the one canonical probe path.

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT??3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
```

`bun -e` because the slim image ships no curl/wget. `start-period=300s` is pure grace
for first-boot backup+migration on a big DB (failures don't count, first success marks
healthy immediately); steady-state flip-to-unhealthy stays ~90 s.

## SPA same-origin serving

`Bun.serve` fetch order: `/ws`, `/api/auth/*`, `/rpc/*`, `/health` (as today), then
**static files from the baked-in `apps/web/dist`**, then **`index.html` fallback** for
any other GET — TanStack Router deep links (`/g/…/c/…`) survive refresh. Cache headers
follow the Vite contract:

- `/assets/*` (content-hashed) → `Cache-Control: public, max-age=31536000, immutable`
- `index.html` + non-hashed root files → `Cache-Control: no-cache`

In dev the `dist/` check falls through — Vite keeps serving on `:3001`, nothing changes
locally.

**Web-side switch:** `VITE_SERVER_URL` becomes *optional* (`packages/env/src/web.ts`).
Unset (the production image build) → same-origin everywhere: `fetch("/rpc")`, auth
`baseURL = window.location.origin`, WS URL from `window.location` (`wss:` when the page
is `https:`). Dev keeps `VITE_SERVER_URL=http://localhost:3000` as the cross-origin
override.

## Dockerfile

Multi-stage on **`oven/bun` debian slim** (glibc — alpine is categorically out: the
mediasoup prebuilt worker smoke-test fails on musl and triggers a source compile). Ships
the workspace and runs TS source directly — mediasoup forces `node_modules` into the
image anyway, so bundling/compiling buys nothing and adds failure modes (Sharkord's
manual worker download exists *because* they compile; we don't).

1. **web-build stage** — `bun install`, `bun run --filter web build` with
   `VITE_SERVER_URL` unset → same-origin `dist/`.
2. **install stage** — production install of the workspace. mediasoup's postinstall
   downloads the prebuilt worker for the *stage's* platform (buildx runs it once per
   arch → correct `linux-x64`/`linux-arm64` binary per image; `mediasoup` is already in
   root `trustedDependencies`). Guard against silent fallback-to-compile:
   `RUN test -x node_modules/mediasoup/worker/out/Release/mediasoup-worker`.
3. **runtime stage** — copy workspace + `node_modules` + `apps/web/dist`;
   `ENV DATABASE_URL=file:/data/konus.db`; `mkdir -p /data && chown bun:bun /data`;
   `USER bun`; `VOLUME /data`; `EXPOSE 3000`; the `HEALTHCHECK` above;
   `CMD ["bun", "apps/server/src/boot.ts"]`.

**Non-root:** runs as the image's `bun` user (UID/GID 1000). Named volumes inherit
`/data` ownership on first use — just works on compose and both platforms. Bind mounts
need a one-time `chown -R 1000:1000 <dir>` — documented in troubleshooting.

**Build-host constraint:** the mediasoup prebuilt tarball name is keyed on the build
host's kernel major (only kernel-6/7 assets exist) — CI builds on `ubuntu-24.04`
(kernel 6); local image builds on older kernels silently fall into the compile path,
which the `test -x` guard turns into a loud failure.

## Compose recipe — `deploy/`

Three copy-paste files; the raw-VPS story is *copy, set one var, `docker compose up -d`*.

- `deploy/docker-compose.yml` — `app` (image `ghcr.io/zenn-g/konus-la:latest`,
  `restart: unless-stopped`, `APP_URL: https://${DOMAIN}`, ports `40000:40000/udp` +
  `40000:40000/tcp`, volume `konus-data:/data`), `caddy` (`caddy:2`, ports 80/443,
  `Caddyfile` mount, `caddy-data` volume, `DOMAIN` env), and a commented-out
  `watchtower` block scoped to the app container only (opt-in auto-updates; the default
  update path is `docker compose pull && docker compose up -d`).
- `deploy/Caddyfile` — `{$DOMAIN} { reverse_proxy app:3000 }` (auto-TLS, WS proxied
  natively).
- `deploy/.env.example` — `DOMAIN=chat.example.com`.

The media port bypasses Caddy: browsers dial `PUBLIC_IP:40000` directly. Firewall
opens: `80`, `443`, `40000/tcp+udp` — nothing else.

## Platform deploys — Dokploy & Coolify

Both handle the single-image model with no blockers
([research](../research/platform-deploy-paths.md)); guides live in
`docs/self-hosting/`. Shared shape: paste the GHCR image, set `APP_URL`, domain +
auto-TLS via the platform's Traefik → container `:3000`, named volume → `/data`, media
port published host→container as **both** `tcp` and `udp`, updates are webhook- or
click-triggered (**no registry polling exists on either**) and imply a brief restart
(host-published port forbids rolling updates — same physics as compose).

Sharp edges each guide must carry:

- **Dokploy:** the two `40000` port entries must use **`host` publish mode** — Swarm's
  default `ingress` mesh SNATs traffic (poison for ICE/RTP). CI update trigger =
  `POST /api/application.deploy` with an API token (no GHCR webhook support). Watch-item:
  open Traefik HTTP/2 WS issue (Dokploy [#4202](https://github.com/Dokploy/dokploy/issues/4202)).
- **Coolify:** Ports Mappings `40000:40000/tcp,40000:40000/udp` (verify the `/udp`
  suffix once in the UI; compose build pack is the guaranteed fallback). Update trigger =
  per-resource deploy webhook + bearer token — **plain, never `force=true`**
  (open bug [#5318](https://github.com/coollabsio/coolify/issues/5318): forced restarts
  skip the pull). Unhealthy = unrouted — covered by our generous `start-period`.

Both guides ship a copy-paste GitHub Actions step calling the platform's deploy hook
after a release; "click redeploy after a release" also works.

## Release pipeline

Adopted verbatim from the [changesets research](../research/changesets-release-flow.md)
(all empirically verified in-repo), plus `@changesets/changelog-github`:

- **Root joins the workspace** — `"."` in `workspaces.packages`, root
  `"version": "0.0.0"`; `.changeset/config.json` ignores all inner packages
  (`["@konus-la/*", "web", "server"]`), `privatePackages: { version: true, tag: false }`,
  changelog via `["@changesets/changelog-github", { "repo": "zeNn-G/konus-la" }]`.
- **`scripts/release-tag.sh`** owns the `v*` tag + GitHub Release (idempotent: remote-tag
  guard, since it runs on every changeset-free push to `main`). `changeset tag` can never
  mint the tag (`tag: false`) — in a monorepo it would produce `konus-la@X.Y.Z`, not
  `vX.Y.Z`.
- **`.github/workflows/release.yml`** — `changesets/action@v1` maintains the "Version
  Packages" PR; on merge the publish script tags, then the image build is **chained via
  `workflow_call`** (`build-image` job gated on `published == 'true'`). Never rely on the
  tag event: `GITHUB_TOKEN`-pushed tags don't trigger workflows. Requires the repo
  setting *Allow GitHub Actions to create and approve pull requests*.
- **`.github/workflows/docker-image.yml`** — triggers on both `push: tags: [v*]`
  (manual-push path) and `workflow_call`; buildx **QEMU single job**
  (`docker/setup-qemu-action` with `docker/build-push-action`) building
  `linux/amd64,linux/arm64` on `ubuntu-24.04`, pushing `ghcr.io/zenn-g/konus-la:X.Y.Z`
  and `:latest`. Native arm runners only if build times hurt.
- **`.github/workflows/ci.yml`** — PR gate: oxlint + `check-types` + `bun test`,
  required via branch protection. Release/build workflows don't re-run tests; no image
  build on PRs.
- **First release** — seed root `0.0.0` + one `major` changeset ("Initial release.") →
  the first Version Packages PR shows `konus-la@1.0.0`; merging it tags `v1.0.0` and
  builds the first image. Repo goes public (whole pipeline $0).

Flow: feature PRs carry a changeset naming `konus-la` → action maintains the Version
Packages PR → merging it tags + releases + builds. Merging that PR **is** the release
button.

## Smoke-test runbook — `docs/deployment/smoke-test.md`

Maintainer checklist, not a user doc. Two tiers:

- **Full pass on a real VPS** — once against `v1.0.0`, and after any release touching
  deployment machinery (Dockerfile, boot, media networking). Only the real internet
  proves `PUBLIC_IP` detection, Caddy TLS, and ICE to `PUBLIC_IP:40000` (localhost media
  proves nothing about the announced-address path). Throwaway VPS, torn down after.
- **Local Docker abbreviated pass** — every ordinary release: compose up with the fresh
  image → boot log, migrations/backup, `/health`, SPA, chat, update/rollback. Voice gets
  a same-box glance (`PUBLIC_IP=127.0.0.1` override).

Steps: **1** fresh boot (empty volume, `APP_URL` only → log shows secret gen, IP
detect, migrations applied; `/health` 200, container healthy) · **2** first signup
becomes instance owner · **3** SPA loads, deep link survives refresh, hashed assets
cache / `index.html` doesn't · **4** second user, messages flow both ways over WS ·
**5** two-user voice call, audio both ways (+ TCP-fallback connect if feasible) ·
**6** update: previous tag → new tag; pre-migration backup appears when a migration is
pending; data intact · **7** rollback: previous tag boots against the restored backup.

## README "Self-Host" + `docs/self-hosting/`

README keeps a tight section: requirements (Linux + Docker, a domain, ports
80/443/40000 open), the 3-file compose quick start, env reference table,
update/rollback/backup one-liners. Platform detail lives in `docs/self-hosting/`:
`dokploy.md`, `coolify.md` (each with its sharp edges above), and
`troubleshooting.md` (voice/NAT explainer per charter — clients only dial outbound, no
TURN in v1; bind-mount chown; WS-behind-proxy notes). Content is build-issue work; this
spec fixes the skeletons.

## Build-issue slicing sketch

Cut after this spec merges (Phase 6/7 precedent), blocked-by-chained; the
`WebRtcServer` precursor PR merges first. Suggested slices: **(1)** boot sequence +
config surface (`boot.ts`, secret, IP detect, backup/prune, migrate, `/health`) —
testable with vitest against temp-file DBs; **(2)** SPA same-origin serving + web
relative-URL switch; **(3)** Dockerfile + local image smoke; **(4)** `deploy/` compose
recipe; **(5)** release pipeline (changesets setup + workflows + repo settings);
**(6)** docs (README, platform guides, troubleshooting, smoke-test runbook) + the
full-VPS smoke pass → `v1.0.0`.

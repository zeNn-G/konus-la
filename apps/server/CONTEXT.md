# Server

Bun runtime (`Bun.serve`). Dispatches by URL path:

- `/ws` — WebSocket upgrade for ORPC over WS (`@orpc/server/bun-ws`). **Authenticated at upgrade**: Origin check (CSWSH guard) → Better Auth session from the cookie → 401 before upgrading. `{ userId, headers, connectionId }` is stashed as `ws.data`; the upgrade headers plus the `connectionId` (minted at upgrade — voice's socket identity, what `voice.*` procedures gate on) become the per-message ORPC context so `requireAuth` works unchanged over WS. Socket `open`/`close` drive presence (`presenceConnectionOpened/Closed` from `@konus-la/api`) and the connection registry (`connectionOpened/Closed` — the handle itself, so `admin.banUser` can force-close a banned user's tabs); `close` also starts the voice seat grace (`voiceConnectionClosed`).
- `/api/auth/*` — Better Auth handler.
- `/rpc/*` — ORPC HTTP `RPCHandler`.
- `/health` — `200 {"status":"ok"}`, no DB ping (phase-8 spec §`/health`: `Bun.serve` only starts after migrations, so answering HTTP already means boot completed). The canonical probe path — the old bare `/` probe is gone; root serves the SPA.
- everything else — same-origin SPA serving (`src/static.ts`): static files from the baked-in `apps/web/dist`, then `index.html` fallback for any other GET so router deep links survive refresh. `/assets/*` (content-hashed) ships `immutable`; `index.html` + root files ship `no-cache`. No `dist/` (dev) → falls through to 404; Vite serves the web app on :3001.

Dev note: `bun --hot` only watches files inside `apps/server` — edits under `packages/*` need a server restart (and reset in-memory state: presence map, rate-limit windows, publisher retention buffer).

## Boot (`src/boot.ts`) — phase-8 spec §Boot sequence

Production entry (container CMD `bun apps/server/src/boot.ts`); dev (`bun run dev`) never touches it. Runs secret → derive → IP detect → conditional backup+prune → migrate, then dynamic-imports `src/index.ts` — so every derivation lands in `process.env` **before** `@konus-la/env/server` validates it. The env-free pieces live in `src/boot/`:

- `secret.ts` — `BETTER_AUTH_SECRET`: env → `<data dir>/.auth-secret` → generate + persist `0600` (data dir = the directory of the `file:` `DATABASE_URL`).
- `public-ip.ts` — `PUBLIC_IP`: env → HTTPS echo chain (ipify → amazonaws → icanhazip, ~3 s each, first well-formed IPv4) → production **boot fails** / dev `127.0.0.1`.
- `sequence.ts` — orchestration (`runBoot`, dependency-injected for vitest); drizzle work comes from `@konus-la/db/migrate`. Backup only when a migration is pending: `VACUUM INTO <data dir>/backups/pre-migration-<UTC>-v<root package.json version>.db`, pruned to the newest `BACKUP_RETENTION` (default 5) by count. A failed migration exits 1 with a fatal line naming the migration, the error, the backup path, and the roll-back-a-tag recovery contract — the migrate batch is one atomic libsql transaction, so the data files stay untouched.

One pino line per auto-decision (the smoke-test runbook greps them). `logger.ts` reads `NODE_ENV` raw — the one sanctioned exception to the env-package rule — so boot can log before env validation.

## SFU (`src/sfu/`) — phase-5 spec §Worker lifecycle

One mediasoup worker boots with the server (`startSfu()` in `src/index.ts`) and lives for the process. Standing invariant: live worker, respawn in flight, or voice declared down.

- `bun-mediasoup-workaround.ts` — vendored Sharkord patch for Bun-on-Windows dev (oven-sh/bun#11044 breaks stdio fd ≥ 3; mediasoup's IPC uses fds 3/4). No-op on Linux/prod. Pin Bun upgrades behind a re-run of the #8 spike until the upstream issue closes.
- `create-worker.ts` — `createWorkerPatched()`, the ONLY sanctioned way to spawn a worker: `restoreSpawn()` unpatches, so every spawn (boot and crash respawn) re-applies the patch. Boot capped at 10 s because an unpatched hang never rejects.
- **WebRtcServer** ([ADR 0009](../../docs/adr/0009-single-image-single-port-deployment.md)) — every spawn also creates the worker's `WebRtcServer`: one UDP + one TCP `listenInfo`, both on `MEDIA_PORT` (default 40000), `announcedAddress = PUBLIC_IP`; every transport multiplexes over that single port pair, so the deployment publishes exactly one media port. It dies with its worker (each respawn recreates it) and rides on `worker.appData`, which survives `bun --hot` alongside the worker. A bind failure (`EADDRINUSE`) closes the half-booted worker and counts as a failed boot toward the breaker. Injected into `@konus-la/api` via `setWebRtcServer`, next to `setSfuWorker`.
- `worker-manager.ts` — eager respawn on `died`; crash-loop breaker (3 deaths/60 s → voice declared down, error log, 30 s slow retry until a boot sticks). Mirrors the down state into `@konus-la/api`'s `setVoiceDown`, which the `voiceProcedure` gate turns into defined `VOICE_UNAVAILABLE` errors. Seat hooks bridge into the api's voice rooms: `onWorkerLost` → `voiceWorkerDied` (every live seat into grace, silently), `onWorkerBooted` → `voiceWorkerRespawned` (self-only `voice.mediaReset` to seated users, whose rejoin lands as a grace rebind).
- `startSfu()` is idempotent under `bun --hot` via a `globalThis` singleton (hot reload re-evaluates modules without killing the process — without the guard, workers stack). `mediasoup` requires `trustedDependencies` in the root package.json (postinstall downloads the worker binary).

Both ORPC handlers carry the pino `LoggingHandlerPlugin`; the HTTP handler also carries `CORSPlugin`. The ORPC `CORSPlugin` only covers `/rpc`, so `/api/auth/*` gets CORS handled inline in `fetch` — an `OPTIONS` preflight responder plus CORS headers on each response, with `x-signup-code` in the allowed headers (the signup-code header forces a browser preflight). Logger configured in `src/logger.ts` — `pino-pretty` in dev, JSON in prod.

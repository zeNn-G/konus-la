# Server

Bun runtime (`Bun.serve`). Dispatches by URL path:

- `/ws` — WebSocket upgrade for ORPC over WS (`@orpc/server/bun-ws`). **Authenticated at upgrade**: Origin check (CSWSH guard) → Better Auth session from the cookie → 401 before upgrading. `{ userId, headers, connectionId }` is stashed as `ws.data`; the upgrade headers plus the `connectionId` (minted at upgrade — voice's socket identity, what `voice.*` procedures gate on) become the per-message ORPC context so `requireAuth` works unchanged over WS. Socket `open`/`close` drive presence (`presenceConnectionOpened/Closed` from `@konus-la/api`) and the connection registry (`connectionOpened/Closed` — the handle itself, so `admin.banUser` can force-close a banned user's tabs); `close` also starts the voice seat grace (`voiceConnectionClosed`).
- `/api/auth/*` — Better Auth handler.
- `/rpc/*` — ORPC HTTP `RPCHandler`.
- `/` — health probe.

Dev note: `bun --hot` only watches files inside `apps/server` — edits under `packages/*` need a server restart (and reset in-memory state: presence map, rate-limit windows, publisher retention buffer).

## SFU (`src/sfu/`) — phase-5 spec §Worker lifecycle

One mediasoup worker boots with the server (`startSfu()` in `src/index.ts`) and lives for the process. Standing invariant: live worker, respawn in flight, or voice declared down.

- `bun-mediasoup-workaround.ts` — vendored Sharkord patch for Bun-on-Windows dev (oven-sh/bun#11044 breaks stdio fd ≥ 3; mediasoup's IPC uses fds 3/4). No-op on Linux/prod. Pin Bun upgrades behind a re-run of the #8 spike until the upstream issue closes.
- `create-worker.ts` — `createWorkerPatched()`, the ONLY sanctioned way to spawn a worker: `restoreSpawn()` unpatches, so every spawn (boot and crash respawn) re-applies the patch. Boot capped at 10 s because an unpatched hang never rejects.
- `worker-manager.ts` — eager respawn on `died`; crash-loop breaker (3 deaths/60 s → voice declared down, error log, 30 s slow retry until a boot sticks). Mirrors the down state into `@konus-la/api`'s `setVoiceDown`, which the `voiceProcedure` gate turns into defined `VOICE_UNAVAILABLE` errors. Seat hooks bridge into the api's voice rooms: `onWorkerLost` → `voiceWorkerDied` (every live seat into grace, silently), `onWorkerBooted` → `voiceWorkerRespawned` (self-only `voice.mediaReset` to seated users, whose rejoin lands as a grace rebind).
- `startSfu()` is idempotent under `bun --hot` via a `globalThis` singleton (hot reload re-evaluates modules without killing the process — without the guard, workers stack). `mediasoup` requires `trustedDependencies` in the root package.json (postinstall downloads the worker binary).

Both ORPC handlers carry the pino `LoggingHandlerPlugin`; the HTTP handler also carries `CORSPlugin`. The ORPC `CORSPlugin` only covers `/rpc`, so `/api/auth/*` gets CORS handled inline in `fetch` — an `OPTIONS` preflight responder plus CORS headers on each response, with `x-signup-code` in the allowed headers (the signup-code header forces a browser preflight). Logger configured in `src/logger.ts` — `pino-pretty` in dev, JSON in prod.

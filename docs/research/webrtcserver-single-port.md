# Research: mediasoup WebRtcServer single-port media on Bun (#99)

Resolves wayfinder research ticket [#99](https://github.com/zeNn-G/konus-la/issues/99)
(parent #98, blocks #102). Feeds the Phase 8 spec's SFU + Dockerfile sections and
charter decisions 6 (single-port media) and 7 (`PUBLIC_IP` auto-detection).

Facts marked **[repo]** were read from this repo's code; external claims cite the
primary source. Inference is labeled as such.

**Top-line recommendations**

| Question | Recommendation |
| --- | --- |
| 1. Adopt `WebRtcServer`? | **Yes** — fully supported on our pinned mediasoup 3.21.0; no interaction with the Bun spawn workaround. Small enough to be a precursor PR. |
| 2. One port, many peers? | **Confirmed** — all transports of a worker multiplex over the WebRtcServer's single UDP + TCP port pair; 1 worker ⇒ 1 port pair total. |
| 3. Base image | `oven/bun` **debian/slim** (glibc) on amd64 + arm64 works with prebuilt workers; **never alpine**; verify the worker binary exists at image build time. |
| 4. `PUBLIC_IP` detection | Env override first, else **HTTPS echo** (built-in `fetch`, 2+ IPv4-forced providers, short timeout, fail-fast in prod). Skip STUN and IPv6 for v1. |

---

## 1. API shape against our vendored SFU

### What we run today [repo]

- mediasoup is pinned to **`3.21.0`** in `apps/server/package.json` (also the sole
  resolution in `bun.lock`).
- Transports currently open **per-transport ports**:
  `packages/api/src/voice/media.ts` calls
  `router.createWebRtcTransport({ listenInfos: transportListenInfos(), preferUdp: true, ... })`,
  where `transportListenInfos()` (`packages/api/src/voice/sfu.ts`) returns one UDP + one
  TCP `TransportListenInfo` on `0.0.0.0` with `announcedAddress: env.MEDIASOUP_ANNOUNCED_IP`.
  Ports are drawn from the worker's `rtcMinPort`/`rtcMaxPort`
  (`MEDIASOUP_RTC_MIN_PORT=40000` … `MAX=40100`, `packages/env/src/server.ts`) — i.e. up
  to ~100 concurrently open media ports.

### WebRtcServer support in 3.21.0 — verified

- `WebRtcServer` was introduced in **mediasoup 3.10.0** ("A new class that brings to
  `WebRtcTransports` the ability to listen on a single UDP/TCP port", PR #834) —
  [CHANGELOG](https://github.com/versatica/mediasoup/blob/3.21.0/CHANGELOG.md).
  Relevant hardening since then, all included in 3.21.0:
  - 3.10.8: `port` optional in `listenInfos` (falls back to the worker port range) — we
    will pass an explicit port, so the range becomes irrelevant.
  - 3.14.5: fixed a memory leak with TCP enabled (PR #1389) and a crash when closing a
    `WebRtcServer` with active transports (PR #1390).
  - 3.17.1: removed the 8-`listenInfos` limit.
- API shape (verified against the
  [v3 API docs](https://mediasoup.org/documentation/v3/mediasoup/api/)):

  ```ts
  const webRtcServer = await worker.createWebRtcServer({
    listenInfos: [
      { protocol: "udp", ip: "0.0.0.0", announcedAddress, port: MEDIA_PORT },
      { protocol: "tcp", ip: "0.0.0.0", announcedAddress, port: MEDIA_PORT },
    ],
  });
  // then, per peer/transport:
  const transport = await router.createWebRtcTransport({
    webRtcServer,
    preferUdp: true,
    appData: { userId },
  });
  ```

  `webRtcServer` and `listenIps`/`listenInfos` are mutually exclusive on
  `WebRtcTransportOptions` (typed that way since 3.10.3, PR #852 — CHANGELOG).
  `enableUdp`/`enableTcp`/`preferUdp`/`preferTcp` still apply: with `webRtcServer` given
  they *filter and prioritize* the server's candidates
  ([API docs](https://mediasoup.org/documentation/v3/mediasoup/api/)).
- `announcedAddress` accepts an IPv4, IPv6, **or hostname**
  ([API docs](https://mediasoup.org/documentation/v3/mediasoup/api/)) — a DNS-name
  announce is a future option the current `MEDIASOUP_ANNOUNCED_IP` name undersells.

### Interaction with the Bun spawn workaround [repo + inference]

None expected. The vendored workaround
(`apps/server/src/sfu/bun-mediasoup-workaround.ts`) only monkey-patches
`child_process.spawn` for the **worker process launch** (and only on Bun+Windows dev;
it is an explicit no-op on Linux). `worker.createWebRtcServer()` is an ordinary request
over the already-established fd-3/fd-4 FlatBuffers channel — the same channel every
`createRouter`/`createWebRtcTransport` call already uses successfully. No new spawn, no
new fds. *(Inference from the workaround's code — it intercepts nothing but the spawn —
plus the fact that channel-based calls demonstrably work today.)*

### Lifecycle wrinkle for our worker manager [repo]

A `WebRtcServer` belongs to a worker and dies with it. Our
`worker-manager.ts` respawns the worker after death, so the `WebRtcServer` must be
recreated in the same boot path that today only creates the worker
(`apps/server/src/sfu/index.ts` `spawn:` closure, or `onWorkerBooted`). The fixed port
is freed when the worker process dies, so respawn re-binding is normally fine; an
`EADDRINUSE` on rebind (e.g. a wedged old worker) would surface as a failed boot and
correctly walk the existing crash-loop breaker. The `getWebRtcServer()` accessor should
live next to `setSfuWorker`/`sfuWorker()` in `packages/api/src/voice/sfu.ts` so vitest
(Node, unpatched) can inject its own, mirroring the current worker seam.

**Recommendation:** adopt. The diff is small (create server at worker boot; pass
`webRtcServer` instead of `listenInfos` in `media.ts`; drop `transportListenInfos()`;
env changes below) and de-risks the Dockerfile — do it as a **precursor PR**, not a
Phase 8 build issue, so the spec can hard-commit to a single published port.

## 2. One port, many peers — confirmed

- The [v3 API docs](https://mediasoup.org/documentation/v3/mediasoup/api/) define the
  `webRtcServer` transport option as: "Instead of opening its own listening port(s) let
  a WebRTC server handle the network traffic of this transport." All transports created
  with the same `webRtcServer` share its listening port(s); each transport keeps unique
  ICE credentials (`usernameFragment`/`password`), which is how incoming STUN/media is
  demultiplexed to the right transport despite the shared port. mediasoup is ICE-Lite
  (always the ICE "server" role — [FAQ](https://mediasoup.org/faq/)), so it never needs
  outbound ephemeral ICE ports either.
- **TCP fallback rides the same port number**: the server's `listenInfos` may include a
  TCP entry on the same `port` as the UDP entry (separate sockets, one number to
  publish). TCP support with `WebRtcServer` is first-class (and the one known TCP leak
  was fixed in 3.14.5).
- **Per-worker constraint**: a `WebRtcServer` cannot be shared across workers — "if
  your app launches N workers it also needs to create N WebRTC servers listening on
  different ports (to not collide)"
  ([API docs](https://mediasoup.org/documentation/v3/mediasoup/api/)). We run exactly
  **1 worker** for the process lifetime (`apps/server/src/sfu/worker-manager.ts`,
  phase-5 spec §Worker lifecycle), so the whole deployment needs exactly one
  UDP+TCP port pair (`MEDIA_PORT`, default 40000). If we ever shard to N workers,
  that becomes N port pairs — a spec note, not a v1 concern.
- Once every transport goes through the `WebRtcServer`, `rtcMinPort`/`rtcMaxPort`
  (and the `MEDIASOUP_RTC_MIN_PORT`/`MAX_PORT` env vars) are dead config for WebRTC
  media and should be removed with the switch.

## 3. Container / arch facts

### Prebuilt worker binaries — verified from the 3.21.0 release assets

The npm `postinstall` downloads a prebuilt `mediasoup-worker` for the current
platform/arch and **falls back to compiling from source** if none matches
([installation docs](https://mediasoup.org/documentation/v3/mediasoup/installation/)).
The [3.21.0 GitHub release](https://github.com/versatica/mediasoup/releases/tag/3.21.0)
ships exactly these prebuilds:

```
mediasoup-worker-3.21.0-darwin-arm64.tgz
mediasoup-worker-3.21.0-linux-arm64-kernel6.tgz
mediasoup-worker-3.21.0-linux-arm64-kernel7.tgz
mediasoup-worker-3.21.0-linux-x64-kernel6.tgz
mediasoup-worker-3.21.0-linux-x64-kernel7.tgz
mediasoup-worker-3.21.0-win32-x64.tgz
```

So **both `linux/amd64` and `linux/arm64` have prebuilds** — but with two sharp edges,
verified from
[`npm-scripts.mjs` @3.21.0](https://github.com/versatica/mediasoup/blob/3.21.0/npm-scripts.mjs):

1. **The tarball name is keyed on the *build host's* kernel major version**
   (`os.release().split('.')[0]` → `-kernel6`/`-kernel7`). Only kernel 6 and 7 assets
   exist. A container sees the *host/runner* kernel, so building the image on a
   kernel-5 machine (e.g. Ubuntu 22.04's stock 5.15) gets a 404 and silently falls
   back to a source compile. GitHub-hosted `ubuntu-24.04` runners are kernel 6.x —
   fine — but this is a real trap for local image builds on older hosts.
2. **The downloaded binary is executed as a smoke test** (must exit with code 41; on
   any other result the prebuilt is deleted and the install falls back to compiling).
   The prebuilds are glibc builds, so on a **musl** base (`oven/bun:alpine`) the check
   fails and the install tries to compile → do not use the alpine variant.

If the fallback compile is ever triggered, the image would need: Python ≥ 3.7 with
pip, and gcc/g++ ≥ 8 or clang with C++17 (Linux) —
[installation docs](https://mediasoup.org/documentation/v3/mediasoup/installation/).
**Recommendation: do not carry those deps.** Use glibc `oven/bun` (debian or slim,
both published for amd64+arm64), rely on the prebuilt, and make the Dockerfile fail
loudly instead of compiling:

```dockerfile
# after bun install:
RUN test -x node_modules/mediasoup/worker/out/Release/mediasoup-worker
```

Escape hatches if the download path ever breaks:
`MEDIASOUP_WORKER_PREBUILT_DOWNLOAD_BASE_URL` (mirror),
`MEDIASOUP_WORKER_BIN` (bring-your-own binary),
`MEDIASOUP_FORCE_WORKER_PREBUILT_DOWNLOAD` / `MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD`
([installation docs](https://mediasoup.org/documentation/v3/mediasoup/installation/),
confirmed in `npm-scripts.mjs`).

### Bun-specific install gotchas

- Bun does **not** run lifecycle scripts of arbitrary packages; `mediasoup` must be in
  `trustedDependencies` ([Bun lifecycle docs](https://bun.com/docs/pm/lifecycle)).
  **Already done** at the repo root `package.json` [repo]. A fresh `bun install` in the
  image runs the postinstall; only *re*-running against a cached install needs
  `--force` (see repo memory note — not an issue for clean image builds).
- `oven/bun` images do **not** contain Node.js, and mediasoup's postinstall is
  `node npm-scripts.mjs postinstall`. Bun symlinks `node` to `bun` for lifecycle
  scripts when `node` is absent
  ([Bun lifecycle docs](https://bun.com/docs/pm/lifecycle),
  [Bun v1.0.18 blog](https://bun.com/blog/bun-v1.0.18)), so the script runs under
  bun-as-node. *(The `RUN test -x …` guard above is the belt-and-braces check that this
  whole chain actually produced a binary — keep it.)*
- Cross-arch builds (`buildx` + QEMU for arm64 on an amd64 CI box): `os.arch()` inside
  emulation reports arm64 so the right tarball is fetched, and the exit-41 smoke test
  runs the arm64 binary under QEMU — works, but requires binfmt to be set up; a missing
  binfmt fails the smoke test and triggers the compile fallback. Building arm64 images
  on native arm64 runners avoids this. *(Inference from the `npm-scripts.mjs` logic.)*

### Docker networking gotchas — verified

- Bind `ip: "0.0.0.0"` and set `announcedAddress` to the host's public IP: "Use
  `ip: '0.0.0.0'` and `announcedAddress: HOST_PUBLIC_IP` when creating a transport"
  ([mediasoup FAQ](https://mediasoup.org/faq/)); the API docs require
  `announcedAddress` whenever the bind IP is `0.0.0.0`/`::`. This applies identically
  to `WebRtcServer` `listenInfos`.
- The `WebRtcServer` switch is what makes **bridge networking viable**: publish exactly
  `-p 40000:40000/udp -p 40000:40000/tcp` (host port must equal container port — the
  announced candidates carry port 40000). Without it we'd have to publish the whole
  40000–40100 range or run `--network host`. Host networking remains the
  zero-surprise option and needs no port mapping.

## 4. `PUBLIC_IP` auto-detection (charter decision 7)

**Recommendation: env override → HTTPS echo → fail fast.** Boot order:

1. `MEDIASOUP_ANNOUNCED_IP` env set → use it, no detection (today's behavior [repo:
   `packages/env/src/server.ts`] — keep it required-in-prod *or* relax to optional once
   detection exists; recommend: optional in prod, detection as the default path).
2. Otherwise HTTPS echo with Bun's built-in `fetch`: try 2–3 independent providers in
   sequence with a ~3 s timeout each, take the first well-formed IPv4. Good providers:
   `https://api4.ipify.org` (IPv4-forced; ipify is a long-standing free service),
   `https://checkip.amazonaws.com` (AWS-operated), `https://ipv4.icanhazip.com`
   (Cloudflare-operated since 2021 —
   [icanhazip announcement](https://major.io/p/a-new-future-for-icanhazip/)).
3. Both fail in production → **fail the boot** (a wrong/missing announce address means
   every ICE connection dead-ends — indistinguishable from up-but-broken voice). In dev,
   fall back to `127.0.0.1` as today.

Why HTTPS echo over STUN:

- **Dependency weight**: HTTPS echo is a one-line `fetch` — zero deps. A STUN Binding
  request needs either a hand-rolled RFC 8489 UDP client over `node:dgram` (supported
  in Bun since 1.2 — [Bun v1.2 blog](https://bun.com/blog/bun-v1.2); we're on 1.3.14)
  or an npm dependency, plus retransmission/timeout logic (STUN-over-UDP is lossy by
  design).
- **Fidelity**: STUN's theoretical edge is that it reflects the address seen on a *UDP*
  path, which is what media uses. That matters behind symmetric/UDP-quirky NATs — but a
  server behind such a NAT can't host an SFU anyway (the announced port must be
  statically reachable, i.e. public IP or 1:1 port-forward). For every viable
  deployment (cloud VM with public IP, or NAT with a forwarded `MEDIA_PORT`), the
  HTTPS egress IP and the UDP-reflected IP are the same address. *(Inference; the
  standard mediasoup deployment guidance — FAQ above — assumes a known static
  public IP.)*
- **Failure modes**: both depend on a third-party endpoint at boot; the echo approach
  makes multi-provider fallback trivial. The env override remains the sovereign
  escape hatch for air-gapped or split-egress setups.

IPv6: skip for v1. Announcing only an IPv4 keeps the candidate set and the Docker port
publish simple; dual-stack would need a v6 `listenInfo` + v6 detection
(`api64.ipify.org` etc.) and `ipv6Only` socket-flag decisions. Note for later:
`announcedAddress` may be a **hostname** (API docs), so "announce a DNS name with A +
AAAA records" is a cleaner future path to v6 than dual IP detection.

## Env/config deltas implied for the spec

- New: `MEDIA_PORT` (default 40000) — the single UDP+TCP media port.
- Removed: `MEDIASOUP_RTC_MIN_PORT` / `MEDIASOUP_RTC_MAX_PORT` (dead once transports
  use the `WebRtcServer`).
- Changed: `MEDIASOUP_ANNOUNCED_IP` becomes optional-in-prod once auto-detection
  lands (override > detection > fail).

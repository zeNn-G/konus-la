# Single-image deployment, single-port media

Amends the ROADMAP's Deployment section. The deployment unit is **one public Docker
image** (`ghcr.io/zenn-g/konus-la`) serving SPA + API + WS + mediasoup on plain HTTP
`:3000`, with all WebRTC media multiplexed over **one UDP+TCP port** (`MEDIA_PORT`,
default `40000`) via mediasoup's `WebRtcServer` — superseding the ROADMAP's
"`bun-server` + `caddy` compose stack *is* the deployment" framing and the
`40000–40100` port range. Full detail in the
[Phase 8 spec](../specs/phase-8-deployment.md); charted on wayfinder map
[#98](https://github.com/zeNn-G/konus-la/issues/98).

## Context

The ROADMAP fixed a single-VPS compose deployment early, before the target audience was
sharp. Phase 8 grilling settled it: the product is *self-hostable by strangers*, not
just this instance — which makes the deployment unit the thing being shipped. A compose
stack as the product couples every operator to our proxy choice; platforms like Dokploy
and Coolify bring their own Traefik and want a bare image. Meanwhile the per-transport
port range (`40000–40100`) forced publishing 101 ports or host networking — hostile to
platform UIs and firewalls alike.

## Decision

- **One image is the product.** TLS is the host's concern: raw VPSs get a ready-made
  compose file pairing the image with Caddy; Dokploy/Coolify run the bare image behind
  their own proxy. The SPA is served same-origin by the server process (`VITE_SERVER_URL`
  demoted to a dev/power-user build-time override).
- **One required env var, `APP_URL`.** `BETTER_AUTH_SECRET` auto-generates into the
  `/data` volume; `PUBLIC_IP` auto-detects at boot (HTTPS echo, env override); auth
  URL/CORS derive from `APP_URL`; everything else defaults.
- **Single-port media.** mediasoup `WebRtcServer` multiplexes all transports of the
  single worker over one UDP+TCP port pair; verified against pinned mediasoup 3.21.0
  ([research](../research/webrtcserver-single-port.md)). Lands as a precursor PR before
  Phase 8 build issues. `MEDIASOUP_ANNOUNCED_IP` → `PUBLIC_IP`, the port range env vars
  die.
- **Migrations apply on boot** — drizzle `migrate()` before `Bun.serve`, preceded by a
  `VACUUM INTO` snapshot into the volume when (and only when) a migration is pending;
  count-pruned retention. Failed migration = fail fast, exit 1, roll back to the
  previous tag.
- **Updates are stop-and-swap.** The host-published media port forbids rolling updates
  everywhere (double-bind), and voice rooms are in-memory by design
  ([ADR 0007](0007-voice-in-memory-rooms-ws-seats.md)) — seconds of downtime per update
  is the contract, on every platform.

## Consequences

- Firewall surface shrinks to `80`, `443`, `40000/tcp+udp`; bridge networking works
  everywhere (host port must equal `MEDIA_PORT` — announced candidates carry it).
- The image must be glibc (`oven/bun` debian slim, never alpine) and CI must build on a
  kernel-6 runner — mediasoup prebuilt-worker constraints.
- Worker respawn must recreate the `WebRtcServer` (it dies with its worker).
- Sharding to N mediasoup workers would need N port pairs — explicitly a non-goal at
  this scale (≤20 concurrent per voice room).
- No TURN in v1: clients only ever dial the SFU's public IP outbound; TCP fallback rides
  the media port. Revisit only on real-world connection failures.

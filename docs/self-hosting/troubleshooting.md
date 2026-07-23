# Self-hosting troubleshooting

Applies to every deploy target (compose, Dokploy, Coolify). Platform-specific
issues live at the bottom of [dokploy.md](dokploy.md) and
[coolify.md](coolify.md).

## Voice: how it connects (and what to check when it doesn't)

Konus ships no TURN server, and doesn't need one for the common case:
**clients only ever dial outbound.** The server (mediasoup SFU) never
initiates a connection to a browser — every client sends UDP (preferred) or
TCP from behind its own NAT to one fixed, publicly reachable address:
`PUBLIC_IP:40000`. Ordinary NATs allow outbound traffic and its replies, so
there is nothing to traverse on the client side, and no TURN relay in v1 by
design. If a client's network blocks outbound UDP entirely, the connection
automatically falls back to TCP — **on the same media port**, not a separate
one.

So when voice fails, the problem is almost always on the server side of that
one address. Check, in order:

1. **Firewall**: `40000` open for **both** TCP and UDP (cloud provider
   security group *and* host firewall).
2. **Port mapping**: both protocols published, host port = container port
   (`40000:40000/udp` and `40000:40000/tcp`). A remapped host port can never
   work — announced ICE candidates carry `MEDIA_PORT`, so browsers dial the
   container's idea of the port no matter what the host maps.
   - Dokploy: both entries must use **`host` publish mode**
     ([why](dokploy.md#4-media-port--host-publish-mode-required)).
   - Coolify: confirm the `/udp` mapping survived
     ([how](coolify.md#4-media-port--ports-mappings)).
3. **Announced address**: grep the boot log for `public IP resolved` — that
   address is what browsers dial. It must be the server's real public IPv4.
   If auto-detection picked the wrong interface (multi-homed hosts, weird
   egress routing), set `PUBLIC_IP` explicitly.
4. **Symptom decoder**: users join the voice channel and see each other
   (that's WebSocket signalling, port 443) but hear nothing — that is
   precisely "signalling works, media doesn't": one of the three points above.

If both public-IP detection providers are unreachable at boot, the container
exits rather than starting with a wrong announce address (up-but-broken voice
is worse than down). Set `PUBLIC_IP` to boot without egress to those services.

## Volume permissions (bind mounts)

The container runs as the non-root `bun` user (UID/GID 1000). Docker **named
volumes** inherit `/data` ownership on first use — nothing to do. A **bind
mount** does not; the app will crash on first boot trying to create the DB.
One-time fix on the host:

```bash
chown -R 1000:1000 /path/you/mounted/to/data
```

## WebSockets behind a proxy

Everything rides one origin: the app is HTTP + WebSocket (`/ws`) on container
port `3000`, and realtime traffic (presence, messages, voice signalling) is
that one WS connection. The shipped Caddy config and both platforms' Traefik
proxy WebSocket upgrades natively — no extra config in the happy path.

If the SPA loads but nothing is live (no presence dots, messages only appear
on refresh), the `/ws` upgrade is failing. Check the browser devtools network
tab for the `/ws` request, then:

- **A proxy in front of the proxy** (Cloudflare, corporate LB, …) must pass
  `Upgrade`/`Connection` headers and allow long-lived connections. Generous
  idle/read timeouts help — the app pings, but aggressive sub-minute idle
  timeouts will churn connections.
- **Origin check**: the server rejects WS upgrades whose `Origin` doesn't
  match `APP_URL`. If the site is reachable under a second hostname (raw IP,
  www-vs-apex), WS fails for that hostname — serve the instance under exactly
  the `APP_URL` origin.
- **TLS termination**: the client connects `wss:` whenever the page is
  `https:`; the proxy must terminate TLS and forward plain HTTP to `:3000`
  (that's what the shipped Caddyfile does).
- **Dokploy**: open HTTP/2-vs-WebSocket Traefik issue — see
  [dokploy.md](dokploy.md#troubleshooting).

## Boot fails / update went wrong

The boot sequence logs one line per decision (secret source, public IP,
backup path, each migration). On a failed migration the container exits 1 and
restart policy will crash-loop it loudly — data is untouched (migrations are
transactional, and a pre-migration snapshot sits in `/data/backups`). Roll
back to the previous image tag and it boots again; see the rollback steps in
the [README](../../README.md#self-host).

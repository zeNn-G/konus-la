# Deploying Konus on Dokploy

Dokploy runs each application as a Docker Swarm service behind a shared Traefik
it manages. Konus is a single prebuilt image, so the whole deploy is
"paste the GHCR reference and wire four things": env, domain, media port,
volume.

Two Swarm-specific sharp edges live in this guide — the **`host` publish mode**
requirement on the media port (step 4) and an open **HTTP/2 WebSocket** issue
(troubleshooting). Don't skip step 4; voice will break silently without it.

## 1. Create the application

Project → **Create Application** → source type **Docker**. Image:

```text
ghcr.io/zenn-g/konus-la:latest
```

The image is public — no registry credentials needed. Dokploy never builds
anything; it pulls and runs this image.

## 2. Environment

In the **Environment** section, set the one required variable:

```text
APP_URL=https://chat.example.com
```

Everything else defaults (see the [README env table](../../README.md#self-host)).
`PUBLIC_IP` is auto-detected at boot; only set it if the detected address in the
boot log is wrong.

## 3. Domain / TLS

**Domains** section → add your domain:

- Host: `chat.example.com` (must already resolve to the server)
- **Container Port: `3000`**
- HTTPS: on, certificate provider: `letsencrypt`

Traefik terminates TLS and proxies HTTP + WebSocket to `:3000`. Domain changes
apply without a redeploy.

## 4. Media port — `host` publish mode (required)

Voice bypasses Traefik entirely: browsers dial `PUBLIC_IP:40000` directly.
Under **Advanced → Ports**, add **two** entries:

| Published Port | Target Port | Protocol | Publish Mode |
| --- | --- | --- | --- |
| `40000` | `40000` | TCP | **host** |
| `40000` | `40000` | UDP | **host** |

Both entries **must use `host` publish mode**, not the default `ingress`.
Swarm's ingress mesh SNATs traffic, so mediasoup would see the mesh's address
instead of the real client source address/port — poison for ICE/RTP. Voice
appears to connect and then carries no audio; nothing in the logs points at the
port mode. `host` binds the port directly on the node.

Open `40000/tcp` and `40000/udp` in the server's firewall as well.

## 5. Volume

**Advanced → Mounts** → **Volume Mount**:

- Volume name: `konus-data`
- Mount path: `/data`

Named volumes inherit the right ownership automatically (the container runs as
UID 1000). This volume holds the SQLite DB, the generated auth secret, and
pre-migration backups — it is the only state the instance has.

## 6. Deploy and claim the instance

Hit **Deploy**, watch the logs for `server listening`, then open the domain and
**sign up immediately** — the first account on a fresh instance becomes the
Instance Owner.

## Updates

Updates are stop-and-swap: the host-published media port forbids start-first
ordering (old and new containers can't both bind `40000`), so expect a few
seconds of downtime and dropped voice sessions per update. Keep the default
stop-first update order — do **not** configure Dokploy's zero-downtime
`start-first` recipe for this app.

**Manually:** click **Redeploy** after a Konus release — Dokploy re-pulls
`:latest`.

**From CI:** Dokploy has no GHCR webhook (DockerHub only), so trigger the
deploy API instead. Generate a token under **Settings → Profile → API/CLI**,
find your `applicationId` in the application's URL (or via
`GET /api/project.all`), then add a step like this to a workflow that runs
after a release:

```yaml
- name: Deploy to Dokploy
  run: |
    curl --fail -X POST "https://dokploy.example.com/api/application.deploy" \
      -H "x-api-key: ${{ secrets.DOKPLOY_TOKEN }}" \
      -H "Content-Type: application/json" \
      -d '{"applicationId": "${{ secrets.DOKPLOY_APP_ID }}"}'
```

## Troubleshooting

- **WebSockets fail behind Traefik (HTTP/2).** Open Dokploy issue
  [#4202](https://github.com/Dokploy/dokploy/issues/4202): when Traefik
  negotiates HTTP/2 (its default), classic `Upgrade` WebSockets can fail. If
  the app loads but never goes "live" (no presence, no incoming messages),
  check the browser console for `/ws` failures and apply the workaround from
  the issue — set `maxConcurrentStreams: 0` on the `websecure` entrypoint in
  Dokploy's `traefik.yml`, forcing HTTP/1.1.
- **Voice connects but is silent** → re-check step 4: both port entries in
  `host` mode, firewall open for both protocols.
- Everything else: [troubleshooting.md](troubleshooting.md).

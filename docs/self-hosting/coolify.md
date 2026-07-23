# Deploying Konus on Coolify

Coolify (v4) runs apps as plain Docker containers behind its shared proxy
(Traefik by default). Konus is a single prebuilt image: paste the GHCR
reference, wire env, domain, media port, volume.

Two Coolify-specific sharp edges live in this guide: the **`/udp` suffix** in
Ports Mappings (step 4) and the **`force=true` webhook bug** (updates). Read
both before going live.

## 1. Create the resource

**New Resource → Docker Image**. Image:

```text
ghcr.io/zenn-g/konus-la
```

Tag: `latest` (or pin a version). The image is public — no `docker login`
needed on the Coolify server.

## 2. Environment

**Environment Variables** tab — set the one required variable:

```text
APP_URL=https://chat.example.com
```

Everything else defaults (see the [README env table](../../README.md#self-host)).
`PUBLIC_IP` is auto-detected at boot; only set it if the detected address in
the boot log is wrong.

## 3. Domain / TLS

- **Domains**: FQDN form — `https://chat.example.com` (must already resolve to
  the server). Coolify configures the proxy and provisions Let's Encrypt
  automatically.
- **Ports Exposes**: `3000` — the container port the proxy routes HTTP and
  WebSocket traffic to.

## 4. Media port — Ports Mappings

Voice bypasses the proxy: browsers dial `PUBLIC_IP:40000` directly. In
**Ports Mappings**, enter exactly:

```text
40000:40000/tcp,40000:40000/udp
```

The field is passed verbatim into the generated compose `ports:` list, so the
compose short syntax with protocol suffixes goes through — but the `/udp`
suffix isn't shown in any Coolify docs example, so **verify it once**: after
the first deploy, run `docker ps` on the server and confirm the container
shows both `0.0.0.0:40000->40000/tcp` and `0.0.0.0:40000->40000/udp`. If the
UDP mapping is missing, fall back to the **Docker Compose build pack** with an
explicit `ports:` block:

```yaml
services:
  app:
    image: ghcr.io/zenn-g/konus-la:latest
    environment:
      APP_URL: https://chat.example.com
    ports:
      - "40000:40000/tcp"
      - "40000:40000/udp"
    volumes:
      - konus-data:/data
volumes:
  konus-data:
```

Open `40000/tcp` and `40000/udp` in the server's firewall as well.

Note: mapping ports to the host disables Coolify's rolling updates for this
resource — that's expected. Updates are stop-and-swap by design (the media
port can't be double-bound), so each update means a few seconds of downtime
and dropped voice sessions.

## 5. Volume

**Persistent Storage** tab → add a **Volume**:

- Name: `konus-data` (Coolify appends the resource UUID to avoid collisions)
- Destination: `/data`

Named volumes inherit the right ownership automatically (the container runs as
UID 1000). This volume holds the SQLite DB, the generated auth secret, and
pre-migration backups.

## 6. Deploy and claim the instance

Hit **Deploy**, watch the logs for `server listening`, then open the domain
and **sign up immediately** — the first account on a fresh instance becomes
the Instance Owner.

The image ships a `HEALTHCHECK` with a 300 s start period (grace for
first-boot migrations on a big DB). Coolify takes an unhealthy container off
the proxy, so if the app is unreachable right after a deploy, check
`docker inspect` health status before suspecting the proxy.

## Updates

**Manually:** use the UI's **Pull latest images & restart**.

**From CI:** every resource has a deploy webhook (resource → **Webhooks**) and
API tokens live under **Keys & Tokens**. Add a step like this to a workflow
that runs after a release:

```yaml
- name: Deploy to Coolify
  run: |
    curl --fail "${{ secrets.COOLIFY_WEBHOOK }}" \
      -H "Authorization: Bearer ${{ secrets.COOLIFY_TOKEN }}"
```

Call the webhook **plain — never with `force=true`**. Open bug
[#5318](https://github.com/coollabsio/coolify/issues/5318): the forced variant
restarts the container *without pulling the new image*, so a "successful"
forced deploy silently keeps running the old version.

## Troubleshooting

- **App loads but never goes "live"** (no presence, no incoming messages):
  check the browser console for `/ws` failures. There are field reports of
  flaky WebSocket/SSE behind Coolify's Traefik
  ([#4002](https://github.com/coollabsio/coolify/issues/4002)) — verify with a
  live WS check after first deploy.
- **Voice connects but is silent** → re-check step 4: both protocol mappings
  present in `docker ps`, firewall open for both.
- Everything else: [troubleshooting.md](troubleshooting.md).

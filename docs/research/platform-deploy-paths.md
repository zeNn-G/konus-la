# Research: Dokploy & Coolify deploy paths for the single image (#100)

Resolves wayfinder research issue [#100](https://github.com/zeNn-G/konus-la/issues/100)
(parent [#98](https://github.com/zeNn-G/konus-la/issues/98), blocking [#102](https://github.com/zeNn-G/konus-la/issues/102)).

Deployment model under test (charter decision 2): one public image
`ghcr.io/zenn-g/konus-la:latest`, HTTP+WS on `:3000` behind the platform's
Traefik, media port `40000` published host→container directly as **both**
`udp` and `tcp` (bypassing the proxy), persistent data on a `/data` volume,
required env `APP_URL`.

Legend: **[verified]** = stated in primary docs or platform source code, cited.
**[inference]** = follows from verified facts but not literally documented; treat
as "confirm once on a test box" before it goes into a user-facing guide.

---

## Dokploy

Dokploy runs each application as a Docker Swarm service and fronts HTTP with a
shared Traefik it manages via file-provider dynamic config
([domains docs](https://docs.dokploy.com/docs/core/domains)).

### 1. Deploying the prebuilt GHCR image

**[verified]** Create an Application and pick **Docker** as the source type,
then enter the image reference (e.g. `ghcr.io/zenn-g/konus-la:latest`). The
server never builds anything — it pulls and runs the prebuilt image
([Going Production](https://docs.dokploy.com/docs/core/applications/going-production)).
A public GHCR image needs no registry credentials; private registries are
supported via registry credentials, not needed for our public image.

**[verified]** Environment variables (our `APP_URL`) are set per-application in
the Environment section
([Going Production](https://docs.dokploy.com/docs/core/applications/going-production)).

### 2. Domain / TLS / WebSocket wiring

**[verified]** Domains section per application: add the domain, toggle HTTPS,
select `letsencrypt` as certificate provider — issuance and renewal are
automatic. The **container port** field (ours: `3000`) tells Traefik where to
route internally and "does not expose the port directly to the internet".
Domain changes for applications take effect without a redeploy (file-provider
config, not labels) ([domains docs](https://docs.dokploy.com/docs/core/domains)).

**[verified]** No WebSocket-specific configuration is documented — Traefik
passes `Upgrade` requests through by default.

**[verified — open issue]** Dokploy issue
[#4202](https://github.com/Dokploy/dokploy/issues/4202) (open, reported
2026-04 against v0.28.8): WebSocket connections fail when Traefik negotiates
HTTP/2 (default config) because h2 has no classic `Upgrade` mechanism. The
report is about Dokploy's *own* dashboard log/monitoring sockets, but app
traffic shares the same `websecure` entrypoint. Workaround documented in the
issue: set `maxConcurrentStreams: 0` on the entrypoint in `traefik.yml`,
forcing HTTP/1.1. **[inference]** Our app's `/ws` runs over the same
entrypoint, so this is a watch-item for the Dokploy guide; verify live WS on a
test deploy and keep the workaround in the troubleshooting section.

### 3. Direct UDP+TCP port publishing (media port 40000)

**[verified]** Advanced → Ports lets you publish ports host→container with
**Published Port**, **Target Port**, and **Protocol** = TCP or UDP
([Advanced settings](https://docs.dokploy.com/docs/core/applications/advanced)).
The docs note this path "is not for accessing the application through a
domain" — i.e. it bypasses Traefik entirely, which is exactly what we want for
40000. Two entries are needed: `40000→40000/tcp` and `40000→40000/udp`.

**[verified]** Because apps are Swarm services, each published port has a
**publish mode**: `ingress` (default) or `host` — both exposed in the API
([Port API reference](https://docs.dokploy.com/docs/api/reference-port)) and
selectable in the UI since PR
[#2124](https://github.com/Dokploy/dokploy/pull/2124) (merged 2025-07-05,
closing [#1570](https://github.com/Dokploy/dokploy/issues/1570)).

**[inference — important]** Use **host** mode for 40000. Ingress mode routes
through Swarm's mesh, which SNATs traffic — mediasoup would see the mesh's
address instead of the real client source address/port, which is poison for
ICE/RTP on a voice server, and adds a hop. Host mode binds the port directly
on the node. This is standard Docker Swarm behavior, not Dokploy-specific; the
Dokploy guide must tell users to pick host mode explicitly since ingress is
the default.

### 4. Volume for `/data`

**[verified]** Advanced → Mounts supports three types; **Volume Mount**
(Docker named volume + container mount path) is the right one: volume name
e.g. `konus-data`, mount path `/data`
([Advanced settings](https://docs.dokploy.com/docs/core/applications/advanced)).

### 5. Auto-update triggers

**[verified]** ([Auto Deploy docs](https://docs.dokploy.com/docs/core/auto-deploy)):

- Push-to-git webhooks: GitHub (zero config), GitLab, Bitbucket, Gitea —
  irrelevant for image-based deploys.
- **DockerHub webhook** (Applications only): deploys when the pushed tag
  matches the one configured in Dokploy. **GHCR is not in the supported
  webhook list**, so this path is unavailable to us.
- **API**: generate a token in profile settings, find the app via
  `GET /api/project.all`, trigger with `POST /api/application.deploy`
  (`{ applicationId }`). This is the documented CI path.

**[inference]** Our release workflow therefore needs nothing new: after
pushing `:latest` to GHCR, a user-configured step (or the user manually) calls
`application.deploy`. Redeploying a Docker-source app re-pulls the tag (Swarm
re-resolves the tag's digest on service update); not literally documented —
confirm once during the walkthrough.

### 6. Gotchas

- **Zero-downtime vs. the published media port.** Dokploy's zero-downtime
  recipe is Swarm healthcheck + `Order: start-first` update config
  ([Zero Downtime docs](https://docs.dokploy.com/docs/core/applications/zero-downtime)).
  **[inference]** `start-first` cannot work with a host-mode published port —
  old and new containers would both bind host `40000`. Keep the default
  stop-first order and accept a few seconds of downtime per update (voice
  sessions drop on server restart anyway).
- **Healthcheck** is opt-in via Advanced → Cluster/Swarm Settings (test
  command, interval, retries) — the image doesn't need a Dockerfile
  `HEALTHCHECK` for Dokploy, but a `/health`-style HTTP route makes the swarm
  config trivial ([Zero Downtime docs](https://docs.dokploy.com/docs/core/applications/zero-downtime)).
- **HTTP/2 + WS issue [#4202](https://github.com/Dokploy/dokploy/issues/4202)**
  (see §2) — still open as of 2026-07-19.
- Nothing documented about non-root images; named-volume ownership under
  `/data` is the image's problem (our entrypoint must `chown`/run with a UID
  that can write the volume) — same as plain Docker. **[inference]**

---

## Coolify

Coolify (v4) runs apps as plain Docker containers via generated compose files,
fronted by a shared proxy — Traefik by default, Caddy optional
([domains docs](https://coolify.io/docs/knowledge-base/domains)).

### 1. Deploying the prebuilt GHCR image

**[verified]** New Resource → **Docker Image** — "Deploy pre-built images from
registries" without git ([Applications docs](https://coolify.io/docs/applications)).
Also scriptable: `POST /applications/dockerimage` with
`docker_registry_image_name`, `docker_registry_image_tag`, `ports_exposes`,
`domains`
([API: Create Docker-image application](https://coolify.io/docs/api-reference/api/operations/create-dockerimage-application)).

**[verified]** Public images need no auth. Private GHCR would require
`docker login ghcr.io` on the Coolify server
([Docker Registry docs](https://coolify.io/docs/knowledge-base/docker/registry));
not needed for us.

Env vars are per-resource in the Environment Variables tab
([Applications docs](https://coolify.io/docs/applications)).

### 2. Domain / TLS / WebSocket wiring

**[verified]** Set the domain in FQDN form (`https://chat.example.com`);
Coolify "automatically applies the necessary configuration to your reverse
proxy (Traefik or Caddy)", requests Let's Encrypt certificates, renews them,
and falls back to a self-signed cert if issuance fails
([domains docs](https://coolify.io/docs/knowledge-base/domains)).

**[verified]** **Ports Exposes** = the container port the proxy routes to
(ours: `3000`); the first listed port is also the default healthcheck port
([Applications docs](https://coolify.io/docs/applications)).

**[verified]** No WebSocket-specific config is documented; Traefik handles
upgrades natively. There are field reports of flaky SSE/WS behind Coolify's
Traefik ([issue #4002](https://github.com/coollabsio/coolify/issues/4002)) —
worth a live check during the walkthrough, but nothing indicates a default
proxy timeout that kills long-lived WS.

### 3. Direct UDP+TCP port publishing (media port 40000)

**[verified]** **Ports Mappings** (`HOST:CONTAINER`, comma-separated) maps
ports straight to the host, bypassing the proxy. Docs warn: "You will lose
some functionality if you map a port to the host system, like `Rolling
Updates`" ([Applications docs](https://coolify.io/docs/applications)).

**[verified — source]** The mapping strings are stored raw and comma-split
verbatim into the generated compose `ports:` list —
`app/Models/Application.php`:

```php
public function portsMappingsArray(): Attribute
{
    return Attribute::make(
        get: fn () => is_null($this->ports_mappings)
            ? []
            : explode(',', $this->ports_mappings),
    );
}
```

([source](https://github.com/coollabsio/coolify/blob/main/app/Models/Application.php))
— so `40000:40000/tcp,40000:40000/udp` should pass the compose short syntax
through unmodified. **[inference]** The `/udp` suffix in this field is not
shown in any docs example (docs only show `8080:80`); community confirmation
exists for UDP via the compose route (TURN server,
[discussion #1014](https://github.com/coollabsio/coolify/discussions/1014)).
Verify the suffix once in the UI during the walkthrough; the guaranteed
fallback is the **Docker Compose build pack** with an explicit `ports:` block.

Docker's normal bridge NAT preserves client source addresses for published
UDP — no Swarm mesh involved, so no Dokploy-style mode decision. **[inference]**

### 4. Volume for `/data`

**[verified]** Persistent Storage tab → add a **Volume**: name + destination
(`/data`). Coolify appends the resource UUID to the volume name to avoid
collisions ([Persistent Storage docs](https://coolify.io/docs/knowledge-base/persistent-storage)).

### 5. Auto-update triggers

**[verified]** Every resource has a **deploy webhook**; Coolify's own CI docs
show exactly our flow — build, push to `ghcr.io` with tag `latest`, then:

```bash
curl --request GET "$COOLIFY_WEBHOOK" --header "Authorization: Bearer $COOLIFY_TOKEN"
```

([GitHub Actions docs](https://coolify.io/docs/applications/ci-cd/github/actions);
endpoint reference: [deploy by tag or uuid](https://coolify.io/docs/api-reference/api/operations/deploy-by-tag-or-uuid) —
accepts `uuid` (comma-separated list ok) or `tag`). A normal deploy of a
Docker-image resource re-runs the deployment and pulls the tag.

**[verified — open bug]** Do **not** rely on `force=true`:
[issue #5318](https://github.com/coollabsio/coolify/issues/5318) (still open
2026-07-19) — the forced variant restarts the container without pulling the
new image. Use the plain webhook, or the UI's "Pull latest images & restart".

**[verified]** No built-in registry polling / tag-watching — updates are
webhook- or UI-triggered only (nothing like Watchtower is documented).

### 6. Gotchas

- **Ports Mappings disables rolling updates.** Documented
  ([Applications docs](https://coolify.io/docs/applications),
  [Rolling updates docs](https://coolify.io/docs/knowledge-base/rolling-updates))
  and visible in `ApplicationDeploymentJob` — with mappings present the old
  container is stopped before the new one starts. Same physics as Dokploy:
  host port 40000 can't be double-bound. Updates mean seconds of downtime.
- **Unhealthy = unrouted.** "Traefik Proxy won't work if the container has
  health check defined, but it is unhealthy"
  ([Applications docs](https://coolify.io/docs/applications)). If our image
  ships a Dockerfile `HEALTHCHECK`, it must be reliable (and tolerant of slow
  first boot), or Coolify will pull the app off the proxy.
- Nothing documented about non-root images; `/data` volume ownership is the
  image's responsibility, as with Dokploy. **[inference]**

---

## Answer summary (feeds spec §Platform deploys)

| Question | Dokploy | Coolify |
| --- | --- | --- |
| Host-publish `40000/udp+tcp`, proxy bypassed | Yes — Advanced → Ports, protocol per entry; **must pick `host` publish mode** (Swarm ingress SNATs) | Yes — Ports Mappings `40000:40000/tcp,40000:40000/udp` (`/udp` suffix passes through source verbatim; confirm in UI once) |
| Paste-GHCR-image flow (env, domain, TLS, WS, `/data`) | Yes — Docker source + Environment + Domains (LE auto-TLS, port 3000) + Volume Mount | Yes — Docker Image resource + Env tab + FQDN (LE auto-TLS) + Ports Exposes `3000` + Persistent Storage volume |
| Auto-update on new image | No GHCR webhook (DockerHub only) → CI calls `POST /api/application.deploy` with API token | Per-resource deploy webhook, `GET /api/v1/deploy?uuid=…` + bearer token; avoid `force=true` (open bug #5318) |
| Update downtime | Seconds (host-published port forbids start-first) | Seconds (Ports Mappings disables rolling updates) |

**What our release workflow must expose: nothing.** Both platforms are
pull-triggered by an authenticated HTTP call the *user* configures with their
own instance URL + token. The per-platform guides should ship a copy-paste
GitHub Actions step (Coolify's docs already model it) — but plain "click
redeploy after a release" also works.

**Blockers for the spec: none.** Both platforms support the single-image
model. The spec should state that platform updates imply a brief restart
(voice sessions drop regardless), and the guides must carry three sharp edges:
Dokploy host-mode selection, the Coolify `/udp`-suffix verification (compose
fallback), and the Coolify `force=true` webhook bug.

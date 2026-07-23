# Release smoke-test runbook

Maintainer checklist, not a user doc. Two tiers:

- **Full pass on a real VPS** — run once against `v1.0.0`, and again for any
  release touching deployment machinery (Dockerfile, `boot.ts`, media
  networking, the compose recipe). Only the real internet proves `PUBLIC_IP`
  detection, Caddy TLS issuance, and ICE to `PUBLIC_IP:40000` — localhost
  media proves nothing about the announced-address path. Use a throwaway VPS;
  tear it down after.
- **Local Docker abbreviated pass** — every ordinary release, on the dev box
  against the fresh image. Same steps minus real-internet voice: voice gets a
  same-box glance with `PUBLIC_IP=127.0.0.1`.

Log lines referenced below are the boot sequence's one-line-per-decision
output — grep the container logs (`docker compose logs app`) for them
verbatim.

## Setup — full VPS pass

1. Provision a throwaway VPS (smallest x86 box with Docker works; both image
   arches are published, arm64 boxes are fine too). Open inbound `80`, `443`,
   `40000/tcp`, `40000/udp` in the provider firewall.
2. Point a throwaway DNS A record at it and wait for it to resolve.
3. Copy the three `deploy/` files, `cp .env.example .env`, set `DOMAIN`.
4. Pin the release-candidate image in `docker-compose.yml` — the exact
   tag/digest under test, not `:latest`.

## Setup — local abbreviated pass

Same three `deploy/` files in a scratch directory, with two overrides on the
`app` service: `PUBLIC_IP: 127.0.0.1` (skips echo detection, keeps voice
same-box testable) and drop the `caddy` service / talk to `:3000` directly
(set `APP_URL: http://localhost:3000` and publish `3000:3000` — Let's Encrypt
can't issue for localhost, so the Caddyfile is only exercised by the VPS
tier). Start from an **empty volume**.

## The pass

### 1. Fresh boot

- [ ] `docker compose up -d` on an empty volume, `APP_URL` the only app config.
- [ ] Log shows `auth secret: generated and persisted`.
- [ ] Log shows `derived BETTER_AUTH_URL and CORS_ORIGIN from APP_URL`.
- [ ] Log shows `public IP resolved` with `source` = a provider name (VPS) or
      `env` (local), and the VPS's real address.
- [ ] Log shows one `migration applied` line per migration, then
      `server listening`.
- [ ] `curl https://$DOMAIN/health` → `200 {"status":"ok"}`.
- [ ] `docker ps` shows the container `healthy`.

### 2. Instance owner signup

- [ ] First signup succeeds **without** an invite code and lands in the app.
- [ ] That account has owner surfaces (user settings → admin group: invite
      codes, instance bans).

### 3. SPA serving

- [ ] The SPA loads over HTTPS (VPS: real Let's Encrypt cert, no warning).
- [ ] A deep link (`/g/…/c/…`) survives a hard refresh (index.html fallback).
- [ ] DevTools network: `/assets/*` responses carry
      `cache-control: public, max-age=31536000, immutable`; the document
      response carries `cache-control: no-cache`.

### 4. Two-user chat over WS

- [ ] Owner mints an invite code; second user signs up with it (second
      browser/device — on the VPS pass, ideally a different network).
- [ ] Messages flow both ways live, no refresh. Presence dots and typing
      indicator update.

### 5. Two-user voice

- [ ] Both users join a voice channel; audio flows **both ways**.
- [ ] VPS pass: users on different networks (e.g. one on hotspot/mobile) — this
      is the real ICE-to-`PUBLIC_IP:40000` proof.
- [ ] If feasible, TCP fallback: block outbound UDP on one client (or its
      network) and confirm voice still connects (slower ramp is fine).
- [ ] Local pass: a same-box two-tab call connecting at all is the bar.

### 6. Update with a pending migration

- [ ] Boot the **previous** release tag first with some data created (steps
      2–4), then swap the compose image tag to the release candidate and
      `docker compose up -d`.
- [ ] If the new release carries a migration: log shows
      `pre-migration backup created` with a `backupPath` under
      `/data/backups/`, then `migration applied`. If it carries none: log
      shows `no migration pending` (and note that this step didn't exercise
      backup this release).
- [ ] Existing users, guilds, and messages are intact after the swap.

For **v1.0.0 there is no previous release**: fabricate one by pushing a
`v0.0.0-test` prerelease tag from an older commit that has fewer migration
files (e.g. a pre-Phase-6 commit — the tag-triggered image workflow builds
prerelease tags without claiming `:latest`), boot that, then update to the
candidate. If that's more machinery than the moment warrants, verify the
backup path in the local pass the same way and record it in the checklist.

### 7. Rollback

- [ ] Pin the previous tag again, restore the step-6 snapshot over
      `/data/konus.db` (rollback steps in the
      [README](../../README.md#self-host)), `docker compose up -d`.
- [ ] Previous version boots clean against the restored DB and serves.

## Teardown (VPS pass)

- [ ] Destroy the VPS and delete the DNS record.
- [ ] Record the ticked checklist in the release PR or issue.

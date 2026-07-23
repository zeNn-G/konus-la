# konus-la

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, TanStack Router, Hono, ORPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Router** - File-based routing with full type safety
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **Bun** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **SQLite/Turso** - Database engine
- **Authentication** - Better-Auth
- **Oxlint** - Oxlint + Oxfmt (linting & formatting)
- **Turborepo** - Optimized monorepo build system

## Self-Host

One Docker image is the whole product: SPA, API, WebSocket realtime, and voice
(mediasoup SFU) served from a single container. TLS comes from the Caddy
service in the shipped compose file.

**Requirements**

- A Linux host with Docker (Compose v2 included)
- A domain with an A record pointing at the host
- Inbound ports open: `80`, `443`, and `40000` (TCP **and** UDP — the WebRTC media port)

**Quick start**

Copy the three files in [`deploy/`](deploy/) to the host, then:

```bash
cp .env.example .env   # set DOMAIN=chat.example.com
docker compose up -d
```

Open `https://your-domain` — the first account to sign up becomes the Instance
Owner and mints invite codes for everyone else, so register immediately after
first boot.

Deploying on Dokploy or Coolify instead of a raw VPS? See
[`docs/self-hosting/`](docs/self-hosting/) — plus
[troubleshooting](docs/self-hosting/troubleshooting.md) for voice/NAT, volume
permissions, and proxy notes.

**Configuration**

`APP_URL` is the only required variable (the compose file derives it from
`DOMAIN`). Everything else defaults or is derived at boot:

| Var | Required | Default / derivation |
| --- | --- | --- |
| `APP_URL` | **yes** | — the instance's public origin, e.g. `https://chat.example.com` |
| `PUBLIC_IP` | no | auto-detected at boot via HTTPS echo (the address voice candidates announce) |
| `MEDIA_PORT` | no | `40000` — host port **must equal** container port (announced ICE candidates carry it) |
| `PORT` | no | `3000` — HTTP port behind the proxy |
| `DATABASE_URL` | no | `file:/data/konus.db` |
| `BETTER_AUTH_SECRET` | no | generated once at first boot, persisted at `/data/.auth-secret` |
| `BACKUP_RETENTION` | no | `5` — pre-migration snapshots kept in `/data/backups` |
| `MEDIASOUP_MAX_INCOMING_BITRATE` | no | `6500000` — per-sender bitrate ceiling (bps) |
| `MAX_GUILDS_PER_USER` | no | `5` |
| `MAX_DM_GROUP_SIZE` | no | `10` |

**Update** (expect a few seconds of downtime — updates are stop-and-swap by design):

```bash
docker compose pull && docker compose up -d
```

**Rollback** — pin the previous tag in `docker-compose.yml`
(`image: ghcr.io/zenn-g/konus-la:<previous-version>`), then:

```bash
docker compose up -d
```

If the failed update had applied a migration, restore the snapshot it took first:

```bash
docker compose stop app
docker compose run --rm --no-deps app ls /data/backups
docker compose run --rm --no-deps app cp /data/backups/<snapshot>.db /data/konus.db
docker compose up -d
```

**Backup** — every update with a pending migration snapshots the DB to
`/data/backups` automatically. For a manual copy:

```bash
docker compose stop app && docker compose cp app:/data/konus.db ./konus-backup.db && docker compose start app
```

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Database Setup

This project uses SQLite with Drizzle ORM.

1. Start the local SQLite database (optional):

```bash
bun run db:local
```

2. Update your `.env` file in the `apps/server` directory with the appropriate connection details if needed.

3. Apply the schema to your database:

```bash
bun run db:push
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@konus-la/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Git Hooks and Formatting

- Format and lint fix: `bun run check`

## Project Structure

```
konus-la/
├── apps/
│   ├── web/         # Frontend application (React + TanStack Router)
│   └── server/      # Backend API (Hono, ORPC)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:push`: Push schema changes to database
- `bun run db:generate`: Generate database client/types
- `bun run db:migrate`: Run database migrations
- `bun run db:studio`: Open database studio UI
- `bun run db:local`: Start the local SQLite database
- `bun run check`: Run Oxlint and Oxfmt

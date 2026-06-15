# DB

Drizzle ORM over libSQL/Turso. Schema lives in `src/schema/`; migrations are generated from it via `drizzle-kit`.

## Language

- **User** — identity record (one per email).
- **Instance Owner** — the single **User** who owns the whole self-hosted instance: the one whose Better Auth global `role` is `admin` (via the admin plugin). The first account ever registered becomes the owner, bypassing the invite gate; everyone after needs a **SignupCode**. Owns code minting and instance-level moderation (instance-ban). Distinct from a **Guild Admin**, which is per-guild and never carries the global `admin` role.
- **Username** — a **User**'s unique, immutable `@mention` handle (`^[a-z0-9_]{3,20}$`, lowercased). Not a sign-in identifier — sign-in is email + password. The only profile column added in Phase 1. Reserved (rejected at signup): `everyone`, `here`, `admin`, `system`, `owner`. Validation + reserved-list live in `src/constants.ts`. Immutability is enforced by a Better Auth `user.update` hook that strips the field.
- **displayName** — the mutable name shown in chat. This **is** Better Auth's `name` column, not a separate field. Defaults to the username at signup when left blank.
- **avatarUrl** — this **is** Better Auth's `image` column. Nullable; the client renders a deterministic Dicebear avatar (seeded by username) when null. No setter in v1 (object storage is post-v1), so it stays null.
- **role / banned** — supplied by the Better Auth **admin plugin** (`role`, `banned`, `banReason`, `banExpires`), not hand-rolled. The Instance Owner has `role='admin'`; **instanceBanned** is `banned`. See [ADR 0002](../../docs/adr/0002-two-tier-authorization.md).
- **SignupCode** — a single-use invitation token granting the right to register one account. Has an optional `expiresAt`; claimed atomically at signup via a conditional `WHERE usedAt IS NULL` update (`usedAt` + `usedByUserId` set). Minted by the **Instance Owner**. The zero-users bootstrap signup needs no code. `revoke` hard-deletes a still-unused row; claimed rows are kept as a record. Query helpers live in `src/queries/` so `@konus-la/auth` and `@konus-la/api` never import `drizzle-orm`.
- **Guild** — a self-contained server **User**s belong to (and later, its channels). Owned by exactly one **User** via `ownerId` — never a role row (see [ADR 0004](../../docs/adr/0004-per-guild-authorization-custom-rbac-tables.md)). Non-unique `name`; nullable `icon` (client renders a Dicebear `identicon` seeded by the guild id when null). The `MAX_GUILDS_PER_USER` cap counts **owned** guilds only.
- **GuildMembership** — a **User**'s membership in a **Guild** (PK `(userId, guildId)`). The owner holds a row like everyone else. Membership alone _is_ the implicit **@everyone**.
- **GuildRole** — a role within one **Guild**. Phase 2 seeds exactly one per guild, `isDefault: true` marking the implicit **@everyone** (identified by the flag, never the name). The `permissions` bitfield arrives with the deferred RBAC work.
- **MemberRole** — assignment of a non-default **GuildRole** to a member. **Empty in Phase 2** (the default role is never materialised here); exists so custom-role assignment is purely additive later.
- **GuildInvite** — a shareable, multi-use invite code for a **Guild**. Time-only expiry (`expiresAt` nullable = never); `usedCount` is display-only (no max-uses cap). Consumed atomically (ban check → already-member no-op → insert membership + tick `usedCount`); revoke hard-deletes.
- **GuildBan** — a **User** barred from rejoining a **Guild** (PK `(guildId, userId)`). A ban beats an invite (checked in `consumeInvite`).
- **Session** — a live login, belongs to a **User**.
- **Account** — a sign-in credential (email/password or OAuth) attached to a **User**. Not a billing/tenant account.
- **Verification** — one-shot token (email verify, password reset).

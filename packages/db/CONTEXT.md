# DB

Drizzle ORM over libSQL/Turso. Schema lives in `src/schema/`; migrations are generated from it via `drizzle-kit`.

## Language

- **User** — identity record (one per email).
- **Instance Owner** — the single **User** who owns the whole self-hosted instance: the one whose Better Auth global `role` is `admin` (via the admin plugin). The first account ever registered becomes the owner, bypassing the invite gate; everyone after needs a **SignupCode**. Owns code minting and instance-level moderation (instance-ban). Distinct from a **Guild Admin**, which is per-guild and never carries the global `admin` role.
- **Username** — a **User**'s unique, immutable `@mention` handle (`^[a-z0-9_]{3,20}$`, lowercased). Not a sign-in identifier — sign-in is email + password. Distinct from **displayName** (the mutable `name` shown in chat).
- **SignupCode** — a single-use invitation token granting the right to register one account. Has an `expiresAt`; claimed atomically at signup (`usedAt` + `usedByUserId` set). Minted by the **Instance Owner**. The zero-users bootstrap signup needs no code. Used/expired rows are kept until cleanup (manual now, possibly auto-swept later).
- **Session** — a live login, belongs to a **User**.
- **Account** — a sign-in credential (email/password or OAuth) attached to a **User**. Not a billing/tenant account.
- **Verification** — one-shot token (email verify, password reset).

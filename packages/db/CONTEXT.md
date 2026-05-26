# DB

Drizzle ORM over libSQL/Turso. Schema lives in `src/schema/`; migrations are generated from it via `drizzle-kit`.

## Language

- **User** — identity record (one per email).
- **Session** — a live login, belongs to a **User**.
- **Account** — a sign-in credential (email/password or OAuth) attached to a **User**. Not a billing/tenant account.
- **Verification** — one-shot token (email verify, password reset).

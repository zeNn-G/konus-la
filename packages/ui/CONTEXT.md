# UI

Shared React components — shadcn primitives on top of `@base-ui/react`, styled with Tailwind.

## Notable components

- **`Avatar`** — renders an explicit `src` when present, otherwise a deterministic Dicebear avatar
  (`@dicebear/core` + `@dicebear/styles`, "lorelei") seeded by a stable `seed` (the user's username).
  In v1 there is no avatar setter, so everyone gets a generated avatar keyed by their username.

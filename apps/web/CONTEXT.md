# Web

Vite + React 19 SPA. File-based routing via TanStack Router, server state via TanStack Query, RPC calls via the ORPC client.

## Route structure

Routes are organised into pathless groups under `src/routes/` (group names don't affect URLs):

- **`(auth)/`** — public pages with no app shell: `login`, `signup`.
- **`(app)/`** — the authenticated area. `(app)/route.tsx` is a layout that guards every child once
  (`beforeLoad` → `requireSession`) and renders the shared shell (header + `UserCard`). Its resolved
  session flows into child route context.
  - **`(app)/admin/`** — nested layout that adds the Instance-Owner gate (`requireAdmin`) for `/admin/*`.

Guards live on the **layouts**, not individual pages — so a page like `profile` or `admin/codes` has no
`beforeLoad`; it inherits the session from its parent layout's context.

## Auth & session

- `lib/auth-client.ts` — Better Auth React client, typed with `inferAdditionalFields<typeof auth>()`
  (for `username`) and `adminClient()` (for `role` / `banned`).
- `lib/auth-guard.ts` — `requireSession` / `requireAdmin` call `authClient.getSession()` **directly** in
  layout `beforeLoad`. There is deliberately **no client-side session cache**: TanStack Router's match
  caching de-dupes hover preloads, and a live `getSession` per navigation keeps auth transitions correct
  (a cached session went stale across sign-in/out).
- Components read the session from route context: route components via `Route.useRouteContext()`, other
  components (e.g. `UserCard`) via `getRouteApi("/(app)").useRouteContext()`. After a profile edit, call
  `router.invalidate()` to re-run the layout guard and refresh context.
- Sign in / up / out use Better Auth's `onSuccess` / `onError` callbacks to navigate + toast — no manual
  cache work. The signup code is sent as the `x-signup-code` request header.

## Forms

Auth forms use **TanStack Form** (`@tanstack/react-form`) with zod `validators.onSubmit`. Field errors render
through the shared `components/field-error.tsx`.

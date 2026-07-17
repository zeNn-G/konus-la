# User-settings dialog prototype — wayfinder #77

**Question:** What does the Discord-style user-settings dialog look like — its IA
(Profile / Voice / Notifications), its trigger from UserCard, the fate of the admin
shortcut links, and the Voice/Notifications section contents?

**Run it:** `bun apps/e2e/boot-proto.ts` (scratch stack on 3100/3101, sign in as
`alice@e2e.local` / `alice-e2e-password-1`), then append `?variant=a` to any app URL.
`←`/`→` cycle variants; the amber pill exits. Or run your own dev stack — the prototype
rides any `(app)` route.

| Variant | Dialog shape | Devices vs ControlDeck popover | Admin links / sign-out |
| --- | --- | --- | --- |
| A — Full-screen takeover | Discord-faithful takeover, grouped nav rail, ESC pill | **Move**: popover gone, deck gear opens dialog at Voice | Both move into the nav rail |
| B — Guild-settings modal | Same shell as GuildSettingsDialog (sm:max-w-3xl) | **Split**: devices stay in popover; dialog owns volume + sounds | Both stay in the sidebar footer |
| C — Single-scroll sheet | Right sheet, sticky scroll-spy tabs, one column | **Duplicate**: popover stays AND dialog lists devices | Admin rows at column bottom; sign-out stays in footer |

Sound-inventory placement also varies: A and C keep one unified list (ping included);
B splits — voice sounds under Voice, notification ping toggle under Notifications.

## Verdict

**First reaction (2026-07-17): variant B wins, refined** — bigger shell
(`sm:max-w-5xl`, `min(90vh,760px)`, 220px rail), the UserCard unified into the dialog
(Admin group + Sign out at the rail bottom; the footer keeps only the chip), and A's
device pickers baked into Voice (the ControlDeck gear now opens the dialog, popover
gone in B). `proto-09`/`proto-10` capture the refined take.

_(awaiting confirmation on the refined B before the ticket closes)_

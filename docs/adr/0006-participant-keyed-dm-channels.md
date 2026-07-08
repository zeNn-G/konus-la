# DMs: participant-keyed channels, two flavors, draft-created 1:1s

Phase 4 models DMs as `Channel { kind: 'dm', guildId: null }` rows whose membership lives in
a new **`channelParticipant`** table — the DM-side twin of `guildMembership`. Every
channel-scoped code path (auth, fan-out, mentions, presence) branches on `guildId` being
null; the chat machinery (messages, history, read state, typing, rate limits) is reused
verbatim.

## Context

The ROADMAP sketched `dm.openWithUser / createGroup / addParticipant / removeParticipant /
leave` and "DM is just a channel." The decisions that needed settling, and where they
landed:

- **1:1 and group are distinct flavors** (`channel.isGroup`), not one concept. A 1:1 never
  upgrades to a group — upgrading would leak private history to a third party and make "the
  conversation with Alice" ambiguous. Groups are created explicitly (creator + ≥2 others,
  capped by `MAX_DM_GROUP_SIZE`, default 10; groups may later shrink below 3).
- **1:1 uniqueness via `dmPairKey`** — the sorted `"idA:idB"` pair under a unique index.
  SQLite treats NULLs as distinct in unique indexes, so guild channels and groups (both
  NULL) never collide with it. `openDmWithUser` leans on this instead of an interactive
  transaction: concurrent opens from both sides contend on the embedded libsql file lock
  (SQLITE_BUSY), so the insert is a bare `onConflictDoNothing({ target: dmPairKey })` and
  the participant upserts are conflict-ignoring — both racers converge on one channel.
- **Draft-created 1:1s (Teams-style)** — picking a user creates NOTHING; the first send
  calls the idempotent `openWithUser` then `sendMessage`. Consequently `dm.openWithUser`
  publishes no event (the first `message.created` introduces the conversation to the
  recipient) and `dm.list` hides 1:1s with zero messages as a safety net against
  crash-orphaned empty channels. Rejected alternative: create-on-open, which either ghosts
  empty conversations into the recipient's list or demands per-user hide state (parked
  post-v1 along with 1:1 hiding in general).
- **Group owner is `channel.ownerId`** (nullable; set only for groups), following ADR 0004's
  column-not-role-row precedent — one source of truth, transfer is a single UPDATE. An
  `isOwner` flag on the participant row would need a partial unique index to fake "exactly
  one owner". Anyone can add members; only the owner removes; owner-leave auto-transfers to
  the longest-standing participant (earliest `joinedAt`, then lowest `userId`); the last
  leaver hard-deletes the channel. In DMs message deletion is **author-only** — the owner
  moderates people, not messages.
- **Membership is the only key to history.** Leaving/removal deletes the participant row
  AND the member's `channelReadState` row — without the latter, a re-added member inherits
  a stale watermark that silently marks pre-removal history as read. Newly added members
  see full history (no `joinedAt` filtering of `chat.history`).
- **Events: relax `guildId` to `string | null`** on the existing `message.*` / `typing` /
  `channel.*` variants rather than minting parallel `dm.*` copies — the web dispatcher
  routes those by `channelId` and only uses `guildId` to pick which sidebar cache to
  invalidate. Two genuinely new variants exist: `dm.participant.added` / `removed`, and
  receiving `removed` with your own userId is the ONE "this DM is gone for you" signal —
  `channel.deleted` never fires for DMs.

## Consequences

- `requireChannelMember` is the single gate for both worlds: guild membership or
  `channelParticipant` row. Anything channel-scoped added later (reactions, voice-in-DMs)
  inherits DM support by construction.
- Presence scope (`listCoMemberUserIds`) is the union of guild co-members and DM
  co-participants, so DM partners get presence dots without sharing a guild.
- Mention resolution branches on `guildId` inside `insertMessage`: guild members vs
  participants.
- The kind/isGroup/dmPairKey/ownerId invariant is enforced by the two creation paths in
  `queries/dm.ts` and the test suite, not a CHECK constraint — drizzle-kit would rebuild
  the table for a CHECK, and the columns land as plain `ADD COLUMN`s.

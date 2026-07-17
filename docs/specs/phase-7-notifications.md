# Phase 7 — notifications & in-app polish

Implementation spec, distilled from wayfinder map
[#74](https://github.com/zeNn-G/konus-la/issues/74). No ADR — the phase is client-only:
zero new events, zero schema, zero server-side preference storage (`message.created`
already carries `guildId`, `mentionedUserIds`, and full author identity —
`packages/api/src/realtime/events.ts`). ROADMAP's Phase 7 section is rewritten alongside
this spec to the grown scope. Ticket numbers (#75–#79, #81) mark where a decision's full
rationale lives.

## Scope

**In:** notification dispatcher (browser Notifications API + sound + static tab-title
counter) for DM messages and guild @mentions; per-channel notification prefs in
localStorage (sidebar context menu); a Discord-style **user-settings dialog** (Profile /
Voice / Notifications + admin sections + sign-out) replacing `/profile`, the `/admin/*`
routes, and the ControlDeck device popover; **master output volume** scaling all app
audio; **mic input volume** + AGC / noise-suppression / echo-cancellation toggles via a
persistent Web Audio mic chain; a **sound-effects system** (notification ping + voice UX
sounds) from CC0 assets.

**Out (per map):** Web Push / service-worker push · server-side preference sync · PWA
install · reply-pings without an @mention · typing / send / error sounds · PTT keybinds ·
browser notifications for voice events (sounds only) · multi-tab sound dedup &
cross-tab viewing suppression (Web Locks leader + BroadcastChannel — v1 accepts duplicate
pings with 2+ tabs, #75) · OS-toast content-privacy toggle (#75) · mic test / input level
meter (the chain leaves an `AnalyserNode` tap point, #81).

## Trigger matrix — charter

An event is **eligible** when it passes all three: not the viewer's own message; kind
rule — any DM / group-DM message, or a guild message whose `mentionedUserIds` contains
the viewer (**strictly @mentions in v1** — a reply without a mention marks unread but
never pings); resolved per-channel pref is not Muted.

| Kind | Pref options | Default |
| --- | --- | --- |
| Guild channel | All / Mentions-only / Muted | Mentions-only |
| DM / group DM | All / Muted | All |

A guild channel set to **All** pings on every message, mention or not. **Muted** kills
the notification, the sound, and the tab-title contribution — the sidebar unread bold /
mention badge still renders (mute is about interruptions, not information).

## Delivery semantics — #75

Suppression is evaluated **once, at event arrival** in the realtime dispatcher
(`lib/use-realtime.ts`); nothing queues or re-fires on later navigation. A suppressed
message still drives unread/mention state normally.

| State | OS notification | Sound |
| --- | --- | --- |
| Tab focused, source channel on screen | no | no |
| Tab focused, different channel/route | no | **yes** |
| Tab unfocused or hidden | **yes** | **yes** |

- **Away = `!document.hasFocus()`** — the exact predicate of the mark-read paths
  (`routes/(app)/guilds/$guildId/channels/$channelId.tsx`, `routes/(app)/dms/$channelId.tsx`),
  giving the invariant *a ping fires precisely when mark-read wouldn't have*.
  Visible-but-unfocused (second monitor) counts as away.
- **Channel-in-view signal:** a module store (`activeChannelId: string | null`) written by
  the guild-channel and DM routes in pathname-keyed mount/unmount effects; the dispatcher
  reads it synchronously. No router parsing in the dispatcher.
- **OS toast:** title `{displayName} (#channel — Guild)` / `{displayName}` (1:1 DM) /
  `{displayName} ({group name})` (group DM); body = full message text truncated ~150
  chars; icon = author avatar, app icon fallback. `tag = channelId`, `renotify: false` —
  a burst from one channel replaces its toast (newest wins) instead of stacking, and
  `tag` also dedupes toasts across tabs. Click ⇒ `window.focus()` + navigate to the
  channel (event `guildId` null ⇒ DM route) + `notification.close()`; mark-read then
  fires naturally on arrival. No action buttons / inline reply in v1.
- **Known v1 limitations (accepted, #75):** duplicate *sounds* with 2+ open tabs, and a
  background tab pinging while the focused tab is viewing the channel.

## Permission-request UX — #75

Two-layer state: browser Notification permission × an app-level **Desktop
notifications** pref (localStorage, **defaults OFF** — opting in is explicit). Sounds
and the tab title work regardless of permission. `Notification.requestPermission()` only
ever rides a user gesture:

- The toggle in the settings dialog's Notifications section — flipping it on while
  permission is `default` triggers the prompt; when `denied` the toggle is disabled with
  a "blocked in your browser settings" hint.
- A **one-time** post-sign-in dismissible toast ("Enable desktop notifications?" +
  Enable button = the gesture), localStorage-flagged, never repeated.

## Tab title — #75

Static **`(n) konus-la`** — no flicker/alternation. `n` is **derived from the same query
caches that render the sidebar badges**, not counted separately: Σ `mentionsCount` over
unmuted guild channels + **1 per unread unmuted DM conversation**. Plain unread guild
channels (bold, no mention) contribute nothing. Reset is automatic — mark-read and
cross-tab `readState.updated` patch the caches `n` is computed from; the derivation
subscribes to the notification-prefs store so muting a channel drops its contribution
live. `n = 0` restores the bare title.

## Per-channel preference model — #76

- **Storage:** one JSON map under `konusLa.notification-prefs` —
  `{ [channelId]: "all" | "mentions" | "muted" }` (the `voice:peer-volumes` precedent).
  **Overrides only**: a channel absent from the map uses its kind default; setting a
  channel back to its default **deletes** its entry. No stale-channel cleanup in v1.
- **Key namespace:** new Phase 7 notification/sound keys use the **`konusLa.` prefix**;
  existing `voice:*` / `konus.*` keys stay put, and the new voice device-store fields
  (below) deliberately stay in the `voice:*` family beside their siblings.
- **Read contract:** a module store in `lib/` (pattern of `activeChannelId` and
  `voice/store.ts`) hydrates once at module init and exposes a synchronous resolver
  `resolveChannelPref(channelId, kind)` → `"all" | "mentions" | "muted"` — **the caller
  supplies `kind`** (the dispatcher derives it from the event's `guildId`, the UI knows
  its row); the store keeps no channel-type lookup. `useSyncExternalStore`-compatible
  subscription for the settings UI and title derivation. All writes go through the
  store's setter: update memory → persist → notify.
- **Cross-tab sync:** the store listens to the `storage` event (fires only in other
  tabs), re-hydrates and notifies — muting in one tab silences all tabs.
- **Control surface:** right-click context menu on sidebar rows **only** (base-ui
  ContextMenu precedent: `members-panel.tsx`, `peer-volume-menu.tsx`). Guild rows:
  All / Mentions-only / Muted radio; DM rows: All / Muted. Muted rows render dimmed. No
  channel-header control; the dialog's Notifications section owns only the app-level
  toggles (#77).

## Sound system — #79

- **Assets:** Kenney CC0 packs — [UI Audio](https://kenney.nl/assets/ui-audio) +
  [Interface Sounds](https://kenney.nl/assets/interface-sounds) — topped up from
  Freesound filtered to CC0 where a cue is missing. CC0-only ⇒ no attribution
  obligations. **MP3 only** (mono, 96–128 kbps, ≤0.5 s, ~5–15 KB each) — the one codec
  every 2026 browser plays. Full findings: `docs/research/sound-assets.md` on the
  `research/sound-assets` branch.
- **Inventory (v1, charter):** notification ping; voice UX — self join, self
  leave/disconnect, mute on/off, deafen on/off, someone joins/leaves your current voice
  room. Nothing else.
- **Bundling:** import the files from `apps/web/src` so Vite emits hashed URLs (mp3 is a
  known asset type; avoid `public/`); preload via fetch + `decodeAudioData` into
  `AudioBuffer`s behind one shared `AudioContext` resumed on first user gesture. Only
  the notification ping is exposed to autoplay policy — swallow `NotAllowedError`
  pre-activation.
- **Toggles (#77):** voice sounds toggle in the dialog's Voice section (with preview
  affordances), ping toggle in Notifications — persisted as one JSON map under
  `konusLa.sound-prefs` (overrides-only, all default **on**; the #76 map precedent).

## Master output volume — #78

One master governs **all** app audio — remote voice *and* every UX/notification sound.
No separate sound-effects slider; finer control is the sound toggles.

- **State:** `outputVolume: number` (0–1, default 1) joins `useDeviceStore` in
  `lib/voice/devices.ts`, persisted under `voice:output-volume` via the existing
  try/catch helpers. **No cross-tab sync** (matches device prefs — drift is harmless,
  unlike mute prefs). The dialog's Voice section writes through a persisting setter; the
  voice bridge and the effects engine subscribe to the same field.
- **Voice path:** plain multiplier — `AudioSink` (in `voice-audio-bridge.tsx`) sets
  `element.volume = master * perPeer`. The multiplication lives only in the bridge; the
  voice store keeps raw per-peer values untouched. **No Web Audio graph for voice** — it
  would regress Firefox output selection (`AudioContext.setSinkId` is Chromium-only) and
  still require kept-alive media elements.
- **Effects routing:** the shared-context effects graph ends in master `GainNode` →
  `MediaStreamAudioDestinationNode` → **one persistent hidden `<audio>` element** with
  `element.setSinkId(sinkId)` exactly like `AudioSink` — same support matrix as voice,
  one code path, reuses the existing `outputSupported` / `sinkId` store logic. The
  hidden element's `play()` piggybacks on the same first-gesture activation as the
  context resume. Rule: *all app audio honors the output-device preference wherever
  `setSinkId` exists; Safari plays system-default everywhere, as today.*

## Mic input chain — #81

The `volume` media-track constraint is dead; the slider needs a Web Audio capture graph.

- **The chain** (new `lib/voice/mic-chain.ts` beside `media-sources.ts`): raw gUM track →
  `MediaStreamAudioSourceNode` → `GainNode` → `MediaStreamAudioDestinationNode`. The
  mediasoup producer receives the destination track **once, for the session's life** —
  `replaceTrack` leaves the mic path entirely. Re-captures (device switch, processing
  toggle) capture a new raw track and swap the source node inside the chain; the
  epoch/teardown machinery in `session.ts` keeps its shape, calling the chain instead of
  juggling raw tracks. The chain owns the raw track and a **dedicated `AudioContext`**
  (created on join, closed on leave — not shared with the effects context; lifetimes
  differ). Disposal must stop the **raw** track, or the tab's mic indicator stays lit.
- **Slider:** 0–100% (gain 0–1, default 100%) — attenuation-only (boost clips at the
  encoder; listeners have per-peer volume). Drags are live `GainNode.gain` writes —
  instant, no signaling, and they work while muted. Mute stays `producer.pause()`,
  orthogonal to gain; deafen is output-side. Both untouched.
- **Processing toggles:** automatic gain control, noise suppression, echo cancellation —
  exposing the constraints hard-coded `true` in `media-sources.ts` (`getMicTrack`). All
  default **on** (today's behavior). Flipping one re-captures via the chain's source
  swap; with no live session it applies on next join. These are the browser's built-in
  stages, not Krisp-grade ML. With AGC off, the input slider becomes the sole gain
  control.
- **Persistence** (device store, pattern of `voice:output-volume`, no cross-tab sync):
  `voice:input-volume` (number 0–1, default 1); `voice:agc`, `voice:noise-suppression`,
  `voice:echo-cancellation` (booleans, default true).

## User-settings dialog — #77 (prototype `prototype/user-settings-77`, capture-only)

Winner: **variant B refined** — a compact modal mirroring `GuildSettingsDialog`
(`components/guild-settings/guild-settings-dialog.tsx`), grown to `sm:max-w-5xl` /
`min(90vh, 760px)` with a 220px rail.

- **IA (rail top → bottom):** Profile · Voice · Notifications — then, pinned at the rail
  bottom: an **Admin group** (Invite codes, Instance bans) as baked-in dialog sections,
  visible only to `role === "admin"`, and **Sign out**.
- **Trigger:** the UserCard avatar chip (`components/user-card.tsx`) is the **sole
  trigger**, opening at Profile. The sidebar footer reduces to just the chip — the admin
  icon shortcuts and footer sign-out button are removed. Open state + active section
  live in a small module store so non-React call sites (the deck gear, the #25
  fallback-toast action) can open the dialog at a section.
- **Profile section:** display-name form (migrated from `/profile`) left, live preview
  card right.
- **Voice section** (Discord Voice-Settings layout): input/output device dropdowns side
  by side (migrated from the ControlDeck popover / `device-picker.tsx`), an input/output
  volume slider under each column — **the output slider is the master output volume** —
  processing toggles under the input column, voice-sound toggles below with preview
  affordances.
- **Notifications section:** browser-permission state pill + request button, the
  app-level Desktop-notifications toggle, DM default (All/Muted), guild default
  (All/Mentions/Muted), and the notification-ping sound toggle. Per-channel overrides
  live in the sidebar context menu, not here (#76).
- **ControlDeck:** the device popover is retired; the deck gear
  (`components/voice/control-deck.tsx`) opens the dialog at Voice. The #25
  device-fallback toast's "Change" action follows — it opens the dialog at Voice.

## Route retirements (spec addition)

`/profile` is removed per the charter; the **`/admin/codes` + `/admin/bans` routes (and
the `(app)/admin` guard route) are deleted outright**, not kept as deep links — their
section components migrate into the dialog wholesale, and a kept route would be a second
owner for the same surface with its own guard to maintain. The dialog gates the Admin
group by `session.user.role === "admin"`, exactly as `user-card.tsx` gates its shortcuts
today. No URL deep-linking into dialog sections in v1 (matches `GuildSettingsDialog`);
stale bookmarks hit the router's not-found handling, acceptable on a friends instance.

## New localStorage keys

| Key | Shape | Default | Cross-tab sync |
| --- | --- | --- | --- |
| `konusLa.notification-prefs` | `{ [channelId]: "all" \| "mentions" \| "muted" }` | `{}` (kind defaults) | yes — `storage` event (#76) |
| `konusLa.desktop-notifications` | boolean | **false** | no |
| `konusLa.notification-nudge-dismissed` | boolean | false | no |
| `konusLa.sound-prefs` | `{ [soundId]: boolean }` (overrides-only) | all on | no |
| `voice:output-volume` | number 0–1 | 1 | no (#78) |
| `voice:input-volume` | number 0–1 | 1 | no (#81) |
| `voice:agc` / `voice:noise-suppression` / `voice:echo-cancellation` | boolean | true | no (#81) |

## Rollout order (slices)

1. Sound assets + effects engine (shared `AudioContext`, buffers, hidden-element output
   routing) + master output volume (device-store field, `AudioSink` multiplier, effects
   gain) — no UI yet beyond nothing breaking.
2. User-settings dialog shell + Profile section + UserCard trigger + sign-out move +
   admin sections migration + `/profile` and `/admin/*` route deletions.
3. Voice section: device dropdowns move in, popover retired, deck gear + #25 toast
   retarget; mic chain + input slider + processing toggles.
4. Per-channel notification prefs: store + resolver + sidebar context menus + dimming +
   `storage` sync; Notifications section defaults UI.
5. Dispatcher: `activeChannelId` store, trigger matrix + delivery matrix, OS toasts,
   ping sound, permission UX (toggle + one-time nudge toast).
6. Tab title derivation.

Implementation lands as ordinary blocked-by-chained build issues (Phase 6 precedent
#54–#63), outside the map.

## Acceptance (extends ROADMAP Phase 7 verification)

- DM to an away tab (unfocused or hidden) ⇒ OS toast + ping; same tab focused on another
  channel ⇒ ping only; viewing the conversation ⇒ silence. A guild message pings only
  when it @mentions you (or the channel is set to All); a reply without a mention marks
  unread but stays silent.
- Muting a channel from the sidebar menu kills toast + sound + title contribution in
  **every** open tab; the row dims; unread bold / mention badge still renders; setting
  it back to default removes its entry from `konusLa.notification-prefs`.
- Tab title shows `(n) konus-la` from mentions + unread DM convos, drops as channels are
  read (including from another tab), and ignores muted channels; no flicker.
- Desktop notifications stay off until explicitly enabled; the first sign-in shows the
  nudge toast exactly once; enabling from the dialog prompts for permission on the
  gesture; a `denied` browser state disables the toggle with a hint. Sounds + title work
  with permission never granted.
- Toast click focuses the window and lands on the channel; a burst from one channel
  shows one toast.
- The UserCard chip opens the dialog; `/profile`, `/admin/codes`, `/admin/bans` no
  longer exist; admins see Invite codes + Instance bans sections (non-admins don't);
  sign-out works from the rail; display-name editing works from Profile.
- Voice: device switching from the dialog works mid-call; the deck gear and the
  device-fallback toast open the dialog at Voice; output slider scales both a peer's
  voice and the notification ping; input slider audibly attenuates what a second browser
  hears live; toggling noise suppression mid-call re-captures without dropping the
  session; leaving voice releases the mic (indicator off).
- Voice sounds fire on self join/leave, mute/deafen, and peer join/leave of your room;
  each toggle silences its sound; effects follow the selected output device on
  Chromium/Firefox.

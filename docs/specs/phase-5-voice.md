# Phase 5 — voice, video & screenshare

Implementation spec, distilled from wayfinder map
[#7](https://github.com/zeNn-G/konus-la/issues/7). ROADMAP divergences are recorded in
[ADR 0007](../adr/0007-voice-in-memory-rooms-ws-seats.md); everything the ADR doesn't amend
keeps the ROADMAP's "Mediasoup model" / "Voice / video UX" defaults. Ticket numbers (#8–#18)
mark where a decision's full rationale lives.

## Scope

**In:** guild voice channels with audio + webcam + screenshare, ≤20 concurrent per room;
occupancy in the sidebar for all guild members; reconnect grace; worker crash recovery;
per-user rate limits; device/permission UX.

**Out (per map):** voice in DMs (schema supports it, post-v1) · TURN/coturn, simulcast,
stage layout · server-mute & voice moderation incl. `serverMuteSet` (Phase 6 wholesale) ·
push-to-talk (parked) · deployment/firewall & socket-level WS flood breaker (Phase 8).

## Domain model (in-memory only — no DB change) — #12

Vocabulary also in `packages/api/CONTEXT.md`. There is **no voice table**; the ROADMAP's
"VoiceState" is retired. A server restart empties every room by definition.

```ts
// apps/server — shapes are indicative, not prescriptive
type Rooms = Map<channelId, Room>

interface Room {
  guildId: string
  channelId: string
  router: Router | null        // null after a worker death until first rejoin rebuilds it (#15)
  audioLevelObserver: AudioLevelObserver | null
  seats: Map<userId, Seat>     // seat map outlives the router handle (#15)
  speakingUserIds: Set<string> // last published activeSpeakers set (edge-trigger memory)
}

interface Seat {
  userId: string
  seatSessionId: string        // minted on EVERY bind (fresh join, rebind, steal) (#12)
  selfMute: boolean            // persists across grace (#12)
  selfDeaf: boolean
  peer: Peer | null            // null while in grace
  graceTimer: Timer | null     // 30 s; only for involuntary socket loss (#9, #12)
}

interface Peer {
  connectionId: string         // the owning socket (#9)
  state: 'joined' | 'transportCreated' | 'connected' | 'producing' // (#9)
  sendTransport: WebRtcTransport | null   // setMaxIncomingBitrate applied (#18)
  recvTransport: WebRtcTransport | null
  producers: Map<producerId, { producer: Producer; source: 'mic' | 'cam' | 'screen' }>
  consumers: Map<consumerId, Consumer>    // created paused (#18)
}
```

Invariants:

- **One seat per user instance-wide** — `voice.join` to a new channel implicitly unseats the
  old one (#11); a second join to any channel from another tab **steals** the seat (#12).
- Room is lazy-created on first join (router + `AudioLevelObserver`), and GC'd
  **immediately** when the last seat leaves — explicit leave, switch, or grace expiry. No
  linger timer. Closing an already-dead router is a no-op, so GC needs no crash special-case
  (#15).
- The Peer dies with its socket; the Seat it served enters grace. Grace preserves
  membership and flags, never media.

## Signaling transport — #9

All `voice.*` procedures ride the existing `/ws` oRPC connection (`BunWSRPCHandler` already
serves the full `appRouter`).

- **`connectionId`** is minted at upgrade, stored in `WSData` (`apps/server/src/index.ts`)
  alongside `userId`/`headers`, and passed into per-message context by the
  `websocket.message` handler.
- **Enforced, not conventional:** every `voice.*` procedure requires connection-scoped
  context and rejects calls whose context lacks `connectionId` — i.e. anything arriving via
  fetch `/rpc`.
- The `websocket.close` hook (where `presenceConnectionClosed` already sits) is the grace
  trigger: if the closing `connectionId` owns a peer, discard the media half and start the
  seat's 30 s timer.
- `voice.*` *events* ride the existing `user:{userId}` topics unchanged.
- Client: hoist the WS `AppRouterClient` out of `useRealtime`'s effect scope into a shared
  module so `VoiceSession` calls the same single socket (#11).

## Procedures

| Procedure | In → Out | Rate rule (#16) | Notes |
|---|---|---|---|
| `voice.join` | `{ channelId }` → `{ seatSessionId }` | `voiceJoin` 10/60 s | Universal entry — see lifecycle |
| `voice.leave` | `{}` → `void` | `voiceJoin` (shared) | Immediate `peerLeft`, no grace |
| `voice.setSelfMute` | `{ muted }` → `void` | `voiceFlags` 10/10 s | Broadcasts `peerMutedSelf` |
| `voice.setSelfDeaf` | `{ deafened }` → `void` | `voiceFlags` (shared) | Broadcasts `peerDeafenedSelf`; server pauses/resumes the peer's audio consumers (#18) |
| `voice.getRouterRtpCapabilities` | `{}` → `RtpCapabilities` | none (read) | Requires a seat |
| `voice.createTransport` | `{ direction: 'send' \| 'recv' }` → `{ id, iceParameters, iceCandidates, dtlsParameters }` | `voiceSignal` 15/10 s | |
| `voice.connectTransport` | `{ transportId, dtlsParameters }` → `void` | `voiceSignal` | |
| `voice.produce` | `{ transportId, kind, rtpParameters, source: 'mic' \| 'cam' \| 'screen' }` → `{ producerId }` | `voiceSignal` | Enforces 1 audio + ≤1 cam + ≤1 screen (ROADMAP) |
| `voice.closeProducer` | `{ producerId }` → `void` | `voiceSignal` | |
| `voice.consume` | `{ producerId, rtpCapabilities }` → `{ consumerId, producerId, kind, rtpParameters }` | `voiceConsume` 60/10 s | Created **server-side paused** (#18) |
| `voice.setConsumersPaused` | `{ consumerIds: string[], paused }` → `void` | `voiceConsume` (shared) | Batched; validates every id belongs to the caller's peer; no broadcast (#18) |

Rate limits reuse `perUserRatelimit` (`packages/api/src/ratelimit.ts`) with per-user keys
(`rule:userId`) — multi-tab can't multiply the budget, a steal doesn't reset it. No limiter
on reads; `voice.snapshot` rides the subscribe path.

**Peer state machine (server-enforced, #9):** `joined → transportCreated → connected →
producing`. Out-of-order calls (e.g. `produce` before `connectTransport`) are rejected with
`VOICE_INVALID_STATE` — the invariant lives on the server, not in client discipline.

**Defined errors:**

- `VOICE_UNAVAILABLE` — crash-loop breaker is open (#15). Client shows "voice unavailable,
  retrying"; no rejoin storm.
- `VOICE_INVALID_STATE` — out-of-order signaling call (#9).
- `TOO_MANY_REQUESTS` — existing rate-limit error; **excluded** from the recovery path
  (#16).

oRPC-version caveat: defined errors depend on a single `@orpc/server` copy
(`instanceof ORPCError`); keep catalog + experimental deps on one minor or `VOICE_*` errors
surface as 500s.

## Events — #12, #15

**Bootstrap** — among the first events of every `/ws` subscription (mirrors
`presence.snapshot`), covering every occupied voice channel visible to the subscriber:

```
voice.snapshot: { rooms: Array<{ guildId, channelId,
                                 seats: Array<{ userId, selfMute, selfDeaf }>,
                                 speakingUserIds: string[] }> }
```

Socket-connected ⇔ occupancy-correct is one invariant with one code path; reconnect
re-syncs by resubscription. There is no fetch path for occupancy.

**Guild-wide** (all guild members — everything the sidebar renders):

| Event | Payload |
|---|---|
| `voice.peerJoined` | `{ guildId, channelId, userId, selfMute, selfDeaf }` |
| `voice.peerLeft` | `{ guildId, channelId, userId }` |
| `voice.peerMutedSelf` | `{ guildId, channelId, userId, selfMute }` |
| `voice.peerDeafenedSelf` | `{ guildId, channelId, userId, selfDeaf }` |
| `voice.activeSpeakers` | `{ guildId, channelId, speakingUserIds }` — **edge-triggered full set**: publish only when the set changes; the `AudioLevelObserver` ~500 ms interval is the debounce. Silent rooms cost zero messages. |

**Room-only** (current seats of that room — consume triggers):

| Event | Payload |
|---|---|
| `voice.producerAdded` | `{ channelId, userId, producerId, kind, source }` |
| `voice.producerClosed` | `{ channelId, userId, producerId }` |

**Self-only** (own `user:{id}` topic):

| Event | Payload | Meaning |
|---|---|---|
| `voice.sessionReplaced` | `{ channelId, replacedSeatSessionId }` | Tear down to idle — but only if the id matches your own seat-session id (#12) |
| `voice.mediaReset` | `{ channelId }` | **Keep your seat, redo your plumbing** — worker respawned; re-run `voice.join` (#15) |

## Lifecycle — `voice.join` is the universal entry (#12)

Fresh join, channel switch, grace rebind, multi-tab steal, and post-restart recovery are the
**same client call**; the server sorts out the flavor:

- **Fresh join** — room lazy-created if needed; seat created, bound to the calling
  connection, seat-session id minted → `peerJoined` guild-wide.
- **Channel switch** — caller already seated elsewhere → implicit unseat → `peerLeft(A)` +
  `peerJoined(B)`. Immediate, no grace. Client side: close local transports first
  (cascades to producers/consumers/tracks), reset the store, then call `voice.join` — no
  awaited leave→join sequence (#11).
- **Socket drop while seated** — peer discarded, producers close (room gets
  `producerClosed`, tiles go avatar-only), 30 s timer starts. **No guild-wide event** — the
  sidebar keeps them seated; flags persist. Only the dropped client renders reconnecting.
- **Rebind** — the reconnected client's `voice.join` finds the in-grace seat for that
  userId → rebind to the new connection, new seat-session id, cancel timer, publish
  nothing guild-wide; the client redoes the full media ceremony (transports → connect →
  produce → consume) and producers re-announce room-wide naturally. No ICE restart in v1.
- **Multi-tab steal** — same path with the old socket still alive: seat rebinds to the new
  connection, the old peer's media closes, `voice.sessionReplaced` carries the **replaced**
  seat-session id so only the loser tears down ("voice moved to another window"). Guild-wide
  nothing publishes — the seat never emptied, the sidebar doesn't flicker. Race-proof for a
  third tab stealing from the second.
- **Grace expiry** — seat removed → `peerLeft` guild-wide; last seat out → room GC'd.
- **Explicit leave / switch / logout** — immediate `peerLeft`. Grace is only for
  *involuntary* socket loss.
- **Server restart** — rooms are memory, so they're gone; reconnecting clients receive an
  empty `voice.snapshot` and their recovery move is the same `voice.join`, landing as a
  fresh join. Nothing to reconcile because nothing stale survives.

**Full join ceremony (client, sequential awaits):** `voice.join` →
`getRouterRtpCapabilities` → `device.load` → `createTransport` ×2 → `connectTransport` ×2 →
`produce` (mic, if grantable) → `consume` each existing producer → batched resume.

## Worker lifecycle — #8, #15

One mediasoup Worker from boot, for the process lifetime — never GC'd. Standing invariant:
**from boot onward there is always a live worker, a respawn in flight, or voice declared
down.**

- **Bun/Windows spawn patch** (dev): vendor Sharkord's `bun-mediasoup-workaround.ts` into
  `apps/server/src/sfu/` (root cause: Bun's `child_process.spawn` breaks stdio fd ≥ 3,
  [oven-sh/bun#11044](https://github.com/oven-sh/bun/issues/11044); mediasoup's IPC uses
  fds 3/4). Wrap every spawn in a `createWorkerPatched()` helper —
  `patchSpawnForMediasoup() → createWorker → restoreSpawn()` — because `restoreSpawn`
  unpatches; crash respawns must re-patch. No-op on Linux/Docker prod.
- **`bun --hot` guard**: hot reload re-evaluates modules without killing the process —
  guard worker creation behind a `globalThis` singleton or workers pile up.
- **Install**: `mediasoup` needs `bun pm trust` / `trustedDependencies` (postinstall
  downloads `mediasoup-worker`). Validated on mediasoup 3.21.0 / Bun 1.3.14. Pin Bun
  upgrades behind a re-run of the #8 spike checks.
- **Crash recovery (seats survive)**: on `died` → discard all mediasoup handles (rooms keep
  their seat maps, `router = null`), start every seated user's 30 s grace, publish nothing
  guild-wide; respawn eagerly from the `died` handler; after the respawn completes publish
  self-only `voice.mediaReset { channelId }` to each seated user → their `VoiceSession`
  re-runs `voice.join` (grace rebind). Routers rebuild **lazily** — the first `voice.join`
  into each channel recreates router + observer through the normal lazy-creation path.
- **Crash-loop breaker**: 3 deaths within 60 s → voice declared down; stop the tight loop,
  retry every 30 s until a worker boots and sticks; error-level pino log with the death
  count. While down, every voice procedure returns `VOICE_UNAVAILABLE` and `mediaReset` is
  not sent. Seats self-correct via normal grace expiry — no mass-eviction code.

## Media policy — #18 (+ ROADMAP defaults)

- **Codecs**: Opus (audio, DTX + FEC enabled, no bitrate cap), VP8 (cam + screen). No
  simulcast.
- **Producer limits per peer**: 1 audio + ≤1 webcam + ≤1 screenshare (server-enforced in
  `produce`).
- **Mute** (unchanged ROADMAP): client-side producer pause + `setSelfMute` flag broadcast.
  **Deafen**: server-side pause of the peer's audio consumers via `setConsumersPaused`;
  undeafen = batched resume; consumers created while deafened simply stay created-paused.
- **Consumer lifecycle — visibility-driven pause**: consumers are created server-side
  paused; resume is the single activation verb. `VoiceAudioBridge` resumes audio consumers
  immediately on creation; a **video** consumer is resumed only while some component renders
  its track AND `document.visibilityState === 'visible'`. Hysteresis: ~3 s
  continuous-hidden debounce before pausing; resume always immediate. No
  IntersectionObserver. Audio is never visibility-paused. Cost on expand: one resume
  round-trip + automatic keyframe request (a few hundred ms blank tile, accepted).
- **Caps** (spec defaults, env-overridable):

  | Source | Constraints | `maxBitrate` |
  |---|---|---|
  | Webcam | 720p@30 ideal | ~1 Mbps |
  | Screenshare 720p | 1280×720 ideal, 30 fps | ~1.5 Mbps |
  | Screenshare 1080p (default) | 1920×1080 ideal, 30 fps | ~3 Mbps |
  | Screenshare 1080p60 | 1920×1080 ideal, 60 fps | ~5 Mbps |

  Quality preset is chosen in a popover on the share button **before** `getDisplayMedia`;
  changing it mid-share = stop + re-share (no live renegotiation in v1). Screenshare audio
  opt-in with graceful video-only fallback (ROADMAP).
- **Server backstop**: `transport.setMaxIncomingBitrate(~6_500_000)` on each **send**
  transport — client encodings are advisory, this makes the ceiling authoritative. No
  recv-transport cap; skip `initialAvailableOutgoingBitrate` tuning.

## Client architecture (`apps/web`) — #11

- **Split**: server-derived occupancy in TanStack Query **client-only keys** per channel
  (the presence/typing pattern in `use-realtime.ts`); the live media session in a
  **zustand** store fronted by a module-singleton **`VoiceSession`** service (plain class
  next to the hoisted WS client). mediasoup-client objects (`Device`, transports,
  producers, consumers, tracks) never enter the Query cache.
- **Two tiers** (#12 amended tier 1 to include flags + speaking):
  - *Tier 1, guild-wide* → Query keys: who sits where — userId/name/avatar + `selfMute` /
    `selfDeaf` + speaking set. Feeds sidebar occupant rows. Dispatcher routes guild-wide
    events + snapshot here via `setQueryData`.
  - *Tier 2, room-only* → zustand: producers keyed per peer, merged with that peer's
    consumers/tracks (a tile reads one entry). Exists exactly while joined; one store reset
    on leave.
- **State machine**: `idle → joining → connected → reconnecting`, transitions driven only
  by `VoiceSession` methods (`join`, `leave`, `toggleMute`, …) — no React effect ever
  drives a transition. `joining` covers the whole sequential ceremony.
- **Recovery path (single)**: any signaling error or in-flight call dying with the socket →
  re-sync/rejoin from server state (`reconnecting` → `voice.join`), **except**
  `TOO_MANY_REQUESTS` (#16): surface/log, no auto-retry, no rejoin — the user's next manual
  action is the retry. `voice.sessionReplaced` (matching own seat-session id) → tear down
  to `idle` + "voice moved to another window". `voice.mediaReset` → `reconnecting` →
  `voice.join`; client transport-failure detection stays as belt-and-braces into the same
  state.
- **Teardown triggers**: leave button, joining another channel, logout. **Navigation never
  tears down** (mini-stage). Tab close gets no client teardown — no beacon exists on a
  WS-only signaling path; the socket close starts the server's grace.
- **`<VoiceAudioBridge />`**: mounted once in the authenticated shell; renders the *only*
  remote `<audio>` elements, one per remote audio consumer keyed by peerId — playback
  survives pane ↔ mini-stage transitions. Video elements stay in visual components.
  Applies per-peer volume from the store (persisted in localStorage keyed by userId).
- New dep: `zustand` (install via CLI).

## UX — #10 (prototype `proto/voice-ux-10`), #17, #18

**Layout & flow (A+B hybrid):** clicking a voice row joins and opens the **full room** —
tile grid fills the channel pane, control capsule docked bottom-center; a voice channel is
a place. Browsing text while connected shows a **corner mini-stage** in the chat pane
(screenshare if any, else active speaker, plus facepile); expanding it returns to the full
room. A **sidebar-footer control deck** (mute / deafen / screenshare / camera / disconnect +
device-settings popover, above the UserCard) is visible in BOTH states.

**Component inventory:**

| Component | Role |
|---|---|
| `VoiceRoom` | Channel-pane takeover: tile grid + capsule |
| `RoomTile` | Avatar/cam/screenshare faces, LIVE badge, square green speaking ring (`green-500`, matches presence) |
| `ControlCapsule` | In-room controls, bottom-center |
| `ControlDeck` | Sidebar-footer controls, both states |
| `VoiceMiniStage` | Corner card while browsing; expand → full room |
| Sidebar voice rows + `OccupantRow` | Occupants nested under each voice channel row, speaking rings + mute/deafen badges |
| Per-peer volume `ContextMenu` | Right-click on occupant row or tile: volume slider + local mute |
| `DevicePicker` | Popover content behind the capsule mic chevron and the deck settings button; input + output lists |
| Screenshare quality popover | 720p / 1080p (default) / 1080p60 preset before `getDisplayMedia` |
| `VoiceAudioBridge` | Invisible; owns all remote `<audio>` |

**Permission & device UX (#17 — degrade in place, retry where your finger already is):**

- **Mic denied / no mic → listen-only join**: `voice.join` proceeds regardless of
  `getUserMedia`; seat taken, everything consumed, nothing produced. Peers see an ordinary
  mute badge — can't-speak vs won't-speak stays local. The capsule/deck **mic button is the
  single component** that knows: distinct "mic unavailable" treatment (slashed-with-alert),
  click re-runs `getUserMedia`; success → live and unmuted; repeat denial → toast with
  check-browser-permissions copy. No banner.
- **Mid-call camera/screenshare denial → revert + toast**: button optimistically shows
  starting, reverts on rejection, stays clickable (clicking again is the retry). Camera
  denial toasts; screenshare rejection reverts **silently** (the OS picker self-explains;
  Chrome reports user-cancel as `NotAllowedError`).
- **`devicechange` unplug of the selected device → auto-fallback to system default +
  toast** ("mic disconnected — switched to <default>", with a **Change** action opening the
  DevicePicker). Input: re-run `getUserMedia` on default + replace the producer track;
  output: `setSinkId` back to default. localStorage selection is NOT overwritten, so replug
  switches back with its own toast — both directions always announced.
- **Safari**: DevicePicker simply has no output section (feature-detect, no explanatory
  copy) and opts out of output-fallback toasts wholesale.
- ROADMAP defaults kept: `getUserMedia` audio constraints all on (echo cancellation, noise
  suppression, AGC); device selections localStorage-persisted and reapplied on
  `devicechange`.

## Env & config

| Var | Default | Notes |
|---|---|---|
| `MEDIASOUP_ANNOUNCED_IP` | `127.0.0.1` (dev) | **Required in prod** (#13) |
| `MEDIASOUP_RTC_MIN_PORT` / `MEDIASOUP_RTC_MAX_PORT` | `40000` / `40100` | UDP+TCP, mapped host→container directly in Phase 8 |
| Media caps (webcam/screenshare bitrates, incoming-bitrate backstop) | §Media policy | Env-overridable |

`listenInfos`: udp + tcp, `ip: '0.0.0.0'`, `announcedAddress` from env,
`preferUdp: true`. Modern `listenInfos`/`announcedAddress` API — not deprecated `listenIps`.

## Dev verification — #13

Verified recipes in `spikes/mediasoup-bun/dev-nat-recipe.md` (untracked; durable copy in
[#13's resolution](https://github.com/zeNn-G/konus-la/issues/13)):

- **Localhost**: defaults above → ICE `completed`, DTLS `connected`, tuple
  `udp → 127.0.0.1`.
- **LAN**: `MEDIASOUP_ANNOUNCED_IP=<LAN IP>`; allow bun.exe through Windows Defender
  Firewall on *Private* (missing this fails silently from LAN while localhost works —
  loopback isn't filtered). Second device needs a secure-context workaround for real mic
  (`chrome://flags/#unsafely-treat-insecure-origin-as-secure` or mkcert).
- **TCP fallback**: TCP-only `listenInfos` (`FORCE_TCP=1`) — the no-admin same-machine
  test; a firewall UDP-block test is meaningful only from a second device (loopback is
  exempt).
- ROADMAP Phase 5 acceptance: three tabs join one channel; mic/cam/screenshare publish;
  mute/deafen/leave behave; LAN + TCP-fallback pass; channel switch tears down cleanly;
  worker respawn + ≤30 s WS-drop reconnect keep the room.

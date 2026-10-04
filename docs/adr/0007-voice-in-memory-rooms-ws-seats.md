# Voice: in-memory rooms, WS-owned seats, one rejoin path

Phase 5 (voice / video / screenshare) was specced on a wayfinder map
([#7](https://github.com/zeNn-G/konus-la/issues/7)); the full design lives in
[`docs/specs/phase-5-voice.md`](../specs/phase-5-voice.md). This ADR records only the
decisions that **diverge from or sharpen the ROADMAP**, which remains the working default
everywhere else (codecs, producer limits, port range, no TURN/simulcast, one worker).

## Context

The ROADMAP sketched a `VoiceState` table, voice events over "maybe the WS", a fixed ~2 Hz
`voice.activeSpeakers` stream, and client-side mute/deafen pauses. Working the map's tickets
(spikes [#8](https://github.com/zeNn-G/konus-la/issues/8) /
[#13](https://github.com/zeNn-G/konus-la/issues/13), decisions
[#9](https://github.com/zeNn-G/konus-la/issues/9)–[#12](https://github.com/zeNn-G/konus-la/issues/12),
[#15](https://github.com/zeNn-G/konus-la/issues/15)–[#18](https://github.com/zeNn-G/konus-la/issues/18))
forced the following amendments:

- **No `VoiceState` table — the term is retired** (#12). The server is single-process; a
  restart kills every socket → every peer → every room, so a persisted row can only ever be
  stale or redundant. In-memory **Room / Seat / Peer** (vocabulary in
  `packages/api/GLOSSARY.md`) are the sole truth; occupancy is a *published view* of that
  memory, never a stored entity.
- **Voice signaling rides the existing `/ws` connection exclusively** (#9). The joining
  tab's socket owns the voice peer (connection-level liveness, not user-level presence), so
  only the WS carries the needed identity: a `connectionId` is stashed in `WSData` at
  upgrade and passed into per-message context, and `voice.*` procedures **reject** calls
  whose context lacks it (i.e. anything arriving via fetch `/rpc`). The ROADMAP's "may route
  voice over the same socket" becomes "must".
- **Seat-only 30 s grace, one universal rejoin** (#9, #12). Grace preserves *membership*,
  not media: socket loss keeps the seat (sidebar unchanged, guild-wide silence) while the
  media half dies; rebinding runs the **full** media ceremony again. `voice.join(channelId)`
  is the single entry for fresh join, channel switch (implicit unseat), grace rebind,
  multi-tab steal, and post-restart recovery — nothing to reconcile because nothing stale
  survives. A deliberate second join from another tab **steals** the seat Discord-style;
  `voice.sessionReplaced` names the replaced seat-session id so only the losing tab tears
  down. Reject-the-second-tab was discarded: extra code path, and it dead-ends the user when
  the "live" tab is a hung window elsewhere.
- **`voice.activeSpeakers` is edge-triggered, not a ~2 Hz stream** (#12). The
  `AudioLevelObserver` interval is only the debounce; the server publishes the **full
  speaking set, only when it changes**. Idempotent and self-healing; silent rooms cost zero
  messages. `voice.snapshot` (on every `/ws` subscribe, `presence.snapshot` precedent)
  carries flags + the current speaking set so cold loads render mid-monologue rings.
- **Deafen is a server-side audio-consumer pause** (#18), not the ROADMAP's client-side
  pause — the SFU stops forwarding entirely, via the same batched
  `voice.setConsumersPaused` used by the visibility policy. Consumers are always created
  server-side paused; resume is the single activation verb. Video consumers flow only while
  their tile is mounted AND the tab visible; audio is never visibility-paused.
- **Worker crash: seats survive** (#15). Worker death = every seat's media half enters the
  existing 30 s grace; nothing publishes guild-wide. Eager respawn from `died` with a
  crash-loop breaker (3 deaths / 60 s → voice declared down, 30 s slow retry, defined
  `VOICE_UNAVAILABLE` error); a new **self-only** `voice.mediaReset { channelId }` event
  tells seated clients to re-run `voice.join`. Routers rebuild lazily on first rejoin; room
  GC is immediate on last-seat-out (no linger timer). Scorched-earth mass eviction was
  rejected — grace-rebind machinery already exists.
- **Rate limits reuse `perUserRatelimit`** (#16) — it's oRPC procedure middleware, so it
  works over the WS unchanged. Four per-user rules (`voiceJoin`, `voiceFlags`,
  `voiceSignal`, `voiceConsume`); `TOO_MANY_REQUESTS` is **carved out** of the client's
  "any signaling error → re-sync/rejoin" rule to prevent a rate-limit→rejoin loop. A
  socket-level flood breaker is ruled out to Phase 8.
- **Client media state is a hybrid** (#11): server-derived occupancy in TanStack Query
  client-only keys (guild-wide: names + flags + speaking); live room detail merged with
  consumers in a **zustand** store; a module-singleton `VoiceSession` service owns the
  `idle → joining → connected → reconnecting` machine. React only calls methods and renders
  store state; navigation never tears down (mini-stage); `<VoiceAudioBridge />` in the shell
  owns all remote `<audio>` elements. mediasoup-client objects never enter the Query cache.
- **Env: `MEDIASOUP_ANNOUNCED_IP`** (#13) replaces the ROADMAP's `PUBLIC_IP` for the
  mediasoup announced address — default `127.0.0.1` in dev, **required** in prod.
- **Scope trims**: `serverMuteSet` and all voice moderation move wholesale to Phase 6;
  push-to-talk is parked (browser global-hotkey limits; always-on voice activity covers v1),
  so the ROADMAP's "audio producer always exists, paused/resumed locally" applies to mute
  only.

## Consequences

- No schema migration in Phase 5 at all; the DB is untouched. Restart recovery is "clients
  call `voice.join` again", literally the same code as a fresh join.
- Bun/Windows dev depends on the Sharkord spawn workaround (#8) vendored into
  `apps/server/src/sfu/` — re-patched around every `createWorker`, guarded by a
  `globalThis` singleton under `bun --hot`, with `mediasoup` in `trustedDependencies`.
  Pin Bun upgrades behind a spike re-run until
  [oven-sh/bun#11044](https://github.com/oven-sh/bun/issues/11044) closes.
- Defined errors make the oRPC single-copy constraint load-bearing for voice: `@orpc/*`
  versions must stay aligned or `VOICE_*` errors surface as 500s and the client recovery
  path misfires.
- The guild event firehose stays bounded: flags and speaking-set changes are guild-wide,
  but producer churn and consumer state are room-only / self-only, and every voice
  procedure sits behind a per-user limiter.
- New web dependency: `zustand`.

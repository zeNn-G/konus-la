# Research: Notification & voice UX sound assets (#79)

**Question:** Where do the UI sounds come from, and how are they shipped? Fixed inventory (9 sounds, some may share assets): notification ping; voice UX — self join, self leave/disconnect, mute on, mute off, deafen on, deafen off, peer joins room, peer leaves room.

## Recommendation (TL;DR)

- **Source:** Kenney's CC0 audio packs — [UI Audio](https://kenney.nl/assets/ui-audio) (50 sounds) and [Interface Sounds](https://kenney.nl/assets/interface-sounds) (100 sounds) — as the primary base, topped up from [Freesound](https://freesound.org/) filtered to CC0 if a specific cue (e.g. a softer notification ping) is missing. CC0-only sourcing means zero attribution obligations in a self-hosted repo.
- **Format:** ship **MP3 only** (mono, 96–128 kbps, target ≤ 0.5 s per cue, roughly 5–15 KB each). MP3 is the single codec supported by every 2026 browser including old Safari; Ogg Vorbis/Opus only reach full Safari support at 18.4+, so they'd need an MP3 fallback anyway — not worth doubling 9 tiny files.
- **Bundling:** import each file from `apps/web/src` so Vite emits hashed, cache-busted URLs (`import ping from './sounds/ping.mp3'`); do **not** use `public/`. Preload by fetching + `decodeAudioData` into `AudioBuffer`s at startup and play through a single shared `AudioContext`, resumed on first user gesture (autoplay policy).

---

## 1. Sourcing — concrete candidates

### Kenney (CC0) — recommended

- **[UI Audio](https://kenney.nl/assets/ui-audio)** — 50 UI sound effects (buttons, switches, generic clicks). License stated on the pack page: *"Creative Commons CC0"*. Free for personal, educational and commercial projects; no attribution or permission required.
- **[Interface Sounds](https://kenney.nl/assets/interface-sounds)** — 100 interface sounds (clicks, snaps, minimize/maximize, confirmation cues). Same *"Creative Commons CC0"* license statement on the pack page.
- Distribution is OGG in the upstream packs; community repackagings exist (e.g. [Calinou/kenney-ui-audio](https://github.com/Calinou/kenney-ui-audio), WAV, CC0). We would transcode chosen files to MP3 at implementation time regardless (see §3).
- Fit for the inventory: the two packs cover click/toggle-style cues well (mute/deafen on/off, self join/leave). A distinct "notification ping" and softer join/leave chimes may need Freesound supplements.

### Freesound (CC0-filtered) — supplement

- [Freesound](https://freesound.org/) hosts sounds under **CC0, CC-BY, and CC-BY-NC**; the search UI filters by license, including a "Free Cultural Works" (CC0 + CC-BY) filter ([Freesound FAQ](https://freesound.org/help/faq/)).
- Per the FAQ, CC0 means *"you can do pretty much what you want with the sound"*; CC-BY requires crediting the creator (suggested format: sound title, creator, Freesound URL, license); CC-BY-NC prohibits commercial use.
- **Rule for this repo:** pick CC0-only from Freesound. Individual sound picks happen at implementation time (this ticket is research-only, no assets committed).

### Google Material Design sound resources (CC-BY 4.0) — viable but not recommended

- Google's Material sound pack: 40 sounds in four groups (hero, alerts/notifications, primary system, secondary system), distributed in AAC, FLAC, OGG Vorbis, MP3 and WAV. The original download page stated: *"Available under CC-BY 4.0. By downloading these files, you agree to the Google Terms of Service."* (verified via the [archived copy on archive.org](https://archive.org/details/material-design-sound-resources); the live [m2.material.io sound-resources page](https://m2.material.io/design/sound/sound-resources.html) is a JS-rendered shell that could not be text-verified in this pass).
- CC-BY 4.0 is compatible with a self-hosted app but **requires attribution** (credit + license link shipped with the app/repo). Since CC0 alternatives cover the inventory, taking on an attribution obligation is unnecessary.

### Not evaluated

Two aggregator candidates that surfaced in search (soundcn, uisfx.com) could not be verified against their source pages in this pass and are deliberately **not** cited or recommended; both claim to primarily repackage CC0 material (largely Kenney), so going to Kenney directly loses nothing.

## 2. Licensing compatibility for a self-hosted repo

- **CC0 1.0** is a public-domain dedication: no attribution, no license notice, no share-alike; fully compatible with committing the files into this repo under any repo license, and with self-hosted/commercial deployment ([Kenney pack pages](https://kenney.nl/assets/ui-audio), [Freesound FAQ](https://freesound.org/help/faq/)).
- **CC-BY 4.0** (Material sounds, some Freesound picks) is compatible but requires attribution wherever the work is distributed — for us that means a credits entry in the repo (e.g. `docs/CREDITS.md` or README section) naming the work, author, source URL, and license. Avoidable by staying CC0.
- **CC-BY-NC** is **not** usable: konus-la is self-hostable by anyone, and we cannot constrain downstream deployments to non-commercial use.
- Good practice even for CC0: keep a short `docs/CREDITS.md` (or a section in the README) listing each shipped sound's origin pack and URL — costs nothing, helps future audits, and covers us if a pick later turns out mislicensed.

## 3. Format, size, preload

### Codec choice: MP3

Browser support facts (verified 2026-07-17):

| Codec | Chrome | Firefox | Safari (macOS) | Safari (iOS) |
|---|---|---|---|---|
| MP3 | yes | yes | yes (3.1+) | yes |
| Ogg Vorbis | yes (4+) | yes (3.5+) | partial 14.1–18.3, **full 18.4+** | none < 17.4, **full 18.4+** |
| Opus | yes (33+) | yes (15+) | **partial** (11+, historically CAF-container-only; still listed partial through 26.4) | partial 11–18.3, **full 18.4+** |

Sources: [caniuse: Opus](https://caniuse.com/opus), [caniuse: Ogg Vorbis](https://caniuse.com/ogg-vorbis), [MDN Web audio codec guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs) (MDN additionally notes Safari's Opus support requires the CAF container and that Vorbis is unsupported in Safari's `<audio>`; caniuse shows Safari 18.4, March 2025, finally shipping full Ogg support — MDN's Safari matrix lags caniuse here).

Implications:

- **MP3 is the only codec playable in every browser with a single file.** Ogg (Vorbis or Opus) still fails on Safari < 18.4 and desktop Safari Opus remains flagged partial on caniuse — any Ogg-first strategy needs an MP3 fallback, doubling assets for negligible savings on 9 sub-second files. MP3's patents are long expired; no licensing concern.
- MDN's noted MP3 caveat — encoder padding adds a few tens of ms of leading silence, making it "not ideal for latency-sensitive applications" — is mitigated by decoding into `AudioBuffer`s up front (playback start is then sample-accurate from the decoded buffer; the baked-in padding on ~100 ms UI blips is inaudible in practice). If a specific cue proves latency-critical during implementation, that one file can ship as WAV (universal support, ~86 KB/s mono 16-bit/44.1 kHz, so a 300 ms blip is ~26 KB — acceptable as an exception, not the default).

### Targets

- **Duration:** toggles/blips (mute, deafen) ≤ 250 ms; join/leave and notification ping ≤ 500 ms (Material's own system sounds sit in this range).
- **Encoding:** mono, 44.1 kHz, 96–128 kbps CBR MP3 (MDN recommends ≥ 128 kbps for acceptable MP3 quality; mono halves the payload for UI cues, which are not stereo material).
- **Size:** ~5–15 KB per file → the full 9-sound set lands well under ~100 KB total.

### Preload & playback strategy

- On app startup, `fetch` each imported URL → `arrayBuffer()` → `AudioContext.decodeAudioData()` → cache the `AudioBuffer`s in a module-level map. Playing is then `new AudioBufferSourceNode` + `start()` — instant, no network or decode on the hot path, and concurrent overlapping plays are free.
- **Autoplay policy:** per the [MDN autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay), programmatic audio is blocked until the page has sticky activation (any click/tap/keypress), and Web Audio `AudioContext`s start suspended under the same rules — call `resume()` on the first user gesture. This matters only for the **notification ping** (the one cue that can fire without a preceding gesture, e.g. a message arriving in a fresh tab); all voice UX cues follow a user action by definition. Handle the pre-activation window by attempting `resume()`/`play()` and swallowing `NotAllowedError` — do not build unmute-UI for a chat app's ping.

## 4. Bundling in the Vite + React SPA

- Vite treats audio as first-class static assets: `mp3`, `ogg`, `wav`, `opus`, `flac`, `aac`, `webm`, `m4a` are all in Vite's `KNOWN_ASSET_TYPES` ([vite/src/node/constants.ts](https://github.com/vitejs/vite/blob/main/packages/vite/src/node/constants.ts)), so a plain `import pingUrl from './sounds/ping.mp3'` returns the served URL in dev and a **hashed** file URL in production builds ([Vite static asset docs](https://vite.dev/guide/assets)) — content-addressed caching for free, and unreferenced sounds are simply not emitted.
- No `?url` suffix needed for known asset types (that suffix is for extensions Vite doesn't recognize). `?inline`/`?no-inline` can force base64 embedding on or off; by default assets under `assetsInlineLimit` (4 KB) are inlined as data URLs. Our files mostly exceed 4 KB; if any tiny blip gets inlined and that's undesirable (data-URL decode per reference), pin it with `?no-inline` — but inlining sub-4 KB cues is actually fine given they're fetched once and cached as `AudioBuffer`s.
- **Avoid `public/`** for these: the Vite docs recommend importing assets over `public/` unless you need stable un-hashed names (robots.txt-style). `public/` files skip hashing (worse caching), skip dead-asset elimination, and their paths are stringly-typed.
- Suggested layout at implementation time: `apps/web/src/assets/sounds/*.mp3` plus one `sounds.ts` module that imports all nine URLs, owns the shared `AudioContext`, preloads buffers, and exposes `playSound(name)` — the single seam the notification and voice features call into.

## Sources

- https://kenney.nl/assets/ui-audio — pack page, license statement "Creative Commons CC0"
- https://kenney.nl/assets/interface-sounds — pack page, license statement "Creative Commons CC0"
- https://freesound.org/help/faq/ — Freesound license tiers, attribution format, license search filters
- https://archive.org/details/material-design-sound-resources — archived Google Material sound pack, "Available under CC-BY 4.0" statement, contents/formats
- https://caniuse.com/opus — Opus support matrix incl. Safari partial / iOS 18.4+ full
- https://caniuse.com/ogg-vorbis — Vorbis support matrix incl. Safari 18.4+ full
- https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs — codec/container support details, MP3 latency caveat, Safari Opus CAF restriction
- https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay — sticky activation, AudioContext suspension, `NotAllowedError` handling
- https://github.com/vitejs/vite/blob/main/packages/vite/src/node/constants.ts — `KNOWN_ASSET_TYPES` includes mp3/ogg/wav/opus/flac/aac
- https://vite.dev/guide/assets — asset URL imports, hashing, `?inline`/`?no-inline`, `assetsInlineLimit`, public/ tradeoffs

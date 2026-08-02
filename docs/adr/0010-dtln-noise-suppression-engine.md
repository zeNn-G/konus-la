# DTLN noise-suppression engine: npm package, after a reversed vendoring attempt

Noise suppression before send is a three-way client setting — None / Standard (browser
gUM) / **DTLN** — with the DTLN engine consumed as a **pinned npm dependency**:
`@workadventure/noise-suppression` (MIT), the original DTLN TFLite models executed by
LiteRT.js inside an AudioWorklet on the mic chain. This **supersedes revision 1 of this
ADR**, which vendored a `dtln-rs` wasm build artifact; that decision was reversed after
implementation experience. Spec: [#121](https://github.com/zeNn-G/konus-la/issues/121)
(revision 2); build ticket [#122](https://github.com/zeNn-G/konus-la/issues/122).

## Context

The browser's built-in `noiseSuppression` constraint handles stationary hiss but little
else; users in noisy environments stay muted or disrupt the channel. ML-grade
suppression must run client-side (the SFU never decodes audio) and must not break the
self-host story: single image, no build-time network fetches
([ADR 0009](0009-single-image-single-port-deployment.md)).

Two engines were compared. `dtln-rs` is Datadog's Rust port of DTLN (breizhn's
Dual-signal Transformation LSTM Network, MIT throughout the lineage) with an internal
resampler, consumable only as a self-built wasm artifact.
`@workadventure/noise-suppression` is a young (v0.1.x) npm package running the same
DTLN models (TFLite exports) via LiteRT.js, maintained by WorkAdventure and shipped in
their production product, with the LiteRT wasm and both model files pre-bundled.

## The vendored attempt, and why it was reversed

Revision 1 chose `dtln-rs` compiled `wasm32-unknown-emscripten` at a pinned commit,
committed as a single self-contained artifact (`SINGLE_FILE=1`, ~8 MB) with a
Docker-pinned rebuild recipe under `tools/dtln/` and a hand-written processor
postscript. Implementation proved the approach wrong in practice:

- The Emscripten glue referenced globals that do not exist in
  `AudioWorkletGlobalScope` (`atob` among others), forcing fragile monkeypatch shims
  into the worklet scope ahead of the glue.
- The Docker/Emscripten build was painful to reproduce (upstream's `build.rs` did not
  even support Linux build hosts without a patched main), making every engine bump a
  toolchain ritual instead of a dependency diff.
- The committed multi-MB artifact needed exclusions across `.gitattributes`, oxlint,
  and oxfmt, and reviewers could only audit the recipe, never the bytes.

All revision-1 artifacts (the vendored processor file, `tools/dtln/`, the exclusions)
are removed.

## Decision

- **Engine: `@workadventure/noise-suppression`, pinned exact version.** The package
  exposes a worklet factory (`createNoiseSuppressionAudioWorklet`) returning the node,
  a readiness promise, and a dispose handle; it pre-bundles the LiteRT wasm and DTLN
  models, so no assets are hosted or vendored by the app. Upgrades are `bun install`
  diffs, reviewed deliberately — the package is young, so the version is pinned exact.
- **16 kHz is mandatory, not preferred**: the package has no internal resampler. In
  dtln mode the per-call mic context is created at 16 kHz; a construction throw or a
  browser that ignores the rate hint (iOS Safari) is an **init failure**, not a
  degraded success. Transmitted audio is 16 kHz wideband while DTLN is on — inherent
  to the model, accepted. iOS Safari therefore gets the Standard fallback; accepted
  for v1.
- **Failure semantics**: any init failure (factory rejection, no readiness within 10 s,
  processor error before ready, wrong-rate context) disposes the engine handle, closes
  the attempted context, and rebuilds the plain chain on a hardware-rate context
  reusing the already-captured raw track — one toast, preference untouched, next call
  retries. A post-ready processor fault bypasses the worklet in place. Where
  AudioWorklet or a secure context is missing, `dtln` behaves as `standard` wholesale
  and the option is disabled with a hint.
- **Exactly one suppressor**: the persisted boolean widens to `none|standard|dtln`
  (read-only migration `"true"`→`standard`, `"false"`→`none`; default `standard`);
  browser `noiseSuppression` rides only in `standard` mode. Mid-call mode changes swap
  the producer track via `replaceTrack` — no re-signaling; the old chain's worklet is
  released via the package's dispose handle.
- **Bundling**: the package is ESM-only and bundles its assets through Vite into the
  normal hashed-asset pipeline — production `dist` stays self-contained (no runtime
  third-party fetches, ADR 0009 intact). The dev server registers the package's Vite
  plugin (`noiseSuppressionAudioWorkletVitePlugin`), which serves the worklet
  processor untransformed — Vite's dev transform would inject its client runtime,
  which `AudioWorkletGlobalScope` cannot load.

## Consequences

- Engine bumps are dependency reviews, not Docker/Emscripten rituals; the repo carries
  no multi-MB artifact and no lint/format/diff exclusions for it.
- The engine's assets are fetched lazily by the browser only when a dtln user joins
  voice, cached immutably like any hashed asset.
- ~32–64 ms added mic latency in dtln mode (one DTLN block plus buffering) — normal
  for ML suppression, accepted.
- The package is v0.1.x; the exact pin and deliberate upgrade review carry that risk.
  The reversal here was settled by implementation experience, not theory — the
  vendored path is not to be resurrected.
- Single-threaded LiteRT execution accepted: the package only uses wasm threads when
  cross-origin isolated, which we are not (no COOP/COEP work in scope).
- RNNoise (or any second ML option) stays out of scope; the select is deliberately
  three-way.

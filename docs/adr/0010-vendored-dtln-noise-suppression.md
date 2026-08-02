# Vendored DTLN wasm for ML noise suppression

Noise suppression before send becomes a three-way client setting — None / Standard
(browser gUM) / **DTLN** — with the DTLN engine shipped as a **committed build
artifact**: `DataDog/dtln-rs` (MIT) compiled to WebAssembly at a pinned commit, inlined
into a single AudioWorklet-loadable file at `apps/web/src/assets/dtln/dtln-processor.js`,
rebuilt only deliberately via the Docker-pinned recipe in `tools/dtln/`. Spec:
[#121](https://github.com/zeNn-G/konus-la/issues/121); build ticket
[#122](https://github.com/zeNn-G/konus-la/issues/122).

## Context

The browser's built-in `noiseSuppression` constraint handles stationary hiss but little
else; users in noisy environments stay muted or disrupt the channel. ML-grade
suppression must run client-side (the SFU never decodes audio) and must not break the
self-host story: single image, no build-time network fetches
([ADR 0009](0009-single-image-single-port-deployment.md)).

Two engines were compared. `@workadventure/noise-suppression` is a young v0.1.x LiteRT
package with a hard 16 kHz requirement and one production consumer. `dtln-rs` is
Datadog's battle-tested Rust port of DTLN (breizhn's Dual-signal Transformation LSTM
Network, MIT throughout the lineage) with a proven browser-integration pattern
(Sharkord, MIT): a wasm module inside an AudioWorklet with an internal resampler, so it
works at any context rate.

## Decision

- **Engine: `dtln-rs` wasm at a pinned commit** (`5bd53c0`), built
  `wasm32-unknown-emscripten` with upstream's own link flags (`SINGLE_FILE=1` inlines
  the wasm into the Emscripten glue). A ~150-line `DtlnProcessor` postscript (adapted
  from Sharkord's MIT implementation, attributed) is appended at build time: 512-sample
  DTLN blocks, native path at 16 kHz, fractional-phase resampler otherwise, `ready:`
  posted on wasm init.
- **Single file is mandatory, not a preference**: `AudioWorkletGlobalScope` has no
  `fetch`, so the module must be self-contained; it also sidesteps `.wasm` MIME serving.
- **The artifact is committed** (~8 MB raw, compresses well) and imported as a hashed
  `?url` asset — existing immutable-cache static serving; the browser fetches it only at
  `addModule` time, i.e. when a user who selected DTLN joins voice. Excluded from
  formatting/linting/diffs/language stats (`.gitattributes` `-text -diff
  linguist-generated`; `-text` matters — autocrlf would corrupt the inlined wasm on
  Windows checkouts).
- **Rebuilds are deliberate, never CI**: `bun tools/dtln/build.ts` drives a pinned
  `emscripten/emsdk` Dockerfile (pinned Rust toolchain; upstream cloned and checked out
  inside the image), assembles the artifact, and gates it on a smoke harness — a
  simulated worklet scope (unguarded `window`/`document`/`fetch` references throw) plus
  a white-noise attenuation proof (measured ≈ −30 dB RMS, no NaNs).
- **16 kHz strategy**: in dtln mode the per-call mic context is requested at 16 kHz
  (try/catch — the spec permits `NotSupportedError`), giving the worklet its native path
  with the browser doing high-quality capture resampling; the worklet's internal
  resampler is the safety net where the rate is refused or ignored. Transmitted audio is
  16 kHz wideband while DTLN is on — inherent to the model, accepted.
- **Exactly one suppressor**: the persisted boolean widens to `none|standard|dtln`
  (read-only migration `"true"`→`standard`, `"false"`→`none`; default `standard`);
  browser `noiseSuppression` rides only in `standard` mode. Mid-call mode changes swap
  the producer track via `replaceTrack` — no re-signaling; failures degrade to Standard
  with one toast, preference unchanged.

## Consequences

- Self-hosting stays dependency-free: the engine ships in the image like any static
  asset; no CDN, no runtime downloads beyond the app's own origin.
- ~32–64 ms added mic latency in dtln mode (one DTLN block plus buffering) — normal for
  ML suppression, accepted.
- The 4 MB-class artifact is a repo-weight tax paid once per engine bump; reviewers
  audit the recipe (pinned commit, Docker digest) rather than the bytes.
- Upstream `build.rs` only supports macOS/Windows build hosts; the image appends a Linux
  equivalent of its macOS wasm branch (`tools/dtln/build-rs-linux-main.rs`) — a
  deliberate, visible patch kept out of the artifact itself.
- Browsers without AudioWorklet or a secure context can never run DTLN: the option is
  disabled with a hint and a stored `dtln` preference behaves as Standard — audio is
  never worse than before the feature existed.
- RNNoise (or any second ML option) stays out of scope; the select is deliberately
  three-way.

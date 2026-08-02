# tools/dtln — DTLN noise-suppression engine build

Builds the committed AudioWorklet artifact
`apps/web/src/assets/dtln/dtln-processor.js`: the
[DataDog/dtln-rs](https://github.com/DataDog/dtln-rs) noise-suppression engine
compiled to WebAssembly, inlined into a single worklet-loadable JS file, with
the `DtlnProcessor` AudioWorkletProcessor appended.

## Rebuild

One command (requires Docker):

```text
bun tools/dtln/build.ts
```

The Dockerfile clones `DataDog/dtln-rs`, checks out the pinned commit **inside
the image**, and runs its `install-wasm` build (Rust →
`wasm32-unknown-emscripten`; upstream's cargo config links with
`SINGLE_FILE=1`, so the wasm is inlined into the Emscripten glue — an
`AudioWorkletGlobalScope` has no `fetch`, so a single file is mandatory). The
build script copies the glue out, prepends a provenance banner, appends
`postscript.js`, writes the artifact, and runs the smoke gate.

Rebuilds are deliberate: this never runs in CI, and the artifact is committed.
To bump the engine, change the pinned values, rebuild, and review the smoke
output.

## Pinned versions

| What | Value |
| --- | --- |
| `DataDog/dtln-rs` commit | `5bd53c00d3334615f9b03fa7775402ae2a39b616` |
| Base image | `emscripten/emsdk:3.1.74` |
| Rust toolchain | `1.85.0` (`wasm32-unknown-emscripten` target) |

The dtln-rs commit is pinned in both the Dockerfile (`DTLN_RS_COMMIT` arg
default) and `build.ts` (`PINNED_COMMIT`, also stamped into the artifact
banner); keep them in sync.

## Smoke gate

```text
bun tools/dtln/smoke.ts
```

Loads the committed artifact in a simulated `AudioWorkletGlobalScope` — the
globals a worklet lacks (`window`, `document`, `fetch`, `XMLHttpRequest`,
`importScripts`, `self`, timers) are shadowed to `undefined`, so any unguarded
reference throws — then constructs the processor, waits for the wasm `ready:`
signal, and pushes 3 s of deterministic white noise through it. Passes only if
output RMS is well below input RMS with no NaNs and no digital silence.
`build.ts` runs this automatically after every build.

## Artifact hygiene

The artifact is generated and ~8 MB raw (it compresses well, and only users who
select DTLN and join voice ever fetch it), so it is excluded from tooling that
would mangle or drown in it:

- `.gitattributes`: `-text -diff linguist-generated=true` (`-text` matters —
  autocrlf would corrupt the inlined wasm bytes on Windows checkouts)
- `.oxlintrc.json` / `.oxfmtrc.json`: ignored

## Licenses

Everything in the chain is MIT:

- **DataDog/dtln-rs** — MIT, Copyright (c) 2024 Datadog Inc. (engine; also
  ships `LICENSE-3rdparty.csv` and `NOTICE` upstream, including the prebuilt
  TensorFlow Lite static libraries, Apache-2.0)
- **breizhn/DTLN** — MIT (the DTLN model weights dtln-rs embeds)
- **Sharkord** — MIT (`postscript.js` is adapted from its
  `resampling-postscript.js`)

# konus-la

## 1.0.1

### Patch Changes

- [#124](https://github.com/zeNn-G/konus-la/pull/124) [`73fb815`](https://github.com/zeNn-G/konus-la/commit/73fb815f7059185352d75a552e015327bbaf4934) Thanks [@zeNn-G](https://github.com/zeNn-G)! - DTLN noise suppression before send: Voice settings gain a three-way noise-suppression
  mode (None / Standard / DTLN). DTLN runs the `@workadventure/noise-suppression` engine
  in an AudioWorklet on the mic chain at 16 kHz, with lazy asset loading, seamless
  mid-call mode changes, and graceful degradation to Standard (single notice) whenever
  the engine cannot initialize. Existing on/off preferences migrate in place; defaults
  are unchanged.

## 1.0.0

### Major Changes

- [#117](https://github.com/zeNn-G/konus-la/pull/117) [`ce36cbe`](https://github.com/zeNn-G/konus-la/commit/ce36cbea4c5d5a67a048a0338f38c8219871bc73) Thanks [@zeNn-G](https://github.com/zeNn-G)! - Initial release.

---
"konus-la": minor
---

DTLN noise suppression before send: Voice settings gain a three-way noise-suppression
mode (None / Standard / DTLN). DTLN runs the `@workadventure/noise-suppression` engine
in an AudioWorklet on the mic chain at 16 kHz, with lazy asset loading, seamless
mid-call mode changes, and graceful degradation to Standard (single notice) whenever
the engine cannot initialize. Existing on/off preferences migrate in place; defaults
are unchanged.

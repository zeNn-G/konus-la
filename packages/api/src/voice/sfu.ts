import type { types } from "mediasoup";

/**
 * The seam between the SFU worker (owned by apps/server, which needs the Bun spawn patch
 * and the crash-loop breaker) and the voice rooms here. The server injects a provider at
 * boot; `mediasoup` itself is only ever a TYPE import in this package — vitest injects a
 * worker of its own (it runs under Node, where mediasoup spawns unpatched).
 *
 * A null worker means a respawn is in flight or voice is down — either way the caller
 * cannot get a router right now (VOICE_UNAVAILABLE; the breaker gate usually fires first).
 */
let getWorker: () => types.Worker | null = () => null;

export function setSfuWorker(provider: () => types.Worker | null): void {
  getWorker = provider;
}

export function sfuWorker(): types.Worker | null {
  return getWorker();
}

/**
 * The worker's WebRtcServer — every transport multiplexes over its single UDP+TCP port
 * pair (ADR 0009; ICE credentials demultiplex peers). Injected alongside the worker and
 * shares its lifecycle: the server dies with the worker, so a null/closed server means
 * the same thing a null worker does.
 */
let getServer: () => types.WebRtcServer | null = () => null;

export function setWebRtcServer(provider: () => types.WebRtcServer | null): void {
  getServer = provider;
}

export function getWebRtcServer(): types.WebRtcServer | null {
  return getServer();
}

/**
 * Router codec menu (spec §Media policy): Opus with DTX + FEC (no bitrate cap), VP8 for
 * cam + screen. No simulcast in v1.
 */
export const MEDIA_CODECS: types.RouterRtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48_000,
    channels: 2,
    parameters: { usedtx: 1, useinbandfec: 1 },
  },
  { kind: "video", mimeType: "video/VP8", clockRate: 90_000 },
];

/**
 * AudioLevelObserver tuning: the ~500 ms interval IS the activeSpeakers debounce
 * (ADR 0007 — events are edge-triggered on top of it). -70 dBvol keeps breath/keyboard
 * noise out of the speaking ring (mediasoup's -80 default is too sensitive).
 */
export const AUDIO_LEVEL_OBSERVER_OPTIONS = {
  maxEntries: 20, // the room seat cap — never truncate a full room's speakers
  threshold: -70,
  interval: 500,
} as const;

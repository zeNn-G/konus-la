import type { ScreensharePreset } from "./store";

/**
 * Local capture + encoding caps (phase-5 spec §Media policy). Client encodings are
 * advisory — the server's `setMaxIncomingBitrate` backstop is the authoritative ceiling.
 */

export const CAM_MAX_BITRATE = 1_000_000;

export const SCREEN_PRESETS: Record<
  ScreensharePreset,
  { width: number; height: number; frameRate: number; maxBitrate: number }
> = {
  "720p": { width: 1280, height: 720, frameRate: 30, maxBitrate: 1_500_000 },
  "1080p": { width: 1920, height: 1080, frameRate: 30, maxBitrate: 3_000_000 },
  "1080p60": { width: 1920, height: 1080, frameRate: 60, maxBitrate: 5_000_000 },
};

function onlyTrack(stream: MediaStream, kind: "audio" | "video"): MediaStreamTrack {
  const track = kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
  if (!track) throw new Error(`capture returned no ${kind} track`);
  return track;
}

/** The browser's built-in speech processing stages, each a user toggle (#81). */
export interface MicProcessing {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

/**
 * Throws NotAllowedError etc. on denial — the caller degrades to listen-only.
 * `deviceId` rides as `ideal`: a stale persisted id falls back to the system default
 * instead of throwing OverconstrainedError (#25).
 */
export async function getMicTrack(
  deviceId: string | undefined,
  processing: MicProcessing,
): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
      ...processing,
    },
  });
  return onlyTrack(stream, "audio");
}

export async function getCamTrack(): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  return onlyTrack(stream, "video");
}

export interface ScreenCapture {
  video: MediaStreamTrack;
  /** Present only when the user ticked "share tab/system audio" in the browser picker. */
  audio: MediaStreamTrack | null;
}

/**
 * One `getDisplayMedia` call for both halves of a share. Audio is a picker opt-in the
 * browser may not even offer (Firefox/Safari, window capture) — `audio: null` is the
 * normal video-only case, never an error. Voice processing is disabled on the audio
 * request: this is content audio (movie/music), not speech.
 */
export async function getScreenCapture(preset: ScreensharePreset): Promise<ScreenCapture> {
  const { width, height, frameRate } = SCREEN_PRESETS[preset];
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate } },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  return { video: onlyTrack(stream, "video"), audio: stream.getAudioTracks()[0] ?? null };
}

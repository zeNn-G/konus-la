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

/**
 * Throws NotAllowedError etc. on denial — the caller degrades to listen-only.
 * `deviceId` rides as `ideal`: a stale persisted id falls back to the system default
 * instead of throwing OverconstrainedError (#25).
 */
export async function getMicTrack(deviceId?: string): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
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

export async function getScreenTrack(preset: ScreensharePreset): Promise<MediaStreamTrack> {
  const { width, height, frameRate } = SCREEN_PRESETS[preset];
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate } },
    // Screenshare audio is out for v1: `voice.produce` pairs kind "audio" strictly with
    // source "mic", so a second audio producer has no wire shape to ride.
    audio: false,
  });
  return onlyTrack(stream, "video");
}

import { create } from "zustand";

/**
 * Tier 2 of the voice split (phase-5 spec §Client architecture): the live media session,
 * existing exactly while joined and reset wholesale on leave. Only VoiceSession methods
 * write the machine fields — no React effect ever drives a transition. Tracks live here
 * so tiles/bridge can render them; the mediasoup objects themselves (Device, transports,
 * producers, consumers) stay inside VoiceSession and never enter any cache.
 */

export type VoiceStatus = "idle" | "joining" | "connected" | "reconnecting";
export type ProducerSource = "mic" | "cam" | "screen" | "screenAudio";
export type ScreensharePreset = "720p" | "1080p" | "1080p60";

export type RemoteMedia = {
  consumerId: string;
  producerId: string;
  kind: "audio" | "video";
  source: ProducerSource;
  track: MediaStreamTrack;
};

/** One remote peer's media, merged so a tile reads a single entry. */
export type RemotePeerMedia = Partial<Record<ProducerSource, RemoteMedia>>;

const VOLUMES_STORAGE_KEY = "voice:peer-volumes";

function loadVolumes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(VOLUMES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export interface VoiceStoreState {
  status: VoiceStatus;
  channelId: string | null;
  guildId: string | null;
  seatSessionId: string | null;
  selfMute: boolean;
  selfDeaf: boolean;
  /** Mic capture failed (denied / no device) — listen-only; the mic button is the retry. */
  micError: boolean;
  /** Own outgoing tracks, for self-tiles and device UX. */
  localTracks: Partial<Record<ProducerSource, MediaStreamTrack>>;
  /** Remote media keyed by userId. */
  peers: Record<string, RemotePeerMedia>;
  /** One-shot user-facing status line ("voice moved to another window"). */
  notice: string | null;
  /**
   * Refcounts of video consumerIds some mounted component currently renders. Owned by
   * components (bind on mount, unbind on unmount); VoiceSession turns interest + tab
   * visibility into server-side consumer pause/resume.
   */
  videoInterest: Record<string, number>;
  /** Per-peer playback volume 0..1, persisted per userId. */
  volumes: Record<string, number>;
  bindVideo: (consumerId: string) => void;
  unbindVideo: (consumerId: string) => void;
  setVolume: (userId: string, volume: number) => void;
}

export const useVoiceStore = create<VoiceStoreState>()((set) => ({
  status: "idle",
  channelId: null,
  guildId: null,
  seatSessionId: null,
  selfMute: false,
  selfDeaf: false,
  micError: false,
  localTracks: {},
  peers: {},
  notice: null,
  videoInterest: {},
  volumes: typeof localStorage === "undefined" ? {} : loadVolumes(),

  bindVideo: (consumerId) =>
    set((state) => ({
      videoInterest: {
        ...state.videoInterest,
        [consumerId]: (state.videoInterest[consumerId] ?? 0) + 1,
      },
    })),

  unbindVideo: (consumerId) =>
    set((state) => {
      const count = (state.videoInterest[consumerId] ?? 0) - 1;
      if (count > 0) return { videoInterest: { ...state.videoInterest, [consumerId]: count } };
      const { [consumerId]: _gone, ...rest } = state.videoInterest;
      return { videoInterest: rest };
    }),

  setVolume: (userId, volume) =>
    set((state) => {
      const volumes = { ...state.volumes, [userId]: volume };
      try {
        localStorage.setItem(VOLUMES_STORAGE_KEY, JSON.stringify(volumes));
      } catch {
        // storage full/blocked — volume still applies for this session
      }
      return { volumes };
    }),
}));

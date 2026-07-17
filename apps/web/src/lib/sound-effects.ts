/**
 * The sound-effects system (phase-7 spec §Sound system #79, §Master output volume #78):
 * every UX/notification cue decodes once into an `AudioBuffer` behind ONE shared
 * `AudioContext` and plays through master `GainNode` → `MediaStreamAudioDestinationNode`
 * → one persistent hidden `<audio>` element. The element is what `setSinkId` targets, so
 * effects follow the output-device preference exactly like voice (`AudioSink`) — same
 * support matrix, Safari stays system-default. Remote voice does NOT route through here:
 * it stays element-volume only (a Web Audio graph would regress Firefox output selection).
 *
 * Autoplay policy: the context starts suspended and the hidden element unplayed until the
 * first user gesture (`activate`); any play attempt before that is dropped silently —
 * queueing it would burst stale cues on resume.
 */

// Imported from source so Vite emits hashed URLs; ?no-inline pins the sub-4KB blips to
// real files too — the fetch+decode preload wants URLs, not data: URIs.
import deafenOffUrl from "@/assets/sounds/deafen-off.mp3?no-inline";
import deafenOnUrl from "@/assets/sounds/deafen-on.mp3?no-inline";
import muteOffUrl from "@/assets/sounds/mute-off.mp3?no-inline";
import muteOnUrl from "@/assets/sounds/mute-on.mp3?no-inline";
import notificationUrl from "@/assets/sounds/notification.mp3?no-inline";
import peerJoinUrl from "@/assets/sounds/peer-join.mp3?no-inline";
import peerLeaveUrl from "@/assets/sounds/peer-leave.mp3?no-inline";
import selfJoinUrl from "@/assets/sounds/self-join.mp3?no-inline";
import selfLeaveUrl from "@/assets/sounds/self-leave.mp3?no-inline";

import { useDeviceStore } from "@/lib/voice/devices";

export type SoundCue =
  | "notification"
  | "self-join"
  | "self-leave"
  | "mute-on"
  | "mute-off"
  | "deafen-on"
  | "deafen-off"
  | "peer-join"
  | "peer-leave";

/**
 * The occupancy events → cue mapping for the realtime dispatcher: a peer entering or
 * leaving the room THIS user is seated in (charter: "someone joins/leaves your current
 * voice room"). Own events fan out too (the server publishes guild-wide) — filtered here.
 */
export function peerSoundCue(
  event: { type: "voice.peerJoined" | "voice.peerLeft"; channelId: string; userId: string },
  selfUserId: string,
  voice: {
    status: "idle" | "joining" | "connected" | "reconnecting";
    channelId: string | null;
  },
): SoundCue | null {
  // Mid-ceremony ("joining") is not seated yet — a room the join may never enter must
  // stay silent; a reconnecting seat survives in grace and still counts.
  if (voice.status !== "connected" && voice.status !== "reconnecting") return null;
  if (voice.channelId === null || event.channelId !== voice.channelId) return null;
  if (event.userId === selfUserId) return null;
  return event.type === "voice.peerJoined" ? "peer-join" : "peer-leave";
}

// --- structural seams (the real Web Audio objects satisfy these; tests fake them) -----------

export interface GainNodeLike {
  gain: { value: number };
  connect(node: unknown): unknown;
}

export interface AudioBufferSourceLike {
  buffer: unknown;
  connect(node: unknown): unknown;
  start(): void;
}

export interface AudioContextLike {
  state: "suspended" | "running" | "closed" | "interrupted";
  resume(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
  createGain(): GainNodeLike;
  createBufferSource(): AudioBufferSourceLike;
  createMediaStreamDestination(): { stream: unknown };
}

export interface SinkElementLike {
  srcObject: unknown;
  play(): Promise<void>;
  /** Absent on Safari — output selection then simply doesn't exist (#25). */
  setSinkId?(sinkId: string): Promise<void>;
}

export interface SoundEngineDeps {
  createContext(): AudioContextLike;
  createElement(): SinkElementLike;
  fetchBuffer(url: string): Promise<ArrayBuffer>;
  cueUrls: Record<SoundCue, string>;
  /** The `konusLa.sound-prefs` overrides-only map — absent cue = enabled. */
  loadSoundPrefs(): Partial<Record<SoundCue, boolean>>;
}

export class SoundEngine {
  private context: AudioContextLike | null = null;
  private masterGain: GainNodeLike | null = null;
  private element: SinkElementLike | null = null;
  private elementStarted = false;
  private buffers = new Map<SoundCue, unknown>();

  constructor(private deps: SoundEngineDeps) {}

  /** Idempotent: builds the graph and kicks off buffer preloads (per-cue best-effort). */
  start(): void {
    if (this.context) return;
    this.context = this.deps.createContext();
    this.masterGain = this.context.createGain();
    const destination = this.context.createMediaStreamDestination();
    this.masterGain.connect(destination);
    this.element = this.deps.createElement();
    this.element.srcObject = destination.stream;
    for (const [cue, url] of Object.entries(this.deps.cueUrls) as Array<[SoundCue, string]>) {
      void this.deps
        .fetchBuffer(url)
        .then((data) => this.context!.decodeAudioData(data))
        .then((buffer) => void this.buffers.set(cue, buffer))
        .catch(() => {
          // Failed fetch/decode: this cue stays silent; the others are unaffected.
        });
    }
  }

  /** First-gesture activation; safe to call repeatedly, `NotAllowedError` swallowed. */
  async activate(): Promise<void> {
    if (!this.context || !this.element) return;
    try {
      await this.context.resume();
    } catch {
      // Pre-activation resume attempt — the next gesture retries.
    }
    try {
      await this.element.play();
      this.elementStarted = true;
    } catch {
      // Same policy as the context resume.
    }
  }

  play(cue: SoundCue): void {
    if (!this.context || !this.masterGain) return;
    if (this.context.state !== "running") return;
    // Consulted fresh on every play — the #77 toggles only ever write the map.
    if (this.deps.loadSoundPrefs()[cue] === false) return;
    const buffer = this.buffers.get(cue);
    if (buffer === undefined) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.masterGain);
    source.start();
  }

  /** The device store's `outputVolume` (#78) — wiring subscribes and forwards it here. */
  setMasterVolume(volume: number): void {
    if (this.masterGain) this.masterGain.gain.value = volume;
  }

  /** The device store's `sinkId` (#25) — same fallback semantics as `AudioSink`. */
  setSink(sinkId: string): void {
    // A gone device rejects — the device manager already fell back to "" by then.
    void this.element?.setSinkId?.(sinkId).catch(() => {});
  }

  /**
   * True once a gesture resumed the context AND started the hidden element — only then
   * are plays audible, so activation stays armed until both halves have landed.
   */
  isActive(): boolean {
    return this.context?.state === "running" && this.elementStarted;
  }
}

// --- the real browser half -------------------------------------------------------------------

export const SOUND_PREFS_STORAGE_KEY = "konusLa.sound-prefs";

const CUE_URLS: Record<SoundCue, string> = {
  notification: notificationUrl,
  "self-join": selfJoinUrl,
  "self-leave": selfLeaveUrl,
  "mute-on": muteOnUrl,
  "mute-off": muteOffUrl,
  "deafen-on": deafenOnUrl,
  "deafen-off": deafenOffUrl,
  "peer-join": peerJoinUrl,
  "peer-leave": peerLeaveUrl,
};

function loadSoundPrefs(): Partial<Record<SoundCue, boolean>> {
  try {
    const raw = localStorage.getItem(SOUND_PREFS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<SoundCue, boolean>>) : {};
  } catch {
    return {};
  }
}

function createRealDeps(): SoundEngineDeps {
  return {
    createContext: () => new AudioContext(),
    createElement: () => document.createElement("audio"),
    fetchBuffer: async (url) => (await fetch(url)).arrayBuffer(),
    cueUrls: CUE_URLS,
    loadSoundPrefs,
  };
}

let engine: SoundEngine | null = null;

/** The one entry every cue caller uses; a no-op until `initSoundEffects` has run. */
export function playSoundCue(cue: SoundCue): void {
  engine?.play(cue);
}

/**
 * Idempotent; called once from the authenticated shell (the audio bridge's home). Builds
 * the engine, follows the device store's `outputVolume`/`sinkId`, and rides the first
 * user gesture to satisfy autoplay policy for both the context and the hidden element.
 */
export function initSoundEffects(): void {
  if (engine || typeof window === "undefined") return;
  const created = new SoundEngine(createRealDeps());
  engine = created;
  created.start();
  created.setMasterVolume(useDeviceStore.getState().outputVolume);
  created.setSink(useDeviceStore.getState().sinkId);
  useDeviceStore.subscribe((state, prev) => {
    if (state.outputVolume !== prev.outputVolume) created.setMasterVolume(state.outputVolume);
    if (state.sinkId !== prev.sinkId) created.setSink(state.sinkId);
  });

  const onGesture = () => {
    void created.activate().then(() => {
      if (!created.isActive()) return; // not a real activation gesture — keep listening
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
    });
  };
  window.addEventListener("pointerdown", onGesture, true);
  window.addEventListener("keydown", onGesture, true);
}

// Dev-only programmatic access — acceptance checks drive cues from the console or a
// Playwright harness without any UI slice present (the phase-5 __voiceSession precedent).
if (import.meta.env.DEV) {
  (globalThis as Record<string, unknown>).__soundEffects = {
    play: playSoundCue,
    engine: () => engine,
  };
}

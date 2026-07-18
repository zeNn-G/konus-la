import { effectiveMicDeviceId, micProcessing, useDeviceStore } from "./devices";
import { getMicTrack } from "./media-sources";

/**
 * The persistent mic capture chain (#81): raw gUM track → `MediaStreamAudioSourceNode` →
 * `GainNode` → `MediaStreamAudioDestinationNode`. The mediasoup producer receives the
 * destination track ONCE, for the session's life — re-captures (device switch, processing
 * toggle) swap the source node inside the graph, never the producer's track. The chain
 * owns the raw track and a dedicated `AudioContext` created per start and closed on
 * dispose — deliberately NOT the shared effects context (`sound-effects.ts`), whose
 * lifetime is the app session, not the call.
 *
 * The input-volume pref drives the gain live (clamped 0..1 — attenuation-only, boost
 * would clip at the encoder) with no signaling; it applies even while muted, since mute
 * is `producer.pause()`, entirely outside this graph.
 */

// --- structural seams (the real Web Audio objects satisfy these; tests fake them) -----------

export interface MicStreamLike {
  getAudioTracks(): MediaStreamTrack[];
}

export interface MicSourceNodeLike {
  connect(node: unknown): unknown;
  disconnect(): void;
}

export interface MicGainNodeLike {
  gain: { value: number };
  connect(node: unknown): unknown;
}

export interface MicContextLike {
  createMediaStreamSource(stream: MicStreamLike): MicSourceNodeLike;
  createGain(): MicGainNodeLike;
  createMediaStreamDestination(): { stream: MicStreamLike };
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface MicChainDeps {
  /** Raw mic capture on the current effective device + processing prefs. */
  captureTrack(): Promise<MediaStreamTrack>;
  createContext(): MicContextLike;
  /** Wrap a raw track for `createMediaStreamSource` (real: `new MediaStream([track])`). */
  createSourceStream(track: MediaStreamTrack): MicStreamLike;
  getInputVolume(): number;
  /** Subscribe to input-volume pref changes; returns an unsubscribe. */
  onInputVolumeChange(listener: (volume: number) => void): () => void;
}

/** The session's view of the chain (its `MicChainLike` seam). */
export class MicChain {
  private context: MicContextLike | null = null;
  private source: MicSourceNodeLike | null = null;
  private gain: MicGainNodeLike | null = null;
  private rawTrack: MediaStreamTrack | null = null;
  private unsubscribeVolume: (() => void) | null = null;
  private disposed = false;
  /** Supersedes in-flight captures — `devicechange` bursts can overlap re-captures. */
  private captureSeq = 0;

  constructor(private deps: MicChainDeps) {}

  /**
   * Capture the raw mic and build the graph; returns the persistent destination track.
   * Capture rejections (denial) propagate — the session degrades to listen-only.
   */
  async start(): Promise<MediaStreamTrack> {
    const seq = ++this.captureSeq;
    const raw = await this.deps.captureTrack();
    if (this.disposed || seq !== this.captureSeq) {
      raw.stop();
      throw new Error("mic chain disposed during capture");
    }
    this.rawTrack = raw;
    const context = this.deps.createContext();
    this.context = context;
    // Belt-and-braces vs autoplay policy: a suspended context would capture silence.
    void context.resume().catch(() => {});
    this.gain = context.createGain();
    this.gain.gain.value = clampGain(this.deps.getInputVolume());
    const destination = context.createMediaStreamDestination();
    // Future mic test / level meter (#81 leftover): an AnalyserNode taps the gain here.
    this.gain.connect(destination);
    this.source = context.createMediaStreamSource(this.deps.createSourceStream(raw));
    this.source.connect(this.gain);
    this.unsubscribeVolume = this.deps.onInputVolumeChange((volume) => {
      if (this.gain) this.gain.gain.value = clampGain(volume);
    });
    const track = destination.stream.getAudioTracks()[0];
    if (!track) throw new Error("mic chain destination produced no track");
    return track;
  }

  /**
   * Re-capture (device switch or processing toggle) and swap the source node — the
   * destination track, and with it the producer, never changes. A failed capture (device
   * raced away / denied) keeps the current source running.
   */
  async recapture(): Promise<void> {
    if (!this.context || !this.gain || this.disposed) return;
    const seq = ++this.captureSeq;
    let raw: MediaStreamTrack;
    try {
      raw = await this.deps.captureTrack();
    } catch {
      return;
    }
    if (this.disposed || seq !== this.captureSeq) {
      raw.stop();
      return;
    }
    const oldSource = this.source;
    const oldRaw = this.rawTrack;
    this.source = this.context.createMediaStreamSource(this.deps.createSourceStream(raw));
    this.source.connect(this.gain);
    this.rawTrack = raw;
    oldSource?.disconnect();
    oldRaw?.stop();
  }

  /**
   * Stop the RAW track — anything less leaves the tab's mic indicator lit — and close
   * the dedicated context. Idempotent; supersedes any in-flight capture.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.captureSeq += 1;
    this.unsubscribeVolume?.();
    this.unsubscribeVolume = null;
    this.rawTrack?.stop();
    this.rawTrack = null;
    void this.context?.close().catch(() => {});
    this.context = null;
    this.source = null;
    this.gain = null;
  }
}

/** Attenuation-only — the graph never boosts past unity even if a pref write slips by. */
function clampGain(volume: number): number {
  return Math.min(1, Math.max(0, volume));
}

/** The real browser half; the session's deps construct one chain per media epoch. */
export function createRealMicChain(): MicChain {
  return new MicChain({
    captureTrack: () => getMicTrack(effectiveMicDeviceId(), micProcessing()),
    createContext: () => new AudioContext(),
    createSourceStream: (track) => new MediaStream([track]),
    getInputVolume: () => useDeviceStore.getState().inputVolume,
    onInputVolumeChange: (listener) =>
      useDeviceStore.subscribe((state, prev) => {
        if (state.inputVolume !== prev.inputVolume) listener(state.inputVolume);
      }),
  });
}

import { createNoiseSuppressionAudioWorklet } from "@workadventure/noise-suppression/audio-worklet";
import { toast } from "sonner";

import {
  effectiveMicDeviceId,
  micProcessing,
  supportsDtln,
  useDeviceStore,
  type NoiseSuppressionMode,
} from "./devices";
import { getMicTrack } from "./media-sources";

/**
 * The persistent mic capture chain (#81, #122): raw gUM track → `MediaStreamAudioSourceNode`
 * → [DTLN worklet, dtln mode only] → `GainNode` → `MediaStreamAudioDestinationNode`. The
 * mediasoup producer receives the destination track for the chain's life — re-captures
 * (device switch, processing toggle) swap the source node inside the graph, never the
 * producer's track; a noise-suppression *mode* change replaces the whole chain (the
 * session swaps producer tracks via `replaceTrack`). The chain owns the raw track and a
 * dedicated `AudioContext` created per start and closed on dispose — deliberately NOT
 * the shared effects context (`sound-effects.ts`), whose lifetime is the app session,
 * not the call.
 *
 * The DTLN engine is `@workadventure/noise-suppression` (ADR 0010): its factory yields
 * the worklet node, a readiness promise, and a dispose handle. The engine has no
 * internal resampler, so dtln mode REQUIRES a context genuinely running at 16 kHz — a
 * construction throw or a browser that ignores the rate hint (iOS Safari) is an init
 * failure, not a degraded success. Any init failure (factory rejection, no readiness
 * within 10 s, processor error before ready, wrong-rate context) collapses to the plain
 * chain on a hardware-rate context with a single fallback notice, reusing the raw track
 * already captured. In none/standard modes the chain runs an optionless context with
 * zero engine interaction — the DTLN feature must be unobservable there.
 *
 * The input-volume pref drives the gain live (clamped 0..1 — attenuation-only, boost
 * would clip at the encoder) with no signaling; it applies even while muted, since mute
 * is `producer.pause()`, entirely outside this graph. The worklet also keeps running
 * while muted — idle CPU burn accepted for v1, unmute is instant.
 */

const DTLN_CONTEXT_SAMPLE_RATE = 16000;
const DTLN_READY_TIMEOUT_MS = 10_000;

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

export interface MicWorkletNodeLike {
  onprocessorerror: (() => void) | null;
  connect(node: unknown): unknown;
}

/** The engine factory's handle: what `createNoiseSuppressionAudioWorklet` resolves to,
 * reduced to the surface the chain touches. `dispose()` disconnects the node and stops
 * the denoiser instance — the chain owns calling it on every path that abandons the
 * worklet (fallback, supersede, bypass, chain disposal). */
export interface DtlnWorkletHandle {
  node: MicWorkletNodeLike;
  ready: Promise<unknown>;
  dispose(): void;
}

export interface MicContextLike {
  sampleRate: number;
  createMediaStreamSource(stream: MicStreamLike): MicSourceNodeLike;
  createGain(): MicGainNodeLike;
  createMediaStreamDestination(): { stream: MicStreamLike };
  resume(): Promise<void>;
  close(): Promise<void>;
}

/** Why DTLN gave way: `init` = never came up (fell back to a plain chain on a fresh
 * context), `runtime` = died mid-call (bypassed in place, audio continues). */
export type DtlnFallbackReason = "init" | "runtime";

export interface MicChainDeps {
  /** Raw mic capture on the current effective device + processing prefs. */
  captureTrack(): Promise<MediaStreamTrack>;
  /** Options carry the 16 kHz request in dtln mode; MUST be absent otherwise. May throw
   * `NotSupportedError` for a rate the browser refuses. */
  createContext(options?: { sampleRate: number }): MicContextLike;
  /** Wrap a raw track for `createMediaStreamSource` (real: `new MediaStream([track])`). */
  createSourceStream(track: MediaStreamTrack): MicStreamLike;
  getInputVolume(): number;
  /** Subscribe to input-volume pref changes; returns an unsubscribe. */
  onInputVolumeChange(listener: (volume: number) => void): () => void;
  getNsMode(): NoiseSuppressionMode;
  supportsDtln(): boolean;
  /** The engine's worklet factory on the given (16 kHz) context; rejects on load/init
   * failure. Real: `createNoiseSuppressionAudioWorklet`. */
  createDtlnWorklet(context: MicContextLike): Promise<DtlnWorkletHandle>;
  onDtlnFallback(reason: DtlnFallbackReason): void;
}

/** The session's view of the chain (its `MicChainLike` seam). */
export class MicChain {
  private context: MicContextLike | null = null;
  private source: MicSourceNodeLike | null = null;
  private gain: MicGainNodeLike | null = null;
  private dtln: DtlnWorkletHandle | null = null;
  /** Where a (re)captured source connects: the worklet while DTLN runs, else the gain. */
  private inputSink: MicWorkletNodeLike | MicGainNodeLike | null = null;
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
    if (this.stale(seq)) {
      raw.stop();
      throw new Error("mic chain disposed during capture");
    }
    this.rawTrack = raw;
    let dtln: DtlnWorkletHandle | null = null;
    if (this.deps.getNsMode() === "dtln" && this.deps.supportsDtln()) {
      dtln = await this.initDtln(seq);
    } else {
      this.usePlainContext();
    }
    const context = this.context!;
    this.gain = context.createGain();
    this.gain.gain.value = clampGain(this.deps.getInputVolume());
    const destination = context.createMediaStreamDestination();
    // Future mic test / level meter (#81 leftover): an AnalyserNode taps the gain here.
    this.gain.connect(destination);
    if (dtln) {
      dtln.node.connect(this.gain);
      // From here on a processor fault is mid-call: bypass in place, keep audio flowing.
      dtln.node.onprocessorerror = () => this.bypassWorklet();
    }
    this.dtln = dtln;
    this.inputSink = dtln?.node ?? this.gain;
    this.source = context.createMediaStreamSource(this.deps.createSourceStream(raw));
    this.source.connect(this.inputSink);
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
   * raced away / denied) keeps the current source.
   */
  async recapture(): Promise<void> {
    if (!this.context || !this.inputSink || this.disposed) return;
    const seq = ++this.captureSeq;
    let raw: MediaStreamTrack;
    try {
      raw = await this.deps.captureTrack();
    } catch {
      return;
    }
    if (this.stale(seq)) {
      raw.stop();
      return;
    }
    const oldSource = this.source;
    const oldRaw = this.rawTrack;
    this.source = this.context.createMediaStreamSource(this.deps.createSourceStream(raw));
    this.source.connect(this.inputSink);
    this.rawTrack = raw;
    oldSource?.disconnect();
    oldRaw?.stop();
  }

  /**
   * Stop the RAW track — anything less leaves the tab's mic indicator lit — dispose the
   * engine handle, and close the dedicated context. Idempotent; supersedes any in-flight
   * capture.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.captureSeq += 1;
    this.unsubscribeVolume?.();
    this.unsubscribeVolume = null;
    this.rawTrack?.stop();
    this.rawTrack = null;
    this.dtln?.dispose();
    this.dtln = null;
    void this.context?.close().catch(() => {});
    this.context = null;
    this.source = null;
    this.gain = null;
    this.inputSink = null;
  }

  private stale(seq: number): boolean {
    return this.disposed || seq !== this.captureSeq;
  }

  /** An optionless hardware-rate context as the chain's context — the none/standard
   * path and the DTLN-fallback landing spot. */
  private usePlainContext(): void {
    const context = this.deps.createContext();
    this.context = context;
    // Belt-and-braces vs autoplay policy: a suspended context would capture silence.
    void context.resume().catch(() => {});
  }

  /**
   * Bring the DTLN worklet up: a context genuinely at 16 kHz (anything else is a
   * failure — the engine cannot resample), the factory, then the ready gate — the
   * handle's readiness promise raced against a 10 s timeout and pre-ready processor
   * errors. Success returns the handle with `this.context` set; any genuine failure
   * disposes the handle, closes the attempted context, notifies once, and falls back to
   * a fresh optionless context with no worklet (null). A disposal detected after an
   * await throws instead — no notice, dispose() already cleaned up (including the
   * handle, via the catch below).
   */
  private async initDtln(seq: number): Promise<DtlnWorkletHandle | null> {
    let context: MicContextLike | null = null;
    let handle: DtlnWorkletHandle | null = null;
    try {
      context = this.deps.createContext({ sampleRate: DTLN_CONTEXT_SAMPLE_RATE });
      this.context = context;
      void context.resume().catch(() => {});
      if (context.sampleRate !== DTLN_CONTEXT_SAMPLE_RATE) {
        throw new Error("browser ignored the 16 kHz context request");
      }
      handle = await this.deps.createDtlnWorklet(context);
      if (this.stale(seq)) throw new Error("mic chain disposed during dtln init");
      await this.awaitWorkletReady(handle);
      if (this.stale(seq)) throw new Error("mic chain disposed during dtln init");
      return handle;
    } catch (error) {
      handle?.dispose();
      if (this.stale(seq)) throw error instanceof Error ? error : new Error(String(error));
      void context?.close().catch(() => {});
      this.deps.onDtlnFallback("init");
      this.usePlainContext();
      return null;
    }
  }

  private awaitWorkletReady(handle: DtlnWorkletHandle): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("no DTLN ready signal within timeout")),
        DTLN_READY_TIMEOUT_MS,
      );
      handle.ready.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
      handle.node.onprocessorerror = () => {
        clearTimeout(timer);
        reject(new Error("DTLN processor failed before ready"));
      };
    });
  }

  /**
   * Post-ready processor fault: reconnect the source straight to the gain so audio
   * keeps flowing (unsuppressed) — same context, same destination track, no producer
   * churn. The handle's dispose disconnects the node and stops the denoiser. One
   * notice; repeat faults are silent no-ops.
   */
  private bypassWorklet(): void {
    if (this.disposed || !this.dtln || !this.gain || !this.source) return;
    this.dtln.dispose();
    this.dtln = null;
    this.inputSink = this.gain;
    this.source.disconnect();
    this.source.connect(this.gain);
    this.deps.onDtlnFallback("runtime");
  }
}

/** Attenuation-only — the graph never boosts past unity even if a pref write slips by. */
function clampGain(volume: number): number {
  return Math.min(1, Math.max(0, volume));
}

const FALLBACK_COPY: Record<DtlnFallbackReason, string> = {
  init: "DTLN noise suppression failed to load, using standard instead",
  runtime: "DTLN noise suppression failed — continuing without it",
};

/** The real browser half; the session's deps construct one chain per media epoch. */
export function createRealMicChain(): MicChain {
  return new MicChain({
    captureTrack: () => getMicTrack(effectiveMicDeviceId(), micProcessing()),
    createContext: (options) => new AudioContext(options),
    createSourceStream: (track) => new MediaStream([track]),
    getInputVolume: () => useDeviceStore.getState().inputVolume,
    onInputVolumeChange: (listener) =>
      useDeviceStore.subscribe((state, prev) => {
        if (state.inputVolume !== prev.inputVolume) listener(state.inputVolume);
      }),
    getNsMode: () => useDeviceStore.getState().noiseSuppression,
    supportsDtln,
    createDtlnWorklet: async (context) => {
      const handle = await createNoiseSuppressionAudioWorklet(context as unknown as AudioContext, {
        readyTimeoutMs: DTLN_READY_TIMEOUT_MS,
        // Dev only: the processor must reach the worklet untransformed, from the package
        // Vite plugin's raw-serving middleware. The plugin's own URL rewrite misses on
        // Windows (its transform compares a backslash fileURLToPath id against Vite's
        // forward-slash ids), which would leave a Vite-transformed module whose injected
        // helpers reference `URL` — undefined in AudioWorkletGlobalScope.
        ...(import.meta.env.DEV
          ? {
              moduleUrl:
                "/node_modules/@workadventure/noise-suppression/dist/assets/audio-worklet-processor.js",
            }
          : {}),
      });
      return {
        node: handle.node as unknown as MicWorkletNodeLike,
        ready: handle.ready,
        dispose: () => handle.dispose(),
      };
    },
    // setTimeout-0: a fallback can fire during join, before the root Toaster subscribes.
    onDtlnFallback: (reason) => setTimeout(() => toast(FALLBACK_COPY[reason]), 0),
  });
}

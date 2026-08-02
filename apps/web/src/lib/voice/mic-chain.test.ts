import { describe, expect, test, vi } from "vitest";

import type { NoiseSuppressionMode } from "./devices";
import { MicChain, type DtlnFallbackReason, type MicStreamLike } from "./mic-chain";

/**
 * The mic capture chain seam (#81, #122): raw gUM track → source → [dtln worklet] →
 * gain → destination on a dedicated context. Asserted here: the graph shape, the
 * persistent destination track, live clamped gain writes, source swaps on re-capture,
 * disposal releasing the raw capture (the tab's mic indicator), and the DTLN paths —
 * a genuinely-16 kHz context or bust, ready gating, every init failure collapsing to
 * exactly one plain-chain fallback with the engine handle disposed, and none/standard
 * staying bit-identical to pre-DTLN behavior (zero factory interaction).
 */

// --- fakes ----------------------------------------------------------------------------------

class FakeTrack {
  readonly kind = "audio";
  stop = vi.fn();
  asTrack(): MediaStreamTrack {
    return this as unknown as MediaStreamTrack;
  }
}

class FakeGain {
  gain = { value: 1 };
  connected: unknown[] = [];
  connect(node: unknown): unknown {
    this.connected.push(node);
    return node;
  }
}

class FakeSource {
  connected: unknown = null;
  disconnected = false;
  constructor(public stream: MicStreamLike) {}
  connect(node: unknown): unknown {
    this.connected = node;
    return node;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeWorkletNode {
  onprocessorerror: (() => void) | null = null;
  connected: unknown = null;

  connect(node: unknown): unknown {
    this.connected = node;
    return node;
  }
}

/** The package factory's handle: node + controllable readiness + dispose (#122 rev 2). */
class FakeDtlnHandle {
  node = new FakeWorkletNode();
  disposed = false;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  ready = new Promise<void>((resolve, reject) => {
    this.resolveReady = resolve;
    this.rejectReady = reject;
  });

  dispose = (): void => {
    this.disposed = true;
  };
  emitReady(): void {
    this.resolveReady();
  }
  emitReadyRejection(): void {
    this.rejectReady(new Error("engine init failed"));
  }
  emitProcessorError(): void {
    this.node.onprocessorerror?.();
  }
}

class FakeContext {
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  destinationTrack = new FakeTrack();
  destination = { stream: { getAudioTracks: () => [this.destinationTrack.asTrack()] } };
  resumed = false;
  closed = false;
  sampleRate: number;

  constructor(
    harness: ChainHarness,
    public options?: { sampleRate: number },
  ) {
    // ignore16k models browsers (iOS Safari) that accept the option but run at hardware rate.
    this.sampleRate = options && !harness.ignore16k ? options.sampleRate : 48000;
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createMediaStreamSource(stream: MicStreamLike): FakeSource {
    const source = new FakeSource(stream);
    this.sources.push(source);
    return source;
  }
  createMediaStreamDestination() {
    return this.destination;
  }
  async resume(): Promise<void> {
    this.resumed = true;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

class ChainHarness {
  contexts: FakeContext[] = [];
  rawTracks: FakeTrack[] = [];
  workletHandles: FakeDtlnHandle[] = [];
  fallbacks: DtlnFallbackReason[] = [];
  denied = false;
  volume = 1;
  volumeListeners = new Set<(volume: number) => void>();
  /** When set, captures wait on it — for in-flight dispose/supersede races. */
  captureGate: Promise<void> | null = null;
  nsMode: NoiseSuppressionMode = "standard";
  dtlnSupported = true;
  /** Simulates browsers that throw NotSupportedError on a 16 kHz context request. */
  reject16k = false;
  /** Simulates browsers that accept the 16 kHz option but ignore it (iOS Safari). */
  ignore16k = false;
  factoryError: Error | null = null;

  chain = new MicChain({
    captureTrack: async () => {
      await this.captureGate;
      if (this.denied) throw new DOMException("denied", "NotAllowedError");
      const track = new FakeTrack();
      this.rawTracks.push(track);
      return track.asTrack();
    },
    createContext: (options) => {
      if (options && this.reject16k) {
        throw new DOMException("sample rate not supported", "NotSupportedError");
      }
      const context = new FakeContext(this, options);
      this.contexts.push(context);
      return context;
    },
    createSourceStream: (track) => ({ getAudioTracks: () => [track] }),
    getInputVolume: () => this.volume,
    onInputVolumeChange: (listener) => {
      this.volumeListeners.add(listener);
      return () => this.volumeListeners.delete(listener);
    },
    getNsMode: () => this.nsMode,
    supportsDtln: () => this.dtlnSupported,
    createDtlnWorklet: async () => {
      if (this.factoryError) throw this.factoryError;
      const handle = new FakeDtlnHandle();
      this.workletHandles.push(handle);
      return handle;
    },
    onDtlnFallback: (reason) => {
      this.fallbacks.push(reason);
    },
  });

  setVolume(volume: number): void {
    this.volume = volume;
    for (const listener of this.volumeListeners) listener(volume);
  }

  context(): FakeContext {
    return this.contexts[0]!;
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Drive a dtln start to completion: let capture + the factory land, then signal ready. */
async function startDtln(h: ChainHarness): Promise<MediaStreamTrack> {
  h.nsMode = "dtln";
  const starting = h.chain.start();
  await flush();
  h.workletHandles[0]?.emitReady();
  return starting;
}

describe("start", () => {
  test("captures raw, wires source → gain → destination, returns the destination track", async () => {
    const h = new ChainHarness();
    const track = await h.chain.start();

    const context = h.context();
    expect(h.rawTracks).toHaveLength(1);
    // The graph: the source feeds the gain, the gain feeds the destination.
    expect(context.sources[0]?.connected).toBe(context.gains[0]);
    expect(context.gains[0]?.connected).toEqual([context.destination]);
    // The source wraps the RAW capture; the producer gets the processed destination track.
    expect(context.sources[0]?.stream.getAudioTracks()).toEqual([h.rawTracks[0]?.asTrack()]);
    expect(track).toBe(context.destinationTrack.asTrack());
    expect(context.resumed).toBe(true);
  });

  test("initial gain comes from the persisted input volume", async () => {
    const h = new ChainHarness();
    h.volume = 0.3;
    await h.chain.start();
    expect(h.context().gains[0]?.gain.value).toBe(0.3);
  });

  test("a capture denial propagates and leaves no context behind", async () => {
    const h = new ChainHarness();
    h.denied = true;
    await expect(h.chain.start()).rejects.toThrow();
    expect(h.contexts).toHaveLength(0);
  });
});

describe("recapture (device switch / processing toggle)", () => {
  test("swaps the source node in place — the destination track never changes", async () => {
    const h = new ChainHarness();
    const track = await h.chain.start();

    await h.chain.recapture();

    const context = h.context();
    expect(h.rawTracks).toHaveLength(2);
    // Old raw released, old source detached; the new source feeds the SAME gain.
    expect(h.rawTracks[0]?.stop).toHaveBeenCalled();
    expect(context.sources[0]?.disconnected).toBe(true);
    expect(context.sources[1]?.connected).toBe(context.gains[0]);
    expect(context.sources[1]?.stream.getAudioTracks()).toEqual([h.rawTracks[1]?.asTrack()]);
    // One context, one destination — the producer's track is untouched.
    expect(h.contexts).toHaveLength(1);
    expect(track).toBe(context.destinationTrack.asTrack());
  });

  test("a failed re-capture keeps the current source and raw track", async () => {
    const h = new ChainHarness();
    await h.chain.start();
    h.denied = true;

    await h.chain.recapture();

    expect(h.rawTracks).toHaveLength(1);
    expect(h.rawTracks[0]?.stop).not.toHaveBeenCalled();
    expect(h.context().sources[0]?.disconnected).toBe(false);
  });

  test("recapture before start is a no-op", async () => {
    const h = new ChainHarness();
    await h.chain.recapture();
    expect(h.rawTracks).toHaveLength(0);
    expect(h.contexts).toHaveLength(0);
  });
});

describe("dispose", () => {
  test("stops the RAW track (mic indicator), closes the context, unsubscribes", async () => {
    const h = new ChainHarness();
    await h.chain.start();

    h.chain.dispose();

    expect(h.rawTracks[0]?.stop).toHaveBeenCalled();
    expect(h.context().closed).toBe(true);
    expect(h.volumeListeners.size).toBe(0);
  });

  test("dispose during an in-flight start stops the arriving capture", async () => {
    const h = new ChainHarness();
    let release!: () => void;
    h.captureGate = new Promise((resolve) => {
      release = resolve;
    });

    const starting = h.chain.start();
    h.chain.dispose();
    release();
    await expect(starting).rejects.toThrow();

    expect(h.rawTracks[0]?.stop).toHaveBeenCalled();
    expect(h.contexts).toHaveLength(0);
  });

  test("dispose during an in-flight recapture stops the arriving capture", async () => {
    const h = new ChainHarness();
    await h.chain.start();
    let release!: () => void;
    h.captureGate = new Promise((resolve) => {
      release = resolve;
    });

    const recapturing = h.chain.recapture();
    h.chain.dispose();
    release();
    await recapturing;

    expect(h.rawTracks[1]?.stop).toHaveBeenCalled();
    // Disposal already released the original raw; the late arrival must not resurrect it.
    expect(h.context().sources).toHaveLength(1);
  });

  test("overlapping recaptures: the newest wins, the superseded arrival is stopped", async () => {
    const h = new ChainHarness();
    await h.chain.start();

    let releaseFirst!: () => void;
    h.captureGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const first = h.chain.recapture();

    let releaseSecond!: () => void;
    h.captureGate = new Promise((resolve) => {
      releaseSecond = resolve;
    });
    const second = h.chain.recapture();

    releaseSecond();
    await second;
    releaseFirst();
    await first;

    // Captures land in release order: rawTracks[1] is the winning second recapture,
    // rawTracks[2] the superseded first, arriving late and stopped.
    expect(h.rawTracks).toHaveLength(3);
    expect(h.rawTracks[1]?.stop).not.toHaveBeenCalled();
    expect(h.rawTracks[2]?.stop).toHaveBeenCalled();
    const context = h.context();
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1]?.stream.getAudioTracks()).toEqual([h.rawTracks[1]?.asTrack()]);
  });
});

describe("dtln mode (#122)", () => {
  test("happy path: 16 kHz context, source → worklet node → gain → destination", async () => {
    const h = new ChainHarness();
    const track = await startDtln(h);

    const context = h.context();
    expect(context.options).toEqual({ sampleRate: 16000 });
    const handle = h.workletHandles[0]!;
    expect(context.sources[0]?.connected).toBe(handle.node);
    expect(handle.node.connected).toBe(context.gains[0]);
    expect(context.gains[0]?.connected).toEqual([context.destination]);
    expect(track).toBe(context.destinationTrack.asTrack());
    expect(context.resumed).toBe(true);
    expect(h.contexts).toHaveLength(1);
    expect(handle.disposed).toBe(false);
    expect(h.fallbacks).toEqual([]);
  });

  test("16 kHz context construction throws → exactly one fallback: plain chain", async () => {
    const h = new ChainHarness();
    h.nsMode = "dtln";
    h.reject16k = true;
    const track = await h.chain.start();

    // The package has no internal resampler — a refused rate is an init failure.
    expect(h.fallbacks).toEqual(["init"]);
    expect(h.contexts).toHaveLength(1);
    expect(h.context().options).toBeUndefined();
    expect(h.workletHandles).toHaveLength(0);
    // The already-captured raw track is reused — no second gUM.
    expect(h.rawTracks).toHaveLength(1);
    expect(h.rawTracks[0]?.stop).not.toHaveBeenCalled();
    expect(h.context().sources[0]?.connected).toBe(h.context().gains[0]);
    expect(track).toBe(h.context().destinationTrack.asTrack());
  });

  test("context accepts the option but runs at hardware rate → the same single fallback", async () => {
    const h = new ChainHarness();
    h.nsMode = "dtln";
    h.ignore16k = true;
    const track = await h.chain.start();

    expect(h.fallbacks).toEqual(["init"]);
    expect(h.contexts).toHaveLength(2);
    expect(h.contexts[0]?.closed).toBe(true);
    expect(h.contexts[1]?.options).toBeUndefined();
    expect(h.workletHandles).toHaveLength(0);
    expect(track).toBe(h.contexts[1]?.destinationTrack.asTrack());
  });

  test("factory rejection → exactly one fallback: plain chain, 16 kHz context closed", async () => {
    const h = new ChainHarness();
    h.nsMode = "dtln";
    h.factoryError = new Error("network");
    const track = await h.chain.start();

    expect(h.fallbacks).toEqual(["init"]);
    expect(h.contexts).toHaveLength(2);
    expect(h.contexts[0]?.closed).toBe(true);
    expect(h.contexts[1]?.options).toBeUndefined();
    expect(h.rawTracks).toHaveLength(1);
    expect(h.rawTracks[0]?.stop).not.toHaveBeenCalled();
    expect(h.workletHandles).toHaveLength(0);
    const plain = h.contexts[1]!;
    expect(plain.sources[0]?.connected).toBe(plain.gains[0]);
    expect(track).toBe(plain.destinationTrack.asTrack());
  });

  test("no ready signal within 10 s → the same single fallback, handle disposed", async () => {
    vi.useFakeTimers();
    try {
      const h = new ChainHarness();
      h.nsMode = "dtln";
      const starting = h.chain.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.workletHandles).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(10_000);
      const track = await starting;

      expect(h.fallbacks).toEqual(["init"]);
      expect(h.workletHandles[0]?.disposed).toBe(true);
      expect(h.contexts).toHaveLength(2);
      expect(h.contexts[0]?.closed).toBe(true);
      expect(h.rawTracks).toHaveLength(1);
      expect(track).toBe(h.contexts[1]?.destinationTrack.asTrack());
    } finally {
      vi.useRealTimers();
    }
  });

  test("readiness rejection → the same single fallback, handle disposed", async () => {
    const h = new ChainHarness();
    h.nsMode = "dtln";
    const starting = h.chain.start();
    await flush();
    h.workletHandles[0]?.emitReadyRejection();
    const track = await starting;

    expect(h.fallbacks).toEqual(["init"]);
    expect(h.workletHandles[0]?.disposed).toBe(true);
    expect(h.contexts).toHaveLength(2);
    expect(h.contexts[0]?.closed).toBe(true);
    expect(track).toBe(h.contexts[1]?.destinationTrack.asTrack());
  });

  test("processor error before ready → the same single fallback, handle disposed", async () => {
    const h = new ChainHarness();
    h.nsMode = "dtln";
    const starting = h.chain.start();
    await flush();
    h.workletHandles[0]?.emitProcessorError();
    const track = await starting;

    expect(h.fallbacks).toEqual(["init"]);
    expect(h.workletHandles[0]?.disposed).toBe(true);
    expect(h.contexts).toHaveLength(2);
    expect(h.contexts[0]?.closed).toBe(true);
    expect(track).toBe(h.contexts[1]?.destinationTrack.asTrack());
  });

  test("dispose during the ready wait → no fallback toast, handle disposed, raw stopped", async () => {
    vi.useFakeTimers();
    try {
      const h = new ChainHarness();
      h.nsMode = "dtln";
      const starting = h.chain.start();
      // Attached before the timer fires — the rejection must never sit unhandled.
      const rejection = expect(starting).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.workletHandles).toHaveLength(1);

      h.chain.dispose();
      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;

      expect(h.fallbacks).toEqual([]);
      expect(h.workletHandles[0]?.disposed).toBe(true);
      expect(h.contexts).toHaveLength(1);
      expect(h.contexts[0]?.closed).toBe(true);
      expect(h.rawTracks[0]?.stop).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("chain dispose disposes the engine handle", async () => {
    const h = new ChainHarness();
    await startDtln(h);

    h.chain.dispose();

    expect(h.workletHandles[0]?.disposed).toBe(true);
    expect(h.context().closed).toBe(true);
  });

  test("recapture swaps the new source onto the worklet node, not the gain", async () => {
    const h = new ChainHarness();
    await startDtln(h);

    await h.chain.recapture();

    const context = h.context();
    expect(context.sources[0]?.disconnected).toBe(true);
    expect(context.sources[1]?.connected).toBe(h.workletHandles[0]?.node);
    expect(h.rawTracks[0]?.stop).toHaveBeenCalled();
  });

  test("post-ready processor fault bypasses the worklet in place — no rebuild", async () => {
    const h = new ChainHarness();
    const track = await startDtln(h);

    h.workletHandles[0]?.emitProcessorError();

    expect(h.fallbacks).toEqual(["runtime"]);
    expect(h.workletHandles[0]?.disposed).toBe(true);
    const context = h.context();
    expect(context.sources[0]?.disconnected).toBe(true);
    expect(context.sources[0]?.connected).toBe(context.gains[0]);
    // Same context, same destination track — the producer is untouched.
    expect(h.contexts).toHaveLength(1);
    expect(track).toBe(context.destinationTrack.asTrack());

    // A repeat fault must not toast again.
    h.workletHandles[0]?.emitProcessorError();
    expect(h.fallbacks).toEqual(["runtime"]);
  });

  test("standard mode: optionless context, zero factory interaction", async () => {
    const h = new ChainHarness();
    h.nsMode = "standard";
    await h.chain.start();

    expect(h.context().options).toBeUndefined();
    expect(h.workletHandles).toHaveLength(0);
  });

  test("dtln preference without worklet support behaves as standard, silently", async () => {
    const h = new ChainHarness();
    h.nsMode = "dtln";
    h.dtlnSupported = false;
    await h.chain.start();

    expect(h.context().options).toBeUndefined();
    expect(h.workletHandles).toHaveLength(0);
    expect(h.fallbacks).toEqual([]);
  });
});

describe("live gain", () => {
  test("volume changes are live gain writes, clamped to 0..1 (attenuation-only)", async () => {
    const h = new ChainHarness();
    await h.chain.start();
    const gain = h.context().gains[0]!;

    h.setVolume(0.4);
    expect(gain.gain.value).toBe(0.4);

    h.setVolume(1.7);
    expect(gain.gain.value).toBe(1);

    h.setVolume(-0.2);
    expect(gain.gain.value).toBe(0);
  });
});

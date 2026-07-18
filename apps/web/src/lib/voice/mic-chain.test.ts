import { describe, expect, test, vi } from "vitest";

import { MicChain, type MicStreamLike } from "./mic-chain";

/**
 * The mic capture chain seam (#81): raw gUM track → source → gain → destination on a
 * dedicated context. Asserted here: the graph shape, the persistent destination track,
 * live clamped gain writes, source swaps on re-capture, and that disposal releases the
 * raw capture (the tab's mic indicator).
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

class FakeContext {
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  destinationTrack = new FakeTrack();
  destination = { stream: { getAudioTracks: () => [this.destinationTrack.asTrack()] } };
  resumed = false;
  closed = false;

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
  denied = false;
  volume = 1;
  volumeListeners = new Set<(volume: number) => void>();
  /** When set, captures wait on it — for in-flight dispose/supersede races. */
  captureGate: Promise<void> | null = null;

  chain = new MicChain({
    captureTrack: async () => {
      await this.captureGate;
      if (this.denied) throw new DOMException("denied", "NotAllowedError");
      const track = new FakeTrack();
      this.rawTracks.push(track);
      return track.asTrack();
    },
    createContext: () => {
      const context = new FakeContext();
      this.contexts.push(context);
      return context;
    },
    createSourceStream: (track) => ({ getAudioTracks: () => [track] }),
    getInputVolume: () => this.volume,
    onInputVolumeChange: (listener) => {
      this.volumeListeners.add(listener);
      return () => this.volumeListeners.delete(listener);
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

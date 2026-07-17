import { beforeEach, describe, expect, test } from "vitest";

import { peerSoundCue, SoundEngine, type SoundEngineDeps } from "./sound-effects";

/**
 * The effects-engine seam (#79/#78): fake Web Audio + sink element stand in for the
 * browser half; what's asserted is the engine's own policy — activation gating, per-cue
 * pref gating, the master-gain graph, and sink routing.
 */

class FakeGain {
  gain = { value: 1 };
  connected: unknown = null;
  connect(node: unknown): unknown {
    this.connected = node;
    return node;
  }
}

class FakeSource {
  buffer: unknown = null;
  connected: unknown = null;
  started = false;
  connect(node: unknown): unknown {
    this.connected = node;
    return node;
  }
  start(): void {
    this.started = true;
  }
}

class FakeContext {
  state: "suspended" | "running" | "closed" = "suspended";
  resumeCalls = 0;
  resumeError: Error | null = null;
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  destination = { stream: { fake: "stream" } };

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.resumeError) throw this.resumeError;
    this.state = "running";
  }

  async decodeAudioData(data: ArrayBuffer): Promise<unknown> {
    return { decoded: new TextDecoder().decode(data) };
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  createMediaStreamDestination(): { stream: unknown } {
    return this.destination;
  }
}

class FakeElement {
  srcObject: unknown = null;
  playCalls = 0;
  playError: Error | null = null;
  sinkIds: string[] = [];

  async play(): Promise<void> {
    this.playCalls += 1;
    if (this.playError) throw this.playError;
  }

  // Instance property (not a prototype method) so the Safari test can delete it.
  setSinkId? = async (sinkId: string): Promise<void> => {
    this.sinkIds.push(sinkId);
  };
}

class FakeDeps {
  context = new FakeContext();
  element = new FakeElement();
  prefs: Record<string, boolean> = {};
  fetched: string[] = [];
  failFetch = new Set<string>();

  deps(): SoundEngineDeps {
    return {
      createContext: () => this.context,
      createElement: () => this.element,
      fetchBuffer: async (url) => {
        this.fetched.push(url);
        if (this.failFetch.has(url)) throw new Error(`fetch failed: ${url}`);
        return new TextEncoder().encode(url).buffer as ArrayBuffer;
      },
      cueUrls: {
        notification: "url:notification",
        "self-join": "url:self-join",
        "self-leave": "url:self-leave",
        "mute-on": "url:mute-on",
        "mute-off": "url:mute-off",
        "deafen-on": "url:deafen-on",
        "deafen-off": "url:deafen-off",
        "peer-join": "url:peer-join",
        "peer-leave": "url:peer-leave",
      },
      loadSoundPrefs: () => this.prefs,
    };
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let fake: FakeDeps;
let engine: SoundEngine;

beforeEach(() => {
  fake = new FakeDeps();
  engine = new SoundEngine(fake.deps());
});

async function started(): Promise<void> {
  engine.start();
  await flush();
}

describe("activation (autoplay policy)", () => {
  test("start wires master gain → destination → hidden element, without playing", async () => {
    await started();

    expect(fake.context.gains).toHaveLength(1);
    expect(fake.context.gains[0]!.connected).toBe(fake.context.destination);
    expect(fake.element.srcObject).toBe(fake.context.destination.stream);
    expect(fake.element.playCalls).toBe(0);
  });

  test("a play before the first gesture is dropped silently — no source, no throw", async () => {
    await started();

    engine.play("self-join");

    expect(fake.context.sources).toHaveLength(0);
  });

  test("activate resumes the context and starts the hidden element", async () => {
    await started();
    expect(engine.isActive()).toBe(false);

    await engine.activate();

    expect(fake.context.state).toBe("running");
    expect(fake.element.playCalls).toBe(1);
    expect(engine.isActive()).toBe(true);
  });

  test("after activation a cue plays its decoded buffer through the master gain", async () => {
    await started();
    await engine.activate();

    engine.play("self-join");

    expect(fake.context.sources).toHaveLength(1);
    const source = fake.context.sources[0]!;
    expect(source.started).toBe(true);
    expect(source.buffer).toEqual({ decoded: "url:self-join" });
    expect(source.connected).toBe(fake.context.gains[0]);
  });

  test("resume success + element play failure keeps activation re-armed", async () => {
    await started();
    fake.element.playError = new DOMException("blocked", "NotAllowedError") as unknown as Error;

    await engine.activate();
    expect(engine.isActive()).toBe(false);

    fake.element.playError = null;
    await engine.activate();
    expect(engine.isActive()).toBe(true);
  });

  test("NotAllowedError from resume or element play is swallowed", async () => {
    await started();
    fake.context.resumeError = new DOMException("blocked", "NotAllowedError") as unknown as Error;
    fake.element.playError = new DOMException("blocked", "NotAllowedError") as unknown as Error;

    await expect(engine.activate()).resolves.toBeUndefined();
    engine.play("self-join");
    expect(fake.context.sources).toHaveLength(0);
  });
});

describe("sound-prefs gating (overrides-only, default on)", () => {
  test("a cue overridden to false is skipped; absent cues play", async () => {
    await started();
    await engine.activate();
    fake.prefs = { "mute-on": false };

    engine.play("mute-on");
    expect(fake.context.sources).toHaveLength(0);

    engine.play("mute-off");
    expect(fake.context.sources).toHaveLength(1);
  });

  test("prefs are consulted fresh on every play — a later override applies immediately", async () => {
    await started();
    await engine.activate();

    engine.play("peer-join");
    fake.prefs = { "peer-join": false };
    engine.play("peer-join");

    expect(fake.context.sources).toHaveLength(1);
  });
});

describe("master volume and sink routing", () => {
  test("setMasterVolume drives the master gain", async () => {
    await started();
    engine.setMasterVolume(0.3);
    expect(fake.context.gains[0]!.gain.value).toBe(0.3);
  });

  test("setSink forwards to the hidden element", async () => {
    await started();
    engine.setSink("out-headset");
    engine.setSink("");
    expect(fake.element.sinkIds).toEqual(["out-headset", ""]);
  });

  test("an element without setSinkId (Safari) is a no-op, not a crash", async () => {
    delete (fake.element as { setSinkId?: unknown }).setSinkId;
    await started();
    expect(() => engine.setSink("out-headset")).not.toThrow();
  });
});

describe("peerSoundCue — peer join/leave of the CURRENT room only", () => {
  const joined = { type: "voice.peerJoined", channelId: "vc-1", userId: "peer-1" } as const;
  const left = { type: "voice.peerLeft", channelId: "vc-1", userId: "peer-1" } as const;
  const seated = { status: "connected", channelId: "vc-1" } as const;

  test("a peer joining or leaving the seated room maps to its cue", () => {
    expect(peerSoundCue(joined, "self", seated)).toBe("peer-join");
    expect(peerSoundCue(left, "self", seated)).toBe("peer-leave");
  });

  test("reconnecting still counts as seated (the seat survives in grace)", () => {
    expect(peerSoundCue(joined, "self", { status: "reconnecting", channelId: "vc-1" })).toBe(
      "peer-join",
    );
  });

  test("another room, not seated, or the own echo → no cue", () => {
    expect(peerSoundCue(joined, "self", { status: "connected", channelId: "vc-2" })).toBeNull();
    expect(peerSoundCue(joined, "self", { status: "idle", channelId: null })).toBeNull();
    expect(peerSoundCue({ ...joined, userId: "self" }, "self", seated)).toBeNull();
  });

  test("mid-ceremony (joining) is not seated yet — no cue for a room never entered", () => {
    expect(peerSoundCue(joined, "self", { status: "joining", channelId: "vc-1" })).toBeNull();
  });
});

describe("preload resilience", () => {
  test("one failed fetch leaves the other cues playable; the failed cue no-ops", async () => {
    fake.failFetch.add("url:self-join");
    await started();
    await engine.activate();

    engine.play("self-join");
    expect(fake.context.sources).toHaveLength(0);

    engine.play("self-leave");
    expect(fake.context.sources).toHaveLength(1);
  });
});

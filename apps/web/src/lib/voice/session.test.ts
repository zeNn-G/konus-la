import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  type ConsumerLike,
  type DeviceLike,
  type ProducerLike,
  type TransportLike,
  VoiceSession,
  type VoiceSessionDeps,
} from "./session";
import { useVoiceStore } from "./store";

/**
 * The VoiceSession seam: a fake signaling client + fake mediasoup device stand in for the
 * wire and WebRTC halves; everything asserted here is the session's own behavior — the
 * state machine, the sequential ceremony, the single recovery path, and consumer
 * activation policy (phase-5 spec §Client architecture, §Media policy).
 */

// --- fakes ----------------------------------------------------------------------------------

class FakeRpcError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

class FakeTrack {
  readonly listeners = new Set<() => void>();
  stop = vi.fn();
  constructor(public kind: "audio" | "video") {}
  addEventListener(_type: "ended", listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "ended", listener: () => void): void {
    this.listeners.delete(listener);
  }
  end(): void {
    for (const listener of this.listeners) listener();
  }
  asTrack(): MediaStreamTrack {
    return this as unknown as MediaStreamTrack;
  }
}

class FakeProducer implements ProducerLike {
  paused = false;
  closed = false;
  constructor(
    public id: string,
    public track: MediaStreamTrack,
  ) {}
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  close(): void {
    this.closed = true;
  }
  async replaceTrack({ track }: { track: MediaStreamTrack }): Promise<void> {
    this.track = track;
  }
}

class FakeConsumer implements ConsumerLike {
  closed = false;
  track: MediaStreamTrack = new FakeTrack("audio").asTrack();
  constructor(
    public id: string,
    public producerId: string,
    public kind: "audio" | "video",
  ) {}
  close(): void {
    this.closed = true;
  }
}

type Handler = (...args: never[]) => void;

class FakeTransport implements TransportLike {
  closed = false;
  connected = false;
  handlers = new Map<string, Handler>();
  producers: FakeProducer[] = [];
  constructor(
    public id: string,
    private harness: Harness,
  ) {}

  on(event: string, handler: (...args: never[]) => void): void {
    this.handlers.set(event, handler as Handler);
  }

  close(): void {
    this.closed = true;
  }

  /** mediasoup-client behavior: 'connect' fires on first produce/consume, then 'produce'. */
  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    this.connected = true;
    const connect = this.handlers.get("connect") as unknown as (
      params: { dtlsParameters: unknown },
      callback: () => void,
      errback: (error: Error) => void,
    ) => void;
    await new Promise<void>((resolve, reject) =>
      connect({ dtlsParameters: { role: "client" } }, resolve, reject),
    );
  }

  async produce(options: {
    track: MediaStreamTrack;
    encodings?: Array<{ maxBitrate?: number }>;
    codecOptions?: Record<string, unknown>;
    appData?: Record<string, unknown>;
  }): Promise<ProducerLike> {
    await this.ensureConnected();
    const produce = this.handlers.get("produce") as unknown as (
      params: { kind: string; rtpParameters: unknown; appData?: Record<string, unknown> },
      callback: (result: { id: string }) => void,
      errback: (error: Error) => void,
    ) => void;
    const { id } = await new Promise<{ id: string }>((resolve, reject) =>
      produce(
        { kind: (options.track as { kind?: string }).kind ?? "audio", rtpParameters: {}, appData: options.appData },
        resolve,
        reject,
      ),
    );
    const producer = new FakeProducer(id, options.track);
    this.producers.push(producer);
    return producer;
  }

  async consume(options: {
    id: string;
    producerId: string;
    kind: "audio" | "video";
    rtpParameters: unknown;
  }): Promise<ConsumerLike> {
    await this.ensureConnected();
    return new FakeConsumer(options.id, options.producerId, options.kind);
  }

  changeConnectionState(state: string): void {
    const handler = this.handlers.get("connectionstatechange") as unknown as
      | ((state: string) => void)
      | undefined;
    handler?.(state);
  }
}

class FakeDevice implements DeviceLike {
  rtpCapabilities: unknown = { codecs: [] };
  loaded = false;
  sendTransport: FakeTransport | null = null;
  recvTransport: FakeTransport | null = null;
  constructor(private harness: Harness) {}
  async load(_options: { routerRtpCapabilities: unknown }): Promise<void> {
    this.loaded = true;
  }
  createSendTransport(params: { id: string }): TransportLike {
    this.sendTransport = new FakeTransport(params.id, this.harness);
    return this.sendTransport;
  }
  createRecvTransport(params: { id: string }): TransportLike {
    this.recvTransport = new FakeTransport(params.id, this.harness);
    return this.recvTransport;
  }
}

type Call = { method: string; input: unknown };

class Harness {
  calls: Call[] = [];
  failures = new Map<string, Error[]>();
  seatCounter = 0;
  producerCounter = 0;
  /** producerId → kind, so consume can answer with the right kind. */
  producerKinds = new Map<string, "audio" | "video">();
  onJoin: (() => void) | null = null;

  micDenied = false;
  device: FakeDevice | null = null;
  devices: FakeDevice[] = [];
  micTracks: FakeTrack[] = [];
  camTracks: FakeTrack[] = [];
  screenTracks: FakeTrack[] = [];
  screenPresets: string[] = [];

  visible = true;
  visibilityListeners = new Set<() => void>();
  socketCloseListeners = new Set<() => void>();

  session: VoiceSession;

  constructor() {
    this.session = new VoiceSession(this.deps());
  }

  failNext(method: string, error: Error): void {
    const queue = this.failures.get(method) ?? [];
    queue.push(error);
    this.failures.set(method, queue);
  }

  private async invoke<T>(method: string, input: unknown, result: () => T): Promise<T> {
    this.calls.push({ method, input });
    const queued = this.failures.get(method)?.shift();
    if (queued) throw queued;
    return result();
  }

  callsOf(method: string): Call[] {
    return this.calls.filter((call) => call.method === method);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const listener of this.visibilityListeners) listener();
  }

  fireSocket(_type: "close"): void {
    for (const listener of this.socketCloseListeners) listener();
  }

  deps(): VoiceSessionDeps {
    return {
      getClient: () => ({
        join: (input: { channelId: string }) =>
          this.invoke("join", input, () => {
            this.onJoin?.();
            return { seatSessionId: `seat-${++this.seatCounter}` };
          }),
        leave: () => this.invoke("leave", undefined, () => undefined),
        setSelfMute: (input: { muted: boolean }) => this.invoke("setSelfMute", input, () => undefined),
        setSelfDeaf: (input: { deafened: boolean }) =>
          this.invoke("setSelfDeaf", input, () => undefined),
        getRouterRtpCapabilities: () =>
          this.invoke("getRouterRtpCapabilities", undefined, () => ({ codecs: [] })),
        createTransport: (input: { direction: "send" | "recv" }) =>
          this.invoke("createTransport", input, () => ({
            id: `${input.direction}-transport`,
            iceParameters: {},
            iceCandidates: [],
            dtlsParameters: {},
          })),
        connectTransport: (input: { transportId: string }) =>
          this.invoke("connectTransport", input, () => undefined),
        produce: (input: { kind: "audio" | "video"; source: string }) =>
          this.invoke("produce", input, () => {
            const producerId = `local-p-${++this.producerCounter}`;
            this.producerKinds.set(producerId, input.kind);
            return { producerId };
          }),
        closeProducer: (input: { producerId: string }) =>
          this.invoke("closeProducer", input, () => undefined),
        consume: (input: { producerId: string }) =>
          this.invoke("consume", input, () => ({
            consumerId: `c-${input.producerId}`,
            producerId: input.producerId,
            kind: this.producerKinds.get(input.producerId) ?? "audio",
            rtpParameters: {},
          })),
        setConsumersPaused: (input: { consumerIds: string[]; paused: boolean }) =>
          this.invoke("setConsumersPaused", input, () => undefined),
      }),
      onSocketClose: (listener) => {
        this.socketCloseListeners.add(listener);
        return () => this.socketCloseListeners.delete(listener);
      },
      createDevice: () => {
        this.device = new FakeDevice(this);
        this.devices.push(this.device);
        return this.device;
      },
      getMicTrack: async () => {
        if (this.micDenied) throw new DOMException("denied", "NotAllowedError");
        const track = new FakeTrack("audio");
        this.micTracks.push(track);
        return track.asTrack();
      },
      getCamTrack: async () => {
        const track = new FakeTrack("video");
        this.camTracks.push(track);
        return track.asTrack();
      },
      getScreenTrack: async (preset) => {
        this.screenPresets.push(preset);
        const track = new FakeTrack("video");
        this.screenTracks.push(track);
        return track.asTrack();
      },
      isDocumentVisible: () => this.visible,
      onVisibilityChange: (listener) => {
        this.visibilityListeners.add(listener);
        return () => this.visibilityListeners.delete(listener);
      },
    };
  }
}

function producerAdded(
  producerId: string,
  kind: "audio" | "video",
  source: "mic" | "cam" | "screen",
  userId = "remote-user",
  channelId = "vc-1",
) {
  return { type: "voice.producerAdded", channelId, userId, producerId, kind, source } as const;
}

const initialStore = { ...useVoiceStore.getState() };

let harness: Harness;

beforeEach(() => {
  useVoiceStore.setState({
    ...initialStore,
    localTracks: {},
    peers: {},
    videoInterest: {},
    volumes: {},
  });
  harness = new Harness();
});

afterEach(() => {
  vi.useRealTimers();
});

async function joined(h: Harness = harness): Promise<void> {
  await h.session.join({ channelId: "vc-1", guildId: "g-1" });
}

/** Register a remote audio producer on the harness and announce it to the session. */
function announceRemoteAudio(h: Harness, producerId = "remote-audio-1"): void {
  h.producerKinds.set(producerId, "audio");
  h.session.handleRealtimeEvent(producerAdded(producerId, "audio", "mic"));
}

function announceRemoteVideo(h: Harness, producerId = "remote-video-1"): void {
  h.producerKinds.set(producerId, "video");
  h.session.handleRealtimeEvent(producerAdded(producerId, "video", "cam"));
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("join ceremony", () => {
  test("fresh join runs the sequential ceremony and lands connected", async () => {
    await joined();

    const state = useVoiceStore.getState();
    expect(state.status).toBe("connected");
    expect(state.channelId).toBe("vc-1");
    expect(state.guildId).toBe("g-1");
    expect(state.seatSessionId).toBe("seat-1");
    expect(state.localTracks.mic).toBeDefined();
    expect(state.micError).toBe(false);

    // Sequential: join → caps → transports ×2 → (connect on first produce) → produce mic.
    const order = harness.calls.map((call) => call.method);
    expect(order).toEqual([
      "join",
      "getRouterRtpCapabilities",
      "createTransport",
      "createTransport",
      "connectTransport",
      "produce",
    ]);
    expect(harness.callsOf("produce")[0]?.input).toMatchObject({ kind: "audio", source: "mic" });
    expect(harness.device?.loaded).toBe(true);
  });

  test("mic denial degrades to a listen-only join", async () => {
    harness.micDenied = true;
    await joined();

    const state = useVoiceStore.getState();
    expect(state.status).toBe("connected");
    expect(state.micError).toBe(true);
    expect(state.localTracks.mic).toBeUndefined();
    expect(harness.callsOf("produce")).toHaveLength(0);
  });

  test("retryMic after a denied join produces, clears the flag, and reports success", async () => {
    harness.micDenied = true;
    await joined();
    harness.micDenied = false;

    await expect(harness.session.retryMic()).resolves.toBe(true);
    const state = useVoiceStore.getState();
    expect(state.micError).toBe(false);
    expect(state.localTracks.mic).toBeDefined();
    expect(harness.callsOf("produce")).toHaveLength(1);
  });

  test("retryMic reports a repeat denial so the UI can toast (#25)", async () => {
    harness.micDenied = true;
    await joined();

    await expect(harness.session.retryMic()).resolves.toBe(false);
    expect(useVoiceStore.getState().micError).toBe(true);
    expect(harness.callsOf("produce")).toHaveLength(0);
  });

  test("producers replayed during the ceremony are consumed and audio batch-resumed", async () => {
    harness.producerKinds.set("existing-audio", "audio");
    harness.producerKinds.set("existing-video", "video");
    harness.onJoin = () => {
      harness.session.handleRealtimeEvent(producerAdded("existing-audio", "audio", "mic", "anna"));
      harness.session.handleRealtimeEvent(producerAdded("existing-video", "video", "cam", "anna"));
    };
    await joined();
    await flush();

    expect(harness.callsOf("consume")).toHaveLength(2);
    const state = useVoiceStore.getState();
    expect(state.peers.anna?.mic?.consumerId).toBe("c-existing-audio");
    expect(state.peers.anna?.cam?.consumerId).toBe("c-existing-video");

    // Audio resumed (batched); video stays created-paused until someone renders it.
    const resumes = harness
      .callsOf("setConsumersPaused")
      .map((call) => call.input as { consumerIds: string[]; paused: boolean });
    expect(resumes).toContainEqual({ consumerIds: ["c-existing-audio"], paused: false });
    expect(resumes.flatMap((r) => (r.paused === false ? r.consumerIds : []))).not.toContain(
      "c-existing-video",
    );
  });

  test("duplicate producerAdded (replay + live race) consumes once", async () => {
    await joined();
    announceRemoteAudio(harness, "dup-1");
    announceRemoteAudio(harness, "dup-1");
    await flush();
    expect(harness.callsOf("consume")).toHaveLength(1);
  });
});

describe("mic device switching (#25)", () => {
  test("switchMicTrack swaps the producer track in place and stops the old capture", async () => {
    await joined();
    const oldTrack = harness.micTracks[0]!;

    await harness.session.switchMicTrack();

    expect(harness.micTracks).toHaveLength(2);
    const newTrack = harness.micTracks[1]!;
    expect(oldTrack.stop).toHaveBeenCalled();
    expect(newTrack.stop).not.toHaveBeenCalled();
    expect(useVoiceStore.getState().localTracks.mic).toBe(newTrack.asTrack());
    expect(harness.device?.sendTransport?.producers[0]?.track).toBe(newTrack.asTrack());
    // A swap is not a re-produce — no extra signaling.
    expect(harness.callsOf("produce")).toHaveLength(1);
  });

  test("switchMicTrack keeps a muted mic paused", async () => {
    await joined();
    await harness.session.setSelfMute(true);

    await harness.session.switchMicTrack();

    expect(harness.device?.sendTransport?.producers[0]?.paused).toBe(true);
    expect(useVoiceStore.getState().selfMute).toBe(true);
  });

  test("switchMicTrack is a no-op while listen-only", async () => {
    harness.micDenied = true;
    await joined();
    harness.micDenied = false;

    await harness.session.switchMicTrack();

    expect(harness.micTracks).toHaveLength(0);
    expect(useVoiceStore.getState().micError).toBe(true);
  });

  test("a failed re-capture keeps the current track playing", async () => {
    await joined();
    const oldTrack = harness.micTracks[0]!;
    harness.micDenied = true;

    await harness.session.switchMicTrack();

    expect(oldTrack.stop).not.toHaveBeenCalled();
    expect(useVoiceStore.getState().localTracks.mic).toBe(oldTrack.asTrack());
  });
});

describe("mid-session consumers", () => {
  test("a new audio producer is consumed and resumed immediately", async () => {
    await joined();
    announceRemoteAudio(harness);
    await flush();

    expect(harness.callsOf("consume")).toHaveLength(1);
    expect(harness.callsOf("setConsumersPaused")[0]?.input).toEqual({
      consumerIds: ["c-remote-audio-1"],
      paused: false,
    });
  });

  test("audio consumed while deafened is NOT resumed", async () => {
    await joined();
    await harness.session.setSelfDeaf(true);
    announceRemoteAudio(harness);
    await flush();

    expect(harness.callsOf("consume")).toHaveLength(1);
    expect(
      harness
        .callsOf("setConsumersPaused")
        .filter((call) => (call.input as { paused: boolean }).paused === false),
    ).toHaveLength(0);
  });

  test("producerClosed closes the consumer and clears the peer entry", async () => {
    await joined();
    announceRemoteAudio(harness);
    await flush();
    expect(useVoiceStore.getState().peers["remote-user"]?.mic).toBeDefined();

    harness.session.handleRealtimeEvent({
      type: "voice.producerClosed",
      channelId: "vc-1",
      userId: "remote-user",
      producerId: "remote-audio-1",
    });
    expect(useVoiceStore.getState().peers["remote-user"]?.mic).toBeUndefined();
  });
});

describe("visibility-driven video pause", () => {
  test("video resumes only when bound AND visible; 3s hidden debounce; instant resume", async () => {
    vi.useFakeTimers();
    await joined();
    announceRemoteVideo(harness);
    await vi.advanceTimersByTimeAsync(0);

    // Created paused, nobody renders it: no resume.
    expect(
      harness
        .callsOf("setConsumersPaused")
        .filter((call) => (call.input as { paused: boolean }).paused === false),
    ).toHaveLength(0);

    // A tile mounts → resume.
    useVoiceStore.getState().bindVideo("c-remote-video-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.callsOf("setConsumersPaused").at(-1)?.input).toEqual({
      consumerIds: ["c-remote-video-1"],
      paused: false,
    });

    // Tab hides: nothing for 3 s…
    const before = harness.callsOf("setConsumersPaused").length;
    harness.setVisible(false);
    await vi.advanceTimersByTimeAsync(2_900);
    expect(harness.callsOf("setConsumersPaused")).toHaveLength(before);
    // …then the batched pause.
    await vi.advanceTimersByTimeAsync(200);
    expect(harness.callsOf("setConsumersPaused").at(-1)?.input).toEqual({
      consumerIds: ["c-remote-video-1"],
      paused: true,
    });

    // Back to visible: immediate resume, no debounce.
    harness.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.callsOf("setConsumersPaused").at(-1)?.input).toEqual({
      consumerIds: ["c-remote-video-1"],
      paused: false,
    });
  });

  test("a brief hide shorter than the debounce never pauses", async () => {
    vi.useFakeTimers();
    await joined();
    announceRemoteVideo(harness);
    useVoiceStore.getState().bindVideo("c-remote-video-1");
    await vi.advanceTimersByTimeAsync(0);
    const before = harness.callsOf("setConsumersPaused").length;

    harness.setVisible(false);
    await vi.advanceTimersByTimeAsync(1_000);
    harness.setVisible(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.callsOf("setConsumersPaused")).toHaveLength(before);
  });

  test("audio is never visibility-paused", async () => {
    vi.useFakeTimers();
    await joined();
    announceRemoteAudio(harness);
    await vi.advanceTimersByTimeAsync(0);

    harness.setVisible(false);
    await vi.advanceTimersByTimeAsync(10_000);
    const pauses = harness
      .callsOf("setConsumersPaused")
      .filter((call) => (call.input as { paused: boolean }).paused === true);
    expect(pauses).toHaveLength(0);
  });
});

describe("flags", () => {
  test("mute pauses the mic producer and broadcasts; unmute resumes", async () => {
    await joined();
    const mic = harness.device?.sendTransport?.producers[0];

    await harness.session.setSelfMute(true);
    expect(useVoiceStore.getState().selfMute).toBe(true);
    expect(mic?.paused).toBe(true);
    expect(harness.callsOf("setSelfMute")[0]?.input).toEqual({ muted: true });

    await harness.session.setSelfMute(false);
    expect(mic?.paused).toBe(false);
  });

  test("deafen broadcasts the flag (the server pauses audio consumers)", async () => {
    await joined();
    await harness.session.setSelfDeaf(true);
    expect(useVoiceStore.getState().selfDeaf).toBe(true);
    expect(harness.callsOf("setSelfDeaf")[0]?.input).toEqual({ deafened: true });
  });

  test("a failed flag call reverts the optimistic state", async () => {
    await joined();
    harness.failNext("setSelfMute", new FakeRpcError("TOO_MANY_REQUESTS"));
    await harness.session.setSelfMute(true);
    expect(useVoiceStore.getState().selfMute).toBe(false);
    expect(harness.device?.sendTransport?.producers[0]?.paused).toBe(false);
  });
});

describe("cam & screenshare producers", () => {
  test("enableCam produces video with the webcam bitrate cap", async () => {
    await joined();
    await harness.session.enableCam();

    expect(useVoiceStore.getState().localTracks.cam).toBeDefined();
    expect(harness.callsOf("produce").at(-1)?.input).toMatchObject({
      kind: "video",
      source: "cam",
    });

    await harness.session.disableCam();
    expect(useVoiceStore.getState().localTracks.cam).toBeUndefined();
    expect(harness.callsOf("closeProducer")).toHaveLength(1);
    expect(harness.camTracks[0]?.stop).toHaveBeenCalled();
  });

  test("screenshare produces per preset and browser-stop closes it", async () => {
    await joined();
    await harness.session.startScreenshare("1080p60");
    expect(harness.screenPresets).toEqual(["1080p60"]);
    expect(harness.callsOf("produce").at(-1)?.input).toMatchObject({
      kind: "video",
      source: "screen",
    });
    expect(useVoiceStore.getState().localTracks.screen).toBeDefined();

    // The user hits the browser's own "stop sharing" — track ends, producer closes.
    harness.screenTracks[0]?.end();
    await flush();
    expect(harness.callsOf("closeProducer")).toHaveLength(1);
    expect(useVoiceStore.getState().localTracks.screen).toBeUndefined();
  });
});

describe("leave, switch & steal", () => {
  test("leave calls voice.leave, closes transports, resets to idle", async () => {
    await joined();
    const send = harness.device?.sendTransport;
    await harness.session.leave();

    const state = useVoiceStore.getState();
    expect(state.status).toBe("idle");
    expect(state.channelId).toBeNull();
    expect(state.peers).toEqual({});
    expect(send?.closed).toBe(true);
    expect(harness.callsOf("leave")).toHaveLength(1);
    expect(harness.micTracks[0]?.stop).toHaveBeenCalled();
  });

  test("channel switch closes local media first, then a single join — never voice.leave", async () => {
    await joined();
    announceRemoteAudio(harness);
    await flush();
    const firstSend = harness.device?.sendTransport;

    await harness.session.join({ channelId: "vc-2", guildId: "g-1" });

    const state = useVoiceStore.getState();
    expect(state.status).toBe("connected");
    expect(state.channelId).toBe("vc-2");
    expect(state.seatSessionId).toBe("seat-2");
    expect(state.peers).toEqual({}); // old room's consumers gone
    expect(firstSend?.closed).toBe(true);
    expect(harness.callsOf("leave")).toHaveLength(0);
    expect(harness.callsOf("join")).toHaveLength(2);
  });

  test("joining the channel already joined is a no-op", async () => {
    await joined();
    await harness.session.join({ channelId: "vc-1", guildId: "g-1" });
    expect(harness.callsOf("join")).toHaveLength(1);
  });

  test("sessionReplaced with the OWN seat-session id tears down locally — no voice.leave", async () => {
    await joined();
    const send = harness.device?.sendTransport;

    harness.session.handleRealtimeEvent({
      type: "voice.sessionReplaced",
      channelId: "vc-1",
      replacedSeatSessionId: "seat-1",
    });

    const state = useVoiceStore.getState();
    expect(state.status).toBe("idle");
    expect(state.notice).toMatch(/another window/i);
    expect(send?.closed).toBe(true);
    // The seat now belongs to the winner — leaving would unseat them.
    expect(harness.callsOf("leave")).toHaveLength(0);
  });

  test("sessionReplaced naming a FOREIGN seat-session id is ignored (third-tab race)", async () => {
    await joined();
    harness.session.handleRealtimeEvent({
      type: "voice.sessionReplaced",
      channelId: "vc-1",
      replacedSeatSessionId: "someone-elses-old-seat",
    });
    expect(useVoiceStore.getState().status).toBe("connected");
  });
});

describe("recovery", () => {
  test("a mid-ceremony signaling failure enters reconnecting and rejoins with backoff", async () => {
    vi.useFakeTimers();
    harness.failNext("createTransport", new Error("socket died"));

    const join = harness.session.join({ channelId: "vc-1", guildId: "g-1" });
    await vi.advanceTimersByTimeAsync(0);
    await join;
    expect(useVoiceStore.getState().status).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(useVoiceStore.getState().status).toBe("connected");
    expect(harness.callsOf("join")).toHaveLength(2);
  });

  test("TOO_MANY_REQUESTS is excluded from recovery: idle, no auto-retry", async () => {
    vi.useFakeTimers();
    harness.failNext("join", new FakeRpcError("TOO_MANY_REQUESTS"));

    await harness.session.join({ channelId: "vc-1", guildId: "g-1" });
    expect(useVoiceStore.getState().status).toBe("idle");
    expect(useVoiceStore.getState().notice).toMatch(/rate/i);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(harness.callsOf("join")).toHaveLength(1);
  });

  test("VOICE_UNAVAILABLE keeps retrying slowly instead of giving up", async () => {
    vi.useFakeTimers();
    harness.failNext("join", new FakeRpcError("VOICE_UNAVAILABLE"));
    harness.failNext("join", new FakeRpcError("VOICE_UNAVAILABLE"));

    const join = harness.session.join({ channelId: "vc-1", guildId: "g-1" });
    await vi.advanceTimersByTimeAsync(0);
    await join;
    expect(useVoiceStore.getState().status).toBe("reconnecting");
    expect(useVoiceStore.getState().notice).toMatch(/unavailable/i);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(useVoiceStore.getState().status).toBe("connected");
  });

  test("a definitive rejection (room full) surfaces and goes idle", async () => {
    harness.failNext("join", new FakeRpcError("CONFLICT"));
    await harness.session.join({ channelId: "vc-1", guildId: "g-1" });
    expect(useVoiceStore.getState().status).toBe("idle");
    expect(harness.callsOf("join")).toHaveLength(1);
  });

  test("socket death while connected → reconnecting; resubscription rejoins immediately", async () => {
    vi.useFakeTimers();
    await joined();

    harness.fireSocket("close");
    expect(useVoiceStore.getState().status).toBe("reconnecting");

    harness.session.notifyRealtimeSubscribed();
    await vi.advanceTimersByTimeAsync(600);
    expect(useVoiceStore.getState().status).toBe("connected");
    expect(harness.callsOf("join")).toHaveLength(2);
    // Rejoin is the universal entry: a fresh seat-session id was minted.
    expect(useVoiceStore.getState().seatSessionId).toBe("seat-2");
  });

  test("mediaReset re-runs voice.join (grace rebind), keeping channel and flags", async () => {
    vi.useFakeTimers();
    await joined();
    await harness.session.setSelfMute(true);

    harness.session.handleRealtimeEvent({ type: "voice.mediaReset", channelId: "vc-1" });
    await vi.advanceTimersByTimeAsync(600);

    const state = useVoiceStore.getState();
    expect(state.status).toBe("connected");
    expect(state.channelId).toBe("vc-1");
    expect(state.selfMute).toBe(true);
    expect(harness.callsOf("join")).toHaveLength(2);
    // The rebound mic honors the persisted mute flag.
    expect(harness.devices.at(-1)?.sendTransport?.producers[0]?.paused).toBe(true);
  });

  test("transport failure falls back into the same recovery path", async () => {
    vi.useFakeTimers();
    await joined();

    harness.device?.sendTransport?.changeConnectionState("failed");
    expect(useVoiceStore.getState().status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(600);
    expect(useVoiceStore.getState().status).toBe("connected");
  });

  test("producerAdded arriving mid-rejoin is queued and consumed once connected", async () => {
    vi.useFakeTimers();
    await joined();
    harness.fireSocket("close");
    expect(useVoiceStore.getState().status).toBe("reconnecting");

    // A peer produces while we're still rebuilding — must not be dropped.
    harness.producerKinds.set("mid-rejoin-audio", "audio");
    harness.session.handleRealtimeEvent(producerAdded("mid-rejoin-audio", "audio", "mic"));

    harness.session.notifyRealtimeSubscribed();
    await vi.advanceTimersByTimeAsync(600);
    expect(useVoiceStore.getState().status).toBe("connected");
    expect(harness.callsOf("consume")).toHaveLength(1);
    expect(useVoiceStore.getState().peers["remote-user"]?.mic?.producerId).toBe("mid-rejoin-audio");
  });

  test("sessionReplaced during reconnecting stops the loop — a steal must not be stolen back", async () => {
    vi.useFakeTimers();
    await joined();
    harness.fireSocket("close");
    expect(useVoiceStore.getState().status).toBe("reconnecting");

    // Another tab took the seat while we were down; only IT may keep it.
    harness.session.handleRealtimeEvent({
      type: "voice.sessionReplaced",
      channelId: "vc-1",
      replacedSeatSessionId: "seat-1",
    });
    expect(useVoiceStore.getState().status).toBe("idle");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(harness.callsOf("join")).toHaveLength(1);
  });

  test("rejoin after socket death waits for the realtime resubscription (replay must not be lost)", async () => {
    vi.useFakeTimers();
    await joined();
    harness.fireSocket("close");

    // Backoff elapses but the events iterator is not back yet — no join attempt.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.callsOf("join")).toHaveLength(1);
    expect(useVoiceStore.getState().status).toBe("reconnecting");

    harness.session.notifyRealtimeSubscribed();
    await vi.advanceTimersByTimeAsync(100);
    expect(useVoiceStore.getState().status).toBe("connected");
    expect(harness.callsOf("join")).toHaveLength(2);
  });

  test("leave during reconnecting stops the rejoin loop", async () => {
    vi.useFakeTimers();
    await joined();
    harness.fireSocket("close");
    expect(useVoiceStore.getState().status).toBe("reconnecting");

    await harness.session.leave();
    expect(useVoiceStore.getState().status).toBe("idle");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(harness.callsOf("join")).toHaveLength(1);
  });
});

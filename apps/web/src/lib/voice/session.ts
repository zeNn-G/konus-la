import type { RealtimeEvent } from "@konus-la/api";
import { Device } from "mediasoup-client";

import { getWs } from "@/lib/ws";

import {
  CAM_MAX_BITRATE,
  SCREEN_PRESETS,
  getCamTrack,
  getMicTrack,
  getScreenTrack,
} from "./media-sources";
import {
  type ProducerSource,
  type ScreensharePreset,
  useVoiceStore,
  type VoiceStoreState,
} from "./store";

/**
 * The module-singleton voice service (phase-5 spec §Client architecture): owns the
 * `idle → joining → connected → reconnecting` machine and every mediasoup-client object.
 * Only methods here drive transitions — no React effect ever does. Teardown happens on
 * leave, channel switch, logout, or losing a seat steal; navigation never tears down.
 *
 * Recovery is ONE path: any signaling failure, socket death, `voice.mediaReset`, or
 * transport failure funnels into `beginRecovery` → rejoin loop (`voice.join` is the
 * universal entry — the server sorts out fresh join vs grace rebind). The exceptions:
 * TOO_MANY_REQUESTS never auto-retries (#16), and definitive rejections (room full,
 * channel gone) surface and stop.
 */

// --- structural seams (mediasoup-client satisfies these; tests fake them) -------------------

export interface ProducerLike {
  id: string;
  paused: boolean;
  pause(): void;
  resume(): void;
  close(): void;
}

export interface ConsumerLike {
  id: string;
  producerId: string;
  kind: string;
  track: MediaStreamTrack;
  close(): void;
}

export interface TransportLike {
  id: string;
  on(event: string, handler: (...args: never[]) => void): void;
  close(): void;
  produce(options: {
    track: MediaStreamTrack;
    encodings?: Array<{ maxBitrate?: number }>;
    codecOptions?: Record<string, unknown>;
    appData?: Record<string, unknown>;
  }): Promise<ProducerLike>;
  consume(options: {
    id: string;
    producerId: string;
    kind: "audio" | "video";
    rtpParameters: unknown;
  }): Promise<ConsumerLike>;
}

export interface DeviceLike {
  rtpCapabilities: unknown;
  load(options: { routerRtpCapabilities: unknown }): Promise<void>;
  createSendTransport(params: unknown): TransportLike;
  createRecvTransport(params: unknown): TransportLike;
}

/** The `voice.*` signaling surface the session needs — AppRouterClient["voice"] satisfies it. */
export interface VoiceClientLike {
  join(input: { channelId: string }): Promise<{ seatSessionId: string }>;
  leave(): Promise<void>;
  setSelfMute(input: { muted: boolean }): Promise<void>;
  setSelfDeaf(input: { deafened: boolean }): Promise<void>;
  getRouterRtpCapabilities(): Promise<unknown>;
  createTransport(input: { direction: "send" | "recv" }): Promise<{ id: string }>;
  connectTransport(input: { transportId: string; dtlsParameters: unknown }): Promise<void>;
  produce(input: {
    transportId: string;
    kind: "audio" | "video";
    rtpParameters: unknown;
    source: ProducerSource;
  }): Promise<{ producerId: string }>;
  closeProducer(input: { producerId: string }): Promise<void>;
  consume(input: { producerId: string; rtpCapabilities: unknown }): Promise<{
    consumerId: string;
    producerId: string;
    kind: "audio" | "video";
    rtpParameters: unknown;
  }>;
  setConsumersPaused(input: { consumerIds: string[]; paused: boolean }): Promise<void>;
}

export interface VoiceSessionDeps {
  getClient: () => VoiceClientLike;
  /** Subscribe to the shared signaling socket's lifecycle; returns an unsubscribe. */
  onSocket: (type: "open" | "close", listener: () => void) => () => void;
  createDevice: () => DeviceLike;
  getMicTrack: () => Promise<MediaStreamTrack>;
  getCamTrack: () => Promise<MediaStreamTrack>;
  getScreenTrack: (preset: ScreensharePreset) => Promise<MediaStreamTrack>;
  isDocumentVisible: () => boolean;
  onVisibilityChange: (listener: () => void) => () => void;
}

/** The realtime events the dispatcher routes to the session (own-user producer events filtered). */
export type VoiceSessionEvent = Extract<
  RealtimeEvent,
  {
    type:
      | "voice.producerAdded"
      | "voice.producerClosed"
      | "voice.sessionReplaced"
      | "voice.mediaReset";
  }
>;

type ProducerAddedEvent = Extract<VoiceSessionEvent, { type: "voice.producerAdded" }>;

/** A superseded ceremony/action — swallow silently, a newer generation owns the session. */
class StaleSessionError extends Error {}

const CALL_TIMEOUT_MS = 15_000;
/** Cumulative ~24 s of retries — inside the server's 30 s grace, under the join budget. */
const REJOIN_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 8_000];
/** Breaker-open cadence: slow enough to never storm, fast enough to catch the respawn. */
const UNAVAILABLE_RETRY_MS = 10_000;
const HIDDEN_PAUSE_DEBOUNCE_MS = 3_000;

const DEFINITIVE_CODES = new Set([
  "BAD_REQUEST",
  "CONFLICT",
  "FORBIDDEN",
  "NOT_FOUND",
  "UNAUTHORIZED",
]);

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

function noticeOf(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.length > 0 ? message : "Couldn't join voice";
}

interface ConsumerEntry {
  consumer: ConsumerLike;
  userId: string;
  source: ProducerSource;
  kind: "audio" | "video";
  /** Client-side mirror of the server pause state — the sync diff's memory. */
  resumed: boolean;
}

export class VoiceSession {
  /** Bumped on every teardown — a running rejoin loop exits when it changes. */
  private gen = 0;
  /** Bumped on teardown AND at each ceremony start — stale awaits guard on it. */
  private epoch = 0;
  private started = false;

  private device: DeviceLike | null = null;
  private sendTransport: TransportLike | null = null;
  private recvTransport: TransportLike | null = null;
  private producers = new Map<ProducerSource, ProducerLike>();
  private consumers = new Map<string, ConsumerEntry>();
  private consumedProducerIds = new Set<string>();
  private pendingProducers: ProducerAddedEvent[] = [];

  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  /** Resolves the rejoin loop's current wait early (socket reopened / teardown). */
  private wake: (() => void) | null = null;

  constructor(private deps: VoiceSessionDeps) {}

  private store(): VoiceStoreState {
    return useVoiceStore.getState();
  }

  private patch(partial: Partial<VoiceStoreState>): void {
    useVoiceStore.setState(partial);
  }

  private guard(epoch: number): void {
    if (this.epoch !== epoch) throw new StaleSessionError();
  }

  /**
   * A WS request sent right before the socket died gets no response, ever — without a
   * deadline it would hang the ceremony forever. Timeouts land in the same recovery
   * classification as any other signaling failure.
   */
  private async timed<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("voice signaling call timed out")),
            CALL_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Idempotent, lazy: the first join wires socket/visibility/interest listeners. */
  private start(): void {
    if (this.started) return;
    this.started = true;
    this.deps.onSocket("close", () => {
      const status = this.store().status;
      if (status === "connected" || status === "joining") this.beginRecovery();
    });
    this.deps.onSocket("open", () => this.wake?.());
    this.deps.onVisibilityChange(() => this.onVisibilityChanged());
    let prevInterest = useVoiceStore.getState().videoInterest;
    useVoiceStore.subscribe((state) => {
      if (state.videoInterest === prevInterest) return;
      prevInterest = state.videoInterest;
      void this.syncVideoConsumers();
    });
  }

  // --- public API ----------------------------------------------------------------------------

  /**
   * The universal client entry: fresh join and channel switch alike. A switch closes the
   * local media first (transports cascade to producers/consumers/tracks), resets tier-2,
   * then calls `voice.join` — the server's implicit unseat replaces any awaited leave.
   */
  async join(target: { channelId: string; guildId: string }): Promise<void> {
    this.start();
    const state = this.store();
    if (
      (state.status === "joining" || state.status === "connected") &&
      state.channelId === target.channelId
    ) {
      return;
    }
    const fromIdle = state.status === "idle";
    this.teardownMedia();
    this.patch({
      status: "joining",
      channelId: target.channelId,
      guildId: target.guildId,
      seatSessionId: null,
      notice: null,
      micError: false,
      // A switch carries flags (mirroring the server's seat carry-over); a fresh join
      // starts unmuted like the fresh seat does.
      ...(fromIdle ? { selfMute: false, selfDeaf: false } : {}),
    });
    try {
      await this.ceremony(target.channelId);
    } catch (error) {
      if (error instanceof StaleSessionError) return;
      this.handleSignalingFailure(error);
    }
  }

  /** Explicit leave (button / logout): local teardown, then best-effort server unseat. */
  async leave(): Promise<void> {
    if (this.store().status === "idle") return;
    this.toIdle(null);
    try {
      await this.deps.getClient().leave();
    } catch {
      // Socket dead or voice down — the server's grace/GC covers the seat either way.
    }
  }

  async setSelfMute(muted: boolean): Promise<void> {
    const state = this.store();
    if (state.selfMute === muted) return;
    this.patch({ selfMute: muted });
    const mic = this.producers.get("mic");
    if (mic) {
      if (muted) mic.pause();
      else mic.resume();
    }
    if (state.status === "idle") return;
    try {
      await this.deps.getClient().setSelfMute({ muted });
    } catch {
      this.patch({ selfMute: !muted });
      if (mic) {
        if (muted) mic.resume();
        else mic.pause();
      }
    }
  }

  /** Deafen's client half is just the flag — the server pauses/resumes audio consumers. */
  async setSelfDeaf(deafened: boolean): Promise<void> {
    const state = this.store();
    if (state.selfDeaf === deafened) return;
    this.patch({ selfDeaf: deafened });
    if (state.status === "idle") return;
    try {
      await this.deps.getClient().setSelfDeaf({ deafened });
    } catch {
      this.patch({ selfDeaf: !deafened });
    }
  }

  /** The mic button's retry after a listen-only join: re-run capture and produce. */
  async retryMic(): Promise<void> {
    if (this.store().status !== "connected" || this.producers.has("mic")) return;
    await this.produceMic(this.epoch);
  }

  async enableCam(): Promise<void> {
    await this.produceVideo("cam", this.deps.getCamTrack, [{ maxBitrate: CAM_MAX_BITRATE }]);
  }

  async disableCam(): Promise<void> {
    await this.closeLocalProducer("cam");
  }

  /** Preset picked BEFORE capture; changing it mid-share is stop + re-share (spec v1). */
  async startScreenshare(preset: ScreensharePreset = "1080p"): Promise<void> {
    await this.produceVideo("screen", () => this.deps.getScreenTrack(preset), [
      { maxBitrate: SCREEN_PRESETS[preset].maxBitrate },
    ]);
  }

  async stopScreenshare(): Promise<void> {
    await this.closeLocalProducer("screen");
  }

  /** The realtime dispatcher's entry — the four session-scoped `voice.*` events. */
  handleRealtimeEvent(event: VoiceSessionEvent): void {
    switch (event.type) {
      case "voice.producerAdded": {
        const state = this.store();
        if (event.channelId !== state.channelId) return;
        if (state.status === "joining" || !this.recvTransport) {
          if (!this.pendingProducers.some((p) => p.producerId === event.producerId)) {
            this.pendingProducers.push(event);
          }
          return;
        }
        if (state.status !== "connected") return;
        void this.consumeAndActivate(event);
        return;
      }
      case "voice.producerClosed": {
        this.pendingProducers = this.pendingProducers.filter(
          (p) => p.producerId !== event.producerId,
        );
        this.consumedProducerIds.delete(event.producerId);
        for (const [consumerId, entry] of this.consumers) {
          if (entry.consumer.producerId !== event.producerId) continue;
          entry.consumer.close();
          this.consumers.delete(consumerId);
        }
        const peers = this.store().peers;
        const peer = peers[event.userId];
        if (!peer) return;
        const remaining = Object.fromEntries(
          Object.entries(peer).filter(([, media]) => media.producerId !== event.producerId),
        );
        this.patch({
          peers:
            Object.keys(remaining).length > 0
              ? { ...peers, [event.userId]: remaining }
              : Object.fromEntries(Object.entries(peers).filter(([id]) => id !== event.userId)),
        });
        return;
      }
      case "voice.sessionReplaced": {
        // Only the LOSING tab's id is ever named — the winner (and any third tab racing
        // in) ignores this. Local teardown only: the seat belongs to someone else now,
        // `voice.leave` would unseat them.
        const state = this.store();
        if (!state.seatSessionId || event.replacedSeatSessionId !== state.seatSessionId) return;
        this.teardownMedia();
        this.patch({
          status: "idle",
          channelId: null,
          guildId: null,
          seatSessionId: null,
          notice: "Voice moved to another window",
        });
        return;
      }
      case "voice.mediaReset": {
        // Keep the seat, redo the plumbing: rejoin lands as a grace rebind (#15).
        const state = this.store();
        if (state.status === "idle" || event.channelId !== state.channelId) return;
        this.beginRecovery();
        return;
      }
    }
  }

  // --- ceremony ------------------------------------------------------------------------------

  /**
   * The full sequential join ceremony (spec §Lifecycle): join → caps → device.load →
   * transports → produce mic (if grantable) → consume the replayed producers → batched
   * resume. `connectTransport` rides mediasoup-client's `connect` events — send connects
   * on first produce, recv on first consume.
   */
  private async ceremony(channelId: string): Promise<void> {
    const epoch = ++this.epoch;
    const client = this.deps.getClient();
    try {
      const { seatSessionId } = await this.timed(client.join({ channelId }));
      this.guard(epoch);
      this.patch({ seatSessionId });

      const routerRtpCapabilities = await this.timed(client.getRouterRtpCapabilities());
      this.guard(epoch);
      const device = this.deps.createDevice();
      await device.load({ routerRtpCapabilities });
      this.guard(epoch);
      this.device = device;

      const sendParams = await this.timed(client.createTransport({ direction: "send" }));
      this.guard(epoch);
      this.sendTransport = device.createSendTransport(sendParams);
      this.wireTransport(this.sendTransport, epoch, true);

      const recvParams = await this.timed(client.createTransport({ direction: "recv" }));
      this.guard(epoch);
      this.recvTransport = device.createRecvTransport(recvParams);
      this.wireTransport(this.recvTransport, epoch, false);

      await this.produceMic(epoch);
      this.guard(epoch);
      this.patch({ status: "connected" });
      await this.drainPendingProducers(epoch);
    } catch (error) {
      if (this.epoch === epoch) this.closeHandles();
      throw error;
    }
  }

  private wireTransport(transport: TransportLike, epoch: number, isSend: boolean): void {
    const client = this.deps.getClient();
    type Callback<T> = (value: T) => void;
    type Errback = (error: Error) => void;
    transport.on(
      "connect",
      ((
        { dtlsParameters }: { dtlsParameters: unknown },
        callback: Callback<void>,
        errback: Errback,
      ) => {
        client
          .connectTransport({ transportId: transport.id, dtlsParameters })
          .then(() => callback(undefined), errback);
      }) as never,
    );
    if (isSend) {
      transport.on(
        "produce",
        ((
          params: { kind: "audio" | "video"; rtpParameters: unknown; appData?: { source?: ProducerSource } },
          callback: Callback<{ id: string }>,
          errback: Errback,
        ) => {
          client
            .produce({
              transportId: transport.id,
              kind: params.kind,
              rtpParameters: params.rtpParameters,
              source: params.appData?.source ?? "mic",
            })
            .then(({ producerId }) => callback({ id: producerId }), errback);
        }) as never,
      );
    }
    // Belt-and-braces into the same single recovery path (spec §Client architecture).
    transport.on("connectionstatechange", ((state: string) => {
      if (state === "failed" && this.epoch === epoch) this.beginRecovery();
    }) as never);
  }

  /** Mic denial degrades to listen-only (#17): the seat is taken either way. */
  private async produceMic(epoch: number): Promise<void> {
    let track: MediaStreamTrack;
    try {
      track = await this.deps.getMicTrack();
    } catch {
      if (this.epoch === epoch) this.patch({ micError: true });
      return;
    }
    if (this.epoch !== epoch) {
      track.stop();
      throw new StaleSessionError();
    }
    try {
      const producer = await this.sendTransport!.produce({
        track,
        codecOptions: { opusDtx: true, opusFec: true },
        appData: { source: "mic" },
      });
      if (this.epoch !== epoch) {
        producer.close();
        track.stop();
        throw new StaleSessionError();
      }
      // Flags persist across grace/switch — a rebound mic honors the standing mute.
      if (this.store().selfMute) producer.pause();
      this.producers.set("mic", producer);
      this.patch({ micError: false, localTracks: { ...this.store().localTracks, mic: track } });
    } catch (error) {
      if (error instanceof StaleSessionError) throw error;
      track.stop();
      if (this.epoch === epoch) this.patch({ micError: true });
    }
  }

  private async produceVideo(
    source: "cam" | "screen",
    capture: () => Promise<MediaStreamTrack>,
    encodings: Array<{ maxBitrate?: number }>,
  ): Promise<void> {
    if (this.store().status !== "connected" || this.producers.has(source) || !this.sendTransport) {
      return;
    }
    const epoch = this.epoch;
    // Capture rejections (denial / picker cancel) propagate — the button UX reverts.
    const track = await capture();
    if (this.epoch !== epoch) {
      track.stop();
      return;
    }
    try {
      const producer = await this.sendTransport.produce({
        track,
        encodings,
        appData: { source },
      });
      if (this.epoch !== epoch) {
        producer.close();
        track.stop();
        return;
      }
      this.producers.set(source, producer);
      this.patch({ localTracks: { ...this.store().localTracks, [source]: track } });
      // Browser-level "stop sharing" (or device unplug) ends the track outside our UI.
      track.addEventListener("ended", () => void this.closeLocalProducer(source));
    } catch (error) {
      track.stop();
      throw error;
    }
  }

  private async closeLocalProducer(source: "cam" | "screen"): Promise<void> {
    const producer = this.producers.get(source);
    if (!producer) return;
    this.producers.delete(source);
    producer.close();
    this.store().localTracks[source]?.stop();
    const { [source]: _gone, ...localTracks } = this.store().localTracks;
    this.patch({ localTracks });
    try {
      await this.deps.getClient().closeProducer({ producerId: producer.id });
    } catch {
      // Peer already replaced/gone — the server closed it with the old peer.
    }
  }

  // --- consumers -----------------------------------------------------------------------------

  private async drainPendingProducers(epoch: number): Promise<void> {
    const pending = this.pendingProducers.splice(0);
    const audioIds: string[] = [];
    for (const event of pending) {
      const entry = await this.consumeOne(event, epoch);
      if (entry?.kind === "audio") audioIds.push(entry.consumer.id);
    }
    if (audioIds.length > 0 && !this.store().selfDeaf) {
      await this.resumeConsumers(audioIds);
    }
    await this.syncVideoConsumers();
  }

  private async consumeAndActivate(event: ProducerAddedEvent): Promise<void> {
    try {
      const entry = await this.consumeOne(event, this.epoch);
      if (!entry) return;
      if (entry.kind === "audio") {
        // Immediate audio activation; consumers created while deafened stay paused —
        // the server resumes them wholesale on undeafen.
        if (!this.store().selfDeaf) await this.resumeConsumers([entry.consumer.id]);
      } else {
        await this.syncVideoConsumers();
      }
    } catch (error) {
      if (!(error instanceof StaleSessionError)) {
        console.error("voice: consume failed", error);
      }
    }
  }

  private async consumeOne(
    event: ProducerAddedEvent,
    epoch: number,
  ): Promise<ConsumerEntry | null> {
    if (this.consumedProducerIds.has(event.producerId)) return null;
    this.consumedProducerIds.add(event.producerId);
    const client = this.deps.getClient();
    try {
      const params = await this.timed(
        client.consume({
          producerId: event.producerId,
          rtpCapabilities: this.device!.rtpCapabilities,
        }),
      );
      this.guard(epoch);
      const consumer = await this.recvTransport!.consume({
        id: params.consumerId,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });
      if (this.epoch !== epoch) {
        consumer.close();
        throw new StaleSessionError();
      }
      const entry: ConsumerEntry = {
        consumer,
        userId: event.userId,
        source: event.source,
        kind: event.kind,
        resumed: false,
      };
      this.consumers.set(consumer.id, entry);
      const peers = this.store().peers;
      this.patch({
        peers: {
          ...peers,
          [event.userId]: {
            ...peers[event.userId],
            [event.source]: {
              consumerId: consumer.id,
              producerId: event.producerId,
              kind: event.kind,
              source: event.source,
              track: consumer.track,
            },
          },
        },
      });
      return entry;
    } catch (error) {
      this.consumedProducerIds.delete(event.producerId);
      if (error instanceof StaleSessionError) throw error;
      // Producer closed in the race window — producerClosed (or the next replay) settles it.
      return null;
    }
  }

  private async resumeConsumers(consumerIds: string[]): Promise<void> {
    for (const id of consumerIds) {
      const entry = this.consumers.get(id);
      if (entry) entry.resumed = true;
    }
    try {
      await this.deps.getClient().setConsumersPaused({ consumerIds, paused: false });
    } catch {
      // Unknown ids are skipped server-side; a real failure self-heals on the next sync.
    }
  }

  /**
   * The visibility policy (#18): a video consumer plays only while some component renders
   * it AND the tab is effectively visible (3 s continuous-hidden debounce; resume always
   * immediate). Audio is never visibility-paused. Diffs against the local `resumed`
   * mirror and batches one call per direction.
   */
  private async syncVideoConsumers(): Promise<void> {
    if (this.consumers.size === 0) return;
    const interest = this.store().videoInterest;
    const play = this.videoShouldPlay();
    const toResume: string[] = [];
    const toPause: string[] = [];
    for (const [consumerId, entry] of this.consumers) {
      if (entry.kind !== "video") continue;
      const desired = play && (interest[consumerId] ?? 0) > 0;
      if (desired && !entry.resumed) toResume.push(consumerId);
      else if (!desired && entry.resumed) toPause.push(consumerId);
    }
    const client = this.deps.getClient();
    if (toResume.length > 0) {
      for (const id of toResume) this.consumers.get(id)!.resumed = true;
      await client.setConsumersPaused({ consumerIds: toResume, paused: false }).catch(() => {});
    }
    if (toPause.length > 0) {
      for (const id of toPause) this.consumers.get(id)!.resumed = false;
      await client.setConsumersPaused({ consumerIds: toPause, paused: true }).catch(() => {});
    }
  }

  /** Visible, or hidden but still inside the debounce window. */
  private videoShouldPlay(): boolean {
    return this.deps.isDocumentVisible() || this.hiddenTimer !== null;
  }

  private onVisibilityChanged(): void {
    if (this.deps.isDocumentVisible()) {
      if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
      void this.syncVideoConsumers();
      return;
    }
    if (this.hiddenTimer) return;
    this.hiddenTimer = setTimeout(() => {
      this.hiddenTimer = null;
      void this.syncVideoConsumers();
    }, HIDDEN_PAUSE_DEBOUNCE_MS);
  }

  // --- recovery ------------------------------------------------------------------------------

  /** Classify a join/ceremony failure per the single-recovery-path rules. */
  private handleSignalingFailure(error: unknown): void {
    const code = codeOf(error);
    if (code === "TOO_MANY_REQUESTS") {
      // #16: surface, no auto-retry — the user's next manual action is the retry.
      this.toIdle("Voice is rate limited — try again in a moment");
      return;
    }
    if (code !== undefined && DEFINITIVE_CODES.has(code)) {
      this.toIdle(noticeOf(error));
      return;
    }
    if (code === "VOICE_UNAVAILABLE") {
      this.patch({ notice: "Voice is unavailable — retrying…" });
    }
    this.beginRecovery();
  }

  private beginRecovery(): void {
    const state = this.store();
    if (state.status === "idle" || state.status === "reconnecting") return;
    const channelId = state.channelId;
    if (!channelId) return;
    this.teardownMedia();
    this.patch({ status: "reconnecting", seatSessionId: null });
    void this.rejoinLoop(this.gen, channelId);
  }

  private async rejoinLoop(gen: number, channelId: string): Promise<void> {
    let attempt = 0;
    let delay = REJOIN_DELAYS_MS[0]!;
    while (this.gen === gen) {
      await this.delayOrWake(delay);
      if (this.gen !== gen) return;
      try {
        await this.ceremony(channelId);
        if (this.gen === gen) this.patch({ notice: null });
        return;
      } catch (error) {
        if (error instanceof StaleSessionError || this.gen !== gen) return;
        const code = codeOf(error);
        if (code === "TOO_MANY_REQUESTS") {
          this.toIdle("Voice is rate limited — join again in a moment");
          return;
        }
        if (code !== undefined && DEFINITIVE_CODES.has(code)) {
          this.toIdle(noticeOf(error));
          return;
        }
        if (code === "VOICE_UNAVAILABLE") {
          // Breaker open: retry slowly forever — the server revives on its own cadence.
          this.patch({ notice: "Voice is unavailable — retrying…" });
          delay = UNAVAILABLE_RETRY_MS;
          continue;
        }
        attempt += 1;
        if (attempt >= REJOIN_DELAYS_MS.length) {
          this.toIdle("Couldn't reconnect to voice");
          return;
        }
        delay = REJOIN_DELAYS_MS[attempt]!;
      }
    }
  }

  /** Wait `ms`, or less if the socket reopens / a teardown wants the loop to re-check. */
  private delayOrWake(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
    });
  }

  // --- teardown ------------------------------------------------------------------------------

  private toIdle(notice: string | null): void {
    this.teardownMedia();
    this.patch({
      status: "idle",
      channelId: null,
      guildId: null,
      seatSessionId: null,
      notice,
    });
  }

  /** Invalidate every in-flight continuation and drop the media half. Status is the caller's. */
  private teardownMedia(): void {
    this.gen += 1;
    this.epoch += 1;
    if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
    this.hiddenTimer = null;
    this.wake?.();
    this.closeHandles();
  }

  /** Close/forget mediasoup handles + tracks; transports cascade client-side. */
  private closeHandles(): void {
    try {
      this.sendTransport?.close();
      this.recvTransport?.close();
    } catch {
      // already closed
    }
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.producers.clear();
    this.consumers.clear();
    this.consumedProducerIds.clear();
    this.pendingProducers = [];
    const { localTracks } = this.store();
    for (const track of Object.values(localTracks)) track?.stop();
    this.patch({ peers: {}, localTracks: {} });
  }
}

// --- the real singleton ----------------------------------------------------------------------

function createRealDeps(): VoiceSessionDeps {
  return {
    getClient: () => getWs().client.voice as unknown as VoiceClientLike,
    onSocket: (type, listener) => {
      const { socket } = getWs();
      socket.addEventListener(type, listener);
      return () => socket.removeEventListener(type, listener);
    },
    createDevice: () => new Device() as unknown as DeviceLike,
    getMicTrack,
    getCamTrack,
    getScreenTrack,
    isDocumentVisible: () => document.visibilityState === "visible",
    onVisibilityChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

export const voiceSession = new VoiceSession(createRealDeps());

// Dev-only programmatic access — the phase-5 acceptance checks drive joins/leaves/
// switches from the console or a Playwright harness without any UI slice present.
if (import.meta.env.DEV) {
  (globalThis as Record<string, unknown>).__voiceSession = voiceSession;
  (globalThis as Record<string, unknown>).__voiceStore = useVoiceStore;
}

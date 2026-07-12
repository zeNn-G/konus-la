import { listGuildMemberUserIds, listUserGuilds } from "@konus-la/db";
import type { types } from "mediasoup";

import type { RealtimeEvent } from "../realtime/events";
import { publishTo } from "../realtime/publishers";
import { AUDIO_LEVEL_OBSERVER_OPTIONS, MEDIA_CODECS, sfuWorker } from "./sfu";

/**
 * In-memory voice state — Room/Seat/Peer per the phase-5 spec §Domain model (vocabulary
 * in ../../CONTEXT.md). Never persisted: a restart empties every room by definition, and
 * occupancy is only ever a published view of this memory.
 *
 * The Peer carries the mediasoup half (transports/producers/consumers) and its
 * server-enforced state machine; procedure-level media operations live in ./media.ts.
 * The room's router + AudioLevelObserver are created lazily on first join and die with
 * the room (or the worker — `voiceWorkerDied` discards the handles, rejoins rebuild).
 *
 * Dev note: `bun --hot` resets this module state — rooms look empty until clients rejoin.
 */

const GRACE_MS = 30_000;
/** Phase-5 scope: ≤20 concurrent per room. Seats count — a grace seat still holds its slot. */
const MAX_SEATS_PER_ROOM = 20;

/** Thrown by `joinVoice` when the target room is at capacity; the router maps it to CONFLICT. */
export class VoiceRoomFullError extends Error {
  constructor() {
    super("Voice channel is full");
  }
}

/**
 * No worker to build a router on — a respawn is in flight, or voice went down mid-call
 * (the `voiceProcedure` breaker gate catches the settled down-state before handlers run).
 * The router maps it to the defined VOICE_UNAVAILABLE error.
 */
export class VoiceUnavailableError extends Error {
  constructor() {
    super("Voice is temporarily unavailable");
  }
}

/**
 * An out-of-order or out-of-session signaling call (spec §Procedures state machine).
 * The router maps it to the defined VOICE_INVALID_STATE error.
 */
export class VoiceInvalidStateError extends Error {}

/** A media entity the caller named does not exist (for them). Maps to NOT_FOUND. */
export class VoiceNotFoundError extends Error {}

/** mediasoup rejected the caller-supplied media parameters. Maps to BAD_REQUEST. */
export class VoiceBadMediaError extends Error {}

export type ProducerSource = "mic" | "cam" | "screen";

/**
 * The connection-level media half of a seat. Dies with its socket (or is replaced by a
 * steal / same-socket rejoin); the seat it served enters grace. `state` is the
 * server-enforced ceremony machine — out-of-order calls are VOICE_INVALID_STATE, the
 * invariant lives here rather than in client discipline (#9).
 */
export interface Peer {
  connectionId: string;
  state: "joined" | "transportCreated" | "connected" | "producing";
  sendTransport: types.WebRtcTransport | null;
  recvTransport: types.WebRtcTransport | null;
  /** DTLS-connected transport ids: `produce` requires its transport connected (#9). */
  connectedTransportIds: Set<string>;
  /**
   * Occupied producer slots, reserved SYNCHRONOUSLY before the async produce call — the
   * 1 mic + ≤1 cam + ≤1 screen cap must hold even against two interleaved produces.
   */
  sources: Set<ProducerSource>;
  producers: Map<string, { producer: types.Producer; source: ProducerSource }>;
  /** Created server-side paused; resume is the single activation verb (#18). */
  consumers: Map<string, types.Consumer>;
}

interface Seat {
  userId: string;
  /** Minted on EVERY bind (fresh join, rebind, steal) — `sessionReplaced` names the loser. */
  seatSessionId: string;
  selfMute: boolean;
  selfDeaf: boolean;
  /** Null while in grace: the seat outlives its socket, media never does. */
  peer: Peer | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

interface Room {
  guildId: string;
  channelId: string;
  /** Null until the first join builds it — and again after a worker death (#15). */
  router: types.Router | null;
  audioLevelObserver: types.AudioLevelObserver | null;
  /** Collapses concurrent first joins onto one createRouter call. */
  routerCreating: Promise<void> | null;
  seats: Map<string, Seat>;
  /** Last published activeSpeakers set — the edge-trigger memory (#12). */
  speakingUserIds: Set<string>;
}

const rooms = new Map<string, Room>();
/** One seat per user instance-wide — the invariant, kept as an index. */
const seatChannelByUser = new Map<string, string>();

function seatOf(userId: string): { room: Room; seat: Seat } | null {
  const channelId = seatChannelByUser.get(userId);
  if (channelId === undefined) return null;
  const room = rooms.get(channelId);
  const seat = room?.seats.get(userId);
  return room && seat ? { room, seat } : null;
}

/**
 * The caller's seat + live peer, gated on the OWNING socket: a stale tab that lost a
 * steal still holds a valid session cookie, but its connectionId no longer matches, so
 * it cannot signal for the seat. Every media procedure resolves through this.
 */
export function livePeerOf(
  userId: string,
  connectionId: string,
): { room: Room; seat: Seat; peer: Peer } | null {
  const current = seatOf(userId);
  const peer = current?.seat.peer;
  if (!current || !peer || peer.connectionId !== connectionId) return null;
  return { room: current.room, seat: current.seat, peer };
}

function newPeer(connectionId: string): Peer {
  return {
    connectionId,
    state: "joined",
    sendTransport: null,
    recvTransport: null,
    connectedTransportIds: new Set(),
    sources: new Set(),
    producers: new Map(),
    consumers: new Map(),
  };
}

/** Closing an already-dead mediasoup handle is a no-op, but never let it throw either. */
function safeClose(closable: { closed: boolean; close: () => void } | null): void {
  try {
    if (closable && !closable.closed) closable.close();
  } catch {
    // handle raced its worker's death — already gone
  }
}

/** Room-only fan-out: the current seats of that room (producer churn stays off the guild). */
export async function publishRoomOnly(room: Room, event: RealtimeEvent): Promise<void> {
  await publishTo(room.seats.keys(), event);
}

/**
 * Tear down a peer's mediasoup half. Closing the transports cascades to its producers
 * and consumers; consumers OTHER peers hold on this peer's producers close via their
 * own 'producerclose' listeners. `announce: false` is the worker-death path — the
 * handles are already dead and `voice.mediaReset` is the recovery signal, not producer
 * churn. Announces are fire-and-forget: callers sit on sync paths (socket close hook).
 */
function closePeerMedia(room: Room, userId: string, peer: Peer, announce: boolean): void {
  const producerIds = [...peer.producers.keys()];
  safeClose(peer.sendTransport);
  safeClose(peer.recvTransport);
  peer.sendTransport = null;
  peer.recvTransport = null;
  peer.connectedTransportIds.clear();
  peer.sources.clear();
  peer.producers.clear();
  peer.consumers.clear();
  if (!announce) return;
  for (const producerId of producerIds) {
    publishRoomOnly(room, {
      type: "voice.producerClosed",
      channelId: room.channelId,
      userId,
      producerId,
    }).catch((error) => {
      console.error("voice: producerClosed publish failed", error);
    });
  }
}

/**
 * Lazily build the room's router + AudioLevelObserver (spec §Domain model, #15): first
 * join creates them, a post-crash rejoin recreates them through this same path.
 */
async function ensureRouter(room: Room): Promise<void> {
  if (room.router && !room.router.closed) return;
  room.routerCreating ??= createRouterFor(room).finally(() => {
    room.routerCreating = null;
  });
  await room.routerCreating;
}

async function createRouterFor(room: Room): Promise<void> {
  const worker = sfuWorker();
  if (!worker || worker.closed) throw new VoiceUnavailableError();
  let router: types.Router;
  let observer: types.AudioLevelObserver;
  try {
    router = await worker.createRouter({
      mediaCodecs: MEDIA_CODECS,
      appData: { channelId: room.channelId },
    });
    observer = await router.createAudioLevelObserver(AUDIO_LEVEL_OBSERVER_OPTIONS);
  } catch (error) {
    // The worker died mid-call; the caller sees the same thing as "no worker yet".
    if (sfuWorker()?.closed !== false) throw new VoiceUnavailableError();
    throw error;
  }
  observer.on("volumes", (volumes) => {
    const speaking: string[] = [];
    for (const { producer } of volumes) {
      const userId = producer.appData.userId;
      if (typeof userId === "string" && !speaking.includes(userId)) speaking.push(userId);
    }
    updateSpeakingUserIds(room.channelId, speaking);
  });
  observer.on("silence", () => updateSpeakingUserIds(room.channelId, []));
  room.router = router;
  room.audioLevelObserver = observer;
}

/**
 * Edge-triggered activeSpeakers (#12): replace the room's speaking set and publish the
 * FULL new set guild-wide — but only when it actually changed. The observer's interval
 * is the debounce; identical sets (and silent rooms) cost zero messages. Fire-and-forget
 * publish: observer callbacks and seat removal are sync paths.
 */
export function updateSpeakingUserIds(channelId: string, speakingUserIds: string[]): void {
  const room = rooms.get(channelId);
  if (!room) return;
  const next = new Set(speakingUserIds);
  const current = room.speakingUserIds;
  if (next.size === current.size && [...next].every((userId) => current.has(userId))) return;
  room.speakingUserIds = next;
  publishGuildWide(room.guildId, {
    type: "voice.activeSpeakers",
    guildId: room.guildId,
    channelId,
    speakingUserIds: [...next],
  }).catch((error) => {
    console.error("voice: activeSpeakers publish failed", error);
  });
}

/**
 * Drop a seat and GC the room when it was the last one out — closing the router cascades
 * to the observer (dead router = no-op, so no crash special-case, #15). A leaving
 * speaker falls out of the published speaking set here rather than waiting an observer
 * interval. No occupancy events published here.
 */
function removeSeat(room: Room, seat: Seat): void {
  if (seat.graceTimer) clearTimeout(seat.graceTimer);
  seat.graceTimer = null;
  const peer = seat.peer;
  seat.peer = null;
  room.seats.delete(seat.userId);
  seatChannelByUser.delete(seat.userId);
  if (peer) closePeerMedia(room, seat.userId, peer, room.seats.size > 0);
  if (room.seats.size === 0) {
    safeClose(room.router);
    room.router = null;
    room.audioLevelObserver = null;
    rooms.delete(room.channelId);
    return;
  }
  if (room.speakingUserIds.has(seat.userId)) {
    updateSpeakingUserIds(
      room.channelId,
      [...room.speakingUserIds].filter((userId) => userId !== seat.userId),
    );
  }
}

async function publishGuildWide(guildId: string, event: RealtimeEvent): Promise<void> {
  await publishTo(await listGuildMemberUserIds(guildId), event);
}

/** Every way a seat empties — leave, switch, grace expiry — fans out the same peerLeft. */
async function publishPeerLeft(room: Room, userId: string): Promise<void> {
  await publishGuildWide(room.guildId, {
    type: "voice.peerLeft",
    guildId: room.guildId,
    channelId: room.channelId,
    userId,
  });
}

/**
 * Media half gone (socket drop or worker death): keep the seat and its flags, start the
 * grace countdown. Expiry is the involuntary leave — peerLeft fans out then, not now.
 * `announce: false` is the worker-death flavor (handles dead, mediaReset recovers).
 * `graceMs` exists as a parameter for the tests; production callers take the default.
 */
function startGrace(room: Room, seat: Seat, graceMs: number, announce: boolean): void {
  const peer = seat.peer;
  seat.peer = null;
  if (peer) closePeerMedia(room, seat.userId, peer, announce);
  if (seat.graceTimer) clearTimeout(seat.graceTimer);
  seat.graceTimer = setTimeout(() => {
    seat.graceTimer = null;
    removeSeat(room, seat);
    // Fire-and-forget off a timer: nothing upstream can await it. A dropped publish only
    // desyncs sidebars until their next resubscription, but must not become an unhandled
    // rejection.
    publishPeerLeft(room, seat.userId).catch((error) => {
      console.error("voice: grace-expiry peerLeft publish failed", error);
    });
  }, graceMs);
}

/**
 * Every bind starts with zero consumers (a rebind's old peer died with its media), so the
 * joiner is told about the room's live producers the same way it hears about new ones:
 * `producerAdded`, replayed self-only. Existing seats already heard these — one client
 * code path covers "existing at join" and "added mid-session".
 */
async function replayProducersTo(room: Room, userId: string): Promise<void> {
  for (const seat of room.seats.values()) {
    if (seat.userId === userId || !seat.peer) continue;
    for (const [producerId, { producer, source }] of seat.peer.producers) {
      await publishTo([userId], {
        type: "voice.producerAdded",
        channelId: room.channelId,
        userId: seat.userId,
        producerId,
        kind: producer.kind,
        source,
      });
    }
  }
}

/**
 * The universal entry (phase-5 spec §Lifecycle): fresh join, channel switch, grace
 * rebind, multi-tab steal, and post-restart recovery are all this one call — the flavor
 * is sorted out here, the client never states it.
 */
export async function joinVoice(input: {
  userId: string;
  connectionId: string;
  guildId: string;
  channelId: string;
}): Promise<{ seatSessionId: string }> {
  const { userId, connectionId, guildId, channelId } = input;
  const current = seatOf(userId);

  // Capacity gates only NEW seats — a rebind/steal re-occupies the caller's own — and is
  // checked before any mutation so a switch into a full room never unseats the caller.
  const takesNewSeat = !current || current.room.channelId !== channelId;
  const targetRoom = rooms.get(channelId);
  if (takesNewSeat && targetRoom && targetRoom.seats.size >= MAX_SEATS_PER_ROOM) {
    throw new VoiceRoomFullError();
  }

  // Same channel again: grace rebind, multi-tab steal, or a same-socket re-join (the
  // mediaReset path) — every one of them rebinds and mints, none publishes guild-wide
  // (the seat never emptied, the sidebar must not flicker). All of them redo the full
  // media ceremony, so the old peer's media closes here; a post-crash rebind also
  // rebuilds the room's router through ensureRouter before anything mutates.
  if (current && current.room.channelId === channelId) {
    const { room, seat } = current;
    await ensureRouter(room);
    const replacedSeatSessionId = seat.seatSessionId;
    const oldPeer = seat.peer;
    if (oldPeer) closePeerMedia(room, userId, oldPeer, true);
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    seat.graceTimer = null;
    seat.peer = newPeer(connectionId);
    seat.seatSessionId = crypto.randomUUID();
    // Only a DIFFERENT live socket lost its session (steal). A rebind or same-socket
    // re-join names nobody — publishing here would race the caller's own new session id.
    if (oldPeer && oldPeer.connectionId !== connectionId) {
      await publishTo([userId], {
        type: "voice.sessionReplaced",
        channelId,
        replacedSeatSessionId,
      });
    }
    await replayProducersTo(room, userId);
    return { seatSessionId: seat.seatSessionId };
  }

  // The target room (and its router) must exist before the old seat is given up, so a
  // join that cannot get a router leaves the caller exactly where they were.
  let room = rooms.get(channelId);
  if (!room) {
    room = {
      guildId,
      channelId,
      router: null,
      audioLevelObserver: null,
      routerCreating: null,
      seats: new Map(),
      speakingUserIds: new Set(),
    };
    rooms.set(channelId, room);
  }
  try {
    await ensureRouter(room);
  } catch (error) {
    if (room.seats.size === 0) rooms.delete(channelId);
    throw error;
  }

  // Seated elsewhere: implicit unseat — immediate peerLeft, no grace. Flags carry over so
  // a muted user doesn't flash unmuted in the sidebar across a switch.
  let carriedMute = false;
  let carriedDeaf = false;
  if (current) {
    const { room: oldRoom, seat: oldSeat } = current;
    carriedMute = oldSeat.selfMute;
    carriedDeaf = oldSeat.selfDeaf;
    const oldPeer = oldSeat.peer;
    const replacedSeatSessionId = oldSeat.seatSessionId;
    removeSeat(oldRoom, oldSeat);
    await publishPeerLeft(oldRoom, userId);
    // Cross-channel steal: another tab was live in the old room — tell it to tear down.
    if (oldPeer && oldPeer.connectionId !== connectionId) {
      await publishTo([userId], {
        type: "voice.sessionReplaced",
        channelId: oldRoom.channelId,
        replacedSeatSessionId,
      });
    }
  }

  const seat: Seat = {
    userId,
    seatSessionId: crypto.randomUUID(),
    selfMute: carriedMute,
    selfDeaf: carriedDeaf,
    peer: newPeer(connectionId),
    graceTimer: null,
  };
  room.seats.set(userId, seat);
  seatChannelByUser.set(userId, channelId);
  await publishGuildWide(guildId, {
    type: "voice.peerJoined",
    guildId,
    channelId,
    userId,
    selfMute: seat.selfMute,
    selfDeaf: seat.selfDeaf,
  });
  await replayProducersTo(room, userId);
  return { seatSessionId: seat.seatSessionId };
}

/** Explicit leave: immediate peerLeft, no grace. Idempotent — no seat is a no-op. */
export async function leaveVoice(userId: string): Promise<void> {
  const current = seatOf(userId);
  if (!current) return;
  removeSeat(current.room, current.seat);
  await publishPeerLeft(current.room, userId);
}

/** Flip the self-mute flag and broadcast it. Returns false when the user has no seat. */
export async function setSelfMute(userId: string, muted: boolean): Promise<boolean> {
  const current = seatOf(userId);
  if (!current) return false;
  current.seat.selfMute = muted;
  await publishGuildWide(current.room.guildId, {
    type: "voice.peerMutedSelf",
    guildId: current.room.guildId,
    channelId: current.room.channelId,
    userId,
    selfMute: muted,
  });
  return true;
}

/**
 * Flip the self-deaf flag, apply its server half — the SFU stops/resumes forwarding by
 * pausing/resuming the peer's audio consumers (#18) — and broadcast it. Video consumers
 * are untouched (visibility drives those); consumers created while deafened are already
 * paused and `setConsumersPaused` refuses to resume audio until undeafen, which is the
 * batched resume. Returns false when the user has no seat.
 */
export async function setSelfDeaf(userId: string, deafened: boolean): Promise<boolean> {
  const current = seatOf(userId);
  if (!current) return false;
  current.seat.selfDeaf = deafened;
  const peer = current.seat.peer;
  if (peer) {
    for (const consumer of peer.consumers.values()) {
      if (consumer.kind !== "audio" || consumer.closed) continue;
      // Best-effort per consumer: one closing under the loop (its producer stopped) must
      // not abort the flag flip or its broadcast.
      await (deafened ? consumer.pause() : consumer.resume()).catch(() => {});
    }
  }
  await publishGuildWide(current.room.guildId, {
    type: "voice.peerDeafenedSelf",
    guildId: current.room.guildId,
    channelId: current.room.channelId,
    userId,
    selfDeaf: deafened,
  });
  return true;
}

/**
 * The `websocket.close` hook: if the closing socket owned a peer, discard the media half
 * (the room hears producerClosed — tiles go avatar-only) and start the seat's grace.
 * Publishes nothing guild-wide — the sidebar keeps the seat.
 */
export function voiceConnectionClosed(connectionId: string, graceMs: number = GRACE_MS): void {
  for (const room of rooms.values()) {
    for (const seat of room.seats.values()) {
      if (seat.peer?.connectionId === connectionId) {
        startGrace(room, seat, graceMs, true);
        return;
      }
    }
  }
}

/**
 * SFU worker died: discard every mediasoup handle — rooms keep their seat maps with
 * `router = null`, every live peer's seat enters grace at once, and NOTHING publishes
 * (guild-wide or room-only): `voice.mediaReset` after the respawn is the recovery
 * signal. Seats already in grace keep their running timers. Routers rebuild lazily on
 * the first rejoin into each channel (#15).
 */
export function voiceWorkerDied(graceMs: number = GRACE_MS): void {
  for (const room of rooms.values()) {
    room.router = null;
    room.audioLevelObserver = null;
    room.speakingUserIds = new Set();
    for (const seat of room.seats.values()) {
      if (seat.peer) startGrace(room, seat, graceMs, false);
    }
  }
}

/**
 * SFU worker (re)spawned: tell every seated user — self-only — to redo their plumbing.
 * Their `voice.join` lands as a grace rebind; routers rebuild lazily on first join.
 */
export async function voiceWorkerRespawned(): Promise<void> {
  const publishes: Promise<void>[] = [];
  for (const room of rooms.values()) {
    for (const seat of room.seats.values()) {
      publishes.push(
        publishTo([seat.userId], { type: "voice.mediaReset", channelId: room.channelId }),
      );
    }
  }
  await Promise.all(publishes);
}

/**
 * The `voice.snapshot` payload for one subscriber: every occupied voice channel in their
 * guilds, read off the in-memory maps at subscribe time (presence precedent), speaking
 * set included so cold loads render mid-monologue rings.
 */
export async function voiceSnapshotFor(
  userId: string,
): Promise<Extract<RealtimeEvent, { type: "voice.snapshot" }>["rooms"]> {
  const guildIds = new Set((await listUserGuilds(userId)).map((guild) => guild.id));
  const snapshot: Extract<RealtimeEvent, { type: "voice.snapshot" }>["rooms"] = [];
  for (const room of rooms.values()) {
    if (!guildIds.has(room.guildId)) continue;
    snapshot.push({
      guildId: room.guildId,
      channelId: room.channelId,
      seats: [...room.seats.values()].map((seat) => ({
        userId: seat.userId,
        selfMute: seat.selfMute,
        selfDeaf: seat.selfDeaf,
      })),
      speakingUserIds: [...room.speakingUserIds],
    });
  }
  return snapshot;
}

/** Test-only: a user's live peer, for asserting server-side media state. */
export function voicePeerForTests(userId: string): Peer | null {
  return seatOf(userId)?.seat.peer ?? null;
}

/** Test-only: drop every room, cancel pending grace timers, close surviving routers. */
export function resetVoiceStateForTests(): void {
  for (const room of rooms.values()) {
    for (const seat of room.seats.values()) {
      if (seat.graceTimer) clearTimeout(seat.graceTimer);
    }
    safeClose(room.router);
  }
  rooms.clear();
  seatChannelByUser.clear();
}

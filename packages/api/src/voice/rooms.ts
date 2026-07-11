import { listGuildMemberUserIds, listUserGuilds } from "@konus-la/db";

import type { RealtimeEvent } from "../realtime/events";
import { publishTo } from "../realtime/publishers";

/**
 * In-memory voice occupancy — Room/Seat/Peer per the phase-5 spec §Domain model
 * (vocabulary in ../../CONTEXT.md). Never persisted: a restart empties every room by
 * definition, and occupancy is only ever a published view of this memory.
 *
 * Slice note: a Peer here is just the owning socket; its mediasoup half (transports,
 * producers, consumers) arrives with the media-signaling slice.
 *
 * Dev note: `bun --hot` resets this module state — rooms look empty until clients rejoin.
 */

const GRACE_MS = 30_000;

interface Peer {
  connectionId: string;
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
  seats: Map<string, Seat>;
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

/** Drop a seat and GC the room when it was the last one out. No events published here. */
function removeSeat(room: Room, seat: Seat): void {
  if (seat.graceTimer) clearTimeout(seat.graceTimer);
  seat.graceTimer = null;
  room.seats.delete(seat.userId);
  seatChannelByUser.delete(seat.userId);
  if (room.seats.size === 0) rooms.delete(room.channelId);
}

async function publishGuildWide(guildId: string, event: RealtimeEvent): Promise<void> {
  await publishTo(await listGuildMemberUserIds(guildId), event);
}

/**
 * Media half gone (socket drop or worker death): keep the seat and its flags, start the
 * grace countdown. Expiry is the involuntary leave — peerLeft fans out then, not now.
 */
function startGrace(room: Room, seat: Seat, graceMs: number): void {
  seat.peer = null;
  if (seat.graceTimer) clearTimeout(seat.graceTimer);
  seat.graceTimer = setTimeout(() => {
    seat.graceTimer = null;
    removeSeat(room, seat);
    void publishGuildWide(room.guildId, {
      type: "voice.peerLeft",
      guildId: room.guildId,
      channelId: room.channelId,
      userId: seat.userId,
    });
  }, graceMs);
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

  // Same channel again: grace rebind, multi-tab steal, or a same-socket re-join (the
  // mediaReset path) — every one of them rebinds and mints, none publishes guild-wide
  // (the seat never emptied, the sidebar must not flicker).
  if (current && current.room.channelId === channelId) {
    const { seat } = current;
    const replacedSeatSessionId = seat.seatSessionId;
    const oldPeer = seat.peer;
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    seat.graceTimer = null;
    seat.peer = { connectionId };
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
    return { seatSessionId: seat.seatSessionId };
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
    await publishGuildWide(oldRoom.guildId, {
      type: "voice.peerLeft",
      guildId: oldRoom.guildId,
      channelId: oldRoom.channelId,
      userId,
    });
    // Cross-channel steal: another tab was live in the old room — tell it to tear down.
    if (oldPeer && oldPeer.connectionId !== connectionId) {
      await publishTo([userId], {
        type: "voice.sessionReplaced",
        channelId: oldRoom.channelId,
        replacedSeatSessionId,
      });
    }
  }

  let room = rooms.get(channelId);
  if (!room) {
    room = { guildId, channelId, seats: new Map() };
    rooms.set(channelId, room);
  }
  const seat: Seat = {
    userId,
    seatSessionId: crypto.randomUUID(),
    selfMute: carriedMute,
    selfDeaf: carriedDeaf,
    peer: { connectionId },
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
  return { seatSessionId: seat.seatSessionId };
}

/** Explicit leave: immediate peerLeft, no grace. Idempotent — no seat is a no-op. */
export async function leaveVoice(userId: string): Promise<void> {
  const current = seatOf(userId);
  if (!current) return;
  removeSeat(current.room, current.seat);
  await publishGuildWide(current.room.guildId, {
    type: "voice.peerLeft",
    guildId: current.room.guildId,
    channelId: current.room.channelId,
    userId,
  });
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
 * Flip the self-deaf flag and broadcast it. Returns false when the user has no seat.
 * The server half of deafen (pausing the peer's audio consumers) lands with the media
 * slice — this slice only carries the flag.
 */
export async function setSelfDeaf(userId: string, deafened: boolean): Promise<boolean> {
  const current = seatOf(userId);
  if (!current) return false;
  current.seat.selfDeaf = deafened;
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
 * and start the seat's grace. Publishes nothing guild-wide — the sidebar keeps the seat.
 */
export function voiceConnectionClosed(connectionId: string, graceMs: number = GRACE_MS): void {
  for (const room of rooms.values()) {
    for (const seat of room.seats.values()) {
      if (seat.peer?.connectionId === connectionId) {
        startGrace(room, seat, graceMs);
        return;
      }
    }
  }
}

/**
 * SFU worker died: every live peer's media is gone, so every seat enters grace at once.
 * Seats already in grace keep their running timers; nothing publishes guild-wide.
 */
export function voiceWorkerDied(graceMs: number = GRACE_MS): void {
  for (const room of rooms.values()) {
    for (const seat of room.seats.values()) {
      if (seat.peer) startGrace(room, seat, graceMs);
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
 * guilds. Read synchronously off the maps at subscribe time (presence precedent).
 * `speakingUserIds` stays empty until the media slice wires the AudioLevelObserver.
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
      speakingUserIds: [],
    });
  }
  return snapshot;
}

/** Test-only: drop every room and cancel pending grace timers. */
export function resetVoiceStateForTests(): void {
  for (const room of rooms.values()) {
    for (const seat of room.seats.values()) {
      if (seat.graceTimer) clearTimeout(seat.graceTimer);
    }
  }
  rooms.clear();
  seatChannelByUser.clear();
}

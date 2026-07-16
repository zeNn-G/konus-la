import { env } from "@konus-la/env/server";
import type { types } from "mediasoup";

import {
  livePeerOf,
  publishRoomOnly,
  VoiceBadMediaError,
  VoiceInvalidStateError,
  VoiceNotFoundError,
  VoiceUnavailableError,
  type Peer,
  type ProducerSource,
} from "./rooms";
import { transportListenInfos } from "./sfu";

/**
 * Media signaling operations (phase-5 spec §Procedures, §Media policy) — the mediasoup
 * calls behind the `voice.*` media procedures. Every operation resolves the caller
 * through `livePeerOf`, so only the socket that owns the seat's current peer can signal
 * for it, and enforces the ceremony state machine `joined → transportCreated →
 * connected → producing` (#9): what a step needs missing = VoiceInvalidStateError.
 */

export type TransportDirection = "send" | "recv";

/** mediasoup rejects malformed caller-supplied parameters with TypeError/UnsupportedError. */
function asBadMedia(error: unknown): never {
  if (error instanceof TypeError || (error instanceof Error && error.name === "UnsupportedError")) {
    throw new VoiceBadMediaError(error.message);
  }
  throw error;
}

function requireLivePeer(userId: string, connectionId: string) {
  const current = livePeerOf(userId, connectionId);
  if (!current) {
    throw new VoiceInvalidStateError("No live voice session on this connection — join first.");
  }
  return current;
}

function requireRouter(room: { router: types.Router | null }): types.Router {
  // A live peer implies a joined room whose router was ensured; null only in the sliver
  // between a worker death and the grace that follows it.
  if (!room.router || room.router.closed) throw new VoiceUnavailableError();
  return room.router;
}

export function getRouterRtpCapabilities(
  userId: string,
  connectionId: string,
): types.RtpCapabilities {
  const { room } = requireLivePeer(userId, connectionId);
  return requireRouter(room).rtpCapabilities;
}

export async function createTransport(
  userId: string,
  connectionId: string,
  direction: TransportDirection,
): Promise<{
  id: string;
  iceParameters: types.IceParameters;
  iceCandidates: types.IceCandidate[];
  dtlsParameters: types.DtlsParameters;
}> {
  const { room, peer } = requireLivePeer(userId, connectionId);
  const router = requireRouter(room);
  if (direction === "send" ? peer.sendTransport : peer.recvTransport) {
    throw new VoiceInvalidStateError(`The ${direction} transport is already created.`);
  }
  const transport = await router.createWebRtcTransport({
    listenInfos: transportListenInfos(),
    preferUdp: true,
    appData: { userId },
  });
  if (direction === "send") {
    // Client encodings are advisory; this ceiling is authoritative (spec §Media policy).
    await transport.setMaxIncomingBitrate(env.MEDIASOUP_MAX_INCOMING_BITRATE);
    peer.sendTransport = transport;
  } else {
    peer.recvTransport = transport;
  }
  if (peer.state === "joined") peer.state = "transportCreated";
  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}

export async function connectTransport(
  userId: string,
  connectionId: string,
  transportId: string,
  dtlsParameters: types.DtlsParameters,
): Promise<void> {
  const { peer } = requireLivePeer(userId, connectionId);
  const transport = transportById(peer, transportId);
  if (!transport) throw new VoiceInvalidStateError("No such transport to connect.");
  if (peer.connectedTransportIds.has(transportId)) {
    throw new VoiceInvalidStateError("Transport is already connected.");
  }
  await transport.connect({ dtlsParameters }).catch(asBadMedia);
  peer.connectedTransportIds.add(transportId);
  if (peer.state === "transportCreated") peer.state = "connected";
}

function transportById(peer: Peer, transportId: string): types.WebRtcTransport | null {
  if (peer.sendTransport?.id === transportId) return peer.sendTransport;
  if (peer.recvTransport?.id === transportId) return peer.recvTransport;
  return null;
}

export async function produce(
  userId: string,
  connectionId: string,
  input: {
    transportId: string;
    kind: "audio" | "video";
    rtpParameters: types.RtpParameters;
    source: ProducerSource;
  },
): Promise<{ producerId: string }> {
  const { room, seat, peer } = requireLivePeer(userId, connectionId);
  if (peer.state !== "connected" && peer.state !== "producing") {
    throw new VoiceInvalidStateError("produce before the ceremony reached connected.");
  }
  if (!peer.sendTransport || peer.sendTransport.id !== input.transportId) {
    throw new VoiceInvalidStateError("produce requires the send transport.");
  }
  if (!peer.connectedTransportIds.has(input.transportId)) {
    throw new VoiceInvalidStateError("produce requires a connected send transport.");
  }
  // 1 mic + ≤1 screenAudio + ≤1 cam + ≤1 screen per peer (server-enforced). The slot is
  // reserved before the await so interleaved produces cannot both claim it.
  if (peer.sources.has(input.source)) {
    throw new VoiceInvalidStateError(`A ${input.source} producer already exists.`);
  }
  peer.sources.add(input.source);
  let producer: types.Producer;
  try {
    producer = await peer.sendTransport.produce({
      kind: input.kind,
      rtpParameters: input.rtpParameters,
      // No self-resume while server-muted (spec §Server-mute): audio — mic AND
      // screenAudio — is born paused; only mod.serverMute(false) resumes it.
      paused: input.kind === "audio" && seat.serverMuted,
      appData: { userId, source: input.source },
    });
  } catch (error) {
    peer.sources.delete(input.source);
    asBadMedia(error);
  }
  peer.producers.set(producer.id, { producer, source: input.source });
  peer.state = "producing";
  // Speaking detection is mic-only: screenAudio (movie/music) must never light a ring.
  if (
    producer.kind === "audio" &&
    input.source === "mic" &&
    room.audioLevelObserver &&
    !room.audioLevelObserver.closed
  ) {
    await room.audioLevelObserver.addProducer({ producerId: producer.id });
  }
  await publishRoomOnly(room, {
    type: "voice.producerAdded",
    channelId: room.channelId,
    userId,
    producerId: producer.id,
    kind: producer.kind,
    source: input.source,
  });
  return { producerId: producer.id };
}

export async function closeProducer(
  userId: string,
  connectionId: string,
  producerId: string,
): Promise<void> {
  const { room, peer } = requireLivePeer(userId, connectionId);
  const entry = peer.producers.get(producerId);
  if (!entry) throw new VoiceNotFoundError("No such producer of yours.");
  entry.producer.close(); // consumers of it close via their 'producerclose' listeners
  peer.producers.delete(producerId);
  peer.sources.delete(entry.source);
  await publishRoomOnly(room, {
    type: "voice.producerClosed",
    channelId: room.channelId,
    userId,
    producerId,
  });
}

export async function consume(
  userId: string,
  connectionId: string,
  producerId: string,
  rtpCapabilities: types.RtpCapabilities,
): Promise<{
  consumerId: string;
  producerId: string;
  kind: "audio" | "video";
  rtpParameters: types.RtpParameters;
}> {
  const { room, peer } = requireLivePeer(userId, connectionId);
  // mediasoup-client connects the recv transport lazily on its FIRST consume, so unlike
  // produce, consume must be legal on a created-but-not-yet-connected transport.
  const recvTransport = peer.recvTransport;
  if (!recvTransport) throw new VoiceInvalidStateError("consume requires a recv transport.");
  if (!producerInRoom(room, producerId)) {
    throw new VoiceNotFoundError("No such producer in this room.");
  }
  const router = requireRouter(room);
  if (!router.canConsume({ producerId, rtpCapabilities })) {
    throw new VoiceBadMediaError("Cannot consume this producer with the given rtpCapabilities.");
  }
  const consumer = await recvTransport
    .consume({ producerId, rtpCapabilities, paused: true, appData: { userId } })
    .catch(asBadMedia);
  peer.consumers.set(consumer.id, consumer);
  consumer.on("producerclose", () => {
    peer.consumers.delete(consumer.id);
  });
  return {
    consumerId: consumer.id,
    producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  };
}

function producerInRoom(
  room: { seats: Map<string, { peer: Peer | null }> },
  producerId: string,
): boolean {
  for (const seat of room.seats.values()) {
    if (seat.peer?.producers.has(producerId)) return true;
  }
  return false;
}

/**
 * Batched pause/resume (#18) — deafen's sibling and the visibility policy's verb. Acts
 * only on the caller's own consumers; ids that don't name one are SKIPPED rather than
 * rejected — a consumer closing under an in-flight batch (its producer stopped) is a
 * normal race, and erroring would shove the client into its rejoin path. Resuming audio
 * while self-deafened is refused — undeafen is the batched resume. No broadcast.
 */
export async function setConsumersPaused(
  userId: string,
  connectionId: string,
  consumerIds: string[],
  paused: boolean,
): Promise<void> {
  const { seat, peer } = requireLivePeer(userId, connectionId);
  for (const consumerId of consumerIds) {
    const consumer = peer.consumers.get(consumerId);
    if (!consumer || consumer.closed) continue;
    if (paused) {
      await consumer.pause();
    } else if (consumer.kind !== "audio" || !seat.selfDeaf) {
      await consumer.resume();
    }
  }
}

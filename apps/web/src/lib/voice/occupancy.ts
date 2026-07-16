import type { RealtimeEvent } from "@konus-la/api";
import { useQuery } from "@tanstack/react-query";

/**
 * Tier 1 of the voice split (phase-5 spec §Client architecture): guild-wide occupancy —
 * who sits where, flags, speaking set — in ONE client-only Query key, fed exclusively by
 * the realtime dispatcher (the presence pattern). There is no fetch path: socket-connected
 * ⇔ occupancy-correct, and every resubscription's `voice.snapshot` resets the map.
 * mediasoup/tier-2 state never touches this cache.
 */

export type VoiceSeatInfo = { selfMute: boolean; selfDeaf: boolean; serverMuted: boolean };

export type VoiceRoomOccupancy = {
  guildId: string;
  /** Seat map keyed by userId — names/avatars come from existing member caches. */
  seats: Record<string, VoiceSeatInfo>;
  speakingUserIds: string[];
};

/** Occupied voice channels by channelId. Absent channel = empty room. */
export type VoiceOccupancyMap = Record<string, VoiceRoomOccupancy>;

export const VOICE_OCCUPANCY_KEY = ["realtime", "voice-occupancy"] as const;

/**
 * The two deletion events sit in here rather than in the dispatcher so the cleanup stays pure
 * and unit-testable — and so a bystander watching a room they are not in stops seeing its
 * ghosts. A deleted room's occupants are gone server-side; nothing else would ever say so.
 */
export type VoiceOccupancyEvent = Extract<
  RealtimeEvent,
  {
    type:
      | "voice.snapshot"
      | "voice.peerJoined"
      | "voice.peerLeft"
      | "voice.peerMutedSelf"
      | "voice.peerDeafenedSelf"
      | "voice.serverMuteSet"
      | "voice.activeSpeakers"
      | "channel.deleted"
      | "guild.deleted";
  }
>;

/**
 * Pure event → map reducer the dispatcher applies via setQueryData. Unknown rooms/seats
 * are no-ops: a race against snapshot replacement must never crash the dispatcher.
 */
export function reduceVoiceOccupancy(
  old: VoiceOccupancyMap | undefined,
  event: VoiceOccupancyEvent,
): VoiceOccupancyMap {
  const map = old ?? {};
  switch (event.type) {
    case "voice.snapshot": {
      return Object.fromEntries(
        event.rooms.map((room) => [
          room.channelId,
          {
            guildId: room.guildId,
            seats: Object.fromEntries(
              room.seats.map((seat) => [
                seat.userId,
                {
                  selfMute: seat.selfMute,
                  selfDeaf: seat.selfDeaf,
                  serverMuted: seat.serverMuted,
                },
              ]),
            ),
            speakingUserIds: room.speakingUserIds,
          },
        ]),
      );
    }
    case "voice.peerJoined": {
      const room = map[event.channelId] ?? {
        guildId: event.guildId,
        seats: {},
        speakingUserIds: [],
      };
      return {
        ...map,
        [event.channelId]: {
          ...room,
          seats: {
            ...room.seats,
            [event.userId]: {
              selfMute: event.selfMute,
              selfDeaf: event.selfDeaf,
              serverMuted: event.serverMuted,
            },
          },
        },
      };
    }
    case "voice.peerLeft": {
      const room = map[event.channelId];
      if (!room?.seats[event.userId]) return map;
      const { [event.userId]: _gone, ...seats } = room.seats;
      if (Object.keys(seats).length === 0) {
        const { [event.channelId]: _room, ...rest } = map;
        return rest;
      }
      return {
        ...map,
        [event.channelId]: {
          ...room,
          seats,
          speakingUserIds: room.speakingUserIds.filter((userId) => userId !== event.userId),
        },
      };
    }
    case "voice.peerMutedSelf":
    case "voice.peerDeafenedSelf": {
      const seat = map[event.channelId]?.seats[event.userId];
      if (!seat) return map;
      const patch =
        event.type === "voice.peerMutedSelf"
          ? { selfMute: event.selfMute }
          : { selfDeaf: event.selfDeaf };
      const room = map[event.channelId]!;
      return {
        ...map,
        [event.channelId]: {
          ...room,
          seats: { ...room.seats, [event.userId]: { ...seat, ...patch } },
        },
      };
    }
    case "voice.serverMuteSet": {
      // channelId null = target unseated: nothing to patch here — the dispatcher
      // invalidates guild.get for that flavor.
      if (event.channelId === null) return map;
      const seat = map[event.channelId]?.seats[event.userId];
      if (!seat) return map;
      const room = map[event.channelId]!;
      return {
        ...map,
        [event.channelId]: {
          ...room,
          seats: {
            ...room.seats,
            [event.userId]: { ...seat, serverMuted: event.serverMuted },
          },
        },
      };
    }
    case "voice.activeSpeakers": {
      const room = map[event.channelId];
      if (!room) return map;
      return { ...map, [event.channelId]: { ...room, speakingUserIds: event.speakingUserIds } };
    }
    case "channel.deleted": {
      // The room died with the channel. A text channel simply isn't in the map.
      if (!map[event.channelId]) return map;
      const { [event.channelId]: _gone, ...rest } = map;
      return rest;
    }
    case "guild.deleted": {
      // The guild took its channels — and their rooms — with it.
      const entries = Object.entries(map).filter(([, room]) => room.guildId !== event.guildId);
      if (entries.length === Object.keys(map).length) return map;
      return Object.fromEntries(entries);
    }
  }
}

/**
 * A user's seat anywhere in one guild; undefined = not in voice there. One seat per user
 * instance-wide (ADR 0007), so the first hit is the only hit. For seated users this is
 * fresher than `guild.get`'s member rows — `voice.serverMuteSet` patches it in place.
 */
export function useGuildVoiceSeat(guildId: string, userId: string): VoiceSeatInfo | undefined {
  const { data } = useQuery({
    queryKey: VOICE_OCCUPANCY_KEY,
    queryFn: () => ({}) as VoiceOccupancyMap,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    select: (map) =>
      Object.values(map).find((room) => room.guildId === guildId && room.seats[userId])?.seats[
        userId
      ],
  });
  return data;
}

/** One channel's occupancy; undefined = nobody seated there. */
export function useVoiceOccupancy(channelId: string): VoiceRoomOccupancy | undefined {
  const { data } = useQuery({
    queryKey: VOICE_OCCUPANCY_KEY,
    queryFn: () => ({}) as VoiceOccupancyMap,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    select: (map) => map[channelId],
  });
  return data;
}

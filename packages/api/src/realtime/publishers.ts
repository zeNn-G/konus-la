import { listChannelParticipantUserIds, listGuildMemberUserIds } from "@konus-la/db";

import type { RealtimeEvent } from "./events";
import { publisher } from "./publisher";

/**
 * Fan an event out to each recipient's personal topic. Publishing to a user with no open
 * subscription is a no-op on the in-process bus, so callers pass the FULL recipient set
 * (e.g. all guild members) without filtering by who's online.
 */
export async function publishTo(userIds: Iterable<string>, event: RealtimeEvent): Promise<void> {
  const publishes: Promise<void>[] = [];
  for (const userId of userIds) {
    publishes.push(publisher.publish(`user:${userId}`, event));
  }
  await Promise.all(publishes);
}

/** The recipient set of a channel's events: guild members, or DM participants when guild-less. */
export async function channelRecipientUserIds(channel: {
  id: string;
  guildId: string | null;
}): Promise<string[]> {
  return channel.guildId
    ? listGuildMemberUserIds(channel.guildId)
    : listChannelParticipantUserIds(channel.id);
}

import type { RealtimeEvent } from "@konus-la/api";
import type { AppRouterClient } from "@konus-la/api/routers/index";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { invalidateDmConversation } from "@/lib/dm";
import {
  reduceVoiceOccupancy,
  VOICE_OCCUPANCY_KEY,
  type VoiceOccupancyMap,
} from "@/lib/voice/occupancy";
import { voiceSession } from "@/lib/voice/session";
import { getWs } from "@/lib/ws";
import { orpc, queryClient } from "@/utils/orpc";

export type HistoryPage = Awaited<ReturnType<AppRouterClient["chat"]["history"]>>;
export type ChatMessage = HistoryPage["messages"][number];
export type ChannelListItem = Awaited<ReturnType<AppRouterClient["channel"]["list"]>>[number];
export type DmListItem = Awaited<ReturnType<AppRouterClient["dm"]["list"]>>[number];

export type TypingEntry = {
  userId: string;
  username: string;
  displayName: string;
  expiresAt: number;
};

/** Client-only cache keys — no fetcher behind them; the realtime dispatcher writes them. */
export const PRESENCE_KEY = ["realtime", "presence"] as const;
export const typingQueryKey = (channelId: string) => ["realtime", "typing", channelId] as const;
/**
 * Tombstone set when THIS user leaves / is removed from a DM. The mounted conversation
 * view watches it, navigates away, and only then cleans the caches — invalidating or
 * removing them while the view is still mounted refires the queries as a non-participant
 * and every one comes back as a FORBIDDEN toast.
 */
export const dmEvictedKey = (channelId: string) => ["realtime", "dm-evicted", channelId] as const;
/**
 * Same contract for guilds: set when THIS user is kicked / banned / leaves. The guild
 * layout route watches it, navigates home, and only then cleans the guild's caches.
 */
export const guildEvictedKey = (guildId: string) => ["realtime", "guild-evicted", guildId] as const;

const historyInput = (channelId: string) => (pageParam: string | undefined) =>
  pageParam ? { channelId, before: pageParam } : { channelId };

/**
 * The one true shape of a channel's history cache. The channel view and the realtime
 * dispatcher MUST both build keys through these helpers, or setQueryData misses.
 */
export function historyInfiniteOptions(channelId: string) {
  return orpc.chat.history.infiniteOptions({
    input: historyInput(channelId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function historyInfiniteKey(channelId: string) {
  return orpc.chat.history.infiniteKey({
    input: historyInput(channelId),
    initialPageParam: undefined as string | undefined,
  });
}

export type HistoryCache = InfiniteData<HistoryPage, string | undefined>;

function patchHistory(
  client: QueryClient,
  channelId: string,
  patch: (pages: HistoryPage[]) => HistoryPage[],
) {
  client.setQueryData<HistoryCache>(historyInfiniteKey(channelId), (old) =>
    old ? { ...old, pages: patch(old.pages) } : old,
  );
}

/**
 * Collapse a channel's history cache to the newest `keep` messages as one synthetic page.
 * Call only while the reader sits at the live edge — dropping pages under a reader who
 * scrolled up would yank their position. Dropped messages imply older history exists, and
 * the server pages `WHERE id < before`, so the oldest kept id is a gap-free cursor.
 */
export function trimHistory(client: QueryClient, channelId: string, keep: number) {
  client.setQueryData<HistoryCache>(historyInfiniteKey(channelId), (old) => {
    if (!old) return old;
    const all = old.pages.flatMap((page) => page.messages); // newest-first
    const oldestKept = all.at(keep - 1);
    if (all.length <= keep || !oldestKept) return old;
    return {
      pages: [{ messages: all.slice(0, keep), nextCursor: oldestKept.id }],
      pageParams: [undefined],
    };
  });
}

function patchChannelLists(
  client: QueryClient,
  channelId: string,
  patch: (channel: ChannelListItem) => ChannelListItem,
) {
  // Partial key match: touches every guild's channel.list cache; only rows for
  // `channelId` change, so foreign guilds are no-ops.
  client.setQueriesData<ChannelListItem[]>({ queryKey: orpc.channel.list.key() }, (old) =>
    old?.map((channel) => (channel.id === channelId ? patch(channel) : channel)),
  );
}

/** The dm.list analog of patchChannelLists — one input-less cache, keyed rows. */
function patchDmList(
  client: QueryClient,
  channelId: string,
  patch: (row: DmListItem) => DmListItem,
) {
  client.setQueriesData<DmListItem[]>({ queryKey: orpc.dm.list.key() }, (old) =>
    old?.map((row) => (row.id === channelId ? patch(row) : row)),
  );
}

/** True when the dm.list cache exists and already carries this conversation. */
function dmListHasChannel(client: QueryClient, channelId: string): boolean {
  return client
    .getQueriesData<DmListItem[]>({ queryKey: orpc.dm.list.key() })
    .some(([, rows]) => rows?.some((row) => row.id === channelId));
}

function dispatch(client: QueryClient, selfUserId: string, event: RealtimeEvent) {
  switch (event.type) {
    case "presence.snapshot": {
      client.setQueryData<Record<string, boolean>>(
        PRESENCE_KEY,
        Object.fromEntries(event.onlineUserIds.map((id) => [id, true])),
      );
      break;
    }
    case "presence.update": {
      client.setQueryData<Record<string, boolean>>(PRESENCE_KEY, (old = {}) => {
        const next = { ...old };
        if (event.online) next[event.userId] = true;
        else delete next[event.userId];
        return next;
      });
      break;
    }
    case "typing": {
      client.setQueryData<TypingEntry[]>(typingQueryKey(event.channelId), (old = []) => [
        ...old.filter((entry) => entry.userId !== event.userId),
        {
          userId: event.userId,
          username: event.username,
          displayName: event.displayName,
          expiresAt: event.expiresAt,
        },
      ]);
      break;
    }
    case "message.created": {
      const { message } = event;
      patchHistory(client, message.channelId, (pages) => {
        if (pages.some((page) => page.messages.some((m) => m.id === message.id))) return pages;
        const [newest, ...older] = pages;
        if (!newest) return pages;
        return [{ ...newest, messages: [message, ...newest.messages] }, ...older];
      });
      const fromSelf = message.author.id === selfUserId;
      patchChannelLists(client, message.channelId, (channel) => ({
        ...channel,
        newestMessageId: message.id,
        // The open-channel view immediately marks read (and locally patches back to false).
        unread: fromSelf ? channel.unread : true,
        mentionsCount:
          channel.mentionsCount + (event.mentionedUserIds.includes(selfUserId) ? 1 : 0),
      }));
      if (event.guildId === null) {
        if (dmListHasChannel(client, message.channelId)) {
          patchDmList(client, message.channelId, (row) => ({
            ...row,
            newestMessageId: message.id,
            unread: fromSelf ? row.unread : true,
            mentionsCount: row.mentionsCount + (event.mentionedUserIds.includes(selfUserId) ? 1 : 0),
            lastActivityAt: message.createdAt.getTime(),
          }));
        } else {
          // First message of a fresh 1:1 (or a group we were just added to) — the row
          // doesn't exist yet, only the server can build it.
          void client.invalidateQueries({ queryKey: orpc.dm.list.key() });
        }
      }
      // A delivered message beats the typing indicator's 5s expiry.
      client.setQueryData<TypingEntry[]>(typingQueryKey(message.channelId), (old = []) =>
        old.filter((entry) => entry.userId !== message.author.id),
      );
      break;
    }
    case "message.updated": {
      patchHistory(client, event.channelId, (pages) =>
        pages.map((page) => ({
          ...page,
          messages: page.messages.map((m) =>
            m.id === event.messageId
              ? { ...m, content: event.content, editedAt: event.editedAt }
              : m,
          ),
        })),
      );
      break;
    }
    case "message.deleted": {
      patchHistory(client, event.channelId, (pages) =>
        pages.map((page) => ({
          ...page,
          messages: page.messages
            .filter((m) => m.id !== event.messageId)
            .map((m) => (m.replyTo?.id === event.messageId ? { ...m, replyTo: null } : m)),
        })),
      );
      break;
    }
    case "readState.updated": {
      // Another tab/device of THIS user read the channel. The event carries no guildId, so
      // patch both lists — the row is keyed, the wrong list is a no-op.
      patchChannelLists(client, event.channelId, (channel) => ({
        ...channel,
        unread:
          channel.newestMessageId !== null && event.lastReadMessageId < channel.newestMessageId,
        mentionsCount: event.mentionsCount,
      }));
      patchDmList(client, event.channelId, (row) => ({
        ...row,
        unread: row.newestMessageId !== null && event.lastReadMessageId < row.newestMessageId,
        mentionsCount: event.mentionsCount,
      }));
      break;
    }
    case "channel.created":
    case "channel.updated": {
      // Structural, low-frequency → refetch the sidebar. Null guildId = a DM (group
      // created / renamed): refresh the DM list and the open conversation's roster.
      if (event.guildId === null) {
        void invalidateDmConversation(client, event.channel.id);
      } else {
        void client.invalidateQueries({ queryKey: orpc.channel.list.key() });
      }
      break;
    }
    case "channel.deleted": {
      void client.invalidateQueries({ queryKey: orpc.channel.list.key() });
      break;
    }
    case "guild.member.added": {
      if (event.userId === selfUserId) {
        // Rejoined (possibly after an earlier eviction): clear the tombstone so the guild
        // layout doesn't bounce us back out, and refresh the rail in other tabs.
        client.removeQueries({ queryKey: guildEvictedKey(event.guildId) });
        void client.invalidateQueries({ queryKey: orpc.guild.list.key() });
      }
      void client.invalidateQueries({
        queryKey: orpc.guild.get.key({ input: { guildId: event.guildId } }),
      });
      break;
    }
    case "guild.member.removed": {
      if (event.userId === selfUserId) {
        // Kicked, banned, or left — drop the rail row and raise the tombstone. The guild
        // layout (if mounted) navigates home and cleans the caches AFTER unmounting;
        // touching guild.get/channel.list here would refetch them as a non-member and
        // toast FORBIDDEN.
        client.setQueriesData<Array<{ id: string }>>({ queryKey: orpc.guild.list.key() }, (old) =>
          old?.filter((g) => g.id !== event.guildId),
        );
        client.setQueryData(guildEvictedKey(event.guildId), true);
      } else {
        void client.invalidateQueries({
          queryKey: orpc.guild.get.key({ input: { guildId: event.guildId } }),
        });
      }
      break;
    }
    case "guild.updated": {
      // Structural (today: ownership transfer) — re-read the header/roster/viewer flags:
      // the new owner gains the settings entry, the old owner's open modal closes.
      void client.invalidateQueries({
        queryKey: orpc.guild.get.key({ input: { guildId: event.guildId } }),
      });
      break;
    }
    case "guild.deleted": {
      // Gone for everyone — same eviction as guild.member.removed's own-user branch:
      // drop the rail row and let the guild layout navigate out before any cache cleanup.
      client.setQueriesData<Array<{ id: string }>>({ queryKey: orpc.guild.list.key() }, (old) =>
        old?.filter((g) => g.id !== event.guildId),
      );
      client.setQueryData(guildEvictedKey(event.guildId), true);
      break;
    }
    case "voice.snapshot":
    case "voice.peerJoined":
    case "voice.peerLeft":
    case "voice.peerMutedSelf":
    case "voice.peerDeafenedSelf":
    case "voice.activeSpeakers": {
      // Tier 1: guild-wide occupancy — pure reducer over one client-only key.
      client.setQueryData<VoiceOccupancyMap>(VOICE_OCCUPANCY_KEY, (old) =>
        reduceVoiceOccupancy(old, event),
      );
      break;
    }
    case "voice.producerAdded":
    case "voice.producerClosed": {
      // Room-only producer churn includes our OWN producers (publishRoomOnly fans out to
      // every seat) — consuming yourself would be an echo loop, so filter here.
      if (event.userId !== selfUserId) voiceSession.handleRealtimeEvent(event);
      break;
    }
    case "voice.sessionReplaced":
    case "voice.mediaReset": {
      voiceSession.handleRealtimeEvent(event);
      break;
    }
    case "dm.participant.added": {
      if (event.userId === selfUserId) {
        // Re-added after an earlier eviction: drop the tombstone or the view would
        // bounce us straight back out.
        client.removeQueries({ queryKey: dmEvictedKey(event.channelId) });
      }
      void invalidateDmConversation(client, event.channelId);
      break;
    }
    case "dm.participant.removed": {
      if (event.userId === selfUserId) {
        // We left or were removed — drop the sidebar row and raise the tombstone. The
        // conversation view (if mounted) navigates away and cleans the caches AFTER
        // unmounting; touching dm.get/history here would refetch them as a
        // non-participant and toast FORBIDDEN.
        client.setQueriesData<DmListItem[]>({ queryKey: orpc.dm.list.key() }, (old) =>
          old?.filter((row) => row.id !== event.channelId),
        );
        client.setQueryData(dmEvictedKey(event.channelId), true);
      } else {
        void invalidateDmConversation(client, event.channelId);
      }
      break;
    }
  }
}

/**
 * The single realtime subscription. Mount ONCE in the authenticated layout.
 *
 * One reconnecting WebSocket carries one `realtime.events` iterator; every event is
 * dispatched into the query cache (`setQueryData` for high-frequency, `invalidateQueries`
 * for structural). Reconnects re-subscribe and — because a missed-events gap beyond the
 * server's 2-minute resume retention is silent — conservatively invalidate everything.
 */
export function useRealtime(selfUserId: string) {
  useEffect(() => {
    const { client: wsClient } = getWs();
    const controller = new AbortController();

    void (async () => {
      let reconnecting = false;
      while (!controller.signal.aborted) {
        try {
          const iterator = await wsClient.realtime.events(undefined, {
            signal: controller.signal,
          });
          if (reconnecting) void queryClient.invalidateQueries();
          reconnecting = true;
          for await (const event of iterator) {
            dispatch(queryClient, selfUserId, event);
          }
        } catch {
          // Socket drop / server restart — partysocket reconnects underneath; retry the call.
        }
        if (controller.signal.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    })();

    // Abort only the subscription — the socket is the shared signaling channel (ws.ts)
    // and outlives any one mount.
    return () => {
      controller.abort();
    };
  }, [selfUserId]);
}

/** Online userIds map, fed by presence.snapshot/update. Own user is always "online" locally. */
export function usePresence(): Record<string, boolean> {
  const { data } = useQuery({
    queryKey: PRESENCE_KEY,
    queryFn: () => ({}) as Record<string, boolean>,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
  return data ?? {};
}

/** Live typing entries for one channel; the component filters by `expiresAt` on a tick. */
export function useTypingEntries(channelId: string): TypingEntry[] {
  const { data } = useQuery({
    queryKey: typingQueryKey(channelId),
    queryFn: () => [] as TypingEntry[],
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
  return data ?? [];
}

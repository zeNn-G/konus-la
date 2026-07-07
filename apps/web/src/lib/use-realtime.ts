import type { RealtimeEvent } from "@konus-la/api";
import type { AppRouterClient } from "@konus-la/api/routers/index";
import { env } from "@konus-la/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import ReconnectingWebSocket from "partysocket/ws";
import { useEffect } from "react";

import { orpc, queryClient } from "@/utils/orpc";

export type HistoryPage = Awaited<ReturnType<AppRouterClient["chat"]["history"]>>;
export type ChatMessage = HistoryPage["messages"][number];
export type ChannelListItem = Awaited<ReturnType<AppRouterClient["channel"]["list"]>>[number];

export type TypingEntry = {
  userId: string;
  username: string;
  displayName: string;
  expiresAt: number;
};

/** Client-only cache keys — no fetcher behind them; the realtime dispatcher writes them. */
export const PRESENCE_KEY = ["realtime", "presence"] as const;
export const typingQueryKey = (channelId: string) => ["realtime", "typing", channelId] as const;

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
      // Another tab/device of THIS user read the channel.
      patchChannelLists(client, event.channelId, (channel) => ({
        ...channel,
        unread:
          channel.newestMessageId !== null && event.lastReadMessageId < channel.newestMessageId,
        mentionsCount: event.mentionsCount,
      }));
      break;
    }
    case "channel.created":
    case "channel.updated":
    case "channel.deleted": {
      // Structural, low-frequency → refetch the sidebar.
      void client.invalidateQueries({ queryKey: orpc.channel.list.key() });
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
    const socket = new ReconnectingWebSocket(
      `${env.VITE_SERVER_URL.replace(/^http/, "ws")}/ws`,
      undefined,
      { maxRetries: Number.POSITIVE_INFINITY },
    );
    // partysocket types readyState as plain `number`; structurally it's a WebSocket.
    const link = new RPCLink({ websocket: socket as unknown as WebSocket });
    const wsClient: AppRouterClient = createORPCClient(link);
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

    return () => {
      controller.abort();
      socket.close();
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

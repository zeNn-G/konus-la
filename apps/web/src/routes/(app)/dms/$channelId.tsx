import { Avatar } from "@konus-la/ui/components/avatar";
import { MessageScrollerProvider } from "@konus-la/ui/components/message-scroller";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import { TypingLine } from "@/components/chat/typing-line";
import { GroupHeaderMenu } from "@/components/dm/group-header-menu";
import { GroupMembersPopover } from "@/components/dm/group-members-popover";
import { PresenceAvatar } from "@/components/presence-avatar";
import { dmDisplayName } from "@/lib/dm";
import type { ChatMessage, DmListItem, HistoryCache } from "@/lib/use-realtime";
import { dmEvictedKey, historyInfiniteKey, typingQueryKey, usePresence } from "@/lib/use-realtime";
import { orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/(app)/dms/$channelId")({
  component: DmChannelView,
});

function DmChannelView() {
  const { channelId } = Route.useParams();
  const { session } = Route.useRouteContext();
  const navigate = useNavigate();
  const presence = usePresence();

  // Existence + roster come from dm.get, NOT dm.list — a just-created 1:1 isn't in the
  // list yet (empty conversations are filtered).
  const dm = useQuery(orpc.dm.get.queryOptions({ input: { channelId }, retry: false }));
  const dms = useQuery(orpc.dm.list.queryOptions());
  const listRow = dms.data?.find((row) => row.id === channelId);

  // Set by the dispatcher when we leave / are removed. Leaving first and cleaning after
  // is load-bearing: refetching dm.get/history while still mounted → FORBIDDEN toasts.
  const evicted = useQuery({
    queryKey: dmEvictedKey(channelId),
    queryFn: () => false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);

  useEffect(() => {
    // dm.get erroring (FORBIDDEN/NOT_FOUND) is the fallback eviction signal — e.g. a
    // direct URL to a conversation you're not in, or a removal missed while offline.
    if (!evicted.data && !dm.isError) return;
    void navigate({ to: "/" }).then(() => {
      queryClient.removeQueries({ queryKey: historyInfiniteKey(channelId) });
      queryClient.removeQueries({ queryKey: typingQueryKey(channelId) });
      queryClient.removeQueries({ queryKey: orpc.dm.get.key({ input: { channelId } }) });
      queryClient.removeQueries({ queryKey: dmEvictedKey(channelId) });
    });
  }, [evicted.data, dm.isError, navigate, channelId]);

  const markRead = useMutation(
    orpc.channel.markRead.mutationOptions({
      onSuccess: (_, variables) => {
        // The confirmation event only reaches OTHER tabs — patch this one directly.
        queryClient.setQueriesData<DmListItem[]>({ queryKey: orpc.dm.list.key() }, (old) =>
          old?.map((row) =>
            row.id === variables.channelId ? { ...row, unread: false, mentionsCount: 0 } : row,
          ),
        );
      },
    }),
  );

  // Same watermark policy as the guild channel view: advance on open, on new messages
  // while focused, and when focus returns; skip your own just-sent newest.
  const newestMessageId = listRow?.newestMessageId ?? null;
  const selfUserId = session.user.id;
  useEffect(() => {
    if (!newestMessageId) return;
    const mark = () => {
      if (!document.hasFocus()) return;
      const newest = queryClient.getQueryData<HistoryCache>(historyInfiniteKey(channelId))
        ?.pages[0]?.messages[0];
      if (newest?.id === newestMessageId && newest.author.id === selfUserId) return;
      markRead.mutate({ channelId, messageId: newestMessageId });
    };
    mark();
    window.addEventListener("focus", mark);
    return () => window.removeEventListener("focus", mark);
  }, [newestMessageId, channelId, selfUserId]);

  useEffect(() => setReplyTo(null), [channelId]);

  const participants = dm.data?.participants;
  const memberUsernames = useMemo(
    () => new Set((participants ?? []).map((p) => p.username).filter((u): u is string => !!u)),
    [participants],
  );
  const mentionMembers = useMemo(
    () =>
      (participants ?? []).flatMap((p) =>
        p.username && p.userId !== selfUserId
          ? [{ username: p.username, displayName: p.displayName || p.username, image: p.image }]
          : [],
      ),
    [participants, selfUserId],
  );

  if (!dm.data) return null;

  const title = dmDisplayName(dm.data, selfUserId);
  const other = dm.data.isGroup
    ? undefined
    : dm.data.participants.find((p) => p.userId !== selfUserId);
  const online = other ? presence[other.userId] === true : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-foreground/10 px-4 py-2">
        {other && (
          <PresenceAvatar
            seed={other.username ?? other.userId}
            src={other.image}
            online={online}
          />
        )}
        <h1 className="truncate text-sm font-medium">{title}</h1>
        {other?.username && (
          <span className="text-xs text-muted-foreground">@{other.username}</span>
        )}
        {dm.data.isGroup && (
          <div className="ml-auto flex items-center gap-0.5">
            <GroupMembersPopover dm={dm.data} selfUserId={selfUserId} />
            <GroupHeaderMenu dm={dm.data} />
          </div>
        )}
      </header>

      <MessageScrollerProvider key={channelId} autoScroll defaultScrollPosition="end">
        <MessageList
          channelId={channelId}
          channelName={title}
          selfUserId={selfUserId}
          isGuildOwner={false}
          memberUsernames={memberUsernames}
          onReply={setReplyTo}
          emptyState={
            other
              ? {
                  icon: (
                    <Avatar
                      seed={other.username ?? other.userId}
                      src={other.image}
                      className="size-14"
                    />
                  ),
                  title,
                  description: `This is the very beginning of your conversation with @${other.username ?? other.userId}.`,
                }
              : {
                  icon: <UsersIcon className="size-10 text-muted-foreground" />,
                  title,
                  description: "This is the very beginning of the group. Say hi!",
                }
          }
          historyStartLabel="This is the very beginning of the conversation."
        />

        <TypingLine channelId={channelId} />
        <Composer
          channelId={channelId}
          channelName={title}
          placeholder={`Message ${title}`}
          members={mentionMembers}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
        />
      </MessageScrollerProvider>
    </div>
  );
}

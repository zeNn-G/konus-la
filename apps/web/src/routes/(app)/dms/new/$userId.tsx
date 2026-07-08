import { Avatar } from "@konus-la/ui/components/avatar";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@konus-la/ui/components/empty";
import { MessageScrollerProvider } from "@konus-la/ui/components/message-scroller";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { Composer } from "@/components/chat/composer";
import { findDmWith } from "@/lib/dm";
import { client, orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/(app)/dms/new/$userId")({
  component: DmDraftView,
});

/**
 * Teams-style draft: no channel exists yet. The first successful send opens the 1:1
 * (idempotent server-side) and sends into it, then navigation lands in the real view.
 */
function DmDraftView() {
  const { userId } = Route.useParams();
  const { session } = Route.useRouteContext();
  const navigate = useNavigate();

  const target = useQuery(orpc.user.get.queryOptions({ input: { userId }, retry: false }));
  const dms = useQuery(orpc.dm.list.queryOptions());

  // Drafting with yourself or a ghost makes no sense.
  useEffect(() => {
    if (userId === session.user.id || target.isError) void navigate({ to: "/" });
  }, [userId, session.user.id, target.isError, navigate]);

  // If a 1:1 with them materializes (they messaged us first, or another tab sent), jump in.
  const existing = findDmWith(dms.data, userId);
  useEffect(() => {
    if (existing) {
      void navigate({ to: "/dms/$channelId", params: { channelId: existing.id } });
    }
  }, [existing, navigate]);

  if (!target.data) return null;

  const username = target.data.username ?? target.data.id;
  const name = target.data.displayName || username;

  const sendFirst = async ({ content }: { content: string }) => {
    const opened = await client.dm.openWithUser({ userId });
    await client.chat.sendMessage({ channelId: opened.channelId, content });
    await queryClient.invalidateQueries({ queryKey: orpc.dm.list.key() });
    await navigate({ to: "/dms/$channelId", params: { channelId: opened.channelId } });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-foreground/10 px-4 py-2">
        <Avatar seed={username} src={target.data.image} className="size-6" />
        <h1 className="truncate text-sm font-medium">{name}</h1>
        <span className="text-xs text-muted-foreground">@{username}</span>
      </header>

      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <Empty>
          <EmptyHeader>
            <Avatar seed={username} src={target.data.image} className="size-14" />
            <EmptyTitle>{name}</EmptyTitle>
            <EmptyDescription>
              This is the very beginning of your conversation with @{username}. Say something —
              the conversation is created when you send.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>

        <Composer
          channelId={null}
          channelName={name}
          placeholder={`Message ${name}`}
          members={[]}
          replyTo={null}
          onCancelReply={() => {}}
          onSend={sendFirst}
        />
      </MessageScrollerProvider>
    </div>
  );
}

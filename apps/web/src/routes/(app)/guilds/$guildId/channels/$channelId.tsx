import { hasPermission, PERMISSIONS } from "@konus-la/api/permissions";
import { Button } from "@konus-la/ui/components/button";
import { MessageScrollerProvider } from "@konus-la/ui/components/message-scroller";
import { Sheet, SheetContent, SheetTitle } from "@konus-la/ui/components/sheet";
import { SidebarTrigger } from "@konus-la/ui/components/sidebar";
import { useIsMobile } from "@konus-la/ui/hooks/use-mobile";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { HashIcon, UsersIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import { MembersPanel } from "@/components/members-panel";
import { TypingLine } from "@/components/chat/typing-line";
import { VoiceMiniStage } from "@/components/voice/voice-mini-stage";
import { VoiceRoom } from "@/components/voice/voice-room";
import { roleColorOf } from "@/lib/roles";
import type { ChannelListItem, ChatMessage, HistoryCache } from "@/lib/use-realtime";
import { useMembersPanelPref } from "@/lib/use-members-panel";
import { historyInfiniteKey } from "@/lib/use-realtime";
import { orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/(app)/guilds/$guildId/channels/$channelId")({
  component: ChannelView,
});

function ChannelView() {
  const { guildId, channelId } = Route.useParams();
  const { session } = Route.useRouteContext();
  const navigate = useNavigate();

  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));
  const channels = useQuery(orpc.channel.list.queryOptions({ input: { guildId } }));
  const channel = channels.data?.find((c) => c.id === channelId);

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);

  const isMobile = useIsMobile();
  const [membersPanelOpen, setMembersPanelOpen] = useMembersPanelPref();
  const [membersSheetOpen, setMembersSheetOpen] = useState(false);

  // Channel got deleted (or never existed) — bounce to the guild home.
  useEffect(() => {
    if (channels.data && !channel) {
      void navigate({ to: "/guilds/$guildId", params: { guildId } });
    }
  }, [channels.data, channel, navigate, guildId]);

  const markRead = useMutation(
    orpc.channel.markRead.mutationOptions({
      onSuccess: (_, variables) => {
        // The confirmation event only reaches OTHER tabs — patch this one directly.
        queryClient.setQueryData<ChannelListItem[]>(
          orpc.channel.list.queryOptions({ input: { guildId } }).queryKey,
          (old) =>
            old?.map((c) =>
              c.id === variables.channelId ? { ...c, unread: false, mentionsCount: 0 } : c,
            ),
        );
      },
    }),
  );

  // Advance the watermark on open, on every new message while focused, and when focus
  // returns. Own sends are skipped: sendMessage advances the watermark server-side and
  // confirms via readState.updated, so a markRead round-trip per send is pure noise.
  // Server-side the upsert is forward-only, so redundant calls are harmless.
  const newestMessageId = channel?.newestMessageId ?? null;
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

  // Reset transient state when switching channels.
  useEffect(() => {
    setReplyTo(null);
    setMembersSheetOpen(false);
  }, [channelId]);

  const members = guild.data?.members;
  const roles = guild.data?.roles;
  const authorColors = useMemo(() => {
    const colors = new Map<string, string>();
    for (const member of members ?? []) {
      const color = roleColorOf(roles ?? [], member.roleIds);
      if (color) colors.set(member.userId, color);
    }
    return colors;
  }, [members, roles]);
  const memberUsernames = useMemo(
    () => new Set((members ?? []).flatMap((member) => (member.username ? [member.username] : []))),
    [members],
  );
  const mentionMembers = useMemo(
    () =>
      (members ?? []).flatMap((member) =>
        member.username && member.userId !== selfUserId
          ? [
              {
                username: member.username,
                displayName: member.displayName || member.username,
                image: member.image,
              },
            ]
          : [],
      ),
    [members, selfUserId],
  );

  if (!channel) return null;

  // A voice channel is a place (decision #10): the room takes over the whole pane.
  if (channel.kind === "voice") {
    return <VoiceRoom guildId={guildId} channelId={channelId} channelName={channel.name ?? ""} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-1.5 border-b border-foreground/10 px-3 py-2 md:px-4 md:py-2.5">
        <SidebarTrigger className="mr-0.5 md:hidden" />
        <HashIcon className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">{channel.name}</h1>
        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto"
          aria-label="Toggle members"
          title="Members"
          onClick={() =>
            isMobile ? setMembersSheetOpen(true) : setMembersPanelOpen(!membersPanelOpen)
          }
        >
          <UsersIcon className="size-4" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* `relative` anchors the voice mini-stage to the chat column's corner. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {/* One scroller context per channel (keyed so scroll state resets on switch),
              shared with the composer so sending returns the reader to the live edge. */}
          <MessageScrollerProvider key={channelId} autoScroll defaultScrollPosition="end">
            <MessageList
              channelId={channelId}
              channelName={channel.name ?? ""}
              selfUserId={session.user.id}
              canModerate={hasPermission(
                guild.data?.viewer.permissions ?? 0,
                PERMISSIONS.MANAGE_MESSAGES,
              )}
              memberUsernames={memberUsernames}
              authorColors={authorColors}
              onReply={setReplyTo}
            />

            <TypingLine channelId={channelId} />
            <Composer
              channelId={channelId}
              channelName={channel.name ?? ""}
              members={mentionMembers}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
            />
          </MessageScrollerProvider>

          <VoiceMiniStage />
        </div>

        {membersPanelOpen && (
          <MembersPanel
            guildId={guildId}
            className="hidden w-60 shrink-0 border-l border-foreground/10 md:flex"
          />
        )}
      </div>

      <Sheet open={membersSheetOpen} onOpenChange={setMembersSheetOpen}>
        <SheetContent side="right" className="w-72">
          <SheetTitle className="sr-only">Members</SheetTitle>
          <MembersPanel guildId={guildId} className="flex min-h-0 flex-1" />
        </SheetContent>
      </Sheet>
    </div>
  );
}

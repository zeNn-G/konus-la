import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { MessageItem } from "@/components/chat/message-item";
import type { ChatMessage } from "@/lib/use-realtime";
import { historyInfiniteOptions } from "@/lib/use-realtime";

/** Same author within 5 minutes → collapse into the previous message's group. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

type Props = {
  channelId: string;
  selfUserId: string;
  isGuildOwner: boolean;
  memberUsernames: ReadonlySet<string>;
  onReply: (message: ChatMessage) => void;
};

/**
 * Cursor-paginated message column, no virtualization (v1 — plain DOM is fine at
 * friends-instance volume). Newest at the bottom; an IntersectionObserver sentinel at the
 * top pulls older pages; scroll stays pinned to the bottom unless the reader scrolled up,
 * and prepending older pages preserves the visual position.
 */
export function MessageList({
  channelId,
  selfUserId,
  isGuildOwner,
  memberUsernames,
  onReply,
}: Props) {
  const history = useInfiniteQuery(historyInfiniteOptions(channelId));

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const prependingRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const [initialScrollDone, setInitialScrollDone] = useState(false);

  // Newest-first from the server; render oldest-first.
  const messages = (history.data?.pages.flatMap((page) => page.messages) ?? []).toReversed();
  const newestId = messages.at(-1)?.id;

  // Restore the visual position when older pages were prepended above.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    const prepend = prependingRef.current;
    if (container && prepend) {
      prependingRef.current = null;
      container.scrollTop = prepend.scrollTop + (container.scrollHeight - prepend.scrollHeight);
    }
  }, [newestId, messages.length]);

  // Pin-to-bottom on ANY content growth while pinned — a ResizeObserver on the content
  // (not a one-shot on data arrival) is what keeps the initial load at the bottom even
  // as markdown/blocks finish laying out, and follows new messages thereafter.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const observer = new ResizeObserver(() => {
      if (prependingRef.current) return; // older-page restore owns this frame
      if (pinnedRef.current) {
        container.scrollTop = container.scrollHeight;
      }
      setInitialScrollDone(true);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Top sentinel → fetch older page (after the initial bottom-scroll settled).
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollRef.current;
    if (!sentinel || !container || !initialScrollDone) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && history.hasNextPage && !history.isFetchingNextPage) {
          prependingRef.current = {
            scrollHeight: container.scrollHeight,
            scrollTop: container.scrollTop,
          };
          void history.fetchNextPage();
        }
      },
      { root: container, rootMargin: "200px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [initialScrollDone, history.hasNextPage, history.isFetchingNextPage, history.fetchNextPage]);

  if (history.isPending) {
    return <div className="flex-1 px-4 py-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto pb-2"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      <div ref={contentRef}>
        <div ref={sentinelRef} />
        {!history.hasNextPage && (
          <p className="px-4 pt-6 pb-2 text-xs text-muted-foreground">
            This is the beginning of the channel.
          </p>
        )}
        {history.isFetchingNextPage && (
          <p className="px-4 py-2 text-xs text-muted-foreground">Loading older messages…</p>
        )}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const grouped =
            previous !== undefined &&
            previous.author.id === message.author.id &&
            message.replyTo === null &&
            message.createdAt.getTime() - previous.createdAt.getTime() < GROUP_WINDOW_MS;
          return (
            <MessageItem
              key={message.id}
              message={message}
              grouped={grouped}
              selfUserId={selfUserId}
              isGuildOwner={isGuildOwner}
              memberUsernames={memberUsernames}
              onReply={onReply}
            />
          );
        })}
      </div>
    </div>
  );
}

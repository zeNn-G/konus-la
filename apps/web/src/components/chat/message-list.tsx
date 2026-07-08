import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@konus-la/ui/components/empty";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
} from "@konus-la/ui/components/message-scroller";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { HashIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { MessageItem } from "@/components/chat/message-item";
import type { ChatMessage } from "@/lib/use-realtime";
import { historyInfiniteOptions, trimHistory } from "@/lib/use-realtime";

/** Same author within 5 minutes → collapse into the previous message's group. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Session guardrail: realtime keeps appending and paging up keeps prepending, so a
 * long-lived channel view grows without bound. Past TRIM_AT cached messages, collapse
 * back to the newest TRIM_KEEP once the reader returns to the live edge — the top
 * sentinel refetches older pages on demand, so trimming is invisible.
 */
/**
 * TRIM_KEEP rows must comfortably out-span the viewport plus the sentinel's 200px
 * prefetch margin, or a trim would drop the sentinel back into view and fetch/trim
 * would loop. ~150 chat rows are several viewports tall; don't lower this near ~40.
 */
const TRIM_AT = 300;
const TRIM_KEEP = 150;

/**
 * Within the scroller's edge threshold of the bottom. Read imperatively inside effects —
 * subscribing to the scroller's reactive scroll state (`useMessageScrollerScrollable`)
 * re-rendered the whole list twice per incoming message, because the `end` flag flips
 * true→false on every append at the live edge.
 */
function isAtEnd(viewport: HTMLDivElement | null): boolean {
  return (
    viewport !== null && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 8
  );
}

type Props = {
  channelId: string;
  channelName: string;
  selfUserId: string;
  isGuildOwner: boolean;
  memberUsernames: ReadonlySet<string>;
  onReply: (message: ChatMessage) => void;
};

/**
 * Cursor-paginated message column, no virtualization (plain DOM is fine at
 * friends-instance volume, and the cache trim keeps the DOM bounded too). The
 * message-scroller primitive owns the scroll contract: open at the newest message,
 * auto-follow while the reader sits at the live edge, hold position when older pages
 * prepend, and a jump-to-bottom button while scrolled up. Requires an ancestor
 * MessageScrollerProvider (the channel route provides it, shared with the composer).
 */
export function MessageList({
  channelId,
  channelName,
  selfUserId,
  isGuildOwner,
  memberUsernames,
  onReply,
}: Props) {
  const history = useInfiniteQuery(historyInfiniteOptions(channelId));
  const queryClient = useQueryClient();

  const viewportRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Newest-first from the server; render oldest-first.
  const messages = (history.data?.pages.flatMap((page) => page.messages) ?? []).toReversed();
  const messageCount = messages.length;

  // Top sentinel → fetch older page. The scroller preserves the reader's position when
  // the page prepends (preserveScrollOnPrepend). No "initial scroll done" gate is
  // needed: intersection reports are delivered a frame behind, after the scroller's
  // opening scroll-to-end has landed.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const viewport = viewportRef.current;
    if (!sentinel || !viewport) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && history.hasNextPage && !history.isFetchingNextPage) {
          void history.fetchNextPage();
        }
      },
      { root: viewport, rootMargin: "200px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [history.hasNextPage, history.isFetchingNextPage, history.fetchNextPage]);

  // Trim the cache once the reader is back at the live edge (never while scrolled up —
  // that would pull the history out from under them). The scroller applies its
  // follow-to-end scroll on a deferred animation frame, so measure two frames later —
  // reading scrollTop at effect time races it and always sees the pre-scroll position.
  useEffect(() => {
    if (history.isFetchingNextPage || messageCount <= TRIM_AT) return;
    let inner: number | undefined;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (isAtEnd(viewportRef.current)) trimHistory(queryClient, channelId, TRIM_KEEP);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner !== undefined) cancelAnimationFrame(inner);
    };
  }, [history.isFetchingNextPage, messageCount, queryClient, channelId]);

  if (history.isPending) {
    return <div className="flex-1 px-4 py-6 text-sm text-muted-foreground">Loading…</div>;
  }

  // An empty channel renders the empty state INSTEAD of the scroller (the shadcn
  // pattern); the scroller mounts fresh — and applies its opening scroll — with the
  // first message.
  if (messages.length === 0) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HashIcon />
          </EmptyMedia>
          <EmptyTitle>Welcome to #{channelName}</EmptyTitle>
          <EmptyDescription>
            This is the beginning of the channel. Say something!
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <MessageScroller className="flex-1">
      <MessageScrollerViewport ref={viewportRef}>
        {/* Static rows stay OUTSIDE MessageScrollerContent: the scroller detects prepends
            by the identity of Content's first child, so only message items may live there. */}
        <div ref={sentinelRef} />
        {!history.hasNextPage && (
          <p className="px-4 pt-6 pb-2 text-xs text-muted-foreground">
            This is the beginning of the channel.
          </p>
        )}
        {history.isFetchingNextPage && (
          <p className="px-4 py-2 text-xs text-muted-foreground">Loading older messages…</p>
        )}
        {/* min-h-0: the registry default (min-h-full) plus the status rows above would
            make even an empty channel scrollable. */}
        <MessageScrollerContent className="min-h-0 gap-0 pb-2">
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const grouped =
              previous !== undefined &&
              previous.author.id === message.author.id &&
              message.replyTo === null &&
              message.createdAt.getTime() - previous.createdAt.getTime() < GROUP_WINDOW_MS;
            return (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                // The registry default (content-visibility:auto + a 10rem size estimate)
                // guesses ~5× too tall for chat rows, so scrollHeight lurches as items
                // render in/out. The cache trim already bounds the DOM; render for real.
                className="[contain-intrinsic-size:auto] [content-visibility:visible]"
              >
                <MessageItem
                  message={message}
                  grouped={grouped}
                  selfUserId={selfUserId}
                  isGuildOwner={isGuildOwner}
                  memberUsernames={memberUsernames}
                  onReply={onReply}
                />
              </MessageScrollerItem>
            );
          })}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton />
    </MessageScroller>
  );
}

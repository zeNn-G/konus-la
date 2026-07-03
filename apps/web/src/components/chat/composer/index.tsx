import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { cn } from "@konus-la/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { SendHorizontalIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  type CaretToken,
  emojiTokenAtCaret,
  mentionTokenAtCaret,
  tokenKey,
} from "@/components/chat/composer/caret-tokens";
import { EmojiPickerButton } from "@/components/chat/composer/emoji-picker-button";
import { ReplyBanner } from "@/components/chat/composer/reply-banner";
import {
  type NavSource,
  SuggestionMenu,
  suggestionKeyNav,
} from "@/components/chat/composer/suggestion-menu";
import { preloadShortcodes, replaceShortcodes, searchShortcodes, shortcodeMap } from "@/lib/emoji";
import type { ChatMessage } from "@/lib/use-realtime";
import { orpc } from "@/utils/orpc";

const MAX_LENGTH = 2000;
/** Re-announce typing while keys keep coming — inside the server's 5s indicator TTL. */
const TYPING_THROTTLE_MS = 4_000;

export type MentionMember = { username: string; displayName: string; image: string | null };

type Props = {
  channelId: string;
  channelName: string;
  members: MentionMember[];
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
};

/**
 * Discord-model composer: a plain auto-growing textarea holding raw markdown source.
 * Enter or the send button sends, Shift+Enter breaks, `@` opens the member autocomplete,
 * `:` opens the emoji autocomplete (shortcodes convert to unicode as you type — messages
 * always store plain unicode). The sent message lands in the cache via the author's own
 * realtime event — no optimistic insert.
 */
export function Composer({ channelId, channelName, members, replyTo, onCancelReply }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingSentRef = useRef(0);
  const [value, setValue] = useState("");
  const [mention, setMention] = useState<CaretToken | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [emojiToken, setEmojiToken] = useState<CaretToken | null>(null);
  const [emojiIndex, setEmojiIndex] = useState(0);
  const [, setEmojiReady] = useState(false);
  const navSourceRef = useRef<NavSource>("mouse");

  useEffect(() => {
    // Warm the shortcode dataset before the first `:` — shares the browser cache
    // with the picker's own fetch. The state poke re-renders an already-open list.
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300));
    idle(() => void preloadShortcodes().then(() => setEmojiReady(true)));
  }, []);

  const send = useMutation(
    orpc.chat.sendMessage.mutationOptions({
      onError: (error) => toast.error(error.message),
    }),
  );
  const typing = useMutation(orpc.typing.start.mutationOptions({ onError: () => {} }));

  const suggestions = mention
    ? members
        .filter(
          (member) =>
            member.username.startsWith(mention.query) ||
            member.displayName.toLowerCase().includes(mention.query),
        )
        .slice(0, 8)
    : [];

  const emojiSuggestions = !mention && emojiToken ? searchShortcodes(emojiToken.query, 25) : [];

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  // Only reset a list's highlight when its token actually changed — this runs on every
  // keyup, including the arrow keys that move the highlight.
  const refreshTokens = () => {
    const el = textareaRef.current;
    if (!el) return;
    const nextMention = mentionTokenAtCaret(el.value, el.selectionStart);
    if (tokenKey(nextMention) !== tokenKey(mention)) {
      setMention(nextMention);
      setMentionIndex(0);
    }
    const nextEmoji = nextMention ? null : emojiTokenAtCaret(el.value, el.selectionStart);
    if (tokenKey(nextEmoji) !== tokenKey(emojiToken)) {
      setEmojiToken(nextEmoji);
      setEmojiIndex(0);
    }
  };

  const insertMention = (username: string) => {
    const el = textareaRef.current;
    if (!el || !mention) return;
    const caret = el.selectionStart;
    const next = `${value.slice(0, mention.start)}@${username} ${value.slice(caret)}`;
    setValue(next);
    setMention(null);
    requestAnimationFrame(() => {
      const position = mention.start + username.length + 2;
      el.focus();
      el.setSelectionRange(position, position);
      autoGrow();
    });
  };

  const insertEmojiForToken = (emoji: string) => {
    const el = textareaRef.current;
    if (!el || !emojiToken) return;
    const caret = el.selectionStart;
    const next = `${value.slice(0, emojiToken.start)}${emoji} ${value.slice(caret)}`;
    setValue(next);
    setEmojiToken(null);
    requestAnimationFrame(() => {
      const position = emojiToken.start + emoji.length + 1;
      el.focus();
      el.setSelectionRange(position, position);
      autoGrow();
    });
  };

  /** Picker path: replace the current selection (or insert at the caret). Stable — the
   * memoized picker button must not re-render on composer keystrokes. */
  const insertEmojiAtCaret = useCallback(
    (emoji: string) => {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      setValue((v) => `${v.slice(0, start)}${emoji}${v.slice(end)}`);
      requestAnimationFrame(() => {
        const position = start + emoji.length;
        el.focus();
        el.setSelectionRange(position, position);
        autoGrow();
      });
    },
    [autoGrow],
  );

  const focusComposer = useCallback(() => textareaRef.current?.focus(), []);

  const submit = () => {
    const content = replaceShortcodes(value);
    if (!content.trim() || send.isPending) return;
    send.mutate(
      {
        channelId,
        content,
        replyToMessageId: replyTo?.id ?? null,
      },
      {
        onSuccess: () => {
          setValue("");
          onCancelReply();
          requestAnimationFrame(autoGrow);
        },
      },
    );
  };

  return (
    <div className="relative px-4 pb-4">
      {mention && suggestions.length > 0 && (
        <SuggestionMenu
          items={suggestions}
          activeIndex={mentionIndex}
          itemKey={(member) => member.username}
          navSource={navSourceRef}
          onHighlight={setMentionIndex}
          onSelect={(member) => insertMention(member.username)}
        >
          {(member) => (
            <>
              <Avatar seed={member.username} src={member.image} className="size-5" />
              <span>{member.displayName}</span>
              <span className="text-xs text-muted-foreground">@{member.username}</span>
            </>
          )}
        </SuggestionMenu>
      )}

      {emojiSuggestions.length > 0 && (
        <SuggestionMenu
          items={emojiSuggestions}
          activeIndex={emojiIndex}
          itemKey={(entry) => entry.shortcode}
          navSource={navSourceRef}
          onHighlight={setEmojiIndex}
          onSelect={(entry) => insertEmojiForToken(entry.emoji)}
        >
          {(entry) => (
            <>
              <span className="w-5 text-center text-base">{entry.emoji}</span>
              <span className="text-xs text-muted-foreground">:{entry.shortcode}:</span>
            </>
          )}
        </SuggestionMenu>
      )}

      {replyTo && <ReplyBanner replyTo={replyTo} onCancelReply={onCancelReply} />}

      <div
        className={cn(
          "flex items-end gap-1 rounded border border-foreground/15 bg-background px-1.5 focus-within:border-foreground/35",
          replyTo && "rounded-t-none",
        )}
      >
        <EmojiPickerButton onPick={insertEmojiAtCaret} onDismiss={focusComposer} />

        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          maxLength={MAX_LENGTH}
          placeholder={`Message #${channelName}`}
          className="max-h-50 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-2 text-sm outline-none scrollbar-thin"
          onChange={(e) => {
            const el = e.target;
            let next = el.value;
            const caret = el.selectionStart;
            const map = shortcodeMap();
            // Closing-colon conversion: `:skull` + `:` → 💀 right in the textarea.
            if (map && caret > 0 && next[caret - 1] === ":") {
              const match = /(?:^|\s):([a-z0-9_+-]+):$/.exec(next.slice(0, caret));
              const emoji = match ? map.get(match[1]) : undefined;
              if (match && emoji) {
                const start = caret - match[1].length - 2;
                next = `${next.slice(0, start)}${emoji}${next.slice(caret)}`;
                const position = start + emoji.length;
                requestAnimationFrame(() => {
                  el.setSelectionRange(position, position);
                  autoGrow();
                });
              }
            }
            setValue(next);
            autoGrow();
            refreshTokens();
            const now = Date.now();
            if (next.trim() && now - lastTypingSentRef.current > TYPING_THROTTLE_MS) {
              lastTypingSentRef.current = now;
              typing.mutate({ channelId });
            }
          }}
          onKeyUp={refreshTokens}
          onClick={refreshTokens}
          onKeyDown={(e) => {
            if (
              mention &&
              suggestions.length > 0 &&
              suggestionKeyNav(e, {
                count: suggestions.length,
                navSource: navSourceRef,
                setIndex: setMentionIndex,
                select: () => {
                  const selected = suggestions[mentionIndex];
                  if (selected) insertMention(selected.username);
                },
                dismiss: () => setMention(null),
              })
            ) {
              return;
            }
            if (
              emojiSuggestions.length > 0 &&
              suggestionKeyNav(e, {
                count: emojiSuggestions.length,
                navSource: navSourceRef,
                setIndex: setEmojiIndex,
                select: () => {
                  const selected = emojiSuggestions[emojiIndex];
                  if (selected) insertEmojiForToken(selected.emoji);
                },
                dismiss: () => setEmojiToken(null),
              })
            ) {
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />

        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Send message"
          disabled={!value.trim() || send.isPending}
          className="my-1 text-primary disabled:text-muted-foreground"
          onMouseDown={(e) => e.preventDefault()} // keep textarea focus
          onClick={submit}
        >
          <SendHorizontalIcon className="size-4" />
        </Button>
      </div>

      {value.length > MAX_LENGTH - 200 && (
        <p className="mt-0.5 text-right text-[11px] text-muted-foreground">
          {value.length}/{MAX_LENGTH}
        </p>
      )}
    </div>
  );
}

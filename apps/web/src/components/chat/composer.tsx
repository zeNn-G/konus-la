import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { cn } from "@konus-la/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

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

/** The `@`-token being typed at the caret, or null. */
function mentionTokenAtCaret(value: string, caret: number): { start: number; query: string } | null {
  const beforeCaret = value.slice(0, caret);
  const match = /(?:^|\s)@([a-z0-9_]{0,20})$/i.exec(beforeCaret);
  if (!match) return null;
  return { start: beforeCaret.length - match[1].length - 1, query: match[1].toLowerCase() };
}

/**
 * Discord-model composer: a plain auto-growing textarea holding raw markdown source.
 * Enter sends, Shift+Enter breaks, `@` opens the member autocomplete. The sent message
 * lands in the cache via the author's own realtime event — no optimistic insert.
 */
export function Composer({ channelId, channelName, members, replyTo, onCancelReply }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingSentRef = useRef(0);
  const [value, setValue] = useState("");
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

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

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const refreshMention = () => {
    const el = textareaRef.current;
    if (!el) return;
    const token = mentionTokenAtCaret(el.value, el.selectionStart);
    setMention(token);
    setMentionIndex(0);
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

  const submit = () => {
    const content = value;
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
        <div className="absolute right-4 bottom-full left-4 z-10 mb-1 overflow-hidden rounded border border-foreground/10 bg-background shadow-md">
          {suggestions.map((member, index) => (
            <button
              key={member.username}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                index === mentionIndex ? "bg-muted" : "hover:bg-muted/60",
              )}
              onMouseEnter={() => setMentionIndex(index)}
              onMouseDown={(e) => {
                e.preventDefault(); // keep textarea focus
                insertMention(member.username);
              }}
            >
              <Avatar seed={member.username} src={member.image} className="size-5" />
              <span>{member.displayName}</span>
              <span className="text-xs text-muted-foreground">@{member.username}</span>
            </button>
          ))}
        </div>
      )}

      {replyTo && (
        <div className="flex items-center gap-2 rounded-t border border-b-0 border-foreground/10 bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
          Replying to <span className="font-medium">@{replyTo.author.username}</span>
          <span className="truncate">{replyTo.content}</span>
          <Button
            size="icon-sm"
            variant="ghost"
            className="ml-auto"
            aria-label="Cancel reply"
            onClick={onCancelReply}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={value}
        rows={1}
        maxLength={MAX_LENGTH}
        placeholder={`Message #${channelName}`}
        className={cn(
          "w-full resize-none rounded border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/35",
          replyTo && "rounded-t-none",
        )}
        onChange={(e) => {
          setValue(e.target.value);
          autoGrow();
          refreshMention();
          const now = Date.now();
          if (e.target.value.trim() && now - lastTypingSentRef.current > TYPING_THROTTLE_MS) {
            lastTypingSentRef.current = now;
            typing.mutate({ channelId });
          }
        }}
        onKeyUp={refreshMention}
        onClick={refreshMention}
        onKeyDown={(e) => {
          if (mention && suggestions.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setMentionIndex((i) => (i + 1) % suggestions.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setMentionIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              const selected = suggestions[mentionIndex];
              if (selected) insertMention(selected.username);
              return;
            }
            if (e.key === "Escape") {
              setMention(null);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {value.length > MAX_LENGTH - 200 && (
        <p className="mt-0.5 text-right text-[11px] text-muted-foreground">
          {value.length}/{MAX_LENGTH}
        </p>
      )}
    </div>
  );
}

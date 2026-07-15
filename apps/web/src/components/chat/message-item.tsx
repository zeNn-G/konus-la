import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { cn } from "@konus-la/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { CornerUpLeftIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { MessageMarkdown } from "@/components/chat/message-markdown";
import type { ChatMessage } from "@/lib/use-realtime";
import { orpc } from "@/utils/orpc";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type Props = {
  message: ChatMessage;
  /** Hide the avatar/name header when the previous message is same-author and recent. */
  grouped: boolean;
  selfUserId: string;
  isGuildOwner: boolean;
  memberUsernames: ReadonlySet<string>;
  /** The author's role tint (highest colored role) — guild channels only. */
  authorColor?: string;
  onReply: (message: ChatMessage) => void;
};

/**
 * One message row. Cache updates flow exclusively through the realtime dispatcher —
 * edit/delete mutations here don't touch the cache themselves (the author receives
 * their own events).
 */
export const MessageItem = memo(MessageItemRow);

function MessageItemRow({
  message,
  grouped,
  selfUserId,
  isGuildOwner,
  memberUsernames,
  authorColor,
  onReply,
}: Props) {
  const isAuthor = message.author.id === selfUserId;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the edit box to its content (a fixed-rows textarea is a scrolling slit
  // for long messages). Also drop the caret at the end when editing starts.
  useLayoutEffect(() => {
    const el = editRef.current;
    if (!editing || !el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [editing, draft]);

  const edit = useMutation(
    orpc.chat.editMessage.mutationOptions({
      onSuccess: () => setEditing(false),
      onError: (error) => toast.error(error.message),
    }),
  );
  const remove = useMutation(
    orpc.chat.deleteMessage.mutationOptions({
      onError: (error) => toast.error(error.message),
    }),
  );

  const submitEdit = () => {
    const content = draft.trim();
    if (!content || content === message.content) {
      setEditing(false);
      setDraft(message.content);
      return;
    }
    edit.mutate({ messageId: message.id, content: draft });
  };

  return (
    <div
      className={cn(
        "group relative px-4 hover:bg-muted/50",
        grouped ? "py-0.5" : "mt-2 pt-1 pb-0.5",
      )}
    >
      {message.replyTo && (
        <div className="mb-0.5 flex items-center gap-1 pl-11 text-xs text-muted-foreground">
          <CornerUpLeftIcon className="size-3 shrink-0" />
          <span className="font-medium">
            @{message.replyTo.authorUsername ?? "unknown"}
          </span>
          <span className="truncate">{message.replyTo.content}</span>
        </div>
      )}

      <div className="flex gap-3">
        {grouped ? (
          <span className="w-8 shrink-0 pt-1 text-right text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100">
            {timeFormat.format(message.createdAt)}
          </span>
        ) : (
          <Avatar
            seed={message.author.username ?? message.author.id}
            src={message.author.image}
            className="mt-0.5 size-8 shrink-0"
          />
        )}

        <div className="min-w-0 flex-1">
          {!grouped && (
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium" style={{ color: authorColor }}>
                {message.author.displayName}
              </span>
              <span
                className="text-[11px] text-muted-foreground"
                title={dateTimeFormat.format(message.createdAt)}
              >
                {timeFormat.format(message.createdAt)}
              </span>
            </div>
          )}

          {editing ? (
            <div className="mt-1 flex flex-col gap-1">
              <textarea
                ref={editRef}
                value={draft}
                autoFocus
                rows={1}
                maxLength={2000}
                onFocus={(e) => {
                  const end = e.target.value.length;
                  e.target.setSelectionRange(end, end);
                }}
                className="w-full resize-none rounded border border-foreground/20 bg-background px-2 py-1 text-sm outline-none focus:border-foreground/40"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitEdit();
                  }
                  if (e.key === "Escape") {
                    setEditing(false);
                    setDraft(message.content);
                  }
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Enter to save · Escape to cancel
              </p>
            </div>
          ) : (
            <div className="text-sm">
              <MessageMarkdown content={message.content} memberUsernames={memberUsernames} />
              {message.editedAt && (
                <span
                  className="ml-1 text-[10px] text-muted-foreground"
                  title={dateTimeFormat.format(message.editedAt)}
                >
                  (edited)
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {!editing && (
        <div className="absolute -top-3 right-4 hidden items-center gap-0.5 rounded border border-foreground/10 bg-background shadow-sm group-hover:flex">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Reply"
            title="Reply"
            onClick={() => onReply(message)}
          >
            <CornerUpLeftIcon className="size-3.5" />
          </Button>
          {isAuthor && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Edit"
              title="Edit"
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
            >
              <PencilIcon className="size-3.5" />
            </Button>
          )}
          {(isAuthor || isGuildOwner) && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Delete"
              title="Delete"
              onClick={() => remove.mutate({ messageId: message.id })}
            >
              <Trash2Icon className="size-3.5 text-red-500" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

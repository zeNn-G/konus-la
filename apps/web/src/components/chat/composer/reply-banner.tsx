import { Button } from "@konus-la/ui/components/button";
import { XIcon } from "lucide-react";

import type { ChatMessage } from "@/lib/use-realtime";

type Props = {
  replyTo: ChatMessage;
  onCancelReply: () => void;
};

/** The "Replying to @user" strip docked on top of the composer input row. */
export function ReplyBanner({ replyTo, onCancelReply }: Props) {
  return (
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
  );
}

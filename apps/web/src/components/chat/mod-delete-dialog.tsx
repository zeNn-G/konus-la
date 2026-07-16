import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@konus-la/ui/components/alert-dialog";
import { Input } from "@konus-la/ui/components/input";
import { Label } from "@konus-la/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { ChatMessage } from "@/lib/use-realtime";
import { orpc } from "@/utils/orpc";

type Props = {
  message: ChatMessage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Moderator confirm for deleting someone else's message (`mod.deleteMessage`): shows the
 * message about to be destroyed and takes an optional reason for the audit entry — which,
 * with its content snippet, is the only record surviving the hard delete.
 */
export function ModDeleteDialog({ message, open, onOpenChange }: Props) {
  const [reason, setReason] = useState("");
  const modDelete = useMutation(
    orpc.mod.deleteMessage.mutationOptions({
      onSuccess: () => onOpenChange(false),
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this message?</AlertDialogTitle>
          <AlertDialogDescription>
            It disappears for everyone. Only the audit log keeps a snippet.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded border border-foreground/10 bg-muted/50 px-3 py-2">
          <p className="text-xs font-medium">{message.author.displayName}</p>
          <p className="line-clamp-4 text-xs break-words whitespace-pre-wrap text-muted-foreground">
            {message.content}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mod-delete-reason">Reason (optional)</Label>
          <Input
            id="mod-delete-reason"
            maxLength={500}
            value={reason}
            placeholder="Recorded in the audit log"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={modDelete.isPending}
            onClick={() => {
              const trimmed = reason.trim();
              modDelete.mutate({
                channelId: message.channelId,
                messageId: message.id,
                reason: trimmed.length > 0 ? trimmed : undefined,
              });
            }}
          >
            Delete message
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

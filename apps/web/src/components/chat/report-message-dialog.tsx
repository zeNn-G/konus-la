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
 * Report a guild message to the guild's moderators (`report.create`). The reason is
 * required — a report is a claim someone has to act on, not a reaction. The server
 * snapshots the message at report time, so the report stays intact even if the message
 * is deleted before a moderator reads it.
 */
export function ReportMessageDialog({ message, open, onOpenChange }: Props) {
  const [reason, setReason] = useState("");
  const report = useMutation(
    orpc.report.create.mutationOptions({
      onSuccess: () => {
        onOpenChange(false);
        toast.success("Report submitted to this guild's moderators.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Report this message?</AlertDialogTitle>
          <AlertDialogDescription>
            Sends the message to this guild's moderators. The author isn't notified.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded border border-foreground/10 bg-muted/50 px-3 py-2">
          <p className="text-xs font-medium">{message.author.displayName}</p>
          <p className="line-clamp-4 text-xs break-words whitespace-pre-wrap text-muted-foreground">
            {message.content}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-reason">Reason</Label>
          <Input
            id="report-reason"
            maxLength={500}
            value={reason}
            placeholder="What's wrong with this message?"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={report.isPending || reason.trim().length === 0}
            onClick={() => report.mutate({ messageId: message.id, reason: reason.trim() })}
          >
            Submit report
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

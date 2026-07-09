import { Button } from "@konus-la/ui/components/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@konus-la/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@konus-la/ui/components/dropdown-menu";
import { Input } from "@konus-la/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MoreVerticalIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { type DmConversation, invalidateDmConversation } from "@/lib/dm";
import { orpc, queryClient } from "@/utils/orpc";

/** Group kebab: rename (any participant, empty clears the name) and leave. */
export function GroupHeaderMenu({ dm }: { dm: DmConversation }) {
  const navigate = useNavigate();
  const [renameOpen, setRenameOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [name, setName] = useState(dm.name ?? "");

  const rename = useMutation(
    orpc.dm.rename.mutationOptions({
      onSuccess: async () => {
        setRenameOpen(false);
        await invalidateDmConversation(queryClient, dm.id);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const leave = useMutation(
    orpc.dm.leave.mutationOptions({
      onSuccess: async () => {
        // Our own dm.participant.removed event also cleans the caches; navigate directly
        // so leaving feels instant rather than waiting on the socket round-trip.
        await navigate({ to: "/" });
        await queryClient.invalidateQueries({ queryKey: orpc.dm.list.key() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="icon-sm" variant="ghost" aria-label="Group options" />}
        >
          <MoreVerticalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => {
              setName(dm.name ?? "");
              setRenameOpen(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setLeaveOpen(true)}>
            Leave group
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename group</DialogTitle>
            <DialogDescription>
              Leave it empty to fall back to the members’ names.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              rename.mutate({ channelId: dm.id, name: name.trim() || null });
            }}
          >
            <Input
              autoFocus
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" disabled={rename.isPending}>
              {rename.isPending ? "Renaming…" : "Rename"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this group?</AlertDialogTitle>
            <AlertDialogDescription>
              You lose access to the whole conversation history. If you’re the last one out, the
              group and its messages are deleted for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => leave.mutate({ channelId: dm.id })}>
              Leave group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

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
import { Popover, PopoverContent, PopoverTrigger } from "@konus-la/ui/components/popover";
import { useMutation } from "@tanstack/react-query";
import { UserMinusIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AddPeopleDialog } from "@/components/dm/add-people-dialog";
import { PresenceAvatar } from "@/components/presence-avatar";
import { type DmConversation, invalidateDmConversation } from "@/lib/dm";
import { usePresence } from "@/lib/use-realtime";
import { orpc, queryClient } from "@/utils/orpc";

type Member = DmConversation["participants"][number];

/**
 * Group roster popover: presence dots, owner badge, owner-only removal, and a button
 * opening the "Add people" dialog. Roster changes land via dm.participant.* events; the
 * mutations here just invalidate for the acting tab.
 */
export function GroupMembersPopover({
  dm,
  selfUserId,
}: {
  dm: DmConversation;
  selfUserId: string;
}) {
  const presence = usePresence();
  const [membersOpen, setMembersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const isOwner = dm.ownerId === selfUserId;

  const removeParticipant = useMutation(
    orpc.dm.removeParticipant.mutationOptions({
      onSuccess: async () => {
        setRemoveTarget(null);
        await invalidateDmConversation(queryClient, dm.id);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <>
      <Popover open={membersOpen} onOpenChange={setMembersOpen}>
        <PopoverTrigger
          render={
            <Button size="icon-sm" variant="ghost" aria-label="Group members" title="Members" />
          }
        >
          <UsersIcon className="size-4" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <p className="border-b border-foreground/10 px-4 py-2.5 text-xs font-medium text-muted-foreground">
            Members — {dm.participants.length}
          </p>
          <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto p-2">
            {dm.participants.map((member) => {
              const online = member.userId === selfUserId || presence[member.userId] === true;
              return (
                <li
                  key={member.userId}
                  className="group flex items-center gap-2 rounded px-2 py-1.5"
                >
                  <PresenceAvatar
                    seed={member.username ?? member.userId}
                    src={member.image}
                    online={online}
                  />
                  <span className="truncate text-sm">
                    {member.displayName || member.username || member.userId}
                  </span>
                  {member.userId === dm.ownerId && (
                    <span className="text-xs text-muted-foreground">owner</span>
                  )}
                  {isOwner && member.userId !== selfUserId && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${member.displayName || member.username}`}
                      className="ml-auto opacity-0 group-hover:opacity-100"
                      onClick={() => setRemoveTarget(member)}
                    >
                      <UserMinusIcon className="size-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="border-t border-foreground/10 p-2">
            <Button
              variant="ghost"
              className="w-full justify-start gap-2 px-2 text-sm font-normal text-muted-foreground hover:text-foreground"
              onClick={() => {
                setMembersOpen(false);
                setAddOpen(true);
              }}
            >
              <span className="flex size-6 shrink-0 items-center justify-center">
                <UserPlusIcon className="size-4" />
              </span>
              Add people
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <AddPeopleDialog dm={dm} selfUserId={selfUserId} open={addOpen} onOpenChange={setAddOpen} />

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removeTarget?.displayName || removeTarget?.username}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to this conversation and its entire history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removeTarget) {
                  removeParticipant.mutate({ channelId: dm.id, userId: removeTarget.userId });
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

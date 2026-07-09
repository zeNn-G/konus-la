import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@konus-la/ui/components/dialog";
import { Input } from "@konus-la/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { UserPickerList } from "@/components/dm/user-picker-list";
import { type DmConversation, invalidateDmConversation } from "@/lib/dm";
import { useRecentContacts } from "@/lib/use-recent-contacts";
import { useUserSearch } from "@/lib/use-user-search";
import { orpc, queryClient } from "@/utils/orpc";

/**
 * "Add people" picker for a group DM, opened from the members popover. Stays open after
 * each add so several people can go in one sitting — new members drop out of the list as
 * the roster refreshes.
 */
export function AddPeopleDialog({
  dm,
  selfUserId,
  open,
  onOpenChange,
}: {
  dm: DmConversation;
  selfUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const search = useUserSearch(query);
  const recents = useRecentContacts(selfUserId);

  const close = () => {
    onOpenChange(false);
    setQuery("");
  };

  const addParticipant = useMutation(
    orpc.dm.addParticipant.mutationOptions({
      onSuccess: async () => {
        setQuery("");
        await invalidateDmConversation(queryClient, dm.id);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const memberIds = new Set(dm.participants.map((p) => p.userId));

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add people</DialogTitle>
          <DialogDescription>New members can read the entire conversation.</DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="Search by name or @username"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <UserPickerList
          query={query}
          search={search}
          recents={recents}
          excludeIds={memberIds}
          disabled={addParticipant.isPending}
          className="h-64"
          onSelect={(user) => addParticipant.mutate({ channelId: dm.id, userId: user.id })}
        />
      </DialogContent>
    </Dialog>
  );
}

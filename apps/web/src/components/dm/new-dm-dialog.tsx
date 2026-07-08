import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@konus-la/ui/components/dialog";
import { Input } from "@konus-la/ui/components/input";
import { useState } from "react";

import { UserPickerList } from "@/components/dm/user-picker-list";
import { useMessageUser } from "@/lib/use-message-user";
import { useRecentContacts } from "@/lib/use-recent-contacts";
import { useUserSearch } from "@/lib/use-user-search";

/**
 * "New DM" picker: recent contacts up front, search anyone on the instance, pick one →
 * existing 1:1 or draft view (via useMessageUser). Nothing is created until a first
 * message is sent.
 */
export function NewDmDialog({
  open,
  onOpenChange,
  selfUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selfUserId: string;
}) {
  const [query, setQuery] = useState("");
  const search = useUserSearch(query);
  const recents = useRecentContacts(selfUserId, { excludeExistingDms: true });
  const messageUser = useMessageUser();

  const close = () => {
    onOpenChange(false);
    setQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New direct message</DialogTitle>
          <DialogDescription>Find someone on the instance to talk to.</DialogDescription>
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
          className="h-64"
          onSelect={(user) => {
            close();
            void messageUser(user.id);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

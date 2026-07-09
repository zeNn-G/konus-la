import { Button } from "@konus-la/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@konus-la/ui/components/dialog";
import { Input } from "@konus-la/ui/components/input";
import { Label } from "@konus-la/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { UserPickerList } from "@/components/dm/user-picker-list";
import { useRecentContacts } from "@/lib/use-recent-contacts";
import { useUserSearch, type UserSearchResult } from "@/lib/use-user-search";
import { orpc, queryClient } from "@/utils/orpc";

/**
 * "New group" modal: search-and-pick at least two people (chips below the input), name is
 * optional. The size cap is enforced server-side and surfaces as a toast.
 */
export function NewGroupDialog({
  open,
  onOpenChange,
  selfUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selfUserId: string;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<UserSearchResult[]>([]);
  const search = useUserSearch(query);
  const recents = useRecentContacts(selfUserId);

  const close = () => {
    onOpenChange(false);
    setQuery("");
    setName("");
    setSelected([]);
  };

  const createGroup = useMutation(
    orpc.dm.createGroup.mutationOptions({
      onSuccess: async ({ channelId }) => {
        await queryClient.invalidateQueries({ queryKey: orpc.dm.list.key() });
        close();
        await navigate({ to: "/dms/$channelId", params: { channelId } });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const toggle = (user: UserSearchResult) => {
    setSelected((current) =>
      current.some((u) => u.id === user.id)
        ? current.filter((u) => u.id !== user.id)
        : [...current, user],
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New group DM</DialogTitle>
          <DialogDescription>Pick at least two people. Naming it is optional.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="group-name">Name (optional)</Label>
          <Input
            id="group-name"
            maxLength={100}
            placeholder="The gang"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="group-search">People</Label>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selected.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs hover:bg-muted/70"
                  onClick={() => toggle(user)}
                >
                  {user.displayName || user.username}
                  <XIcon className="size-3" />
                </button>
              ))}
            </div>
          )}
          <Input
            id="group-search"
            autoFocus
            placeholder="Search by name or @username"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <UserPickerList
          query={query}
          search={search}
          recents={recents}
          excludeIds={new Set(selected.map((u) => u.id))}
          className="h-48"
          onSelect={toggle}
        />

        <Button
          disabled={selected.length < 2 || createGroup.isPending}
          onClick={() =>
            createGroup.mutate({
              participantIds: selected.map((u) => u.id),
              name: name.trim() || null,
            })
          }
        >
          {createGroup.isPending
            ? "Creating…"
            : selected.length < 2
              ? "Pick at least 2 people"
              : `Create group with ${selected.length} people`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

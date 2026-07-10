import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@konus-la/ui/components/alert-dialog";
import { Button } from "@konus-la/ui/components/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@konus-la/ui/components/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { orpc, queryClient } from "@/utils/orpc";

export function DangerSection({ guildId, onClose }: { guildId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [transferTo, setTransferTo] = useState<string | null>(null);

  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));
  const guildKey = orpc.guild.get.queryOptions({ input: { guildId } }).queryKey;

  const transfer = useMutation(
    orpc.guild.transferOwnership.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: guildKey });
        toast.success("Ownership transferred.");
        onClose();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const deleteGuild = useMutation(
    orpc.guild.delete.mutationOptions({
      onSuccess: async () => {
        // Leave the guild's routes before invalidating — a refetch from inside would 403.
        onClose();
        await navigate({ to: "/" });
        await queryClient.invalidateQueries({ queryKey: orpc.guild.list.queryOptions().queryKey });
        toast.success("Guild deleted.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!guild.data) return null;
  const { guild: g, members } = guild.data;
  const memberItems = members
    .filter((m) => m.userId !== g.ownerId)
    .map((m) => ({ label: m.displayName || m.username || m.userId, value: m.userId }));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">Transfer ownership or delete this guild.</p>

      <div className="flex items-center gap-2">
        <Select items={memberItems} value={transferTo} onValueChange={setTransferTo}>
          <SelectTrigger className="min-w-48">
            <SelectValue placeholder="Transfer ownership to…" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {memberItems.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <AlertDialog>
          <AlertDialogTrigger render={<Button size="sm" variant="outline" disabled={!transferTo} />}>
            Transfer
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Transfer ownership?</AlertDialogTitle>
              <AlertDialogDescription>
                You’ll become an ordinary member. Only the new owner can transfer it back.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={transfer.isPending}
                onClick={() => transferTo && transfer.mutate({ guildId, newOwnerUserId: transferTo })}
              >
                Transfer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <AlertDialog>
        <AlertDialogTrigger render={<Button size="sm" variant="destructive" className="self-start" />}>
          Delete guild
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {g.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This can’t be undone. All members, invites, and bans are removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteGuild.isPending}
              onClick={() => deleteGuild.mutate({ guildId })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { Button } from "@konus-la/ui/components/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@konus-la/ui/components/select";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { orpc, queryClient } from "@/utils/orpc";

/** Invite expiry presets. Value is the seconds string, or "never". */
const DURATIONS = [
  { label: "1 day", value: "86400" },
  { label: "7 days", value: "604800" },
  { label: "30 days", value: "2592000" },
  { label: "Never", value: "never" },
];

export function InvitesSection({ guildId }: { guildId: string }) {
  const [ttl, setTtl] = useState("604800"); // default 7 days

  const invites = useQuery(orpc.guild.invite.list.queryOptions({ input: { guildId } }));
  const invitesKey = orpc.guild.invite.list.queryOptions({ input: { guildId } }).queryKey;
  const invalidateInvites = () => queryClient.invalidateQueries({ queryKey: invitesKey });

  const createInvite = useMutation(
    orpc.guild.invite.create.mutationOptions({
      onSuccess: async (created) => {
        await invalidateInvites();
        toast.success(`Created invite ${created.code}`);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const revokeInvite = useMutation(
    orpc.guild.invite.revoke.mutationOptions({
      onSuccess: async () => {
        await invalidateInvites();
        toast.success("Invite revoked.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">Shareable codes. Time-only expiry; reusable.</p>

      <div className="flex items-center gap-2">
        <Select
          items={DURATIONS}
          value={ttl}
          onValueChange={(value) => {
            if (value) setTtl(value);
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {DURATIONS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={createInvite.isPending}
          onClick={() =>
            createInvite.mutate({
              guildId,
              expiresInSeconds: ttl === "never" ? null : Number(ttl),
            })
          }
        >
          {createInvite.isPending ? "Creating…" : "Create invite"}
        </Button>
      </div>

      {invites.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : invites.data && invites.data.length > 0 ? (
        <ul className="flex flex-col divide-y divide-foreground/10">
          {invites.data.map((inv) => (
            <li key={inv.id} className="flex items-center gap-3 py-2">
              <code className="font-mono text-sm">{inv.code}</code>
              <span className="text-xs text-muted-foreground">
                {inv.expiresAt ? `expires ${inv.expiresAt.toLocaleDateString()}` : "never expires"}
                {" · "}
                {inv.usedCount} used
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => navigator.clipboard?.writeText(inv.code)}
                >
                  Copy
                </Button>
                <Button
                  size="xs"
                  variant="destructive"
                  disabled={revokeInvite.isPending}
                  onClick={() => revokeInvite.mutate({ guildId, inviteId: inv.id })}
                >
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No invites yet.</p>
      )}
    </div>
  );
}

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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@konus-la/ui/components/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@konus-la/ui/components/select";
import { SidebarTrigger } from "@konus-la/ui/components/sidebar";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/(app)/guilds/$guildId/settings")({
  component: GuildSettings,
});

/** Invite expiry presets. Value is the seconds string, or "never". */
const DURATIONS = [
  { label: "1 day", value: "86400" },
  { label: "7 days", value: "604800" },
  { label: "30 days", value: "2592000" },
  { label: "Never", value: "never" },
];

function GuildSettings() {
  const { guildId } = Route.useParams();
  const navigate = useNavigate();
  const [ttl, setTtl] = useState("604800"); // default 7 days
  const [transferTo, setTransferTo] = useState<string | null>(null);

  const guildQuery = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));
  const isOwner = guildQuery.data?.viewer.isOwner ?? false;
  const invitesQuery = useQuery({
    ...orpc.guild.invite.list.queryOptions({ input: { guildId } }),
    enabled: isOwner,
  });

  const guildKey = orpc.guild.get.queryOptions({ input: { guildId } }).queryKey;
  const invitesKey = orpc.guild.invite.list.queryOptions({ input: { guildId } }).queryKey;
  const invalidateGuild = () => queryClient.invalidateQueries({ queryKey: guildKey });
  const invalidateInvites = () => queryClient.invalidateQueries({ queryKey: invitesKey });

  const kick = useMutation(
    orpc.guild.member.kick.mutationOptions({
      onSuccess: async () => {
        await invalidateGuild();
        toast.success("Member removed.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const ban = useMutation(
    orpc.guild.member.ban.mutationOptions({
      onSuccess: async () => {
        await invalidateGuild();
        toast.success("Member banned.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

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

  const transfer = useMutation(
    orpc.guild.transferOwnership.mutationOptions({
      onSuccess: async () => {
        await invalidateGuild();
        toast.success("Ownership transferred.");
        navigate({ to: "/guilds/$guildId", params: { guildId } });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const deleteGuild = useMutation(
    orpc.guild.delete.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.guild.list.queryOptions().queryKey });
        toast.success("Guild deleted.");
        navigate({ to: "/" });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (guildQuery.isPending) {
    return <div className="px-4 py-8 text-muted-foreground">Loading…</div>;
  }
  if (!guildQuery.data) return null;
  if (!isOwner) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-muted-foreground">Only the owner can manage this guild.</p>
        <Link to="/guilds/$guildId" params={{ guildId }} className="text-primary hover:underline">
          Back to guild
        </Link>
      </div>
    );
  }

  const { guild: g, members } = guildQuery.data;
  const otherMembers = members.filter((m) => m.userId !== g.ownerId);
  const memberItems = otherMembers.map((m) => ({
    label: m.displayName || m.username || m.userId,
    value: m.userId,
  }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1 md:hidden" />
          <h1 className="text-lg font-medium">{g.name} — settings</h1>
        </div>
        <Link to="/guilds/$guildId" params={{ guildId }} className="text-primary hover:underline">
          Back to guild
        </Link>
      </div>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>Remove or ban members. You can’t target yourself.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y divide-foreground/10">
            {members.map((m) => {
              const isGuildOwner = m.userId === g.ownerId;
              return (
                <li key={m.userId} className="flex items-center gap-3 py-2">
                  <span className="text-sm">{m.displayName || m.username || m.userId}</span>
                  {m.username && (
                    <span className="text-xs text-muted-foreground">@{m.username}</span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {isGuildOwner ? "Owner" : "@everyone"}
                  </span>
                  {!isGuildOwner && (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={kick.isPending}
                        onClick={() => kick.mutate({ guildId, userId: m.userId })}
                      >
                        Kick
                      </Button>
                      <Button
                        size="xs"
                        variant="destructive"
                        disabled={ban.isPending}
                        onClick={() => ban.mutate({ guildId, userId: m.userId })}
                      >
                        Ban
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* Invites */}
      <Card>
        <CardHeader>
          <CardTitle>Invites</CardTitle>
          <CardDescription>Shareable codes. Time-only expiry; reusable.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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

          {invitesQuery.data && invitesQuery.data.length > 0 ? (
            <ul className="flex flex-col divide-y divide-foreground/10">
              {invitesQuery.data.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 py-2">
                  <code className="font-mono text-sm">{inv.code}</code>
                  <span className="text-xs text-muted-foreground">
                    {inv.expiresAt
                      ? `expires ${inv.expiresAt.toLocaleDateString()}`
                      : "never expires"}
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
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card>
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
          <CardDescription>Transfer ownership or delete this guild.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
              <AlertDialogTrigger
                render={<Button size="sm" variant="outline" disabled={!transferTo} />}
              >
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
                    onClick={() =>
                      transferTo && transfer.mutate({ guildId, newOwnerUserId: transferTo })
                    }
                  >
                    Transfer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <AlertDialog>
            <AlertDialogTrigger render={<Button size="sm" variant="destructive" />}>
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
        </CardContent>
      </Card>
    </div>
  );
}

import { hasPermission, PERMISSIONS } from "@konus-la/api/permissions";
import { Button } from "@konus-la/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@konus-la/ui/components/popover";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { RoleDot } from "@/components/guild-settings/role-dot";
import { useMemberModeration } from "@/components/member-moderation";
import type { GuildRole } from "@/lib/roles";
import { highestRoleOf, memberRolesOf } from "@/lib/roles";
import { orpc, queryClient } from "@/utils/orpc";

export function MembersSection({ guildId }: { guildId: string }) {
  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));
  const { session } = getRouteApi("/(app)").useRouteContext();
  const guildKey = orpc.guild.get.queryOptions({ input: { guildId } }).queryKey;
  const invalidateGuild = () => queryClient.invalidateQueries({ queryKey: guildKey });

  const { canKick, canBan, kick, ban } = useMemberModeration(guildId);

  const assign = useMutation(
    orpc.role.assign.mutationOptions({
      onSuccess: () => invalidateGuild(),
      onError: (error) => toast.error(error.message),
    }),
  );
  const unassign = useMutation(
    orpc.role.unassign.mutationOptions({
      onSuccess: () => invalidateGuild(),
      onError: (error) => toast.error(error.message),
    }),
  );

  if (guild.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (!guild.data) return null;

  const { guild: g, members, roles, viewer } = guild.data;
  const canManageRoles = hasPermission(viewer.permissions, PERMISSIONS.MANAGE_ROLES);
  // The "+" popover offers only strictly-below roles (charter rule — the server enforces
  // it too). The owner outranks the whole stack; a roleless viewer outranks nothing.
  const viewerHighestPosition = viewer.isOwner
    ? Number.POSITIVE_INFINITY
    : (highestRoleOf(roles, members.find((m) => m.userId === session.user.id)?.roleIds ?? [])
        ?.position ?? 0);
  const assignableRoles = roles.filter(
    (role) => !role.isDefault && role.position < viewerHighestPosition,
  );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Manage roles, remove, or ban members. You can’t kick or ban yourself.
      </p>
      <ul className="flex flex-col divide-y divide-foreground/10">
        {members.map((m) => {
          const isGuildOwner = m.userId === g.ownerId;
          const memberRoles = memberRolesOf(roles, m.roleIds);
          const addable = assignableRoles.filter((role) => !m.roleIds.includes(role.id));
          return (
            <li key={m.userId} className="flex items-center gap-3 py-2">
              <span className="shrink-0 text-sm">{m.displayName || m.username || m.userId}</span>
              {m.username && (
                <span className="shrink-0 text-xs text-muted-foreground">@{m.username}</span>
              )}
              <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
                {memberRoles.map((role) => (
                  <RoleChip
                    key={role.id}
                    role={role}
                    onRemove={
                      canManageRoles
                        ? () => unassign.mutate({ guildId, userId: m.userId, roleId: role.id })
                        : undefined
                    }
                  />
                ))}
                {canManageRoles && addable.length > 0 && (
                  <Popover>
                    <PopoverTrigger
                      render={
                        <button
                          type="button"
                          aria-label="Assign role"
                          title="Assign role"
                          className="flex size-5 items-center justify-center rounded-full border border-foreground/15 text-muted-foreground hover:bg-muted hover:text-foreground"
                        />
                      }
                    >
                      <PlusIcon className="size-3" />
                    </PopoverTrigger>
                    <PopoverContent align="end" className="flex w-44 flex-col gap-0.5 p-1.5">
                      {addable.map((role) => (
                        <button
                          key={role.id}
                          type="button"
                          disabled={assign.isPending}
                          className="flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted"
                          onClick={() =>
                            assign.mutate({ guildId, userId: m.userId, roleId: role.id })
                          }
                        >
                          <RoleDot color={role.color} />
                          <span className="truncate">{role.name}</span>
                        </button>
                      ))}
                    </PopoverContent>
                  </Popover>
                )}
                {isGuildOwner && <span className="text-xs text-muted-foreground">Owner</span>}
              </div>
              {!isGuildOwner && m.userId !== session.user.id && (canKick || canBan) && (
                <div className="flex shrink-0 items-center gap-1.5">
                  {canKick && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={kick.isPending}
                      onClick={() => kick.mutate({ guildId, userId: m.userId })}
                    >
                      Kick
                    </Button>
                  )}
                  {canBan && (
                    <Button
                      size="xs"
                      variant="destructive"
                      disabled={ban.isPending}
                      onClick={() => ban.mutate({ guildId, userId: m.userId })}
                    >
                      Ban
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One assignment pill. No hierarchy-aware greying (spec #47): the × shows with the
 *  permission and a role-hierarchy miss (the role at or above the viewer's highest)
 *  surfaces as the server's FORBIDDEN toast. */
function RoleChip({ role, onRemove }: { role: GuildRole; onRemove?: () => void }) {
  return (
    <span className="flex items-center gap-1 rounded-full border border-foreground/10 bg-muted/50 py-0.5 pr-1 pl-1.5 text-xs">
      <RoleDot color={role.color} />
      <span className="max-w-24 truncate">{role.name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${role.name}`}
          title={`Remove ${role.name}`}
          className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onRemove}
        >
          <XIcon className="size-3" />
        </button>
      )}
    </span>
  );
}

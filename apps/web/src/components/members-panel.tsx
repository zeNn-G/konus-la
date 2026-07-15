import { Button } from "@konus-la/ui/components/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@konus-la/ui/components/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@konus-la/ui/components/popover";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { cn } from "@konus-la/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { CrownIcon, MessageSquareIcon } from "lucide-react";

import { MemberModerationItems, useMemberModeration } from "@/components/member-moderation";
import { PresenceAvatar } from "@/components/presence-avatar";
import type { GuildRole } from "@/lib/roles";
import { highestRoleOf, roleColorOf } from "@/lib/roles";
import { useMessageUser } from "@/lib/use-message-user";
import { usePresence } from "@/lib/use-realtime";
import { orpc } from "@/utils/orpc";

type MemberGroup<M> = { key: string; label: string; color: string | null; members: M[] };

/**
 * Role buckets (spec #48): one group per custom role holding the members whose HIGHEST
 * role it is, rank order, roleless members last under "Members". Group headers carry the
 * group role's color; empty groups are dropped. Presence stays on the avatar dot — there
 * are no online/offline buckets inside groups.
 */
function groupByHighestRole<M extends { userId: string; roleIds: string[] }>(
  members: M[],
  roles: GuildRole[],
): MemberGroup<M>[] {
  const buckets = new Map<string | null, M[]>();
  for (const m of members) {
    const key = highestRoleOf(roles, m.roleIds)?.id ?? null;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(m);
    else buckets.set(key, [m]);
  }
  const groups: MemberGroup<M>[] = roles
    .filter((role) => !role.isDefault)
    .map((role) => {
      const roleMembers = buckets.get(role.id) ?? [];
      return {
        key: role.id,
        label: `${role.name} — ${roleMembers.length}`,
        color: role.color,
        members: roleMembers,
      };
    });
  const roleless = buckets.get(null) ?? [];
  groups.push({
    key: "members",
    label: `Members — ${roleless.length}`,
    color: null,
    members: roleless,
  });
  return groups.filter((group) => group.members.length > 0);
}

/** Guild roster grouped by highest role. Caller owns width, border, and display breakpoints. */
export function MembersPanel({ guildId, className }: { guildId: string; className?: string }) {
  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));
  const presence = usePresence();
  const { session } = getRouteApi("/(app)").useRouteContext();
  const messageUser = useMessageUser();
  const { canKick, canBan } = useMemberModeration(guildId);

  if (guild.isPending) {
    return (
      <aside className={cn("flex-col gap-0.5 overflow-y-auto px-2 py-3", className)}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5">
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </aside>
    );
  }
  // Stale roster after a kick/ban resolves to an error — show nothing rather than crash.
  if (!guild.data) return null;

  const { guild: g, members, roles } = guild.data;
  const groups = groupByHighestRole(members, roles);

  return (
    <aside className={cn("flex-col overflow-y-auto pb-2", className)}>
      {groups.map((group) => (
        <section key={group.key}>
          <h2
            className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground"
            style={{ color: group.color ?? undefined }}
          >
            {group.label}
          </h2>
          <div className="flex flex-col gap-0.5 px-2">
            {group.members.map((m) => {
              const name = m.displayName || m.username || m.userId;
              const online = m.userId === session.user.id || presence[m.userId] === true;
              // Kick/ban ride a right-click menu on the row (spec #48). Self and the owner
              // are never valid targets; rank misses still surface as the server's FORBIDDEN.
              const moderatable =
                (canKick || canBan) && m.userId !== session.user.id && m.userId !== g.ownerId;
              const rowTrigger = (
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted data-popup-open:bg-muted"
                    />
                  }
                >
                  <PresenceAvatar seed={m.username ?? m.userId} src={m.image} online={online} />
                  <span
                    className="truncate"
                    style={{ color: roleColorOf(roles, m.roleIds) ?? undefined }}
                  >
                    {name}
                  </span>
                  {m.userId === g.ownerId && (
                    <CrownIcon
                      aria-label="Guild owner"
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  )}
                </PopoverTrigger>
              );
              return (
                <Popover key={m.userId}>
                  {moderatable ? (
                    <ContextMenu>
                      <ContextMenuTrigger render={rowTrigger} />
                      <ContextMenuContent className="w-44">
                        <MemberModerationItems guildId={guildId} userId={m.userId} />
                      </ContextMenuContent>
                    </ContextMenu>
                  ) : (
                    rowTrigger
                  )}
                  <PopoverContent align="start" side="left" className="w-56 p-3">
                    <div className="flex items-center gap-3">
                      <PresenceAvatar
                        seed={m.username ?? m.userId}
                        src={m.image}
                        online={online}
                        className="size-10"
                        dotClassName="size-3"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{name}</p>
                        {m.username && (
                          <p className="truncate text-xs text-muted-foreground">@{m.username}</p>
                        )}
                      </div>
                    </div>
                    {m.userId !== session.user.id && (
                      <Button
                        size="sm"
                        className="mt-3 w-full"
                        onClick={() => void messageUser(m.userId)}
                      >
                        <MessageSquareIcon className="size-4" />
                        Message
                      </Button>
                    )}
                  </PopoverContent>
                </Popover>
              );
            })}
          </div>
        </section>
      ))}
    </aside>
  );
}

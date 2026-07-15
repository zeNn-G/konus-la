import { Button } from "@konus-la/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@konus-la/ui/components/popover";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { cn } from "@konus-la/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { CrownIcon, MessageSquareIcon } from "lucide-react";

import { useEffect } from "react";

import {
  EVERYONE_ID,
  customRolesByRank,
  highestRole,
  roleColorFor,
  seedAssignments,
  usePrototypeRoles,
} from "@/components/guild-settings/roles-prototype/store";
import { useRolesVariant } from "@/components/guild-settings/roles-prototype/use-variant";
import { PresenceAvatar } from "@/components/presence-avatar";
import { useMessageUser } from "@/lib/use-message-user";
import { usePresence } from "@/lib/use-realtime";
import { orpc } from "@/utils/orpc";

type MemberGroup<M> = {
  key: string;
  label: string;
  dimmed?: boolean;
  color?: string | null;
  members: M[];
};

// PROTOTYPE (wayfinder #48): the "role buckets later" this file predicted — group by
// highest custom role (rank order), everyone-only members last.
function groupByHighestRole<M extends { userId: string }>(
  members: M[],
  roles: ReturnType<typeof usePrototypeRoles>["roles"],
): MemberGroup<M>[] {
  const buckets = new Map<string, M[]>();
  for (const m of members) {
    const top = highestRole(m.userId);
    const key = top?.id ?? EVERYONE_ID;
    buckets.set(key, [...(buckets.get(key) ?? []), m]);
  }
  const groups: MemberGroup<M>[] = customRolesByRank(roles).map((role) => ({
    key: role.id,
    label: `${role.name} — ${(buckets.get(role.id) ?? []).length}`,
    color: role.color,
    members: buckets.get(role.id) ?? [],
  }));
  const everyone = buckets.get(EVERYONE_ID) ?? [];
  groups.push({ key: EVERYONE_ID, label: `Members — ${everyone.length}`, members: everyone });
  return groups.filter((group) => group.members.length > 0);
}

/**
 * Presence buckets today; role buckets later are just another function returning the
 * same shape. Empty groups are dropped. Your own row is always online — you're here.
 */
function groupByPresence<M extends { userId: string }>(
  members: M[],
  presence: Record<string, boolean>,
  selfUserId: string,
): MemberGroup<M>[] {
  const online: M[] = [];
  const offline: M[] = [];
  for (const m of members) {
    (m.userId === selfUserId || presence[m.userId] === true ? online : offline).push(m);
  }
  return [
    { key: "online", label: `Online — ${online.length}`, members: online },
    { key: "offline", label: `Offline — ${offline.length}`, dimmed: true, members: offline },
  ].filter((group) => group.members.length > 0);
}

/** Guild roster grouped by presence. Caller owns width, border, and display breakpoints. */
export function MembersPanel({ guildId, className }: { guildId: string; className?: string }) {
  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));
  const presence = usePresence();
  const { session } = getRouteApi("/(app)").useRouteContext();
  const messageUser = useMessageUser();

  // PROTOTYPE (wayfinder #48): subscribe to the in-memory role store and seed it with
  // real member ids so grouping/tints react to edits made in the settings dialog.
  const variant = useRolesVariant();
  const { roles } = usePrototypeRoles();
  useEffect(() => {
    if (variant && guild.data) {
      seedAssignments(
        guild.data.members.map((m) => m.userId),
        guild.data.guild.ownerId,
      );
    }
  }, [variant, guild.data]);

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

  const { guild: g, members } = guild.data;
  const groups = variant
    ? groupByHighestRole(members, roles)
    : groupByPresence(members, presence, session.user.id);

  return (
    <aside className={cn("flex-col overflow-y-auto pb-2", className)}>
      {groups.map((group) => (
        <section key={group.key} className={cn(group.dimmed && "opacity-60")}>
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
              return (
                <Popover key={m.userId}>
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
                      style={variant ? { color: roleColorFor(m.userId) ?? undefined } : undefined}
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

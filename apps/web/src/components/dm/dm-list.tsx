import { Avatar } from "@konus-la/ui/components/avatar";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { cn } from "@konus-la/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PresenceAvatar } from "@/components/presence-avatar";
import { dmDisplayName, dmOtherParticipant } from "@/lib/dm";
import type { DmListItem } from "@/lib/use-realtime";
import { usePresence } from "@/lib/use-realtime";
import { orpc } from "@/utils/orpc";

/**
 * The Home conversation list: `dm.list` rows sorted by last activity (re-sorted here so
 * dispatcher patches reorder live), unread bold + mention badge like the channel sidebar.
 * Rendered inside the DM sidebar on desktop and as the `/` page itself on mobile.
 */
export function DmList({ selfUserId, className }: { selfUserId: string; className?: string }) {
  const dms = useQuery(orpc.dm.list.queryOptions());
  const presence = usePresence();

  const rows = [...(dms.data ?? [])].sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  return (
    <nav className={cn("flex flex-col gap-0.5 px-2 py-2", className)}>
      {dms.isPending &&
        Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5">
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      {rows.length === 0 && !dms.isPending && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          No conversations yet. Start one!
        </p>
      )}
      {rows.map((row) => (
        <Link
          key={row.id}
          to="/dms/$channelId"
          params={{ channelId: row.id }}
          className={cn(
            "flex items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
            row.unread && "font-semibold text-foreground",
          )}
          activeProps={{ className: "bg-muted text-foreground" }}
        >
          <DmRowAvatar row={row} selfUserId={selfUserId} presence={presence} />
          <span className="truncate">{dmDisplayName(row, selfUserId)}</span>
          {row.mentionsCount > 0 && (
            <span className="ml-auto rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">
              {row.mentionsCount}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

/** 1:1 → partner avatar + presence dot; group → two stacked participant avatars. */
function DmRowAvatar({
  row,
  selfUserId,
  presence,
}: {
  row: DmListItem;
  selfUserId: string;
  presence: Record<string, boolean>;
}) {
  if (!row.isGroup) {
    const other = dmOtherParticipant(row, selfUserId);
    const online = other ? presence[other.userId] === true : false;
    return (
      <PresenceAvatar seed={other?.username ?? row.id} src={other?.image ?? null} online={online} />
    );
  }

  const faces = row.participants.filter((p) => p.userId !== selfUserId).slice(0, 2);
  const [first, second] = faces;
  if (!second) {
    return (
      <Avatar seed={first?.username ?? row.id} src={first?.image ?? null} className="size-6 shrink-0" />
    );
  }
  return (
    <div className="relative size-6 shrink-0">
      <Avatar
        seed={first?.username ?? row.id}
        src={first?.image ?? null}
        className="absolute top-0 left-0 size-4.5"
      />
      <Avatar
        seed={second.username ?? second.userId}
        src={second.image}
        className="absolute right-0 bottom-0 size-4.5 ring-2 ring-background"
      />
    </div>
  );
}

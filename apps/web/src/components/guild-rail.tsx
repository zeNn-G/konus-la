import { GuildIcon } from "@konus-la/ui/components/guild-icon";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { HomeIcon } from "lucide-react";

import { CreateGuildDialog } from "@/components/create-guild-dialog";
import { JoinGuildDialog } from "@/components/join-guild-dialog";
import { orpc } from "@/utils/orpc";

/**
 * Persistent left rail: a home entry, the guilds the user belongs to (icons from
 * `guild.list`), and create/join triggers. Refetched via TanStack Query invalidation
 * after create/join mutations.
 */
export function GuildRail() {
  const guilds = useQuery(orpc.guild.list.queryOptions());

  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-foreground/10 py-3">
      <Link
        to="/"
        aria-label="Home"
        title="Home"
        activeOptions={{ exact: true }}
        className="flex size-10 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
        activeProps={{ className: "bg-muted text-foreground" }}
      >
        <HomeIcon className="size-5" />
      </Link>

      <div className="h-px w-8 bg-foreground/10" />

      {guilds.data?.map((g) => (
        <Link
          key={g.id}
          to="/guilds/$guildId"
          params={{ guildId: g.id }}
          title={g.name}
          aria-label={g.name}
          className="opacity-90 transition-opacity hover:opacity-100"
          activeProps={{ className: "opacity-100 ring-1 ring-foreground" }}
        >
          <GuildIcon seed={g.id} src={g.icon} alt={g.name} className="size-10" />
        </Link>
      ))}

      <div className="mt-auto flex flex-col items-center gap-2">
        <CreateGuildDialog />
        <JoinGuildDialog />
      </div>
    </nav>
  );
}

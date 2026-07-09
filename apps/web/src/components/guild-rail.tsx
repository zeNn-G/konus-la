import { GuildIcon } from "@konus-la/ui/components/guild-icon";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@konus-la/ui/components/sidebar";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@konus-la/ui/components/tooltip";
import { cn } from "@konus-la/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { AddGuildDialog } from "@/components/add-guild-dialog";
import { useSidebarZone } from "@/lib/sidebar-zone";
import { orpc } from "@/utils/orpc";

/**
 * Persistent icon rail: the konus-la home entry (the DM zone), the guilds the user
 * belongs to (icons from `guild.list`), and create/join triggers. Refetched via
 * TanStack Query invalidation after create/join mutations.
 */
export function GuildRail() {
  const guilds = useQuery(orpc.guild.list.queryOptions());
  const zone = useSidebarZone();

  return (
    // Fixed w-16 (not the sidebar CSS vars): the mobile sheet portals to <body>, where
    // provider-level vars don't cascade. Must match RAIL_WIDTH in (app)/route.tsx.
    <Sidebar collapsible="none" className="w-16 shrink-0 border-r border-sidebar-border">
      <SidebarHeader className="items-center gap-3 pt-4">
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                to="/"
                aria-label="Home"
                className={cn(
                  "flex size-10 items-center justify-center text-lg font-semibold text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  zone.zone === "home" && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
              />
            }
          >
            k
          </TooltipTrigger>
          <TooltipContent side="right">konus-la — home</TooltipContent>
        </Tooltip>
        <div className="h-px w-8 bg-sidebar-border" />
      </SidebarHeader>

      <SidebarContent className="items-center gap-3 py-2">
        {guilds.isPending &&
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="size-10 shrink-0" />)}
        {guilds.data?.map((g) => (
          <Tooltip key={g.id}>
            <TooltipTrigger
              render={
                <Link
                  to="/guilds/$guildId"
                  params={{ guildId: g.id }}
                  aria-label={g.name}
                  className="opacity-90 transition-opacity hover:opacity-100"
                  activeProps={{ className: "opacity-100 ring-1 ring-sidebar-primary" }}
                />
              }
            >
              <GuildIcon seed={g.id} src={g.icon} alt={g.name} className="size-10" />
            </TooltipTrigger>
            <TooltipContent side="right">{g.name}</TooltipContent>
          </Tooltip>
        ))}
      </SidebarContent>

      <SidebarFooter className="items-center">
        <AddGuildDialog />
      </SidebarFooter>
    </Sidebar>
  );
}

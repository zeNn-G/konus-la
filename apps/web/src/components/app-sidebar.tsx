import { Sidebar, useSidebar } from "@konus-la/ui/components/sidebar";
import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import { ChannelSidebar } from "@/components/channel-sidebar";
import { DmSidebar } from "@/components/dm/dm-sidebar";
import { GuildRail } from "@/components/guild-rail";
import { useSidebarZone } from "@/lib/sidebar-zone";

/**
 * Nested-rails panel (shadcn sidebar-09 shape): the guild icon rail is always present,
 * the second column follows the zone. Desktop collapses to the rail alone; on mobile the
 * whole panel is a sheet, so every navigation closes it.
 */
export function AppSidebar({ selfUserId }: { selfUserId: string }) {
  const zone = useSidebarZone();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { setOpenMobile } = useSidebar();

  // Keyed on the actual location: router events (onResolved) also fire for hover
  // preloads, which would close the sheet the moment it opens under the cursor.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  return (
    <Sidebar collapsible="icon" className="overflow-hidden">
      <div className="flex h-full w-full">
        <GuildRail />
        {zone.zone === "guild" && <ChannelSidebar key={zone.guildId} guildId={zone.guildId} />}
        {zone.zone === "home" && <DmSidebar selfUserId={selfUserId} />}
      </div>
    </Sidebar>
  );
}

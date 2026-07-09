import { SidebarInset, SidebarProvider } from "@konus-la/ui/components/sidebar";
import { TooltipProvider } from "@konus-la/ui/components/tooltip";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import type { CSSProperties } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { requireSession } from "@/lib/auth-guard";
import { useSidebarZone } from "@/lib/sidebar-zone";
import { useRealtime } from "@/lib/use-realtime";

export const Route = createFileRoute("/(app)")({
  beforeLoad: async ({ context }) => ({
    session: await requireSession(context.queryClient),
  }),
  component: AppLayout,
});

const RAIL_WIDTH = "4rem";
const PANEL_WIDTH = "18rem";

function AppLayout() {
  const { session } = Route.useRouteContext();
  useRealtime(session.user.id);
  const zone = useSidebarZone();

  return (
    <TooltipProvider>
      <SidebarProvider
        // Desktop panel is pinned open; the trigger/sheet only exist on mobile.
        open
        className="h-full min-h-0"
        style={
          {
            // Rail-only zones shrink the panel to just the icon rail (GuildRail's w-16).
            "--sidebar-width": zone.zone === "rail-only" ? RAIL_WIDTH : PANEL_WIDTH,
          } as CSSProperties
        }
      >
        <AppSidebar selfUserId={session.user.id} />
        <SidebarInset className="min-h-0 overflow-y-auto">
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

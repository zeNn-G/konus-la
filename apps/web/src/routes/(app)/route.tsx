import { SidebarInset, SidebarProvider } from "@konus-la/ui/components/sidebar";
import { TooltipProvider } from "@konus-la/ui/components/tooltip";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useEffect, type CSSProperties } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { VoiceAudioBridge } from "@/components/voice-audio-bridge";
import { requireSession } from "@/lib/auth-guard";
import { useSidebarZone } from "@/lib/sidebar-zone";
import { initSoundEffects } from "@/lib/sound-effects";
import { useRealtime } from "@/lib/use-realtime";
import { deviceManager } from "@/lib/voice/session";

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

  // Device watcher (#25): `devicechange` fallback/replug handling lives for the whole
  // authenticated shell, like the audio bridge. Idempotent across remounts.
  useEffect(() => {
    void deviceManager.start();
    // Sound effects (#79): preload buffers and arm the first-gesture activation.
    initSoundEffects();
  }, []);

  return (
    <TooltipProvider>
      <VoiceAudioBridge />
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

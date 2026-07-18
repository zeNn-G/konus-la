import { SidebarInset, SidebarProvider } from "@konus-la/ui/components/sidebar";
import { TooltipProvider } from "@konus-la/ui/components/tooltip";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, type CSSProperties } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { UserSettingsDialog } from "@/components/user-settings/user-settings-dialog";
import { VoiceAudioBridge } from "@/components/voice-audio-bridge";
import { requireSession } from "@/lib/auth-guard";
import { maybeShowNotificationNudge } from "@/lib/desktop-notifications";
import { registerNotificationNavigate } from "@/lib/notification-dispatcher";
import { initSoundEffects } from "@/lib/sound-effects";
import { useRealtime } from "@/lib/use-realtime";
import { deviceManager } from "@/lib/voice/session";

export const Route = createFileRoute("/(app)")({
  beforeLoad: async ({ context }) => ({
    session: await requireSession(context.queryClient),
  }),
  component: AppLayout,
});

const PANEL_WIDTH = "18rem";

function AppLayout() {
  const { session } = Route.useRouteContext();
  const navigate = useNavigate();
  useRealtime(session.user.id);

  // Device watcher (#25): `devicechange` fallback/replug handling lives for the whole
  // authenticated shell, like the audio bridge. Idempotent across remounts.
  useEffect(() => {
    void deviceManager.start();
    // Sound effects (#79): preload buffers and arm the first-gesture activation.
    initSoundEffects();
    // One-time post-sign-in desktop-notifications nudge (#75).
    maybeShowNotificationNudge();
  }, []);

  // OS-toast clicks land on the source channel; the dispatcher borrows this navigate.
  useEffect(
    () =>
      registerNotificationNavigate(({ guildId, channelId }) => {
        if (guildId === null) {
          void navigate({ to: "/dms/$channelId", params: { channelId } });
        } else {
          void navigate({
            to: "/guilds/$guildId/channels/$channelId",
            params: { guildId, channelId },
          });
        }
      }),
    [navigate],
  );

  return (
    <TooltipProvider>
      <VoiceAudioBridge />
      <UserSettingsDialog />
      <SidebarProvider
        // Desktop panel is pinned open; the trigger/sheet only exist on mobile.
        open
        className="h-full min-h-0"
        style={{ "--sidebar-width": PANEL_WIDTH } as CSSProperties}
      >
        <AppSidebar selfUserId={session.user.id} />
        <SidebarInset className="min-h-0 overflow-y-auto">
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

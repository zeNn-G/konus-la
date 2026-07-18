import { Dialog, DialogContent, DialogTitle } from "@konus-la/ui/components/dialog";
import { Separator } from "@konus-la/ui/components/separator";
import { cn } from "@konus-la/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import { GavelIcon, KeyRoundIcon, LogOutIcon, MicIcon, UserIcon } from "lucide-react";
import { getRouteApi } from "@tanstack/react-router";

import { BansSection } from "@/components/user-settings/bans-section";
import { CodesSection } from "@/components/user-settings/codes-section";
import { ProfileSection } from "@/components/user-settings/profile-section";
import { VoiceSection } from "@/components/user-settings/voice-section";
import { authClient } from "@/lib/auth-client";
import { useUserSettings, type UserSettingsSection } from "@/lib/user-settings";
import { voiceSession } from "@/lib/voice/session";

const appRoute = getRouteApi("/(app)");

type NavSection = { id: UserSettingsSection; label: string; icon: LucideIcon };

const SECTIONS: NavSection[] = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "voice", label: "Voice", icon: MicIcon },
];

/** Instance-admin surfaces — `role === "admin"` only. */
const ADMIN_SECTIONS: NavSection[] = [
  { id: "codes", label: "Invite codes", icon: KeyRoundIcon },
  { id: "bans", label: "Instance bans", icon: GavelIcon },
];

async function signOut() {
  // Logout is a teardown trigger (unlike navigation): explicit leave, no grace.
  await voiceSession.leave();
  await authClient.signOut({
    fetchOptions: {
      onSuccess: () => {
        window.location.href = "/login";
      },
    },
  });
}

/**
 * User-settings modal: nav rail (desktop) / horizontal section row (mobile) beside a
 * scrollable content pane. The Admin group and Sign out pin to the rail bottom. Opened
 * only through the `useUserSettings` store.
 */
export function UserSettingsDialog() {
  const { session } = appRoute.useRouteContext();
  const open = useUserSettings((s) => s.open);
  const stored = useUserSettings((s) => s.section);
  const openAt = useUserSettings((s) => s.openAt);
  const close = useUserSettings((s) => s.close);

  const isAdmin = session.user.role === "admin";
  const sections = isAdmin ? [...SECTIONS, ...ADMIN_SECTIONS] : SECTIONS;
  // A non-admin can still be pointed at an admin section (any call site can name one) —
  // snap to Profile rather than render an empty pane.
  const section = sections.some((s) => s.id === stored) ? stored : "profile";

  const navButton = (s: NavSection, mobile: boolean) => (
    <button
      key={s.id}
      type="button"
      onClick={() => openAt(s.id)}
      className={cn(
        "flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent",
        mobile && "shrink-0 whitespace-nowrap",
        section === s.id && "bg-sidebar-accent",
      )}
    >
      <s.icon className="size-4 shrink-0 opacity-70" />
      {s.label}
    </button>
  );

  const signOutButton = (mobile: boolean) => (
    <button
      type="button"
      onClick={() => void signOut()}
      className={cn(
        "flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-sidebar-accent",
        mobile && "shrink-0 whitespace-nowrap",
      )}
    >
      <LogOutIcon className="size-4 shrink-0 opacity-70" />
      Sign out
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:top-1/2 sm:left-1/2 sm:h-[min(90vh,760px)] sm:max-w-5xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:flex-row">
        <DialogTitle className="sr-only">User settings</DialogTitle>

        <div className="hidden w-55 shrink-0 flex-col gap-0.5 border-r border-sidebar-border bg-sidebar p-2 sm:flex">
          <div className="px-2 py-1.5 text-sm font-medium">
            <span className="block truncate">@{session.user.username ?? session.user.email}</span>
          </div>
          <Separator className="my-1" />
          {SECTIONS.map((s) => navButton(s, false))}
          <div className="mt-auto flex flex-col gap-0.5">
            {isAdmin && (
              <>
                <Separator className="my-1" />
                <div className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Admin
                </div>
                {ADMIN_SECTIONS.map((s) => navButton(s, false))}
              </>
            )}
            <Separator className="my-1" />
            {signOutButton(false)}
          </div>
        </div>

        {/* pr clears the dialog's X button. */}
        <div className="flex gap-1 overflow-x-auto border-b border-sidebar-border bg-sidebar p-2 pr-12 sm:hidden">
          {sections.map((s) => navButton(s, true))}
          {signOutButton(true)}
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
          <h2 className="mb-4 text-sm font-medium">
            {sections.find((s) => s.id === section)?.label}
          </h2>
          {section === "profile" && <ProfileSection />}
          {section === "voice" && <VoiceSection />}
          {section === "codes" && isAdmin && <CodesSection />}
          {section === "bans" && isAdmin && <BansSection />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

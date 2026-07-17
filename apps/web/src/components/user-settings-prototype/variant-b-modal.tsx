// PROTOTYPE — THROWAWAY (wayfinder ticket #77). Variant B after first reaction:
// GuildSettingsDialog shell grown to 5xl, the UserCard unified into it (admin
// shortcuts + sign-out live at the rail bottom, A-style), and A's device pickers
// baked into Voice — the ControlDeck gear opens this dialog instead of the popover.

import { Dialog, DialogContent, DialogTitle } from "@konus-la/ui/components/dialog";
import { Separator } from "@konus-la/ui/components/separator";
import { cn } from "@konus-la/ui/lib/utils";
import { BellIcon, GavelIcon, KeyRoundIcon, LogOutIcon, UserIcon, Volume2Icon } from "lucide-react";
import { toast } from "sonner";

import { AdminBansSection, AdminCodesSection } from "./admin-sections";
import {
  DeviceVolumeGrid,
  NotificationDefaultFields,
  NotificationPermissionField,
  NotificationSoundField,
  ProfileFields,
  SoundFields,
} from "./shared";
import { usePrototypeStore, type SettingsSection } from "./store";

const SECTIONS: { id: SettingsSection; label: string; icon: typeof UserIcon }[] = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "voice", label: "Voice", icon: Volume2Icon },
  { id: "notifications", label: "Notifications", icon: BellIcon },
];

/** Admin surfaces baked in as sections (second reaction) — admin viewers only. */
const ADMIN_SECTIONS: { id: SettingsSection; label: string; icon: typeof UserIcon }[] = [
  { id: "codes", label: "Invite codes", icon: KeyRoundIcon },
  { id: "bans", label: "Instance bans", icon: GavelIcon },
];

/** Voice-UX sounds only — the notification ping is toggled in Notifications here. */
const VOICE_SOUNDS = [
  "selfJoin",
  "selfLeave",
  "muteToggle",
  "deafenToggle",
  "peerJoinLeave",
] as const;

export function VariantBModal({
  user,
}: {
  user: { name: string; username: string; image?: string | null; isAdmin: boolean };
}) {
  const open = usePrototypeStore((s) => s.open);
  const section = usePrototypeStore((s) => s.section);
  const openAt = usePrototypeStore((s) => s.openAt);
  const close = usePrototypeStore((s) => s.close);

  const navButton = (s: (typeof SECTIONS)[number], mobile: boolean) => (
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:top-1/2 sm:left-1/2 sm:h-[min(90vh,760px)] sm:max-w-5xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:flex-row">
        <DialogTitle className="sr-only">User settings</DialogTitle>

        <div className="hidden w-[220px] shrink-0 flex-col gap-0.5 border-r border-sidebar-border bg-sidebar p-2 sm:flex">
          <div className="px-2 py-1.5 text-sm font-medium">
            <span className="block truncate">@{user.username}</span>
          </div>
          <Separator className="my-1" />
          {SECTIONS.map((s) => navButton(s, false))}
          <div className="mt-auto flex flex-col gap-0.5">
            {user.isAdmin && (
              <>
                <Separator className="my-1" />
                <div className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Admin
                </div>
                {ADMIN_SECTIONS.map((s) => navButton(s, false))}
              </>
            )}
            <Separator className="my-1" />
            <button
              type="button"
              onClick={() => toast("Prototype — sign-out lives here in variant B.")}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-sidebar-accent"
            >
              <LogOutIcon className="size-4 shrink-0 opacity-70" /> Sign out
            </button>
          </div>
        </div>

        {/* pr clears the dialog's X button. */}
        <div className="flex gap-1 overflow-x-auto border-b border-sidebar-border bg-sidebar p-2 pr-12 sm:hidden">
          {SECTIONS.map((s) => navButton(s, true))}
          {user.isAdmin && ADMIN_SECTIONS.map((s) => navButton(s, true))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
          <h2 className="mb-4 text-sm font-medium">
            {[...SECTIONS, ...ADMIN_SECTIONS].find((s) => s.id === section)?.label}
          </h2>
          {section === "profile" && <ProfileFields {...user} />}
          {section === "voice" && (
            <div className="flex flex-col gap-6">
              <DeviceVolumeGrid />
              <SoundFields title="Voice sounds" only={[...VOICE_SOUNDS]} />
            </div>
          )}
          {section === "notifications" && (
            <div className="flex flex-col gap-6">
              <NotificationPermissionField />
              <NotificationDefaultFields />
              <NotificationSoundField />
            </div>
          )}
          {section === "codes" && user.isAdmin && <AdminCodesSection />}
          {section === "bans" && user.isAdmin && <AdminBansSection />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

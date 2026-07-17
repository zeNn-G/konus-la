// PROTOTYPE — THROWAWAY (wayfinder ticket #77). Variant A: Discord-faithful
// full-screen takeover. Grouped nav rail owns everything the sidebar footer used to
// link to — admin shortcuts and sign-out move in here; devices move in from the
// ControlDeck popover (the deck gear opens this dialog at Voice).

import { Dialog, DialogContent, DialogTitle } from "@konus-la/ui/components/dialog";
import { Separator } from "@konus-la/ui/components/separator";
import { cn } from "@konus-la/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
  BellIcon,
  GavelIcon,
  KeyRoundIcon,
  LogOutIcon,
  UserIcon,
  Volume2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  DeviceFields,
  MasterVolumeField,
  NotificationDefaultFields,
  NotificationPermissionField,
  ProfileFields,
  SoundFields,
} from "./shared";
import { usePrototypeStore, type SettingsSection } from "./store";

const SECTIONS: { id: SettingsSection; label: string; icon: typeof UserIcon }[] = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "voice", label: "Voice", icon: Volume2Icon },
  { id: "notifications", label: "Notifications", icon: BellIcon },
];

export function VariantATakeover({
  user,
}: {
  user: { name: string; username: string; image?: string | null; isAdmin: boolean };
}) {
  const open = usePrototypeStore((s) => s.open);
  const section = usePrototypeStore((s) => s.section);
  const openAt = usePrototypeStore((s) => s.openAt);
  const close = usePrototypeStore((s) => s.close);

  const navRow = (
    label: string,
    icon: typeof UserIcon,
    props: { active?: boolean; onClick?: () => void; to?: string },
  ) => {
    const Icon = icon;
    const className = cn(
      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent",
      props.active && "bg-sidebar-accent",
    );
    return props.to ? (
      <Link key={label} to={props.to} className={className} onClick={close}>
        <Icon className="size-4 shrink-0 opacity-70" />
        {label}
      </Link>
    ) : (
      <button key={label} type="button" onClick={props.onClick} className={className}>
        <Icon className="size-4 shrink-0 opacity-70" />
        {label}
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">User settings</DialogTitle>

        {/* Nav column: right-aligned rail so nav hugs the content on wide screens. */}
        <div className="flex shrink-0 justify-end overflow-y-auto bg-sidebar sm:w-[30%] sm:min-w-[200px]">
          <div className="flex w-full max-w-[220px] flex-col gap-0.5 p-2 pt-8 sm:pr-3">
            <div className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              User settings
            </div>
            {SECTIONS.map((s) =>
              navRow(s.label, s.icon, { active: section === s.id, onClick: () => openAt(s.id) }),
            )}
            {user.isAdmin && (
              <>
                <Separator className="my-2" />
                <div className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Admin
                </div>
                {navRow("Invite codes", KeyRoundIcon, { to: "/admin/codes" })}
                {navRow("Instance bans", GavelIcon, { to: "/admin/bans" })}
              </>
            )}
            <Separator className="my-2" />
            {navRow("Sign out", LogOutIcon, {
              onClick: () => toast("Prototype — sign-out lives here in variant A."),
            })}
          </div>
        </div>

        {/* Content column with Discord's floating ESC affordance. */}
        <div className="relative flex min-w-0 flex-1 overflow-y-auto">
          <div className="w-full max-w-2xl px-6 py-8 sm:px-10">
            <h2 className="mb-6 text-base font-semibold">
              {SECTIONS.find((s) => s.id === section)?.label}
            </h2>
            {section === "profile" && <ProfileFields {...user} />}
            {section === "voice" && (
              <div className="flex flex-col gap-6">
                <MasterVolumeField />
                <DeviceFields />
                <SoundFields title="Sound effects" />
              </div>
            )}
            {section === "notifications" && (
              <div className="flex flex-col gap-6">
                <NotificationPermissionField />
                <NotificationDefaultFields />
                <p className="text-xs text-muted-foreground">
                  Sound effects (including the notification ping) live under Voice.
                </p>
              </div>
            )}
          </div>
          <div className="sticky top-8 ml-auto hidden pr-6 sm:block">
            <button
              type="button"
              onClick={close}
              className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <span className="flex size-9 items-center justify-center rounded-full border border-muted-foreground/40">
                <XIcon className="size-4" />
              </span>
              <span className="text-xs">ESC</span>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// PROTOTYPE — THROWAWAY (wayfinder ticket #77). Variant C: right-side sheet with one
// continuous scroll column — sticky anchor tabs scroll-spy over Profile → Voice →
// Notifications, with the admin shortcuts re-homed as rows at the bottom. Devices are
// DUPLICATED here (the ControlDeck popover also stays, as the mid-call quick path).

import { Sheet, SheetContent, SheetTitle } from "@konus-la/ui/components/sheet";
import { Separator } from "@konus-la/ui/components/separator";
import { cn } from "@konus-la/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { GavelIcon, KeyRoundIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  DeviceFields,
  MasterVolumeField,
  NotificationDefaultFields,
  NotificationPermissionField,
  ProfileFields,
  SoundFields,
} from "./shared";
import { usePrototypeStore, type SettingsSection } from "./store";

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "voice", label: "Voice" },
  { id: "notifications", label: "Notifications" },
];

export function VariantCScroll({
  user,
}: {
  user: { name: string; username: string; image?: string | null; isAdmin: boolean };
}) {
  const open = usePrototypeStore((s) => s.open);
  const section = usePrototypeStore((s) => s.section);
  const close = usePrototypeStore((s) => s.close);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<SettingsSection, HTMLDivElement | null>>>({});
  const [active, setActive] = useState<SettingsSection>("profile");

  const scrollTo = (id: SettingsSection) =>
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Deep-link support: opening at a section (e.g. the deck gear → voice) jumps there.
  useEffect(() => {
    if (open) {
      // Wait a frame so the sheet has mounted and laid out before jumping.
      requestAnimationFrame(() => sectionRefs.current[section]?.scrollIntoView());
      setActive(section);
    }
  }, [open, section]);

  const onScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const top = container.getBoundingClientRect().top + 56; // clears the sticky tab row
    let current: SettingsSection = "profile";
    for (const s of SECTIONS) {
      const el = sectionRefs.current[s.id];
      if (el && el.getBoundingClientRect().top <= top + 1) current = s.id;
    }
    setActive(current);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        <SheetTitle className="sr-only">User settings</SheetTitle>

        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
          {/* pr clears the sheet's X button. */}
          <div className="sticky top-0 z-10 flex gap-1 border-b border-sidebar-border bg-popover p-2 pr-12">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollTo(s.id)}
                className={cn(
                  "rounded px-2.5 py-1 text-sm hover:bg-muted/60",
                  active === s.id && "bg-muted font-medium",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-8 p-4 pb-8 sm:p-6">
            <div
              ref={(el) => void (sectionRefs.current.profile = el)}
              className="scroll-mt-14"
            >
              <h2 className="mb-4 text-sm font-semibold">Profile</h2>
              <ProfileFields {...user} />
            </div>
            <Separator />
            <div ref={(el) => void (sectionRefs.current.voice = el)} className="scroll-mt-14">
              <h2 className="mb-4 text-sm font-semibold">Voice</h2>
              <div className="flex flex-col gap-6">
                <DeviceFields />
                <MasterVolumeField />
                <SoundFields title="Sounds & volume" />
              </div>
            </div>
            <Separator />
            <div
              ref={(el) => void (sectionRefs.current.notifications = el)}
              className="scroll-mt-14"
            >
              <h2 className="mb-4 text-sm font-semibold">Notifications</h2>
              <div className="flex flex-col gap-6">
                <NotificationPermissionField />
                <NotificationDefaultFields />
              </div>
            </div>

            {user.isAdmin && (
              <>
                <Separator />
                <div>
                  <h2 className="mb-2 text-sm font-semibold">Admin</h2>
                  <div className="flex flex-col">
                    <Link
                      to="/admin/codes"
                      onClick={close}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60"
                    >
                      <KeyRoundIcon className="size-4 opacity-70" /> Invite codes
                    </Link>
                    <Link
                      to="/admin/bans"
                      onClick={close}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60"
                    >
                      <GavelIcon className="size-4 opacity-70" /> Instance bans
                    </Link>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

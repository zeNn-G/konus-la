import { Dialog, DialogContent, DialogTitle } from "@konus-la/ui/components/dialog";
import { Separator } from "@konus-la/ui/components/separator";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { cn } from "@konus-la/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { BanIcon, ShieldIcon, TicketIcon, TriangleAlertIcon, UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { BansSection } from "@/components/guild-settings/bans-section";
import { DangerSection } from "@/components/guild-settings/danger-section";
import { InvitesSection } from "@/components/guild-settings/invites-section";
import { MembersSection } from "@/components/guild-settings/members-section";
import { RolesSection } from "@/components/guild-settings/roles-section";
import { orpc } from "@/utils/orpc";

type SectionId = "members" | "roles" | "bans" | "invites" | "danger";

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon; danger?: boolean }[] = [
  { id: "members", label: "Members", icon: UsersIcon },
  { id: "roles", label: "Roles", icon: ShieldIcon },
  { id: "bans", label: "Bans", icon: BanIcon },
  { id: "invites", label: "Invites", icon: TicketIcon },
  { id: "danger", label: "Danger zone", icon: TriangleAlertIcon, danger: true },
];

/**
 * Owner-only guild management modal: nav rail (desktop) / horizontal section row (mobile)
 * beside a scrollable content pane. Sections mount lazily so their owner-only queries
 * never fire while unselected.
 */
export function GuildSettingsDialog({
  guildId,
  open,
  onOpenChange,
}: {
  guildId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [section, setSection] = useState<SectionId>("members");
  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));

  // Ownership can flip under an open modal (remote transfer) — close rather than strand
  // the ex-owner on sections whose queries would now be FORBIDDEN.
  const lostOwnership = open && guild.data !== undefined && !guild.data.viewer.isOwner;
  useEffect(() => {
    if (lostOwnership) onOpenChange(false);
  }, [lostOwnership, onOpenChange]);

  // Reopening starts back at Members — a fresh visit, not a resumed one.
  useEffect(() => {
    if (!open) setSection("members");
  }, [open]);

  const navButton = (s: (typeof SECTIONS)[number], mobile: boolean) => (
    <button
      key={s.id}
      type="button"
      onClick={() => setSection(s.id)}
      className={cn(
        "flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent",
        mobile && "shrink-0 whitespace-nowrap",
        section === s.id && "bg-sidebar-accent",
        s.danger && "text-destructive",
      )}
    >
      <s.icon className="size-4 shrink-0 opacity-70" />
      {s.label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:top-1/2 sm:left-1/2 sm:h-[min(85vh,640px)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:flex-row">
        <DialogTitle className="sr-only">Guild settings</DialogTitle>

        <div className="hidden w-[190px] shrink-0 flex-col gap-0.5 border-r border-sidebar-border bg-sidebar p-2 sm:flex">
          <div className="px-2 py-1.5 text-sm font-medium">
            {guild.data ? (
              <span className="block truncate">{guild.data.guild.name}</span>
            ) : (
              <Skeleton className="h-4 w-24" />
            )}
          </div>
          <Separator className="my-1" />
          {SECTIONS.map((s) => navButton(s, false))}
        </div>

        {/* pr clears the dialog's X button. */}
        <div className="flex gap-1 overflow-x-auto border-b border-sidebar-border bg-sidebar p-2 pr-12 sm:hidden">
          {SECTIONS.map((s) => navButton(s, true))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
          <h2 className="mb-4 text-sm font-medium">
            {SECTIONS.find((s) => s.id === section)?.label}
          </h2>
          {section === "members" && <MembersSection guildId={guildId} />}
          {section === "roles" && <RolesSection guildId={guildId} />}
          {section === "bans" && <BansSection guildId={guildId} />}
          {section === "invites" && <InvitesSection guildId={guildId} />}
          {section === "danger" && (
            <DangerSection guildId={guildId} onClose={() => onOpenChange(false)} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

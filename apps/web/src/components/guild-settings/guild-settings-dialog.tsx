import { hasPermission, PERMISSIONS } from "@konus-la/api/permissions";
import type { AppRouterClient } from "@konus-la/api/routers/index";
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

type Viewer = Awaited<ReturnType<AppRouterClient["guild"]["get"]>>["viewer"];

/**
 * The spec's visibility table (#48): each section appears iff the viewer holds a
 * permission it serves — no locked placeholders. Danger zone (transfer/delete) is
 * owner-only, matching the never-delegable procedures behind it.
 */
const SECTIONS: {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  visible: (viewer: Viewer) => boolean;
}[] = [
  {
    id: "members",
    label: "Members",
    icon: UsersIcon,
    visible: (viewer) =>
      hasPermission(viewer.permissions, PERMISSIONS.KICK_MEMBERS) ||
      hasPermission(viewer.permissions, PERMISSIONS.BAN_MEMBERS) ||
      hasPermission(viewer.permissions, PERMISSIONS.MANAGE_ROLES),
  },
  {
    id: "roles",
    label: "Roles",
    icon: ShieldIcon,
    visible: (viewer) => hasPermission(viewer.permissions, PERMISSIONS.MANAGE_ROLES),
  },
  {
    id: "bans",
    label: "Bans",
    icon: BanIcon,
    visible: (viewer) => hasPermission(viewer.permissions, PERMISSIONS.BAN_MEMBERS),
  },
  {
    id: "invites",
    label: "Invites",
    icon: TicketIcon,
    visible: (viewer) => hasPermission(viewer.permissions, PERMISSIONS.MANAGE_INVITES),
  },
  {
    id: "danger",
    label: "Danger zone",
    icon: TriangleAlertIcon,
    danger: true,
    visible: (viewer) => viewer.isOwner,
  },
];

/** The sections this viewer may see; the settings entry itself shows iff ≥ 1 passes. */
export function visibleSettingsSections(viewer: Viewer | undefined) {
  return viewer ? SECTIONS.filter((section) => section.visible(viewer)) : [];
}

/**
 * Guild management modal: nav rail (desktop) / horizontal section row (mobile) beside a
 * scrollable content pane. Sections are permission-gated per the spec table and mount
 * lazily, so a gated section's queries never fire for a viewer who can't see it.
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
  const [selected, setSelected] = useState<SectionId | null>(null);
  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));

  const sections = visibleSettingsSections(guild.data?.viewer);
  // A remote role edit or ownership transfer can strip every gate under an open modal —
  // close rather than strand the viewer on sections whose queries would now be FORBIDDEN.
  const lostAccess = open && guild.data !== undefined && sections.length === 0;
  useEffect(() => {
    if (lostAccess) onOpenChange(false);
  }, [lostAccess, onOpenChange]);

  // Reopening starts back at the first visible section — a fresh visit, not a resumed one.
  useEffect(() => {
    if (!open) setSelected(null);
  }, [open]);

  // Snap to the first visible section until one is picked — or when a live permission
  // change just removed the picked one.
  const section = sections.some((s) => s.id === selected) ? selected : sections[0]?.id;

  const navButton = (s: (typeof SECTIONS)[number], mobile: boolean) => (
    <button
      key={s.id}
      type="button"
      onClick={() => setSelected(s.id)}
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
          {sections.map((s) => navButton(s, false))}
        </div>

        {/* pr clears the dialog's X button. */}
        <div className="flex gap-1 overflow-x-auto border-b border-sidebar-border bg-sidebar p-2 pr-12 sm:hidden">
          {sections.map((s) => navButton(s, true))}
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

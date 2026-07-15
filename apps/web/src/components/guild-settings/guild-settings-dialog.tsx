import { Dialog, DialogContent, DialogTitle } from "@konus-la/ui/components/dialog";
import { Separator } from "@konus-la/ui/components/separator";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { cn } from "@konus-la/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  BanIcon,
  FlagIcon,
  ScrollTextIcon,
  ShieldIcon,
  TicketIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { BansSection } from "@/components/guild-settings/bans-section";
import { DangerSection } from "@/components/guild-settings/danger-section";
import { InvitesSection } from "@/components/guild-settings/invites-section";
import { MembersSection } from "@/components/guild-settings/members-section";
import {
  RolesPrototypeSection,
  StubSection,
} from "@/components/guild-settings/roles-prototype/roles-prototype-section";
import { RolesPrototypeSwitcher } from "@/components/guild-settings/roles-prototype/switcher";
import {
  permissionsFor,
  usePrototypeRoles,
  type PermissionId,
} from "@/components/guild-settings/roles-prototype/store";
import { useRolesVariant } from "@/components/guild-settings/roles-prototype/use-variant";
import { ViewingAsPicker } from "@/components/guild-settings/roles-prototype/viewing-as";
import { orpc } from "@/utils/orpc";

type SectionId = "members" | "roles" | "bans" | "invites" | "reports" | "audit" | "danger";

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon; danger?: boolean }[] = [
  { id: "members", label: "Members", icon: UsersIcon },
  { id: "bans", label: "Bans", icon: BanIcon },
  { id: "invites", label: "Invites", icon: TicketIcon },
  { id: "danger", label: "Danger zone", icon: TriangleAlertIcon, danger: true },
];

// PROTOTYPE (wayfinder #48): section list once RBAC lands — Roles plus stub Reports and
// Audit log entries, each gated by the permissions of the simulated "viewing as" identity.
const PROTO_SECTIONS: {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  /** Any of these unlocks the section; empty = owner only. */
  anyOf: PermissionId[];
}[] = [
  { id: "members", label: "Members", icon: UsersIcon, anyOf: ["KICK_MEMBERS", "BAN_MEMBERS", "MANAGE_ROLES"] },
  { id: "roles", label: "Roles", icon: ShieldIcon, anyOf: ["MANAGE_ROLES"] },
  { id: "bans", label: "Bans", icon: BanIcon, anyOf: ["BAN_MEMBERS"] },
  { id: "invites", label: "Invites", icon: TicketIcon, anyOf: ["MANAGE_INVITES"] },
  { id: "reports", label: "Reports", icon: FlagIcon, anyOf: ["MANAGE_REPORTS"] },
  { id: "audit", label: "Audit log", icon: ScrollTextIcon, anyOf: ["VIEW_AUDIT_LOG"] },
  { id: "danger", label: "Danger zone", icon: TriangleAlertIcon, danger: true, anyOf: [] },
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

  // PROTOTYPE (wayfinder #48): with ?variant= present, swap in the RBAC section list
  // filtered by the simulated identity's permissions.
  const variant = useRolesVariant();
  const { viewingAs } = usePrototypeRoles();
  const heldPermissions = permissionsFor(viewingAs);
  const sections = variant
    ? PROTO_SECTIONS.filter(
        (s) =>
          viewingAs === "owner" ||
          (s.anyOf.length > 0 && s.anyOf.some((p) => heldPermissions.includes(p))),
      )
    : SECTIONS;
  const visibleSection = sections.some((s) => s.id === section)
    ? section
    : (sections[0]?.id ?? "members");

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

  const navButton = (
    s: { id: SectionId; label: string; icon: LucideIcon; danger?: boolean },
    mobile: boolean,
  ) => (
    <button
      key={s.id}
      type="button"
      onClick={() => setSection(s.id)}
      className={cn(
        "flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent",
        mobile && "shrink-0 whitespace-nowrap",
        visibleSection === s.id && "bg-sidebar-accent",
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
          {variant && <ViewingAsPicker className="mt-auto pt-2" />}
        </div>

        {/* pr clears the dialog's X button. */}
        <div className="flex gap-1 overflow-x-auto border-b border-sidebar-border bg-sidebar p-2 pr-12 sm:hidden">
          {sections.map((s) => navButton(s, true))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
          {variant && (
            <div className="mb-3 sm:hidden">
              <ViewingAsPicker />
            </div>
          )}
          <h2 className="mb-4 text-sm font-medium">
            {sections.find((s) => s.id === visibleSection)?.label}
          </h2>
          {visibleSection === "members" && <MembersSection guildId={guildId} />}
          {visibleSection === "bans" && <BansSection guildId={guildId} />}
          {visibleSection === "invites" && <InvitesSection guildId={guildId} />}
          {variant && visibleSection === "roles" && <RolesPrototypeSection variant={variant} />}
          {variant && visibleSection === "reports" && <StubSection label="The report inbox" />}
          {variant && visibleSection === "audit" && <StubSection label="The audit log" />}
          {visibleSection === "danger" && (
            <DangerSection guildId={guildId} onClose={() => onOpenChange(false)} />
          )}
        </div>

        {/* Second instance inside the modal layer — the route-level pill is unclickable
            behind the dialog overlay. Same position, so they visually stack as one. */}
        <RolesPrototypeSwitcher />
      </DialogContent>
    </Dialog>
  );
}

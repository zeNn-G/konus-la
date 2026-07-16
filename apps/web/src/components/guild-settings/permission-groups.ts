import { PERMISSIONS } from "@konus-la/api/permissions";

/**
 * The one bit → label catalog for every permission, grouped with a one-line hint
 * (prototype #48). The roles editor renders its toggles from it; the audit view renders
 * permission diffs from the same labels.
 */
export const PERMISSION_GROUPS: {
  label: string;
  permissions: { bit: number; label: string; hint: string }[];
}[] = [
  {
    label: "General",
    permissions: [
      {
        bit: PERMISSIONS.ADMINISTRATOR,
        label: "Administrator",
        hint: "Bypasses every permission check (not hierarchy).",
      },
      { bit: PERMISSIONS.MANAGE_GUILD, label: "Manage guild", hint: "Rename the guild." },
      {
        bit: PERMISSIONS.MANAGE_ROLES,
        label: "Manage roles",
        hint: "Create, edit, and assign roles below their highest role.",
      },
      {
        bit: PERMISSIONS.MANAGE_CHANNELS,
        label: "Manage channels",
        hint: "Create, rename, and delete channels.",
      },
      {
        bit: PERMISSIONS.MANAGE_INVITES,
        label: "Manage invites",
        hint: "Create and revoke invites.",
      },
      {
        bit: PERMISSIONS.VIEW_AUDIT_LOG,
        label: "View audit log",
        hint: "Read the guild audit log.",
      },
    ],
  },
  {
    label: "Members",
    permissions: [
      {
        bit: PERMISSIONS.KICK_MEMBERS,
        label: "Kick members",
        hint: "Remove lower-ranked members.",
      },
      {
        bit: PERMISSIONS.BAN_MEMBERS,
        label: "Ban members",
        hint: "Ban and unban lower-ranked members.",
      },
      { bit: PERMISSIONS.MUTE_MEMBERS, label: "Mute members", hint: "Server-mute in voice." },
      {
        bit: PERMISSIONS.MOVE_MEMBERS,
        label: "Move members",
        hint: "Disconnect members from voice.",
      },
    ],
  },
  {
    label: "Messages",
    permissions: [
      {
        bit: PERMISSIONS.MANAGE_MESSAGES,
        label: "Manage messages",
        hint: "Delete other members' messages.",
      },
      {
        bit: PERMISSIONS.MANAGE_REPORTS,
        label: "Manage reports",
        hint: "See and resolve the report inbox.",
      },
    ],
  },
];

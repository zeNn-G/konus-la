/**
 * The Phase 6 permission catalog (ADR 0008) — a pure, zero-import module so the web app
 * can import it as `@konus-la/api/permissions` without dragging in the server. Values are
 * bit MASKS in a plain JS number.
 *
 * BIT ORDER IS FROZEN FOREVER: a permission's bit is part of every guild's stored data,
 * so existing entries may never be renumbered — new permissions APPEND ONLY (bit 12, 13,
 * …). `packages/db` traffics in raw integers; bit meaning lives here alone.
 */
export const PERMISSIONS = {
  /** Bit 0 — bypasses every permission check (never hierarchy, never owner-only). */
  ADMINISTRATOR: 1 << 0,
  /** Bit 1 — `guild.update` (rename). */
  MANAGE_GUILD: 1 << 1,
  /** Bit 2 — `role.*` (create / update / delete / reorder / assign / unassign). */
  MANAGE_ROLES: 1 << 2,
  /** Bit 3 — `channel.create / update / delete`. */
  MANAGE_CHANNELS: 1 << 3,
  /** Bit 4 — `guild.invite.create / list / revoke`. */
  MANAGE_INVITES: 1 << 4,
  /** Bit 5 — `guild.member.kick`. */
  KICK_MEMBERS: 1 << 5,
  /** Bit 6 — `guild.member.ban / unban / banList`. */
  BAN_MEMBERS: 1 << 6,
  /** Bit 7 — `mod.deleteMessage` (others' messages; own-delete stays author-only). */
  MANAGE_MESSAGES: 1 << 7,
  /** Bit 8 — `mod.serverMute`. */
  MUTE_MEMBERS: 1 << 8,
  /** Bit 9 — `mod.disconnectVoice`. */
  MOVE_MEMBERS: 1 << 9,
  /** Bit 10 — `auditLog.list`. */
  VIEW_AUDIT_LOG: 1 << 10,
  /** Bit 11 — `report.list / unresolvedCount / resolve` (+ `report.changed` recipient). */
  MANAGE_REPORTS: 1 << 11,
} as const;

export type PermissionBit = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Every catalog bit set — the resolved mask the owner and `ADMINISTRATOR` holders see. */
export const ALL_PERMISSIONS: number = Object.values(PERMISSIONS).reduce(
  (mask, bit) => mask | bit,
  0,
);

/**
 * Plain bit test: does `bits` contain `bit`? No `ADMINISTRATOR` special-casing — that
 * bypass lives server-side (gates + the resolved viewer mask), so client checks stay a
 * uniform `hasPermission(viewer.permissions, bit)`.
 */
export function hasPermission(bits: number, bit: number): boolean {
  return (bits & bit) === bit;
}

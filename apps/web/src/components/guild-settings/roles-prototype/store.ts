// PROTOTYPE — THROWAWAY (wayfinder ticket #48). In-memory roles model shared by every
// prototype surface: the settings dialog Roles section, member-row assignment chips,
// the role-grouped members panel, and chat author tints. Nothing here persists or
// touches the API; delete the whole roles-prototype/ directory when the spec lands.

import { useSyncExternalStore } from "react";

export type PermissionId =
  | "ADMINISTRATOR"
  | "MANAGE_GUILD"
  | "MANAGE_ROLES"
  | "MANAGE_CHANNELS"
  | "MANAGE_INVITES"
  | "KICK_MEMBERS"
  | "BAN_MEMBERS"
  | "MANAGE_MESSAGES"
  | "MUTE_MEMBERS"
  | "MOVE_MEMBERS"
  | "VIEW_AUDIT_LOG"
  | "MANAGE_REPORTS";

export const PERMISSION_GROUPS: {
  label: string;
  permissions: { id: PermissionId; label: string; hint: string }[];
}[] = [
  {
    label: "General",
    permissions: [
      {
        id: "ADMINISTRATOR",
        label: "Administrator",
        hint: "Bypasses every permission check (not hierarchy).",
      },
      { id: "MANAGE_GUILD", label: "Manage guild", hint: "Rename the guild." },
      {
        id: "MANAGE_ROLES",
        label: "Manage roles",
        hint: "Create, edit, and assign roles below their highest role.",
      },
      {
        id: "MANAGE_CHANNELS",
        label: "Manage channels",
        hint: "Create, rename, and delete channels.",
      },
      { id: "MANAGE_INVITES", label: "Manage invites", hint: "Create and revoke invites." },
      { id: "VIEW_AUDIT_LOG", label: "View audit log", hint: "Read the guild audit log." },
    ],
  },
  {
    label: "Members",
    permissions: [
      { id: "KICK_MEMBERS", label: "Kick members", hint: "Remove lower-ranked members." },
      { id: "BAN_MEMBERS", label: "Ban members", hint: "Ban and unban lower-ranked members." },
      { id: "MUTE_MEMBERS", label: "Mute members", hint: "Server-mute in voice." },
      { id: "MOVE_MEMBERS", label: "Move members", hint: "Disconnect members from voice." },
    ],
  },
  {
    label: "Messages",
    permissions: [
      { id: "MANAGE_MESSAGES", label: "Manage messages", hint: "Delete other members' messages." },
      { id: "MANAGE_REPORTS", label: "Manage reports", hint: "See and resolve the report inbox." },
    ],
  },
];

export const ALL_PERMISSIONS: PermissionId[] = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((permission) => permission.id),
);

/** Preset swatches for the role color picker; null = default text color. */
export const ROLE_COLORS = [
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
] as const;

export type PrototypeRole = {
  id: string;
  name: string;
  /** Hex tint for names in chat/member list; null = default foreground. */
  color: string | null;
  /** Higher = ranks higher. @everyone is pinned at 0. */
  position: number;
  permissions: PermissionId[];
};

export const EVERYONE_ID = "everyone";

type PrototypeState = {
  roles: PrototypeRole[];
  /** userId -> assigned role ids (excluding @everyone, which is implicit). */
  assignments: Record<string, string[]>;
  /** Simulated identity for settings-access gating: "owner" | role id | EVERYONE_ID. */
  viewingAs: string;
  seeded: boolean;
};

let state: PrototypeState = {
  roles: [
    {
      id: "admin",
      name: "Admin",
      color: "#f43f5e",
      position: 3,
      permissions: ["ADMINISTRATOR"],
    },
    {
      id: "moderator",
      name: "Moderator",
      color: "#3b82f6",
      position: 2,
      permissions: [
        "KICK_MEMBERS",
        "BAN_MEMBERS",
        "MANAGE_MESSAGES",
        "MUTE_MEMBERS",
        "MOVE_MEMBERS",
        "MANAGE_REPORTS",
        "VIEW_AUDIT_LOG",
      ],
    },
    {
      id: "events",
      name: "Events",
      color: "#22c55e",
      position: 1,
      permissions: ["MANAGE_INVITES"],
    },
    { id: EVERYONE_ID, name: "@everyone", color: null, position: 0, permissions: [] },
  ],
  assignments: {},
  viewingAs: "owner",
  seeded: false,
};

const listeners = new Set<() => void>();

function emit(next: PrototypeState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrototypeRoles(): PrototypeState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Roles above @everyone, highest position first — the order every list renders in. */
export function customRolesByRank(roles: PrototypeRole[]): PrototypeRole[] {
  return roles.filter((role) => role.id !== EVERYONE_ID).sort((a, b) => b.position - a.position);
}

export function highestRole(userId: string): PrototypeRole | null {
  const assigned = state.assignments[userId] ?? [];
  const ranked = customRolesByRank(state.roles).filter((role) => assigned.includes(role.id));
  return ranked[0] ?? null;
}

/** Discord rule: the name tint comes from the highest assigned role that has a color. */
export function roleColorFor(userId: string): string | null {
  const assigned = state.assignments[userId] ?? [];
  const colored = customRolesByRank(state.roles).find(
    (role) => assigned.includes(role.id) && role.color !== null,
  );
  return colored?.color ?? null;
}

export function permissionsFor(viewingAs: string): PermissionId[] {
  if (viewingAs === "owner") return ALL_PERMISSIONS;
  const role = state.roles.find((r) => r.id === viewingAs);
  if (!role) return [];
  if (role.permissions.includes("ADMINISTRATOR")) return ALL_PERMISSIONS;
  const everyone = state.roles.find((r) => r.id === EVERYONE_ID);
  return [...new Set([...role.permissions, ...(everyone?.permissions ?? [])])];
}

/** Deterministic one-time seeding once real guild members are known. */
export function seedAssignments(memberIds: string[], ownerId: string) {
  if (state.seeded) return;
  const others = memberIds.filter((id) => id !== ownerId);
  const assignments: Record<string, string[]> = { [ownerId]: ["admin"] };
  if (others[0]) assignments[others[0]] = ["moderator"];
  if (others[1]) assignments[others[1]] = ["moderator", "events"];
  if (others[2]) assignments[others[2]] = ["events"];
  emit({ ...state, assignments, seeded: true });
}

export function assignRole(userId: string, roleId: string) {
  const current = state.assignments[userId] ?? [];
  if (current.includes(roleId) || roleId === EVERYONE_ID) return;
  emit({
    ...state,
    assignments: { ...state.assignments, [userId]: [...current, roleId] },
  });
}

export function unassignRole(userId: string, roleId: string) {
  const current = state.assignments[userId] ?? [];
  emit({
    ...state,
    assignments: { ...state.assignments, [userId]: current.filter((id) => id !== roleId) },
  });
}

export function createRole(): PrototypeRole {
  const role: PrototypeRole = {
    id: `role-${state.roles.length}-${state.roles.map((r) => r.id).join("").length}`,
    name: "new role",
    color: null,
    position: Math.max(...state.roles.map((r) => r.position)) + 1,
    permissions: [],
  };
  emit({ ...state, roles: [...state.roles, role] });
  return role;
}

export function updateRole(roleId: string, patch: Partial<Pick<PrototypeRole, "name" | "color">>) {
  emit({
    ...state,
    roles: state.roles.map((role) => (role.id === roleId ? { ...role, ...patch } : role)),
  });
}

export function togglePermission(roleId: string, permission: PermissionId) {
  emit({
    ...state,
    roles: state.roles.map((role) => {
      if (role.id !== roleId) return role;
      const has = role.permissions.includes(permission);
      return {
        ...role,
        permissions: has
          ? role.permissions.filter((p) => p !== permission)
          : [...role.permissions, permission],
      };
    }),
  });
}

export function deleteRole(roleId: string) {
  if (roleId === EVERYONE_ID) return;
  const assignments = Object.fromEntries(
    Object.entries(state.assignments).map(([userId, roleIds]) => [
      userId,
      roleIds.filter((id) => id !== roleId),
    ]),
  );
  emit({
    ...state,
    roles: state.roles.filter((role) => role.id !== roleId),
    assignments,
    viewingAs: state.viewingAs === roleId ? "owner" : state.viewingAs,
  });
}

/** Swap positions with the neighbor above/below; @everyone never moves off 0. */
export function moveRole(roleId: string, direction: "up" | "down") {
  const ranked = customRolesByRank(state.roles);
  const index = ranked.findIndex((role) => role.id === roleId);
  const neighbor = ranked[direction === "up" ? index - 1 : index + 1];
  if (index === -1 || !neighbor) return;
  const self = ranked[index];
  emit({
    ...state,
    roles: state.roles.map((role) => {
      if (role.id === self.id) return { ...role, position: neighbor.position };
      if (role.id === neighbor.id) return { ...role, position: self.position };
      return role;
    }),
  });
}

export function setViewingAs(viewingAs: string) {
  emit({ ...state, viewingAs });
}

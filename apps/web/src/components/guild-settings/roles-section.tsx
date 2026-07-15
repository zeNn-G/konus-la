import type { AppRouterClient } from "@konus-la/api/routers/index";
import { PERMISSIONS } from "@konus-la/api/permissions";
import { Button } from "@konus-la/ui/components/button";
import { Checkbox } from "@konus-la/ui/components/checkbox";
import { Input } from "@konus-la/ui/components/input";
import { Separator } from "@konus-la/ui/components/separator";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { cn } from "@konus-la/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { orpc, queryClient } from "@/utils/orpc";

type GuildView = Awaited<ReturnType<AppRouterClient["guild"]["get"]>>;
type GuildRole = GuildView["roles"][number];

/** The editor's toggle catalog: every bit, grouped with a one-line hint (prototype #48). */
const PERMISSION_GROUPS: {
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

/** Preset swatches for the role color picker; null = default text color. */
const ROLE_COLORS = [
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
] as const;

function RoleDot({ color }: { color: string | null }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? "var(--muted-foreground)" }}
    />
  );
}

/**
 * Master–detail Roles editor (prototype #48 variant A): fixed role list column with hover
 * ▲▼ reorder beside an independently scrolling edit pane. `@everyone` is selectable —
 * its bits are editable, rename/recolor/reorder/delete are not. Other clients reconcile
 * via `role.changed`; this client invalidates `guild.get` on every mutation itself.
 */
export function RolesSection({ guildId }: { guildId: string }) {
  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));
  const invalidateGuild = () =>
    queryClient.invalidateQueries({ queryKey: orpc.guild.get.key({ input: { guildId } }) });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const create = useMutation(
    orpc.role.create.mutationOptions({
      onSuccess: async (role) => {
        setSelectedId(role.id);
        await invalidateGuild();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const update = useMutation(
    orpc.role.update.mutationOptions({
      onSuccess: () => invalidateGuild(),
      onError: (error) => toast.error(error.message),
    }),
  );
  const remove = useMutation(
    orpc.role.delete.mutationOptions({
      onSuccess: () => invalidateGuild(),
      onError: (error) => toast.error(error.message),
    }),
  );
  const reorder = useMutation(
    orpc.role.reorder.mutationOptions({
      onSuccess: () => invalidateGuild(),
      onError: (error) => toast.error(error.message),
    }),
  );

  if (guild.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (!guild.data) return null;

  // guild.get orders highest position first, @everyone (position 0) last.
  const roles = guild.data.roles;
  const customRoles = roles.filter((role) => !role.isDefault);
  const everyone = roles.find((role) => role.isDefault);
  if (!everyone) return null;

  // A remotely deleted selection falls back to the top of the stack.
  const selected =
    roles.find((role) => role.id === selectedId) ?? customRoles[0] ?? everyone;

  const memberCount = (roleId: string) =>
    guild.data.members.filter((member) => member.roleIds.includes(roleId)).length;

  return (
    // Desktop: fill the pane so the role list stays put while only the edit pane scrolls.
    <div className="flex min-h-0 flex-col gap-4 sm:min-h-0 sm:flex-1 sm:flex-row">
      <div className="flex shrink-0 flex-col gap-0.5 sm:w-44 sm:overflow-y-auto sm:border-r sm:border-foreground/10 sm:pr-3">
        <Button
          size="xs"
          variant="outline"
          className="mb-1 justify-start"
          disabled={create.isPending}
          onClick={() => create.mutate({ guildId, name: "new role" })}
        >
          <PlusIcon className="size-3.5" />
          New role
        </Button>
        {[...customRoles, everyone].map((role, index) => (
          <div
            key={role.id}
            className={cn(
              "group flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted",
              role.id === selected.id && "bg-muted",
            )}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={() => setSelectedId(role.id)}
            >
              <RoleDot color={role.color} />
              <span className="truncate" style={{ color: role.color ?? undefined }}>
                {role.isDefault ? "@everyone" : role.name}
              </span>
            </button>
            {!role.isDefault && (
              <span className="hidden items-center group-hover:flex">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={index === 0 || reorder.isPending}
                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  onClick={() => reorder.mutate({ guildId, roleId: role.id, direction: "up" })}
                >
                  <ChevronUpIcon className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={index === customRoles.length - 1 || reorder.isPending}
                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  onClick={() => reorder.mutate({ guildId, roleId: role.id, direction: "down" })}
                >
                  <ChevronDownIcon className="size-3.5" />
                </button>
              </span>
            )}
          </div>
        ))}
        <p className="mt-2 hidden px-2 text-[11px] text-muted-foreground sm:block">
          Higher in the list ranks higher. @everyone stays at the bottom.
        </p>
      </div>

      {/* Keyed by role id: switching roles resets the name/color drafts to server truth. */}
      <RoleEditPane
        key={selected.id}
        role={selected}
        memberCount={memberCount(selected.id)}
        updatePending={update.isPending}
        onUpdate={(patch) => update.mutate({ guildId, roleId: selected.id, ...patch })}
        onDelete={() => {
          remove.mutate({ guildId, roleId: selected.id });
          // The prototype lands on @everyone after a delete.
          setSelectedId(everyone.id);
        }}
        deletePending={remove.isPending}
      />
    </div>
  );
}

function RoleEditPane({
  role,
  memberCount,
  updatePending,
  deletePending,
  onUpdate,
  onDelete,
}: {
  role: GuildRole;
  memberCount: number;
  updatePending: boolean;
  deletePending: boolean;
  onUpdate: (patch: { name?: string; color?: string | null; permissions?: number }) => void;
  onDelete: () => void;
}) {
  const [nameDraft, setNameDraft] = useState(role.name);
  // The custom picker previews locally while dragging; the mutation lands on blur.
  const [colorDraft, setColorDraft] = useState<string | null>(null);

  const commitName = () => {
    const name = nameDraft.trim();
    if (name && name !== role.name) onUpdate({ name });
    else setNameDraft(role.name);
  };
  const isPresetOrNone = role.color === null || (ROLE_COLORS as readonly string[]).includes(role.color);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 sm:overflow-y-auto sm:pr-1">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase">Role name</label>
        <div className="flex items-center gap-2">
          <Input
            value={role.isDefault ? "@everyone" : nameDraft}
            disabled={role.isDefault}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="max-w-56"
          />
          {!role.isDefault && (
            <span className="text-xs text-muted-foreground">
              {memberCount} member{memberCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {!role.isDefault && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase">Color</label>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              title="No color"
              onClick={() => onUpdate({ color: null })}
              className={cn(
                "flex size-6 items-center justify-center rounded-full border border-input text-[10px] text-muted-foreground",
                role.color === null && "ring-2 ring-ring",
              )}
            >
              —
            </button>
            {ROLE_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => onUpdate({ color })}
                className={cn("size-6 rounded-full", role.color === color && "ring-2 ring-ring")}
                style={{ backgroundColor: color }}
              />
            ))}
            <label
              title="Custom color"
              className={cn(
                "relative size-6 cursor-pointer overflow-hidden rounded-full border border-input",
                !isPresetOrNone && "ring-2 ring-ring",
              )}
              style={{
                background:
                  (colorDraft ?? (isPresetOrNone ? null : role.color)) ??
                  "conic-gradient(#f43f5e,#eab308,#22c55e,#06b6d4,#3b82f6,#8b5cf6,#f43f5e)",
              }}
            >
              <input
                type="color"
                value={colorDraft ?? role.color ?? "#99aab5"}
                onChange={(event) => setColorDraft(event.target.value)}
                onBlur={() => {
                  if (colorDraft && colorDraft !== role.color) onUpdate({ color: colorDraft });
                  setColorDraft(null);
                }}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </label>
          </div>
        </div>
      )}

      <Separator />
      <div className="flex flex-col gap-4">
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1.5">
            <h4 className="text-xs font-medium text-muted-foreground uppercase">{group.label}</h4>
            <div>
              {group.permissions.map((permission) => (
                <label
                  key={permission.bit}
                  className="flex cursor-pointer items-start gap-2.5 py-1.5"
                >
                  <Checkbox
                    checked={(role.permissions & permission.bit) === permission.bit}
                    disabled={updatePending}
                    onCheckedChange={() =>
                      onUpdate({ permissions: role.permissions ^ permission.bit })
                    }
                    className="mt-0.5"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm leading-tight">{permission.label}</span>
                    <span className="text-xs text-muted-foreground">{permission.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!role.isDefault && (
        <>
          <Separator />
          <Button
            size="xs"
            variant="destructive"
            className="self-start"
            disabled={deletePending}
            onClick={onDelete}
          >
            <Trash2Icon className="size-3.5" />
            Delete role
          </Button>
        </>
      )}
    </div>
  );
}

import type { AppRouterClient } from "@konus-la/api/routers/index";
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

import { PERMISSION_GROUPS } from "@/components/guild-settings/permission-groups";
import { RoleDot } from "@/components/guild-settings/role-dot";
import { orpc, queryClient } from "@/utils/orpc";

type GuildView = Awaited<ReturnType<AppRouterClient["guild"]["get"]>>;
type GuildRole = GuildView["roles"][number];

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

/**
 * Master–detail Roles editor (prototype #48 variant A): fixed role list column with hover
 * ▲▼ reorder beside an independently scrolling edit pane. `@everyone` is selectable —
 * its bits are editable, rename/recolor/reorder/delete are not. Name/color/permission
 * edits accumulate as a LOCAL DRAFT and land as one `role.update` on "Save changes" —
 * list actions (create / reorder / delete) commit immediately. Other clients reconcile
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
  const selected = roles.find((role) => role.id === selectedId) ?? customRoles[0] ?? everyone;

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

      {/* Keyed by role id: switching roles discards the draft and re-reads server truth. */}
      <RoleEditPane
        key={selected.id}
        guildId={guildId}
        role={selected}
        memberCount={memberCount(selected.id)}
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

/**
 * The detail half. Edits are a draft OVERLAYING the server row — nothing is sent until
 * "Save changes" commits every dirty field as one `role.update` (one limiter spend, one
 * `role.changed`). A remote edit under a clean field shows through live; a dirty field
 * keeps the draft until Save or Reset.
 */
function RoleEditPane({
  guildId,
  role,
  memberCount,
  deletePending,
  onDelete,
}: {
  guildId: string;
  role: GuildRole;
  memberCount: number;
  deletePending: boolean;
  onDelete: () => void;
}) {
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  // undefined = untouched; null = "no color" chosen.
  const [colorDraft, setColorDraft] = useState<string | null | undefined>(undefined);
  const [permissionsDraft, setPermissionsDraft] = useState<number | null>(null);

  const name = nameDraft ?? role.name;
  const color = colorDraft === undefined ? role.color : colorDraft;
  const permissions = permissionsDraft ?? role.permissions;

  const nameDirty = nameDraft !== null && nameDraft.trim() !== role.name;
  const colorDirty = colorDraft !== undefined && colorDraft !== role.color;
  const permissionsDirty = permissionsDraft !== null && permissionsDraft !== role.permissions;
  const dirty = nameDirty || colorDirty || permissionsDirty;
  const nameInvalid = nameDraft !== null && nameDraft.trim() === "";

  const resetDraft = () => {
    setNameDraft(null);
    setColorDraft(undefined);
    setPermissionsDraft(null);
  };

  const update = useMutation(
    orpc.role.update.mutationOptions({
      onSuccess: async () => {
        resetDraft();
        await queryClient.invalidateQueries({
          queryKey: orpc.guild.get.key({ input: { guildId } }),
        });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const save = () => {
    if (!dirty || nameInvalid || update.isPending) return;
    update.mutate({
      guildId,
      roleId: role.id,
      ...(nameDirty && { name: nameDraft.trim() }),
      ...(colorDirty && { color: colorDraft }),
      ...(permissionsDirty && { permissions: permissionsDraft }),
    });
  };

  const isPresetOrNone = color === null || (ROLE_COLORS as readonly string[]).includes(color);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 sm:min-h-0">
      <div className="flex min-w-0 flex-col gap-4 sm:-ml-1 sm:flex-1 sm:overflow-y-auto sm:pl-1 sm:pr-1">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase">Role name</label>
          <div className="flex items-center gap-2">
            <Input
              value={role.isDefault ? "@everyone" : name}
              disabled={role.isDefault}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") save();
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
                onClick={() => setColorDraft(null)}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border border-input text-[10px] text-muted-foreground",
                  color === null && "ring-2 ring-ring",
                )}
              >
                —
              </button>
              {ROLE_COLORS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  title={preset}
                  onClick={() => setColorDraft(preset)}
                  className={cn("size-6 rounded-full", color === preset && "ring-2 ring-ring")}
                  style={{ backgroundColor: preset }}
                />
              ))}
              <label
                title="Custom color"
                className={cn(
                  "relative size-6 cursor-pointer overflow-hidden rounded-full border border-input",
                  !isPresetOrNone && "ring-2 ring-ring",
                )}
                style={{
                  background: isPresetOrNone
                    ? "conic-gradient(#f43f5e,#eab308,#22c55e,#06b6d4,#3b82f6,#8b5cf6,#f43f5e)"
                    : color,
                }}
              >
                <input
                  type="color"
                  value={color ?? "#99aab5"}
                  onChange={(event) => setColorDraft(event.target.value)}
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
                      checked={(permissions & permission.bit) === permission.bit}
                      onCheckedChange={() => setPermissionsDraft(permissions ^ permission.bit)}
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

      {dirty && (
        <div className="flex shrink-0 items-center gap-2 rounded-md border border-foreground/10 bg-muted/50 px-3 py-2">
          <span className="text-xs text-muted-foreground">You have unsaved changes.</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="xs" variant="ghost" disabled={update.isPending} onClick={resetDraft}>
              Reset
            </Button>
            <Button size="xs" disabled={update.isPending || nameInvalid} onClick={save}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

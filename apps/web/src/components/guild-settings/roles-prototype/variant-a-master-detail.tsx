// PROTOTYPE — THROWAWAY (wayfinder ticket #48).
// Variant A — Discord-style master–detail: role list on the left (reorder via ▲▼),
// full edit pane (name, color, grouped permission toggles with hints) on the right.

import { Button } from "@konus-la/ui/components/button";
import { Input } from "@konus-la/ui/components/input";
import { Separator } from "@konus-la/ui/components/separator";
import { cn } from "@konus-la/ui/lib/utils";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { ColorSwatchRow, PermissionToggles, RoleDot } from "./shared";
import {
  EVERYONE_ID,
  createRole,
  customRolesByRank,
  deleteRole,
  moveRole,
  updateRole,
  usePrototypeRoles,
} from "./store";

export function VariantAMasterDetail() {
  const { roles, assignments } = usePrototypeRoles();
  const ranked = customRolesByRank(roles);
  const everyone = roles.find((role) => role.id === EVERYONE_ID);
  const [selectedId, setSelectedId] = useState<string>(ranked[0]?.id ?? EVERYONE_ID);
  const selected = roles.find((role) => role.id === selectedId) ?? everyone;
  if (!selected || !everyone) return null;

  const memberCount = (roleId: string) =>
    Object.values(assignments).filter((roleIds) => roleIds.includes(roleId)).length;

  return (
    <div className="flex min-h-0 flex-col gap-4 sm:flex-row">
      <div className="flex shrink-0 flex-col gap-0.5 sm:w-44 sm:border-r sm:border-foreground/10 sm:pr-3">
        <Button
          size="xs"
          variant="outline"
          className="mb-1 justify-start"
          onClick={() => setSelectedId(createRole().id)}
        >
          <PlusIcon className="size-3.5" />
          New role
        </Button>
        {[...ranked, everyone].map((role, index) => (
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
                {role.name}
              </span>
            </button>
            {role.id !== EVERYONE_ID && (
              <span className="hidden items-center group-hover:flex">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={index === 0}
                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  onClick={() => moveRole(role.id, "up")}
                >
                  <ChevronUpIcon className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={index === ranked.length - 1}
                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  onClick={() => moveRole(role.id, "down")}
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

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase">Role name</label>
          <div className="flex items-center gap-2">
            <Input
              value={selected.name}
              disabled={selected.id === EVERYONE_ID}
              onChange={(event) => updateRole(selected.id, { name: event.target.value })}
              className="max-w-56"
            />
            {selected.id !== EVERYONE_ID && (
              <span className="text-xs text-muted-foreground">
                {memberCount(selected.id)} member{memberCount(selected.id) === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        {selected.id !== EVERYONE_ID && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase">Color</label>
            <ColorSwatchRow role={selected} />
          </div>
        )}

        <Separator />
        <PermissionToggles role={selected} />

        {selected.id !== EVERYONE_ID && (
          <>
            <Separator />
            <Button
              size="xs"
              variant="destructive"
              className="self-start"
              onClick={() => {
                deleteRole(selected.id);
                setSelectedId(EVERYONE_ID);
              }}
            >
              <Trash2Icon className="size-3.5" />
              Delete role
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

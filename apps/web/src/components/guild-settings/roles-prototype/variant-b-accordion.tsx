// PROTOTYPE — THROWAWAY (wayfinder ticket #48).
// Variant B — single-column accordion: every role is a row (dot, name, member count,
// permission count, ▲▼ always visible); clicking a row expands a compact inline editor.

import { Button } from "@konus-la/ui/components/button";
import { Input } from "@konus-la/ui/components/input";
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

export function VariantBAccordion() {
  const { roles, assignments } = usePrototypeRoles();
  const ranked = customRolesByRank(roles);
  const everyone = roles.find((role) => role.id === EVERYONE_ID);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (!everyone) return null;

  const memberCount = (roleId: string) =>
    Object.values(assignments).filter((roleIds) => roleIds.includes(roleId)).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Order is rank — use ▲▼. Click a role to edit it in place.
        </p>
        <Button size="xs" variant="outline" onClick={() => setExpandedId(createRole().id)}>
          <PlusIcon className="size-3.5" />
          New role
        </Button>
      </div>

      <ul className="flex flex-col divide-y divide-foreground/10 border-y border-foreground/10">
        {[...ranked, everyone].map((role, index) => {
          const expanded = expandedId === role.id;
          const isEveryone = role.id === EVERYONE_ID;
          return (
            <li key={role.id} className="flex flex-col">
              <div
                className={cn(
                  "flex items-center gap-3 py-2 pr-1 pl-2",
                  expanded && "bg-muted/50",
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => setExpandedId(expanded ? null : role.id)}
                >
                  <RoleDot color={role.color} />
                  <span
                    className="truncate text-sm font-medium"
                    style={{ color: role.color ?? undefined }}
                  >
                    {role.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {isEveryone ? "everyone" : `${memberCount(role.id)} members`} ·{" "}
                    {role.permissions.length} perms
                  </span>
                </button>
                {!isEveryone && (
                  <span className="flex items-center">
                    <button
                      type="button"
                      aria-label="Move up"
                      disabled={index === 0}
                      className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      onClick={() => moveRole(role.id, "up")}
                    >
                      <ChevronUpIcon className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      disabled={index === ranked.length - 1}
                      className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      onClick={() => moveRole(role.id, "down")}
                    >
                      <ChevronDownIcon className="size-4" />
                    </button>
                  </span>
                )}
              </div>

              {expanded && (
                <div className="flex flex-col gap-3 border-t border-foreground/10 bg-muted/30 p-3">
                  {!isEveryone && (
                    <div className="flex flex-wrap items-center gap-3">
                      <Input
                        value={role.name}
                        onChange={(event) => updateRole(role.id, { name: event.target.value })}
                        className="h-8 max-w-48"
                      />
                      <ColorSwatchRow role={role} />
                    </div>
                  )}
                  <PermissionToggles role={role} compact />
                  {!isEveryone && (
                    <Button
                      size="xs"
                      variant="destructive"
                      className="self-start"
                      onClick={() => deleteRole(role.id)}
                    >
                      <Trash2Icon className="size-3.5" />
                      Delete role
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

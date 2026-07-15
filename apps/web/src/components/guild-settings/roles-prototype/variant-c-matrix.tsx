// PROTOTYPE — THROWAWAY (wayfinder ticket #48).
// Variant C — permission matrix: permissions as rows, roles as columns, checkboxes at
// intersections. Cross-role comparison at a glance; rename/recolor/delete lives in a
// popover on each column header; reorder via ◀▶ in the header.

import { Button } from "@konus-la/ui/components/button";
import { Checkbox } from "@konus-la/ui/components/checkbox";
import { Input } from "@konus-la/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@konus-la/ui/components/popover";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Fragment } from "react";

import { ColorSwatchRow, RoleDot } from "./shared";
import {
  EVERYONE_ID,
  PERMISSION_GROUPS,
  createRole,
  customRolesByRank,
  deleteRole,
  moveRole,
  togglePermission,
  updateRole,
  usePrototypeRoles,
} from "./store";

export function VariantCMatrix() {
  const { roles } = usePrototypeRoles();
  const ranked = customRolesByRank(roles);
  const everyone = roles.find((role) => role.id === EVERYONE_ID);
  if (!everyone) return null;
  const columns = [...ranked, everyone];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Rows are permissions, columns are roles (rank falls left → right). Click a header to
        rename, recolor, or delete; ◀▶ reorders.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-44 bg-background p-2 text-left align-bottom">
                <Button size="xs" variant="outline" onClick={() => createRole()}>
                  <PlusIcon className="size-3.5" />
                  New role
                </Button>
              </th>
              {columns.map((role, index) => {
                const isEveryone = role.id === EVERYONE_ID;
                return (
                  <th key={role.id} className="min-w-24 p-2 text-center align-bottom font-normal">
                    <div className="flex flex-col items-center gap-1">
                      {!isEveryone && (
                        <span className="flex items-center">
                          <button
                            type="button"
                            aria-label="Move left (rank up)"
                            disabled={index === 0}
                            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                            onClick={() => moveRole(role.id, "up")}
                          >
                            <ChevronLeftIcon className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Move right (rank down)"
                            disabled={index === ranked.length - 1}
                            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                            onClick={() => moveRole(role.id, "down")}
                          >
                            <ChevronRightIcon className="size-3.5" />
                          </button>
                        </span>
                      )}
                      {isEveryone ? (
                        <span className="flex items-center gap-1.5 px-1 py-0.5 text-xs font-medium">
                          <RoleDot color={null} />
                          @everyone
                        </span>
                      ) : (
                        <Popover>
                          <PopoverTrigger
                            render={
                              <button
                                type="button"
                                className="flex max-w-28 items-center gap-1.5 rounded px-1 py-0.5 text-xs font-medium hover:bg-muted"
                              />
                            }
                          >
                            <RoleDot color={role.color} />
                            <span
                              className="truncate"
                              style={{ color: role.color ?? undefined }}
                            >
                              {role.name}
                            </span>
                          </PopoverTrigger>
                          <PopoverContent className="flex w-64 flex-col gap-3 p-3">
                            <Input
                              value={role.name}
                              onChange={(event) =>
                                updateRole(role.id, { name: event.target.value })
                              }
                              className="h-8"
                            />
                            <ColorSwatchRow role={role} />
                            <Button
                              size="xs"
                              variant="destructive"
                              className="self-start"
                              onClick={() => deleteRole(role.id)}
                            >
                              <Trash2Icon className="size-3.5" />
                              Delete role
                            </Button>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_GROUPS.map((group) => (
              <Fragment key={group.label}>
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    className="sticky left-0 bg-background pt-3 pb-1 text-xs font-medium text-muted-foreground uppercase"
                  >
                    {group.label}
                  </td>
                </tr>
                {group.permissions.map((permission) => (
                  <tr key={permission.id} className="border-t border-foreground/10">
                    <td
                      className="sticky left-0 z-10 bg-background py-1.5 pr-4 pl-0"
                      title={permission.hint}
                    >
                      {permission.label}
                    </td>
                    {columns.map((role) => (
                      <td key={role.id} className="py-1.5 text-center">
                        <Checkbox
                          checked={role.permissions.includes(permission.id)}
                          onCheckedChange={() => togglePermission(role.id, permission.id)}
                          className="mx-auto after:-inset-2"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

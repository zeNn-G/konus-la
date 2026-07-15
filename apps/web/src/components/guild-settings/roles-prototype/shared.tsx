// PROTOTYPE — THROWAWAY (wayfinder ticket #48). Small pieces the variants share:
// color swatch row, grouped permission toggles, role dot. Variants own their layouts.

import { Checkbox } from "@konus-la/ui/components/checkbox";
import { cn } from "@konus-la/ui/lib/utils";

import {
  PERMISSION_GROUPS,
  ROLE_COLORS,
  togglePermission,
  updateRole,
  type PrototypeRole,
} from "./store";

export function RoleDot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color ?? "var(--muted-foreground)" }}
    />
  );
}

export function ColorSwatchRow({ role }: { role: PrototypeRole }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        title="No color"
        onClick={() => updateRole(role.id, { color: null })}
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
          onClick={() => updateRole(role.id, { color })}
          className={cn("size-6 rounded-full", role.color === color && "ring-2 ring-ring")}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

export function PermissionToggles({
  role,
  compact,
}: {
  role: PrototypeRole;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col", compact ? "gap-2" : "gap-4")}>
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium text-muted-foreground uppercase">{group.label}</h4>
          <div className={cn(compact && "grid grid-cols-1 gap-x-4 md:grid-cols-2")}>
            {group.permissions.map((permission) => {
              const checked = role.permissions.includes(permission.id);
              return (
                <label
                  key={permission.id}
                  className="flex cursor-pointer items-start gap-2.5 py-1.5"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => togglePermission(role.id, permission.id)}
                    className="mt-0.5"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm leading-tight">{permission.label}</span>
                    {!compact && (
                      <span className="text-xs text-muted-foreground">{permission.hint}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// PROTOTYPE — THROWAWAY (wayfinder ticket #48). Replaces the static "Owner"/"@everyone"
// chip on settings member rows: colored chips per assigned role (click × to remove) and
// a + popover to assign, mimicking Discord's member-row role editing.

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@konus-la/ui/components/popover";
import { PlusIcon, XIcon } from "lucide-react";

import { RoleDot } from "./shared";
import {
  assignRole,
  customRolesByRank,
  unassignRole,
  usePrototypeRoles,
} from "./store";

export function MemberRoleChips({ userId, isOwner }: { userId: string; isOwner: boolean }) {
  const { roles, assignments } = usePrototypeRoles();
  const assigned = assignments[userId] ?? [];
  const ranked = customRolesByRank(roles);
  const assignedRoles = ranked.filter((role) => assigned.includes(role.id));
  const assignable = ranked.filter((role) => !assigned.includes(role.id));

  return (
    <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
      {isOwner && <span className="text-xs text-muted-foreground">Owner</span>}
      {assignedRoles.length === 0 && !isOwner && (
        <span className="text-xs text-muted-foreground">@everyone</span>
      )}
      {assignedRoles.map((role) => (
        <span
          key={role.id}
          className="group flex items-center gap-1 rounded-full border border-foreground/15 py-0.5 pr-1.5 pl-2 text-xs"
        >
          <RoleDot color={role.color} className="size-2" />
          {role.name}
          <button
            type="button"
            aria-label={`Remove ${role.name}`}
            className="text-muted-foreground opacity-50 hover:text-foreground group-hover:opacity-100"
            onClick={() => unassignRole(userId, role.id)}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      {assignable.length > 0 && (
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label="Add role"
                className="flex size-5 items-center justify-center rounded-full border border-foreground/15 text-muted-foreground hover:bg-muted hover:text-foreground"
              />
            }
          >
            <PlusIcon className="size-3" />
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-44 flex-col gap-0.5 p-1.5">
            {assignable.map((role) => (
              <button
                key={role.id}
                type="button"
                className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => assignRole(userId, role.id)}
              >
                <RoleDot color={role.color} />
                {role.name}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

// PROTOTYPE — THROWAWAY (wayfinder ticket #48). "Viewing as" simulator for how the
// settings dialog widens beyond the owner: pick an identity and the section nav filters
// to what that identity's permissions unlock (owner additionally sees Danger zone).

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@konus-la/ui/components/select";

import {
  EVERYONE_ID,
  customRolesByRank,
  setViewingAs,
  usePrototypeRoles,
} from "./store";

export function ViewingAsPicker({ className }: { className?: string }) {
  const { roles, viewingAs } = usePrototypeRoles();
  const items = [
    { value: "owner", label: "Owner" },
    ...customRolesByRank(roles).map((role) => ({ value: role.id, label: role.name })),
    { value: EVERYONE_ID, label: "@everyone" },
  ];

  return (
    <div className={className}>
      <p className="mb-1 px-2 text-[10px] font-medium tracking-wide text-amber-600 uppercase dark:text-amber-500">
        Prototype · viewing as
      </p>
      <Select
        items={items}
        value={viewingAs}
        onValueChange={(value) => {
          if (typeof value === "string") setViewingAs(value);
        }}
      >
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

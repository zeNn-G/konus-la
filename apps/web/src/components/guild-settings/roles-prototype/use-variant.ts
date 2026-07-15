// PROTOTYPE — THROWAWAY (wayfinder ticket #48). `?variant=a|b|c` on any guild route
// activates the roles prototype; absent = the untouched production app.

import { useNavigate, useSearch } from "@tanstack/react-router";

export type RolesVariant = "a" | "b" | "c";

export const ROLES_VARIANTS: { key: RolesVariant; name: string }[] = [
  { key: "a", name: "Master–detail" },
  { key: "b", name: "Accordion rows" },
  { key: "c", name: "Permission matrix" },
];

export function useRolesVariant(): RolesVariant | null {
  const search = useSearch({ strict: false }) as { variant?: unknown };
  const value = search.variant;
  return value === "a" || value === "b" || value === "c" ? value : null;
}

export function useSetRolesVariant() {
  const navigate = useNavigate();
  return (variant: RolesVariant | null) =>
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        variant: variant ?? undefined,
      }),
      replace: true,
    });
}

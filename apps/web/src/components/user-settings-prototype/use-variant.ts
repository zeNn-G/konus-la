// PROTOTYPE — THROWAWAY (wayfinder ticket #77). `?variant=a|b|c` on any app route
// activates the user-settings prototype; absent = the untouched production app.

import { useNavigate, useSearch } from "@tanstack/react-router";

export type SettingsVariant = "a" | "b" | "c";

export const SETTINGS_VARIANTS: { key: SettingsVariant; name: string }[] = [
  { key: "a", name: "Full-screen takeover" },
  { key: "b", name: "Guild-settings modal" },
  { key: "c", name: "Single-scroll sheet" },
];

export function useSettingsVariant(): SettingsVariant | null {
  const search = useSearch({ strict: false }) as { variant?: unknown };
  const value = search.variant;
  return value === "a" || value === "b" || value === "c" ? value : null;
}

export function useSetSettingsVariant() {
  const navigate = useNavigate();
  return (variant: SettingsVariant | null) =>
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        variant: variant ?? undefined,
      }),
      replace: true,
    });
}

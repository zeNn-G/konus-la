import { useParams, useRouterState } from "@tanstack/react-router";

export type SidebarZone =
  | { zone: "guild"; guildId: string }
  | { zone: "home" }
  | { zone: "rail-only" };

/**
 * Which second sidebar column the shell shows for the current location: the guild's
 * channels inside a guild, the DM list in the home zone, and none on account surfaces
 * (profile/admin) where the rail stands alone.
 */
export function useSidebarZone(): SidebarZone {
  const { guildId } = useParams({ strict: false });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (guildId) return { zone: "guild", guildId };
  if (pathname.startsWith("/profile") || pathname.startsWith("/admin")) {
    return { zone: "rail-only" };
  }
  return { zone: "home" };
}

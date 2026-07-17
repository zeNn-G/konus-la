import { useParams } from "@tanstack/react-router";

export type SidebarZone = { zone: "guild"; guildId: string } | { zone: "home" };

/**
 * Which second sidebar column the shell shows for the current location: the guild's
 * channels inside a guild, the DM list everywhere else.
 */
export function useSidebarZone(): SidebarZone {
  const { guildId } = useParams({ strict: false });
  if (guildId) return { zone: "guild", guildId };
  return { zone: "home" };
}

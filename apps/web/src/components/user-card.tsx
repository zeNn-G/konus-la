import { Avatar } from "@konus-la/ui/components/avatar";
import { getRouteApi } from "@tanstack/react-router";

import { useUserSettings } from "@/lib/user-settings";

// Read the session the (app) layout already resolved into route context.
const appRoute = getRouteApi("/(app)");

/** Sidebar-footer chip: avatar + name, the sole trigger for the user-settings dialog. */
export function UserCard() {
  const { session } = appRoute.useRouteContext();
  const openSettings = useUserSettings((s) => s.openAt);
  const username = session.user.username ?? session.user.email;

  return (
    <button
      type="button"
      onClick={() => openSettings("profile")}
      className="flex w-full min-w-0 items-center gap-2 p-1 text-left hover:bg-sidebar-accent"
    >
      <Avatar seed={username} src={session.user.image} className="size-7 shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium">{session.user.name}</span>
        <span className="truncate text-xs text-muted-foreground">@{username}</span>
      </span>
    </button>
  );
}

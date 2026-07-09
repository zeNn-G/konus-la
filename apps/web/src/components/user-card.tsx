import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { Link, getRouteApi } from "@tanstack/react-router";
import { KeyRoundIcon, LogOutIcon } from "lucide-react";

import { authClient } from "@/lib/auth-client";

// Read the session the (app) layout already resolved into route context.
const appRoute = getRouteApi("/(app)");

/** Sidebar-footer chip: avatar + name linking to the profile, admin shortcut, sign-out. */
export function UserCard() {
  const { session } = appRoute.useRouteContext();
  const username = session.user.username ?? session.user.email;

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Link
        to="/profile"
        className="flex min-w-0 flex-1 items-center gap-2 p-1 hover:bg-sidebar-accent"
      >
        <Avatar seed={username} src={session.user.image} className="size-7 shrink-0" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xs font-medium">{session.user.name}</span>
          <span className="truncate text-xs text-muted-foreground">@{username}</span>
        </span>
      </Link>

      {session.user.role === "admin" && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Invite codes"
          title="Invite codes"
          render={<Link to="/admin/codes" />}
        >
          <KeyRoundIcon className="size-4" />
        </Button>
      )}

      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Sign out"
        title="Sign out"
        onClick={async () => {
          await authClient.signOut({
            fetchOptions: {
              onSuccess: () => {
                window.location.href = "/login";
              },
            },
          });
        }}
      >
        <LogOutIcon className="size-4" />
      </Button>
    </div>
  );
}

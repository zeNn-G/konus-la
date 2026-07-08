import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { Link, getRouteApi } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

// Read the session the (app) layout already resolved into route context.
const appRoute = getRouteApi("/(app)");

/** Header chip: avatar + name, admin shortcut, and sign-out. Rendered by the app layout. */
export function UserCard() {
  const { session } = appRoute.useRouteContext();
  const username = session.user.username ?? session.user.email;

  return (
    <div className="flex items-center gap-2">
      <Link to="/profile" className="flex items-center gap-2 hover:opacity-80">
        <Avatar seed={username} src={session.user.image} className="size-7" />
        <span className="text-xs font-medium">{session.user.name}</span>
      </Link>

      {session.user.role === "admin" && (
        <Button size="xs" variant="outline" render={<Link to="/admin/codes" />}>
          Codes
        </Button>
      )}

      <Button
        size="xs"
        variant="ghost"
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
        Sign out
      </Button>
    </div>
  );
}

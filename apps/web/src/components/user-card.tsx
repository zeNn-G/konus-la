import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { Link, getRouteApi } from "@tanstack/react-router";
import { GavelIcon, KeyRoundIcon, LogOutIcon } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { voiceSession } from "@/lib/voice/session";

// PROTOTYPE — THROWAWAY (wayfinder ticket #77): variant-gated trigger swap below.
import { usePrototypeStore } from "@/components/user-settings-prototype/store";
import { useSettingsVariant } from "@/components/user-settings-prototype/use-variant";

// Read the session the (app) layout already resolved into route context.
const appRoute = getRouteApi("/(app)");

/** Sidebar-footer chip: avatar + name linking to the profile, admin shortcut, sign-out. */
export function UserCard() {
  const { session } = appRoute.useRouteContext();
  const username = session.user.username ?? session.user.email;

  // PROTOTYPE — with a variant active the chip opens the settings dialog instead of
  // linking to /profile; A and B (post-reaction) move admin links + sign-out into the
  // dialog, C moves only the admin links.
  const variant = useSettingsVariant();
  const openSettings = usePrototypeStore((s) => s.openAt);
  const chipContent = (
    <>
      <Avatar seed={username} src={session.user.image} className="size-7 shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium">{session.user.name}</span>
        <span className="truncate text-xs text-muted-foreground">@{username}</span>
      </span>
    </>
  );
  const chipClass = "flex min-w-0 flex-1 items-center gap-2 p-1 hover:bg-sidebar-accent";
  const showAdminIcons = session.user.role === "admin" && variant === null;
  const showSignOut = variant === null || variant === "c";

  return (
    <div className="flex min-w-0 items-center gap-1">
      {variant === null ? (
        <Link to="/profile" className={chipClass}>
          {chipContent}
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => openSettings("profile")}
          className={`${chipClass} text-left`}
        >
          {chipContent}
        </button>
      )}

      {showAdminIcons && (
        <>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Invite codes"
            title="Invite codes"
            render={<Link to="/admin/codes" />}
          >
            <KeyRoundIcon className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Instance bans"
            title="Instance bans"
            render={<Link to="/admin/bans" />}
          >
            <GavelIcon className="size-4" />
          </Button>
        </>
      )}

      {showSignOut && (
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Sign out"
        title="Sign out"
        onClick={async () => {
          // Logout is a teardown trigger (unlike navigation): explicit leave, no grace.
          await voiceSession.leave();
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
      )}
    </div>
  );
}

import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { Input } from "@konus-la/ui/components/input";
import { Label } from "@konus-la/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

const appRoute = getRouteApi("/(app)");

/** Display-name form beside a live preview card that tracks unsaved edits. */
export function ProfileSection() {
  const router = useRouter();
  const { session } = appRoute.useRouteContext();
  const [displayName, setDisplayName] = useState(session.user.name);

  // A save invalidates the router, which refreshes the session in route context —
  // re-sync so the field tracks the server's accepted value.
  useEffect(() => {
    setDisplayName(session.user.name);
  }, [session.user.name]);

  const updateProfile = useMutation(
    orpc.profile.update.mutationOptions({
      onSuccess: async () => {
        await router.invalidate();
        toast.success("Profile updated.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const username = session.user.username ?? session.user.email;

  return (
    <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-[minmax(0,1fr)_260px]">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const next = displayName.trim();
          if (!next) {
            toast.error("Display name can’t be empty.");
            return;
          }
          updateProfile.mutate({ displayName: next });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="displayName">Display name</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="username">Username</Label>
          <Input id="username" value={username} disabled />
          <p className="text-xs text-muted-foreground">Usernames are permanent.</p>
        </div>
        <div>
          <Button type="submit" disabled={updateProfile.isPending}>
            {updateProfile.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-1">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Preview
        </div>
        <div className="flex flex-col items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar p-5">
          <Avatar seed={username} src={session.user.image} className="size-16" />
          <div className="max-w-full truncate text-sm font-medium">
            {displayName.trim() || session.user.name}
          </div>
          <div className="text-xs text-muted-foreground">@{username}</div>
        </div>
      </div>
    </div>
  );
}

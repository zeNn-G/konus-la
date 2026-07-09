import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@konus-la/ui/components/card";
import { Input } from "@konus-la/ui/components/input";
import { Label } from "@konus-la/ui/components/label";
import { SidebarTrigger } from "@konus-la/ui/components/sidebar";
import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/(app)/profile")({
  component: ProfileComponent,
});

function ProfileComponent() {
  const router = useRouter();
  const { session } = Route.useRouteContext();
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (session?.user.name) setDisplayName(session.user.name);
  }, [session?.user.name]);

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
    <div className="mx-auto w-full max-w-lg px-4 py-8">
      <div className="pb-2 md:hidden">
        <SidebarTrigger className="-ml-1" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Manage how you appear in konus-la.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Avatar seed={username} src={session.user.image} className="size-12" />
            <div>
              <div className="font-medium">{session.user.name}</div>
              <div className="text-muted-foreground">@{username}</div>
            </div>
          </div>

          <form
            className="flex flex-col gap-3"
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
              <p className="text-muted-foreground">Usernames are permanent.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={updateProfile.isPending}>
                {updateProfile.isPending ? "Saving…" : "Save"}
              </Button>
              <Link to="/" className="ml-auto text-primary hover:underline">
                Home
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

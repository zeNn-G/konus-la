import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/(app)/")({
  component: HomeComponent,
});

function HomeComponent() {
  const { session } = Route.useRouteContext();

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-lg font-medium">Welcome back, {session.user.name}</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Signed in as @{session.user.username ?? session.user.email}.
      </p>
    </div>
  );
}

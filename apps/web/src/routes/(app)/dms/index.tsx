import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(app)/dms/")({
  // The DM home IS the app home — `/dms` on its own has nothing extra to show.
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});

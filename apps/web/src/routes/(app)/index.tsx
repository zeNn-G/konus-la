import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@konus-la/ui/components/empty";
import { createFileRoute } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";

import { DmSidebar } from "@/components/dm/dm-sidebar";

export const Route = createFileRoute("/(app)/")({
  component: HomeComponent,
});

/** Home = the DM zone: conversation rail + a pick-something empty pane. */
function HomeComponent() {
  const { session } = Route.useRouteContext();

  return (
    <div className="flex h-full min-h-0">
      <DmSidebar selfUserId={session.user.id} />
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquareIcon />
          </EmptyMedia>
          <EmptyTitle>Direct messages</EmptyTitle>
          <EmptyDescription>
            Pick a conversation, or start a new one with the buttons up in the sidebar.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

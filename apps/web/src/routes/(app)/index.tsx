import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@konus-la/ui/components/empty";
import { SidebarTrigger } from "@konus-la/ui/components/sidebar";
import { createFileRoute } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";

import { DmList } from "@/components/dm/dm-list";
import { DmActions } from "@/components/dm/dm-sidebar";

export const Route = createFileRoute("/(app)/")({
  component: HomeComponent,
});

/**
 * Home = the DM zone. On desktop the sidebar owns the conversation list, so this pane is
 * just the pick-something empty state; on mobile the list itself is the page.
 */
function HomeComponent() {
  const { session } = Route.useRouteContext();

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        <header className="flex items-center justify-between border-b border-foreground/10 px-2 py-1.5">
          <div className="flex items-center gap-1">
            <SidebarTrigger />
            <span className="text-sm font-medium">Direct messages</span>
          </div>
          <DmActions selfUserId={session.user.id} />
        </header>
        <DmList selfUserId={session.user.id} className="min-h-0 flex-1 overflow-y-auto" />
      </div>

      <div className="hidden min-h-0 flex-1 md:flex">
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
    </>
  );
}

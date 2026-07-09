import { Button } from "@konus-la/ui/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@konus-la/ui/components/sidebar";
import { MessageSquarePlusIcon, UsersIcon } from "lucide-react";
import { useState } from "react";

import { DmList } from "@/components/dm/dm-list";
import { NewDmDialog } from "@/components/dm/new-dm-dialog";
import { NewGroupDialog } from "@/components/dm/new-group-dialog";
import { UserCard } from "@/components/user-card";

/** The Home zone's second column: conversation list, new-conversation actions, user footer. */
export function DmSidebar({ selfUserId }: { selfUserId: string }) {
  return (
    <Sidebar collapsible="none" className="min-w-0 flex-1">
      <SidebarHeader className="flex-row items-center justify-between gap-0 border-b border-sidebar-border px-4 py-1.5">
        <span className="text-sm font-medium">Direct messages</span>
        <DmActions selfUserId={selfUserId} />
      </SidebarHeader>

      <SidebarContent>
        <DmList selfUserId={selfUserId} />
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <UserCard />
      </SidebarFooter>
    </Sidebar>
  );
}

/** New DM / new group triggers + dialogs; shared by the sidebar and the mobile home header. */
export function DmActions({ selfUserId }: { selfUserId: string }) {
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);

  return (
    <div className="flex gap-0.5">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="New DM"
        title="New DM"
        onClick={() => setNewDmOpen(true)}
      >
        <MessageSquarePlusIcon className="size-4" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="New group"
        title="New group"
        onClick={() => setNewGroupOpen(true)}
      >
        <UsersIcon className="size-4" />
      </Button>

      <NewDmDialog open={newDmOpen} onOpenChange={setNewDmOpen} selfUserId={selfUserId} />
      <NewGroupDialog open={newGroupOpen} onOpenChange={setNewGroupOpen} selfUserId={selfUserId} />
    </div>
  );
}

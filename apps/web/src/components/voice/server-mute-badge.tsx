import { cn } from "@konus-la/ui/lib/utils";
import { MicOffIcon } from "lucide-react";

/**
 * The server-mute marker (spec §UI): deliberately distinct from the plain red self-mute
 * icon — a moderator imposed this, and everyone (the target included) should read it as
 * such at a glance. Sized by the host via className.
 */
export function ServerMuteBadge({ className }: { className?: string }) {
  return (
    <span
      title="Muted by a moderator"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[3px] bg-red-500 p-px",
        className,
      )}
    >
      <MicOffIcon className="size-full text-white" strokeWidth={2.5} />
    </span>
  );
}

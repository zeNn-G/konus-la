import { Avatar } from "@konus-la/ui/components/avatar";
import { cn } from "@konus-la/ui/lib/utils";

/** Avatar with the online/offline presence dot pinned to its bottom-right corner. */
export function PresenceAvatar({
  seed,
  src,
  online,
  className,
  dotClassName,
}: {
  seed: string;
  src: string | null;
  online: boolean;
  /** Avatar size utility, defaults to size-6. */
  className?: string;
  /** Dot size override for larger avatars (default size-2). */
  dotClassName?: string;
}) {
  return (
    <div className="relative shrink-0">
      <Avatar seed={seed} src={src} className={cn("size-6", className)} />
      <span
        aria-label={online ? "Online" : "Offline"}
        className={cn(
          "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background",
          online ? "bg-green-500" : "bg-muted-foreground/40",
          dotClassName,
        )}
      />
    </div>
  );
}

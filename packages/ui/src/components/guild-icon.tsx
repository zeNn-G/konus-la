import { Avatar as DicebearAvatar } from "@dicebear/core";
import identicon from "@dicebear/styles/identicon.json" with { type: "json" };
import { cn } from "@konus-la/ui/lib/utils";
import { useMemo } from "react";

type GuildIconProps = {
  /** Stable seed for the generated icon (use the immutable guild id). */
  seed: string;
  /** Explicit icon image; when null/undefined a deterministic Dicebear identicon is rendered. */
  src?: string | null;
  alt?: string;
  size?: number;
  className?: string;
};

/**
 * Guild icon. Renders `src` when present, otherwise a deterministic Dicebear "identicon"
 * generated from `seed` (the guild id). In v1 there is no icon setter, so `src` is always
 * null and every guild gets a stable generated icon keyed by its id. Counterpart to `Avatar`.
 */
function GuildIcon({ seed, src, alt, size = 128, className }: GuildIconProps) {
  const generated = useMemo(
    () => new DicebearAvatar(identicon, { seed, size }).toDataUri(),
    [seed, size],
  );

  return (
    <img
      data-slot="guild-icon"
      src={src ?? generated}
      alt={alt ?? seed}
      width={size}
      height={size}
      className={cn("size-8 shrink-0 rounded-none object-cover", className)}
    />
  );
}

export { GuildIcon };

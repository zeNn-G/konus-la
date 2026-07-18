import { avatarDataUri } from "@konus-la/ui/lib/avatar-uri";
import { cn } from "@konus-la/ui/lib/utils";
import { useMemo } from "react";

type AvatarProps = {
  /** Stable seed for the generated fallback (use the immutable username). */
  seed: string;
  /** Explicit avatar image; when null/undefined a deterministic Dicebear avatar is rendered. */
  src?: string | null;
  alt?: string;
  size?: number;
  className?: string;
};

/**
 * User avatar. Renders `src` when present, otherwise a deterministic Dicebear "lorelei"
 * avatar generated from `seed`. In v1 there is no avatar setter, so `src` is always null
 * and everyone gets a stable generated avatar keyed by their username.
 */
function Avatar({ seed, src, alt, size = 128, className }: AvatarProps) {
  const generated = useMemo(() => avatarDataUri(seed, size), [seed, size]);

  return (
    <img
      data-slot="avatar"
      src={src ?? generated}
      alt={alt ?? seed}
      width={size}
      height={size}
      className={cn("size-8 shrink-0 rounded-none object-cover", className)}
    />
  );
}

export { Avatar };

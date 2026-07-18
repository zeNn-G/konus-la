import { Avatar as DicebearAvatar } from "@dicebear/core";
import lorelei from "@dicebear/styles/lorelei.json" with { type: "json" };

/**
 * The deterministic generated-avatar data URI behind the Avatar component — exported on
 * its own for non-DOM consumers (the OS-notification icon), so a user's toast face
 * matches their in-app face.
 */
export function avatarDataUri(seed: string, size = 128): string {
  return new DicebearAvatar(lorelei, { seed, size }).toDataUri();
}

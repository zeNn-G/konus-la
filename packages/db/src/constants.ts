/** Username validation shared across the signup hook and the client form. */
export const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

/**
 * Usernames that may not be claimed at signup. These drive `@mentions`; some are
 * reserved for future channel-notify keywords (`@everyone` / `@here`) or imply authority.
 */
export const RESERVED_USERNAMES = new Set(["everyone", "here", "admin", "system", "owner"]);

/** True when `username` (already lowercased) is well-formed and not reserved. */
export function isUsernameAllowed(username: string): boolean {
  return USERNAME_REGEX.test(username) && !RESERVED_USERNAMES.has(username);
}

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

/**
 * Human-shareable code generation, used by both signup codes and guild invites.
 * The alphabet is base32-ish with ambiguous glyphs (0/O/1/I/L) removed so codes are
 * safe to read aloud and retype.
 */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Generate a random code of `length` characters drawn from {@link CODE_ALPHABET}. */
export function randomCode(length = 10): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

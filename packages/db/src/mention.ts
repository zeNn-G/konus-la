import { RESERVED_USERNAMES } from "./constants";

/**
 * Mention scanning shared by the server (insert-time counting) and the client (display-time
 * pill rendering). Usernames are immutable (Phase 1), so raw `@username` text is a stable
 * reference — no token format, no mention table.
 */
export const MENTION_REGEX = /@([a-z0-9_]{3,20})/g;

/**
 * Candidate usernames mentioned in `content`: deduped, reserved words dropped (`@everyone`
 * et al. are inert text in v1). Callers still must resolve candidates against actual guild
 * members — an `@notauser` that matches the pattern is simply never resolved.
 */
export function extractMentionCandidates(content: string): string[] {
  const seen = new Set<string>();
  for (const match of content.matchAll(MENTION_REGEX)) {
    const username = match[1];
    if (username && !RESERVED_USERNAMES.has(username)) seen.add(username);
  }
  return [...seen];
}

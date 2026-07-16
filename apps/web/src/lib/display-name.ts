/**
 * The name a settings view shows for a user row that may reference a deleted account —
 * LEFT-joined display info yields nulls, never a missing row. Callers pick the fallback.
 */
export function displayName(
  user: { username: string | null; displayName: string | null } | null,
): string | null {
  return user?.displayName || user?.username || null;
}

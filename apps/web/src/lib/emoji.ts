/**
 * Shortcode → unicode emoji support for the composer (`:skull:` → 💀).
 *
 * Pinned to the exact emojibase dataset the frimousse picker reads (pass
 * EMOJIBASE_URL as its `emojibaseUrl` prop), so the picker and the typed
 * shortcodes can never disagree about which emoji exist. Messages always
 * store plain unicode — shortcodes never leave the composer.
 */
export const EMOJIBASE_URL = "https://cdn.jsdelivr.net/npm/emojibase-data@16.0.3";

export type ShortcodeEntry = { shortcode: string; emoji: string };

let loaded: Map<string, string> | null = null;
let loading: Promise<Map<string, string>> | null = null;

async function fetchShortcodeMap(): Promise<Map<string, string>> {
  // Only the ~120KB shortcodes file — the emoji character is derived from its own
  // hexcode ("1F441-FE0F" → code points), so the ~2MB en/data.json never needs to be
  // fetched or parsed here (a main-thread parse that big causes a visible frame drop).
  const shortcodes = (await fetch(`${EMOJIBASE_URL}/en/shortcodes/emojibase.json`).then((r) =>
    r.json(),
  )) as Record<string, string | string[]>;
  const map = new Map<string, string>();
  for (const [hexcode, names] of Object.entries(shortcodes)) {
    const emoji = String.fromCodePoint(...hexcode.split("-").map((part) => parseInt(part, 16)));
    for (const name of Array.isArray(names) ? names : [names]) {
      map.set(name, emoji);
    }
  }
  return map;
}

/** Start (or reuse) the dataset fetch; call from an idle moment before the user types `:`. */
export function preloadShortcodes(): Promise<Map<string, string>> {
  loading ??= fetchShortcodeMap().then((map) => (loaded = map));
  return loading;
}

/** The map if the fetch has finished, else null — callers degrade gracefully, never await. */
export function shortcodeMap(): Map<string, string> | null {
  return loaded;
}

/** Prefix matches first, then substring, deduped by emoji — for the `:query` autocomplete. */
export function searchShortcodes(query: string, limit = 8): ShortcodeEntry[] {
  const map = loaded;
  if (!map || !query) return [];
  const prefix: ShortcodeEntry[] = [];
  const substring: ShortcodeEntry[] = [];
  const seen = new Set<string>();
  for (const [shortcode, emoji] of map) {
    if (seen.has(emoji)) continue;
    if (shortcode.startsWith(query)) {
      seen.add(emoji);
      prefix.push({ shortcode, emoji });
      if (prefix.length >= limit) break;
    } else if (substring.length < limit && shortcode.includes(query)) {
      seen.add(emoji);
      substring.push({ shortcode, emoji });
    }
  }
  return [...prefix, ...substring].slice(0, limit);
}

/** Convert every complete `:name:` token known to the map (no-op while still loading). */
export function replaceShortcodes(text: string): string {
  const map = loaded;
  if (!map || !text.includes(":")) return text;
  return text.replaceAll(/:([a-z0-9_+-]+):/g, (token, name: string) => map.get(name) ?? token);
}

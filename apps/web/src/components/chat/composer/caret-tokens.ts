export type CaretToken = { start: number; query: string };

/** Identity of a token for change detection — same start + query means "still the same token". */
export const tokenKey = (token: CaretToken | null) => (token ? `${token.start}:${token.query}` : "");

/** The `@`-token being typed at the caret, or null. */
export function mentionTokenAtCaret(value: string, caret: number): CaretToken | null {
  const beforeCaret = value.slice(0, caret);
  const match = /(?:^|\s)@([a-z0-9_]{0,20})$/i.exec(beforeCaret);
  if (!match) return null;
  return { start: beforeCaret.length - match[1].length - 1, query: match[1].toLowerCase() };
}

/** The `:`-shortcode token being typed at the caret (min 2 chars, Discord-style), or null. */
export function emojiTokenAtCaret(value: string, caret: number): CaretToken | null {
  const beforeCaret = value.slice(0, caret);
  const match = /(?:^|\s):([a-z0-9_+-]{2,})$/.exec(beforeCaret);
  if (!match) return null;
  return { start: beforeCaret.length - match[1].length - 1, query: match[1] };
}

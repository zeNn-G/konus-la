/**
 * Pixel position of a character offset inside a textarea, for anchoring popups at the
 * trigger char of an autocomplete token. Textareas expose no DOM caret, so the text is
 * mirrored into a hidden div with identical typography and the offset is measured there.
 */

/** Styles that determine where text wraps and where each glyph lands. */
const MIRRORED_STYLES = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "tabSize",
  "textIndent",
  "textTransform",
  "wordBreak",
  "overflowWrap",
] as const;

let mirror: HTMLDivElement | null = null;

const getMirror = () => {
  if (!mirror) {
    mirror = document.createElement("div");
    mirror.setAttribute("aria-hidden", "true");
    mirror.style.position = "absolute";
    mirror.style.top = "0";
    mirror.style.left = "-9999px";
    mirror.style.visibility = "hidden";
    // Textareas always soft-wrap long words; the mirror must break identically.
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.overflowWrap = "break-word";
    document.body.appendChild(mirror);
  }
  return mirror;
};

/** Viewport rect (zero-width, one line tall) of the character at `offset` in the textarea. */
export function caretRectInTextarea(textarea: HTMLTextAreaElement | null, offset: number): DOMRect {
  if (!textarea) return new DOMRect();
  const div = getMirror();
  const computed = window.getComputedStyle(textarea);
  for (const property of MIRRORED_STYLES) {
    div.style[property] = computed[property];
  }

  div.textContent = textarea.value.slice(0, offset);
  const marker = document.createElement("span");
  // The real character (not an empty span) so a wrap at `offset` lands the marker on the
  // wrapped line, where the character actually renders.
  marker.textContent = textarea.value[offset] ?? ".";
  div.appendChild(marker);

  const textareaRect = textarea.getBoundingClientRect();
  const rect = new DOMRect(
    textareaRect.left + marker.offsetLeft - textarea.scrollLeft,
    textareaRect.top + marker.offsetTop - textarea.scrollTop,
    0,
    marker.offsetHeight,
  );
  div.textContent = "";
  return rect;
}

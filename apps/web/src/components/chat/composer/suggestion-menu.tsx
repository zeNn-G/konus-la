import { cn } from "@konus-la/ui/lib/utils";
import type { ReactNode, RefObject } from "react";

/**
 * Who moved the highlight last. Keyboard scrolls its row into view; that scroll slides
 * rows under a stationary cursor, and honoring those enter-events as hover would yank
 * the highlight back — a scroll/hover feedback loop that burns frames (Discord-style fix:
 * only real mouse movement counts, and only keyboard navigation scrolls).
 */
export type NavSource = "keyboard" | "mouse";

/** Keep the keyboard-highlighted row visible inside the scrollable suggestion list. */
const scrollActiveIntoView = (el: HTMLButtonElement | null) =>
  el?.scrollIntoView({ block: "nearest" });

type Props<T> = {
  items: T[];
  activeIndex: number;
  itemKey: (item: T) => string;
  navSource: RefObject<NavSource>;
  onHighlight: (index: number) => void;
  onSelect: (item: T) => void;
  children: (item: T) => ReactNode;
};

/** The dropdown above the composer shared by the `@`-mention and `:`-emoji autocompletes. */
export function SuggestionMenu<T>({
  items,
  activeIndex,
  itemKey,
  navSource,
  onHighlight,
  onSelect,
  children,
}: Props<T>) {
  return (
    <div className="absolute right-4 bottom-full left-4 z-10 mb-1 max-h-72 overflow-y-auto rounded border border-foreground/10 bg-background shadow-md">
      {items.map((item, index) => (
        <button
          key={itemKey(item)}
          type="button"
          ref={index === activeIndex && navSource.current === "keyboard" ? scrollActiveIntoView : undefined}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
            index === activeIndex ? "bg-muted" : "hover:bg-muted/60",
          )}
          onMouseMove={() => {
            navSource.current = "mouse";
            onHighlight(index);
          }}
          onMouseDown={(e) => {
            e.preventDefault(); // keep textarea focus
            onSelect(item);
          }}
        >
          {children(item)}
        </button>
      ))}
    </div>
  );
}

type KeyNavOptions = {
  count: number;
  navSource: RefObject<NavSource>;
  setIndex: (updater: (index: number) => number) => void;
  select: () => void;
  dismiss: () => void;
};

/**
 * Keyboard navigation for an open suggestion menu, called from the textarea's keydown.
 * Returns true when the key was consumed (so the caller must not treat it as input).
 */
export function suggestionKeyNav(
  e: React.KeyboardEvent,
  { count, navSource, setIndex, select, dismiss }: KeyNavOptions,
): boolean {
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      navSource.current = "keyboard";
      setIndex((i) => (i + 1) % count);
      return true;
    case "ArrowUp":
      e.preventDefault();
      navSource.current = "keyboard";
      setIndex((i) => (i - 1 + count) % count);
      return true;
    case "Enter":
    case "Tab":
      e.preventDefault();
      select();
      return true;
    case "Escape":
      dismiss();
      return true;
    default:
      return false;
  }
}

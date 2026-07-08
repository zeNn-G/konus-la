import { Popover, PopoverContent } from "@konus-la/ui/components/popover";
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
  /** Viewport rect of the token's trigger char — the popover anchors here. */
  anchorRect: () => DOMRect;
  /** The composer input: presses inside it re-derive the token instead of dismissing. */
  inputRef: RefObject<HTMLElement | null>;
  onHighlight: (index: number) => void;
  onSelect: (item: T) => void;
  onDismiss: () => void;
  children: (item: T) => ReactNode;
};

/** The caret-anchored popover shared by the `@`-mention and `:`-emoji autocompletes. */
export function SuggestionMenu<T>({
  items,
  activeIndex,
  itemKey,
  navSource,
  anchorRect,
  inputRef,
  onHighlight,
  onSelect,
  onDismiss,
  children,
}: Props<T>) {
  return (
    <Popover
      open
      modal={false}
      onOpenChange={(open, details) => {
        if (open) return;
        // Any close request dismisses (Escape arrives here, not at the textarea — Base UI
        // consumes it first) — except presses on the textarea itself: those move the
        // caret, and the token logic decides what happens next.
        if (details.reason === "outside-press") {
          const target = details.event.target;
          if (target instanceof Node && inputRef.current?.contains(target)) return;
        }
        onDismiss();
      }}
    >
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        anchor={{ getBoundingClientRect: anchorRect }}
        initialFocus={false}
        finalFocus={false}
        className="w-72 max-h-72 overflow-y-auto"
      >
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
      </PopoverContent>
    </Popover>
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

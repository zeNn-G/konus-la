import { Button } from "@konus-la/ui/components/button";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from "@konus-la/ui/components/emoji-picker";
import { cn } from "@konus-la/ui/lib/utils";
import { SmileIcon } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

import { EMOJIBASE_URL } from "@/lib/emoji";

type Props = {
  /** Insert the picked emoji into the composer. Must be stable — this component is memoized. */
  onPick: (emoji: string) => void;
  /** Return focus to the composer after dismissing with Escape. Must be stable. */
  onDismiss: () => void;
};

/**
 * The composer's emoji button + picker panel, isolated so composer keystrokes and
 * picker open/close never re-render each other. Mounting frimousse is a ~65ms main
 * thread task that froze the popup animation on EVERY open while the picker lived
 * inside a portal that unmounts on close. Instead the panel mounts ONCE at idle,
 * hidden with `visibility` (not `display`, so the grid keeps real dimensions and
 * builds itself off-screen) — opening is then a pure style toggle.
 */
export const EmojiPickerButton = memo(function EmojiPickerButton({ onPick, onDismiss }: Props) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300));
    idle(() => setMounted(true));
  }, []);

  useEffect(() => {
    if (!open) return;
    // Focus the search and select any leftover query so typing starts fresh.
    searchRef.current?.focus();
    searchRef.current?.select();
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onDismiss]);

  return (
    <span ref={rootRef} className="contents">
      <Button
        size="icon-sm"
        variant="ghost"
        className="my-1"
        aria-label="Open emoji picker"
        aria-expanded={open}
        onClick={() => {
          setMounted(true); // opened before the idle mount fired — mount now
          setOpen((o) => !o);
        }}
      >
        <SmileIcon className="size-4" />
      </Button>
      {mounted && (
        <div
          className={cn(
            "absolute bottom-full left-4 z-10 mb-1 origin-bottom-left rounded bg-popover shadow-md ring-1 ring-foreground/10 transition-all duration-100",
            open ? "visible scale-100 opacity-100" : "invisible scale-95 opacity-0",
          )}
        >
          <EmojiPicker
            className="h-80"
            emojibaseUrl={EMOJIBASE_URL}
            onEmojiSelect={({ emoji }) => {
              setOpen(false);
              onPick(emoji);
            }}
          >
            <EmojiPickerSearch ref={searchRef} placeholder="Search emoji" />
            <EmojiPickerContent />
            <EmojiPickerFooter />
          </EmojiPicker>
        </div>
      )}
    </span>
  );
});

/**
 * The bar that keeps Save in reach (owner, Nov 17: "I like how you did that on trade bids and
 * want to implement that broadly"). It is the last thing in a screen's own column, and it stays
 * at the bottom of the window while the screen is scrolled, so Save never has to be scrolled to.
 * At the end of the screen it rests where it is written.
 *
 * What goes in it is the screen's: on the left a line saying where the form stands ("You have
 * changes that are not saved."), on the right the buttons, Save last.
 *
 * Other bars that stay at the bottom of the window (the selected-photos bar of a ticket) sit
 * above this one: while a SaveBar is on screen its height is kept in `--jbk-save-bar` on the
 * page, and they add it to how far from the bottom they stay.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The bar's height, kept on the page while one is shown (see above). */
export const SAVE_BAR_VAR = "--jbk-save-bar";

/**
 * The bottom padding gives way to the iPhone's home indicator, so the buttons are never under it.
 */
export const SAVE_BAR_CLASS =
  "sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur";

/** The buttons of the bar, in one group on the right: they wrap together under the words. */
export const SAVE_BAR_ACTIONS = "flex flex-wrap items-center justify-end gap-2";

/** The bars on screen now. More than one can be (a page of several parts, each with its own). */
const shown = new Set<HTMLElement>();

/** Keeps the tallest shown bar's height on the page; takes it away when no bar is left. */
function keepHeight() {
  const page = document.documentElement;
  let most = 0;
  for (const el of shown) most = Math.max(most, Math.ceil(el.getBoundingClientRect().height));
  if (shown.size === 0) page.style.removeProperty(SAVE_BAR_VAR);
  else page.style.setProperty(SAVE_BAR_VAR, `${most}px`);
}

export function SaveBar(props: { children: ReactNode; className?: string | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    shown.add(el);
    keepHeight();
    // The bar grows when its words wrap (a phone, a long "Before you can save" line).
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(keepHeight);
    watch?.observe(el);
    return () => {
      watch?.disconnect();
      shown.delete(el);
      keepHeight();
    };
  }, []);
  return (
    <div ref={ref} className={cn(SAVE_BAR_CLASS, props.className)} data-save-bar>
      {props.children}
    </div>
  );
}

/**
 * The bar of a screen whose one button is "Save changes" (the Estimate Pricing pages; owner,
 * Nov 17: "yes pls" to the same bar there). Those pages kept the button at the top right of each
 * tab, out of sight once the tab was scrolled. `note` is the words on the left, when the screen
 * has something true to say about where it stands.
 */
export function SaveChangesBar(props: {
  saving: boolean;
  onSave: () => void;
  /** Save is off for a reason other than a save under way (nothing loaded yet). */
  disabled?: boolean | undefined;
  note?: ReactNode;
  label?: string | undefined;
}) {
  return (
    <SaveBar>
      <div className="min-w-0 flex-1 text-sm text-muted-foreground" data-save-note>
        {props.note}
      </div>
      <div className={SAVE_BAR_ACTIONS}>
        <Button
          type="button"
          className="h-10 min-w-24"
          data-save
          disabled={props.saving || !!props.disabled}
          onClick={props.onSave}
        >
          {props.saving ? <Loader2 className="animate-spin" /> : <Save />}
          {props.saving ? "Saving…" : (props.label ?? "Save changes")}
        </Button>
      </div>
    </SaveBar>
  );
}

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

export function SaveBar(props: { children: ReactNode; className?: string | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const page = document.documentElement;
    const keep = () =>
      page.style.setProperty(SAVE_BAR_VAR, `${Math.ceil(el.getBoundingClientRect().height)}px`);
    keep();
    // The bar grows when its words wrap (a phone, a long "Before you can save" line).
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(keep);
    watch?.observe(el);
    return () => {
      watch?.disconnect();
      page.style.removeProperty(SAVE_BAR_VAR);
    };
  }, []);
  return (
    <div ref={ref} className={cn(SAVE_BAR_CLASS, props.className)} data-save-bar>
      {props.children}
    </div>
  );
}

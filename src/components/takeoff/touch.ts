/**
 * The takeoff on a touch screen (owner, Nov 3: "ensure everything is as easy to use as possible
 * on an ipad"). Pure, no React; the hooks that read the screen are in ./use-screen.ts.
 *
 *  - A NARROW screen (under NARROW_PX) or any TOUCH screen (`panelsSlide`; Nov 10: the bigger
 *    iPads held sideways are wider than NARROW_PX) opens the editor in Focus: the pages list
 *    and the side panel slide OVER the drawing when asked for, instead of squeezing it
 *    (upright, the drawing was 44 px wide).
 *  - On a coarse pointer (a finger) the toolbar's and header's buttons grow to TOUCH_TARGET_PX
 *    and the corner handles and pins get a wider hit area.
 *  - While drawing, a bar of buttons stands in for the keys an iPad has not got: Finish / Close
 *    / Done for Enter, Undo point for Backspace, Cancel for Esc, and a length box that brings up
 *    the keyboard for "24'6" or "40 x 120" (`touchDrawBar` says which to show).
 *  - "Pencil draws" (remembered under PENCIL_PREF_KEY): an Apple Pencil places points, a finger
 *    only pans and pinches, since a pencil tap is precise and a finger is not.
 */
import type { Tool } from "./shapes";

/** Narrower than this, the editor opens in Focus and the panels slide over the drawing. */
export const NARROW_PX = 1100;
/** Apple's guide for a finger target. */
export const TOUCH_TARGET_PX = 44;
/** A finger that moves less than this between touch and lift is a tap. */
export const TAP_PX = 10;
/** The hit radius (screen px) round a corner handle or pin on a touch screen. */
export const TOUCH_HIT_PX = 22;

export const isNarrow = (width: number): boolean => width < NARROW_PX;

/**
 * The editor opens in Focus, and its pages list and side panel slide OVER the drawing: on a
 * narrow window, and (owner, Nov 10) on ANY touch screen. An iPad Air (1,180), an iPad Pro 11
 * (1,194) and an iPad Pro 12.9 (1,366) held sideways are wider than NARROW_PX, so with the
 * width alone the menu, the pages and the panel all stayed open and the drawing got 396 x 264 px
 * of a 1,194 x 834 screen. A desktop with a mouse keeps the width rule.
 */
export const panelsSlide = (s: { width: number; coarse: boolean }): boolean =>
  s.coarse || isNarrow(s.width);

/**
 * Tailwind for a container whose buttons grow to TOUCH_TARGET_PX on a touch screen. In pixels,
 * not rem (the app's root font is 13 px, so min-h-11 would be 36 px); switches and checkboxes
 * keep their shape.
 */
export const TOUCH_BUTTON_CLASS =
  "[&_button:not([role=switch]):not([role=checkbox])]:min-h-[44px] [&_button:not([role=switch]):not([role=checkbox])]:min-w-[44px]";

export const PENCIL_PREF_KEY = "takeoff:pencil";
/** The saved "Pencil draws" toggle; anything but the string "true" is off. */
export const parsePencilPref = (raw: string | null | undefined): boolean => raw === "true";

export interface DrawBarContext {
  /** The viewer is on a coarse pointer. */
  touch: boolean;
  tool: Tool;
  draftPoints: number;
  countSession: boolean;
  /** "Edge from this area" or stamping is on: those have their own buttons. */
  busy: boolean;
  /** The page has a scale (typed lengths need one). */
  scaled: boolean;
}

export interface DrawBar {
  /** The Enter button's label, or null when nothing can be finished yet. */
  finish: "Close" | "Finish" | "Done" | null;
  /** Backspace: take the last point back. */
  undo: boolean;
  /** Esc: drop what is being drawn. */
  cancel: boolean;
  /** The length / size box (a typed length or "40 x 120"). */
  length: boolean;
}

/** The buttons the touch bar shows, or null when there is nothing in progress to act on. */
export function touchDrawBar(c: DrawBarContext): DrawBar | null {
  if (!c.touch || c.busy) return null;
  const outline = c.tool === "area" || c.tool === "linear" || c.tool === "cutout";
  const inProgress = c.draftPoints > 0 || c.countSession;
  if (!inProgress) return null;
  let finish: DrawBar["finish"] = null;
  if (c.countSession && c.tool === "count") finish = "Done";
  else if (c.tool === "linear" && c.draftPoints >= 2) finish = "Finish";
  else if ((c.tool === "area" || c.tool === "cutout") && c.draftPoints >= 3) finish = "Close";
  return {
    finish,
    undo: c.draftPoints > 0,
    cancel: true,
    length: outline && c.draftPoints > 0 && c.scaled,
  };
}

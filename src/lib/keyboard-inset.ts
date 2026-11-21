/**
 * A box pinned to the bottom of a phone's screen, kept clear of the on-screen keyboard and of
 * the spot it is about (owner, Nov 20: "if youre marking it up, the tags pop up box is half off
 * screen"). Pure rules; the hook is hooks/use-keyboard-inset.ts and the sheets are the label
 * sheets of the two markup tools (components/service/photo-markup.tsx, aerial-markup.tsx).
 *
 * On an iPhone the keyboard covers the bottom of the page without the page getting shorter, so
 * a box pinned to the bottom sits behind the keys. The browser says how much of the page is
 * really showing (its "visual viewport"); the box is lifted by the difference. Where the page
 * itself gets shorter with the keyboard (Android, by the viewport setting in routes/__root.tsx)
 * the difference is nothing and the box stays where it is.
 */

/** What the browser reports: the page's height, and the part of it showing above the keyboard. */
export interface ScreenNow {
  innerHeight: number;
  visual?: { height: number; offsetTop: number; scale?: number | undefined } | null | undefined;
}

/** Room left above and below a lifted box, so it never touches the very edge. */
export const KEYBOARD_GAP_PX = 8;

/**
 * `bottom`: how far a bottom-pinned box rises to sit on top of the keyboard (0 with no keyboard,
 * or when the browser cannot say). `visible`: the height of the page that is showing.
 * A pinched-in page reports a small visual viewport too; that is not a keyboard, so it is left.
 */
export function keyboardInset(s: ScreenNow): { bottom: number; visible: number } {
  const v = s.visual;
  if (!v || !(v.height > 0) || !(s.innerHeight > 0)) return { bottom: 0, visible: s.innerHeight };
  if (v.scale != null && Math.abs(v.scale - 1) > 0.01) return { bottom: 0, visible: s.innerHeight };
  const hidden = Math.round(s.innerHeight - (v.height + v.offsetTop));
  // A pixel or two is rounding, not a keyboard.
  const bottom = hidden > 2 ? hidden : 0;
  return { bottom, visible: Math.round(bottom ? v.height : s.innerHeight) };
}

/**
 * The inline style of a bottom sheet for that keyboard: lifted onto the keys and no taller than
 * what shows above them. Nothing at all when no keyboard is up, so the sheet's own classes rule.
 */
export function sheetStyleFor(inset: {
  bottom: number;
  visible: number;
}): { bottom: string; maxHeight: string } | undefined {
  if (!(inset.bottom > 0)) return undefined;
  return {
    bottom: `${inset.bottom}px`,
    maxHeight: `${Math.max(120, inset.visible - KEYBOARD_GAP_PX)}px`,
  };
}

/** How much clear picture is kept above a sheet, around the spot being tagged. */
export const SPOT_CLEAR_PX = 36;

/**
 * How far the page scrolls up so the spot being tagged is not under the sheet: the spot ends
 * `SPOT_CLEAR_PX` above the sheet's top. 0 when it is already clear, and never so far that the
 * spot would leave the top of the screen (`topLimit`: under the page's own header).
 */
export function scrollToClearSpot(a: {
  /** The spot's distance from the top of the screen. */
  spotY: number;
  /** The sheet's top edge, from the top of the screen. */
  sheetTop: number;
  /** The lowest the spot may be pushed up to (the header's height). */
  topLimit?: number | undefined;
}): number {
  const want = a.spotY - (a.sheetTop - SPOT_CLEAR_PX);
  if (!(want > 0)) return 0;
  const room = a.spotY - ((a.topLimit ?? 0) + SPOT_CLEAR_PX);
  return Math.max(0, Math.round(Math.min(want, room)));
}

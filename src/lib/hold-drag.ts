/**
 * Hold, then drag: moving a ticket with a finger (owner, Nov 17: "it needs to be easy to drag and
 * move tickets onto the tech board"). The desk board's drag and drop is the browser's own, which
 * a touch screen does not give: a finger that moves scrolls the page.
 *
 * So a finger says which it means by waiting. Press and hold still for a moment and the ticket
 * lifts (the page stops scrolling and the ticket follows the finger); move first and it is a
 * scroll, as everywhere else; lift without holding and it is a tap. Near the top or the bottom of
 * the list the page scrolls on its own, so a technician further down can be reached mid-drag.
 *
 * The rules only, as plain functions the tests can run: the page wiring is hooks/use-hold-drag.ts.
 */

/** How long a finger holds still before the ticket lifts. */
export const HOLD_MS = 320;
/** How far a finger may wander while holding. Further, and it was a scroll. */
export const SLOP_PX = 10;
/** How long a lifted ticket rests on a day button before the board switches to that day. */
export const DWELL_MS = 600;
/** The band at the top and bottom of the list where the page scrolls during a drag. */
export const EDGE_PX = 72;
/**
 * How long the finger rests in a band before the page starts to scroll. A ticket carried from the
 * day buttons down to a technician crosses the top band on its way, and must not drag the list
 * along with it.
 */
export const EDGE_WAIT_MS = 220;
/** The fastest the page scrolls during a drag, per frame. */
export const SCROLL_MAX = 16;

export type HoldPhase = "idle" | "pressing" | "dragging";
export interface HoldState {
  phase: HoldPhase;
  startX: number;
  startY: number;
  x: number;
  y: number;
}

export const IDLE: HoldState = { phase: "idle", startX: 0, startY: 0, x: 0, y: 0 };

/** A finger went down on a ticket. */
export const press = (x: number, y: number): HoldState => ({
  phase: "pressing",
  startX: x,
  startY: y,
  x,
  y,
});

/** The hold time passed with the finger still down and still: the ticket lifts. */
export const lift = (s: HoldState): HoldState =>
  s.phase === "pressing" ? { ...s, phase: "dragging" } : s;

/**
 * The finger moved. While pressing, a move past the slop is a scroll: the press is over (`cancel`)
 * and the page is left to scroll. While dragging, the page must not scroll (`prevent`).
 */
export function move(
  s: HoldState,
  x: number,
  y: number,
): { state: HoldState; cancel: boolean; prevent: boolean } {
  if (s.phase === "pressing") {
    const far = Math.hypot(x - s.startX, y - s.startY) > SLOP_PX;
    return far
      ? { state: IDLE, cancel: true, prevent: false }
      : { state: { ...s, x, y }, cancel: false, prevent: false };
  }
  if (s.phase === "dragging") return { state: { ...s, x, y }, cancel: false, prevent: true };
  return { state: s, cancel: false, prevent: false };
}

/** The finger lifted: a drop when the ticket was lifted, a plain tap otherwise. */
export const release = (s: HoldState): { drop: boolean; tap: boolean } => ({
  drop: s.phase === "dragging",
  tap: s.phase === "pressing",
});

/**
 * Was the lifted ticket carried anywhere? A ticket that lifts and is let go where it lifted (the
 * finger never left the slop) is put back: it drops on nothing. The page can change under a
 * still finger at the lift (the open tray folds away, the technician dock opens), so what is
 * under it then is not something the finger chose (Nov 19).
 */
export const carried = (liftX: number, liftY: number, x: number, y: number): boolean =>
  Math.hypot(x - liftX, y - liftY) > SLOP_PX;

/**
 * How far the page scrolls this frame with the finger at `y`, between the list's `top` and
 * `bottom` edges on the screen: up (negative) in the top band, down in the bottom band, faster
 * the deeper in, nothing in between or outside the list (over the day buttons or the tray, which
 * are targets themselves).
 */
export function edgeScroll(y: number, top: number, bottom: number): number {
  if (bottom - top < EDGE_PX * 2) return 0;
  if (y < top || y > bottom) return 0;
  if (y < top + EDGE_PX) return -Math.ceil(((top + EDGE_PX - y) / EDGE_PX) * SCROLL_MAX);
  if (y > bottom - EDGE_PX) return Math.ceil(((y - (bottom - EDGE_PX)) / EDGE_PX) * SCROLL_MAX);
  return 0;
}

/**
 * The same, with the wait: `since` is when the finger entered the band it is in (null: it is in
 * none). Gives this frame's scroll and the `since` to carry to the next frame.
 */
export function edgeScrollAfterWait(
  y: number,
  top: number,
  bottom: number,
  since: number | null,
  now: number,
): { by: number; since: number | null } {
  const by = edgeScroll(y, top, bottom);
  if (!by) return { by: 0, since: null };
  const started = since ?? now;
  return { by: now - started >= EDGE_WAIT_MS ? by : 0, since: started };
}

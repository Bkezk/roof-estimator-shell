/**
 * When the estimator may apply a takeoff (`/estimate?takeoff=<id>`, with `?bid=<id>` to UPDATE
 * that saved bid) — pure.
 *
 * Audit, Nov 10 (docs/qa/takeoff-audit-2026-11-10.md, finding 1): the update used to run as soon
 * as a REF said the bid had been read. That ref is set in the same pass that queues the bid's
 * sections, walls and lines into the page, so when the takeoff had already arrived the update
 * ran on the page as it was BEFORE the bid loaded (empty) and its result replaced the bid: every
 * section and wall made new, hand-added ones gone, the estimator's edits lost (5 of 8 tries).
 * The rule now reads the bid id that the page's own state holds — a value that only shows the
 * bid once the same render carries the bid's sections.
 */

export interface TakeoffApplyState {
  /** `?bid=` — the saved bid to update; absent for a NEW bid from the takeoff. */
  bidParam: string | null | undefined;
  /** The bid whose saved content THIS render's state holds (state, never a ref); null = none. */
  renderedBidId: string | null;
}

/** A new bid is seeded at once; an update waits until the page holds that bid. */
export function takeoffApplyReady(s: TakeoffApplyState): boolean {
  if (!s.bidParam) return true;
  return s.renderedBidId === s.bidParam;
}

/** How many times linking a takeoff to the bid it built is tried before the user is told. */
export const LINK_ATTEMPTS = 3;
/** The wait before try `attempt + 1` (2 s, then 4 s). */
export const linkRetryDelayMs = (attempt: number): number => 2000 * Math.max(1, attempt);

/**
 * Said when the takeoff could not be linked to the bid it built (finding 6: the failure used to
 * be swallowed, so the takeoff stayed "No bid yet", unlocked, offering Create bid again).
 */
export function linkFailedToast(bidName: string | null, reason: string): string {
  const why = reason.trim().replace(/\.+$/, "");
  return `${bidName ? `“${bidName}”` : "This bid"} is saved, but its takeoff could not be linked to it${why ? ` (${why})` : ""}, so the takeoff is not locked and still says it has no bid. It is tried again each time you save this bid.`;
}

/**
 * The stale-tab rule for a bid save (owner, Oct 6, Towneplace: an older tab wrote over a newer
 * save; owner, Oct 26: Brian "tries to save it but a toast pops up … Brian saved this at 2 pm",
 * another "at 7 pm", on Somerset Career Center). Proof from audit_log: both times Brian himself
 * had changed the bid from a list page while his estimator tab had it open — filed it under a
 * folder at 10:19 am Eastern, and on Oct 22 linked it to its customer at 3:07 pm Eastern. The
 * update_bids_updated_at trigger stamps updated_at on EVERY row update, so those filing changes
 * made the tab's copy "stale" though nobody had saved the bid's contents; the message named the
 * last contents saver (Brian) and printed the time in UTC (the server's clock), hence "7 pm".
 *
 * Now the rule reads bids.content_saved_at, which only a save of the bid's contents stamps
 * (saveBid; inserts default to now()), the time is the office's (Eastern), and a save that
 * trips over your own other tab says so. Pure, so it is tested.
 */

/** The office's clock for the message (every user is in the Eastern zone). */
export const BID_OFFICE_TZ = "America/New_York";

/** The two stamps a bids row carries: updated_at moves on any update, content_saved_at on a contents save. */
export interface BidSaveStamps {
  updated_at: string | null;
  content_saved_at?: string | null;
}

/**
 * Is the saving tab's copy older than the last save of the bid's contents? A row from before
 * the column existed (no content_saved_at) falls back to updated_at, as before.
 */
export function bidSaveIsStale(
  expectUpdatedAt: string | undefined,
  row: BidSaveStamps | null | undefined,
): boolean {
  if (!expectUpdatedAt || !row) return false;
  const stamp = row.content_saved_at ?? row.updated_at;
  if (!stamp) return false;
  return new Date(stamp).getTime() > new Date(expectUpdatedAt).getTime() + 1000;
}

/** "3:07 PM" on the same office day, else "Oct 22 at 3:07 PM" — in the office's zone, never UTC. */
export function staleSavedAtText(at: string, now: Date = new Date(), tz: string = BID_OFFICE_TZ) {
  const d = new Date(at);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
  if (day(d) === day(now)) return time;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })} at ${time}`;
}

/**
 * The message a stale save gets. `me` is the saver's own display name: when the newer save was
 * theirs it was another tab of theirs, and the message says so instead of "Brian saved this".
 */
export function bidStaleMessage(
  who: string | null | undefined,
  at: string,
  me?: string | null,
  now?: Date,
): string {
  const w = who?.trim() || "";
  const mine = !!w && !!me && w === me.trim();
  const saver = mine ? "you saved this bid from another tab" : `${w || "someone"} saved this bid`;
  return `Not saved: ${saver} at ${staleSavedAtText(at, now)}, after this tab opened it. Reload the bid to see that save, then make your changes again.`;
}

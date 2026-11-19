/**
 * The estimator's yellow notices, dismissed one at a time (owner, Nov 19: "the yellow bullet
 * point notifications should be able to be dismissed individually"). Pure, no I/O.
 *
 * A dismissal is kept ON THE BID (SavedBidState.dismissedNotices), like the PlanSwift notice's
 * own "Dismiss": it is saved with the bid's next Save and reads the same for everyone who opens
 * the bid. A notice is remembered by its own words, so a notice whose numbers change is a new
 * notice and shows again.
 */

/** How many dismissed notices a bid remembers: the newest are kept. */
export const MAX_DISMISSED_NOTICES = 200;

/** What a notice is remembered by: its words, spacing aside. */
export const noticeKey = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The list as stored on a bid, read safely (an older bid has none; a bad value is none). */
export function readDismissedNotices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

/** The notices still showing, and the ones on this list that were dismissed. Order is kept. */
export function splitNotices(
  notices: readonly string[],
  dismissed: readonly string[] | undefined,
): { open: string[]; hidden: string[] } {
  const gone = new Set((dismissed ?? []).map(noticeKey));
  const open: string[] = [];
  const hidden: string[] = [];
  for (const n of notices) (gone.has(noticeKey(n)) ? hidden : open).push(n);
  return { open, hidden };
}

/** The list after one notice is dismissed. Already there: the same list. */
export function dismissNotice(dismissed: readonly string[] | undefined, text: string): string[] {
  const key = noticeKey(text);
  const have = dismissed ?? [];
  if (!key || have.some((d) => noticeKey(d) === key)) return [...have];
  return [...have, key].slice(-MAX_DISMISSED_NOTICES);
}

/** The list after these notices are brought back ("Show 2 dismissed"). */
export function restoreNotices(
  dismissed: readonly string[] | undefined,
  texts: readonly string[],
): string[] {
  const back = new Set(texts.map(noticeKey));
  return (dismissed ?? []).filter((d) => !back.has(noticeKey(d)));
}

/** The button that brings them back. */
export const showDismissedLabel = (n: number): string => `Show ${n} dismissed`;

/** Small formatting helpers for the Leads page (kept apart so the card file only exports components). */
import type { LeadRow, LeadSettingsRow } from "@/lib/leads.functions";

/** "$2.9M" from a million up, "$100,000" below. */
export function formatCost(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * A lead whose bid date has passed, whatever the source (owner, Sep 29: closed campus and
 * SAM.gov bids were showing with "Show closed bids" off). Permits have no bid date.
 */
export const isClosedBid = (l: LeadRow, now = Date.now()) =>
  !!l.bid_at && Date.parse(l.bid_at) < now;

const DAY = 24 * 60 * 60 * 1000;

/**
 * "New" is a recent arrival nobody has acted on: first seen in the last three days, status
 * new, and no one's stamp on it. Unwatch and Restore set the status back to new but stamp who
 * did it, so the badge does not come back (Sep 30).
 */
export const isNewLead = (
  l: Pick<LeadRow, "status" | "status_at" | "first_seen_at">,
  now = Date.now(),
) => l.status === "new" && !l.status_at && now - Date.parse(l.first_seen_at) < 3 * DAY;

/**
 * The source failures an older refresh appended to its note (before they were stored as a
 * list, lead_settings.last_fetch_problems): everything after the summary, which ends with
 * "N job pages read" (and ", N buildings marked re-roofed"). A note that says a run failed
 * outright is shown whole.
 */
export function fetchProblem(note: string | null | undefined): string | null {
  if (!note) return null;
  const m = / job pages read(?:, \d+ buildings? marked re-roofed)?; (.+)$/s.exec(note);
  if (m) return m[1]!;
  return /failed/i.test(note) ? note : null;
}

/** Two problem lines as one ("a; b"), each part once. */
export function joinProblems(a: string | null, b: string | null): string | null {
  const parts = [...new Set([a, b].flatMap((x) => (x ? x.split("; ") : [])).filter(Boolean))];
  return parts.length ? parts.join("; ") : null;
}

/**
 * The red line: the refresh this visit ran (its own error) or else the last run's stored
 * problems (the note, for a run stamped before the list existed), plus what the job-page reads
 * after it reported. Null when all is well.
 */
export function lastCheckProblem(
  settings: Pick<LeadSettingsRow, "last_fetch_note" | "last_fetch_problems"> | null | undefined,
  refreshError: string | null,
  pagesError: string | null = null,
): string | null {
  const stored = Array.isArray(settings?.last_fetch_problems)
    ? settings.last_fetch_problems.filter(Boolean).join("; ") || null
    : fetchProblem(settings?.last_fetch_note);
  return joinProblems(refreshError ?? stored, pagesError);
}

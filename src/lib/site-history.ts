/**
 * "Earlier at this site" on a ticket (service study M4, owner Oct 5): CenterPoint's File Library
 * on a ticket lists every earlier ticket at the property — what the office checks on a callback
 * ("Still leaking"). The portal shows the last tickets at the same site, newest first, each a
 * link, with the first line of what the technician wrote. Pure, so it is tested without a server.
 */

/** How many earlier tickets the section lists. */
export const SITE_HISTORY_LIMIT = 10;

export interface SiteHistoryRow {
  id: string;
  number: number;
  stage: string;
  service_type: string;
  scheduled_date: string | null;
  completed_at: string | null;
  created_at: string;
  closing_notes: string | null;
  description: string | null;
  technician_name: string | null;
}

/** The longest snippet shown on a row; longer text ends in "…". */
export const SNIPPET_MAX = 90;

/** The first non-blank line of the closing notes, else the description, cut to SNIPPET_MAX. */
export function historySnippet(r: Pick<SiteHistoryRow, "closing_notes" | "description">): string {
  const first = (s: string | null) =>
    (s ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l !== "") ?? "";
  const text = first(r.closing_notes) || first(r.description);
  return text.length > SNIPPET_MAX ? `${text.slice(0, SNIPPET_MAX - 1).trimEnd()}…` : text;
}

/** The day a row is filed under: when it was done, else its scheduled day, else opened (YYYY-MM-DD). */
export function historyDay(
  r: Pick<SiteHistoryRow, "completed_at" | "scheduled_date" | "created_at">,
): string {
  return (r.completed_at ?? r.scheduled_date ?? r.created_at).slice(0, 10);
}

/** A row's day as "Sep 22, 2026" (the year matters: callbacks reach back years). */
export function historyDayText(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

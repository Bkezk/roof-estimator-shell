/**
 * Roof warranties on a site (service study M5, owner Oct 5). CenterPoint shows the warranty on
 * the property card of every ticket ("DURO-LAST 15 NDL" with a WARRANTY watermark). The portal
 * keeps them per site (site_warranties, migration 20261005160000) and shows a badge on the ticket
 * and the Today card while one is in force: "Duro-Last 15 NDL · to Mar 2031". Pure, so the badge
 * rules are tested without a server.
 */

export interface Warranty {
  id: string;
  site_id: string;
  manufacturer: string;
  kind: string | null;
  number: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
}

export const WARRANTY_MAX = { manufacturer: 80, kind: 120, number: 80, notes: 1000 } as const;

/** In force on `today` (YYYY-MM-DD): started (or no start) and not ended (or no end). */
export function inForce(w: Pick<Warranty, "start_date" | "end_date">, today: string): boolean {
  return (!w.start_date || w.start_date <= today) && (!w.end_date || w.end_date >= today);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mar 2031" from YYYY-MM-DD. */
export function monthYear(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return y && m && m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : ymd;
}

/** "Duro-Last 15 NDL · to Mar 2031" (no end: no "to …"). */
export function warrantyLabel(w: Pick<Warranty, "manufacturer" | "kind" | "end_date">): string {
  const name = [w.manufacturer.trim(), (w.kind ?? "").trim()].filter(Boolean).join(" ");
  return w.end_date ? `${name} · to ${monthYear(w.end_date)}` : name;
}

/** The badges for a site's warranties in force today, the one ending last first. */
export function warrantyBadges(list: Warranty[], today: string): string[] {
  return list
    .filter((w) => inForce(w, today))
    .sort((a, b) => (b.end_date ?? "9999").localeCompare(a.end_date ?? "9999"))
    .map(warrantyLabel);
}

/** Why a warranty cannot be saved (null = it can). */
export function warrantyProblem(w: {
  manufacturer: string;
  start_date: string | null;
  end_date: string | null;
}): string | null {
  if (!w.manufacturer.trim()) return "Enter the manufacturer";
  if (w.start_date && w.end_date && w.end_date < w.start_date)
    return "The end date is before the start date";
  return null;
}

/**
 * PostgREST's "Could not find the table … in the schema cache" (PGRST205): the table's migration
 * (20261005160000_site_warranties.sql) is not applied yet. Owner, Oct 5: that error blanked the
 * page; until the table exists a site has no warranties to show.
 */
export const isMissingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "PGRST205" || /Could not find the table/i.test(e.message ?? ""));

export const WARRANTIES_NOT_SET_UP =
  "Warranties are not set up in the database yet (apply 20261005160000_site_warranties.sql)";

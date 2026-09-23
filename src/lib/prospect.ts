/**
 * Prospecting — pure helpers (no I/O). Docs: docs/roofing-ops-portal-brief.md.
 *
 * - `equivalentRectangle`: the estimator prices a section as a rectangle (legacy Bid-Advantage
 *   geometry). A building footprint gives area and perimeter, so a building becomes the
 *   rectangle with the SAME area and perimeter (W + L = P/2, W × L = A). When no rectangle has
 *   that pair (P² < 16A — a rounder shape than a square), or no perimeter is known, it falls back
 *   to the square of the same area. The engine is untouched: it still sees width × length.
 * - `warrantyLeadFrom`: an accepted bid read on demand becomes a lead — the roof we installed,
 *   with its warranty clock — without copying anything out of the estimator.
 */
export interface Rect {
  width: number;
  length: number;
}

/** Rectangle with the given area and (optionally) perimeter; square fallback. */
export function equivalentRectangle(areaSqFt: number, perimeterFt?: number | null): Rect {
  const a = Math.max(0, areaSqFt);
  if (a === 0) return { width: 0, length: 0 };
  const square = Math.round(Math.sqrt(a) * 10) / 10;
  if (perimeterFt === undefined || perimeterFt === null || perimeterFt <= 0) {
    return { width: square, length: square };
  }
  const half = perimeterFt / 2; // W + L
  const disc = half * half - 4 * a; // (W − L)²
  if (disc < 0) return { width: square, length: square };
  const root = Math.sqrt(disc);
  const length = Math.round(((half + root) / 2) * 10) / 10;
  const width = Math.round(((half - root) / 2) * 10) / 10;
  if (width <= 0) return { width: square, length: square };
  return { width, length };
}

/** "15 Year NDL" → 15; "20-yr" → 20; anything else → undefined. */
export function warrantyYears(name: string | null | undefined): number | undefined {
  if (!name) return undefined;
  const m = /(\d{1,2})\s*-?\s*(?:year|yr)/i.exec(name);
  return m ? Number(m[1]) : undefined;
}

/** ISO date `years` after `from` (YYYY-MM-DD in, YYYY-MM-DD out). */
export function addYears(fromIso: string, years: number): string {
  const d = new Date(fromIso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return fromIso;
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** What `warranty_leads()` returns per accepted bid (read-only view of estimator data). */
export interface WarrantyLeadRow {
  bid_id: string;
  bid_name: string;
  customer_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  start_date: string | null;
  warranty_name: string | null;
  updated_at: string;
  building_id: string | null;
}

export interface WarrantyLead {
  bidId: string;
  bidName: string;
  customerName: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** The bid's start date (Setup) when set, else the day it was last saved. */
  installDate: string;
  warrantyName: string | null;
  /** Install + the years in the warranty name; null when the name carries none. */
  expires: string | null;
  /** Years from `today` to expiry, one decimal; negative = expired; null = unknown. */
  yearsLeft: number | null;
  buildingId: string | null;
}

/** An accepted bid → a warranty lead (the roof we installed and when its warranty runs out). */
export function warrantyLeadFrom(r: WarrantyLeadRow, today: string): WarrantyLead {
  const installDate = (r.start_date && r.start_date.slice(0, 10)) || r.updated_at.slice(0, 10);
  const years = warrantyYears(r.warranty_name);
  const expires = years !== undefined ? addYears(installDate, years) : null;
  let yearsLeft: number | null = null;
  if (expires) {
    const ms = Date.parse(expires + "T00:00:00Z") - Date.parse(today + "T00:00:00Z");
    yearsLeft = Math.round((ms / (365.25 * 86_400_000)) * 10) / 10;
  }
  return {
    bidId: r.bid_id,
    bidName: r.bid_name,
    customerName: (r.customer_name ?? "").trim() || r.bid_name,
    address: (r.address ?? "").trim(),
    city: r.city?.trim() || null,
    state: r.state?.trim() || null,
    zip: r.zip?.trim() || null,
    installDate,
    warrantyName: r.warranty_name?.trim() || null,
    expires,
    yearsLeft,
    buildingId: r.building_id,
  };
}

/** Soonest expiry first; unknown expiries last. */
export function sortWarrantyLeads(leads: WarrantyLead[]): WarrantyLead[] {
  return [...leads].sort((a, b) => {
    if (a.expires && b.expires) return a.expires.localeCompare(b.expires);
    if (a.expires) return -1;
    if (b.expires) return 1;
    return a.customerName.localeCompare(b.customerName);
  });
}

/** One line for a building in lists: "Name — 123 Main St, City" (whatever is known). */
export function buildingLine(b: { name: string; address1: string; city?: string | null }): string {
  const addr = [b.address1, b.city].filter((x) => x && x.trim()).join(", ");
  return b.name && addr ? `${b.name} — ${addr}` : b.name || addr || "(unnamed building)";
}

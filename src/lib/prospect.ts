/**
 * Prospecting — pure helpers (no I/O). Docs: docs/roofing-ops-portal-brief.md.
 *
 * - `equivalentRectangle`: the estimator prices a section as a rectangle (legacy Bid-Advantage
 *   geometry). A building footprint gives area and perimeter, so a building becomes the
 *   rectangle with the SAME area and perimeter (W + L = P/2, W × L = A). When no rectangle has
 *   that pair (P² < 16A — a rounder shape than a square), or no perimeter is known, it falls back
 *   to the square of the same area. The engine is untouched: it still sees width × length.
 * - `ownBookFromBid`: an accepted bid becomes a building plus one roof per section ("own book"),
 *   so installed roofs re-enter prospecting with their warranty clock.
 */
import type { SavedBidState } from "@/lib/proposal-bid";

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

export interface BuildingSeed {
  name: string;
  address1: string;
  address2: string | null;
  city: string | null;
  state: string;
  zip: string | null;
  owner_name: string | null;
  roof_sqft: number | null;
  own_book: boolean;
  source: "won_bid";
  notes: string | null;
}

export interface RoofSeed {
  section_name: string;
  roof_system: string | null;
  area_sqft: number | null;
  install_date: string | null;
  installer: string | null;
  warranty_type: string | null;
  warranty_expires: string | null;
}

export interface OwnBookSeed {
  building: BuildingSeed;
  roofs: RoofSeed[];
}

/**
 * Map an accepted bid to its own-book building and roofs. Install date = the bid's start date
 * (Setup) when set, else the day it was last saved; warranty expiry = install + the years in
 * the warranty name when it carries one.
 */
export function ownBookFromBid(
  saved: Pick<SavedBidState, "customer" | "sections" | "roofSystem" | "startDate" | "warrantyName">,
  meta: { name: string; updatedAt: string; installer?: string | undefined },
): OwnBookSeed {
  const c = saved.customer;
  const sections = Array.isArray(saved.sections) ? saved.sections : [];
  const install = (saved.startDate && saved.startDate.slice(0, 10)) || meta.updatedAt.slice(0, 10);
  const years = warrantyYears(saved.warrantyName);
  const expires = years !== undefined ? addYears(install, years) : null;
  const total = sections.reduce((n, s) => n + (s.length || 0) * (s.width || 0), 0);
  const city = c.jobCity?.trim() || null;
  const state = c.jobState?.trim() || "KY";
  const zip = c.jobZip?.trim() || null;
  return {
    building: {
      name: (c.name || meta.name).trim() || meta.name,
      address1: (c.projectAddress || "").trim(),
      address2: c.projectAddress2?.trim() || null,
      city,
      state,
      zip,
      owner_name: c.name?.trim() || null,
      roof_sqft: total > 0 ? total : null,
      own_book: true,
      source: "won_bid",
      notes: c.jobCityStZip && !city ? c.jobCityStZip : null,
    },
    roofs:
      sections.length > 0
        ? sections.map((s) => ({
            section_name: s.name || "Roof",
            roof_system: s.roofSystem ?? saved.roofSystem ?? null,
            area_sqft: s.length && s.width ? s.length * s.width : null,
            install_date: install,
            installer: meta.installer ?? null,
            warranty_type: saved.warrantyName || null,
            warranty_expires: expires,
          }))
        : [
            {
              section_name: "Roof",
              roof_system: saved.roofSystem ?? null,
              area_sqft: null,
              install_date: install,
              installer: meta.installer ?? null,
              warranty_type: saved.warrantyName || null,
              warranty_expires: expires,
            },
          ],
  };
}

/** One line for a building in lists: "Name — 123 Main St, City" (whatever is known). */
export function buildingLine(b: { name: string; address1: string; city?: string | null }): string {
  const addr = [b.address1, b.city].filter((x) => x && x.trim()).join(", ");
  return b.name && addr ? `${b.name} — ${addr}` : b.name || addr || "(unnamed building)";
}

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
import { KY_COUNTIES } from "@/lib/gis/ky-layers";
import { TN_COUNTIES, inTennesseeBox } from "@/lib/gis/tn-layers";

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

const MONTH_SHORT = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** "Mar 2026" from "2026-03-14" (null when it is not a date). */
export function monthYear(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  const month = m ? MONTH_SHORT[Number(m[2]) - 1] : undefined;
  return m && month ? `${month} ${m[1]}` : null;
}

/**
 * "re-roofed Mar 2026 by Pinaire Roofing" from a building's re-roof permit stamp (without "by"
 * when the permit named nobody; an all-lower-case name is capitalised), or null when there is
 * no stamp — or when someone has since typed a later "Roof installed (year)", which then wins.
 */
export function reroofLine(b: {
  last_reroof_on?: string | null;
  last_reroof_by?: string | null;
  roof_year?: number | null;
}): string | null {
  const when = monthYear(b.last_reroof_on);
  if (!when) return null;
  if (b.roof_year && b.roof_year > Number(String(b.last_reroof_on).slice(0, 4))) return null;
  let by = (b.last_reroof_by ?? "").replace(/\s+/g, " ").trim();
  if (by && by === by.toLowerCase()) by = by.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return `re-roofed ${when}${by ? ` by ${by}` : ""}`;
}

// ── Kentucky + Tennessee (owner, Sep 29: "we actually cover TN as well … whole state") ──────

/** The two states the Buildings page covers. */
export type CoveredState = "KY" | "TN";

/**
 * The Kentucky / Tennessee line west → east as [lng, lat] (Census TIGER state outline, thinned
 * to ~400 m; east of Cumberland Gap it is the Virginia line). The two states' bounding boxes
 * overlap along 36.5–36.68°N (Murray, Middlesboro and Fulton, Kentucky sit inside Tennessee's
 * box), so a default state needs the line; the server asks the Tennessee imagery index instead.
 */
const KY_TN_LINE: readonly [number, number][] = [
  [-89.6, 36.5],
  [-88.06, 36.5],
  // The Tennessee River: the line runs north up the river to the Walker line.
  [-88.05, 36.678],
  [-87.85, 36.664],
  [-87.84, 36.633],
  [-86.59, 36.652],
  [-86.493, 36.652],
  [-85.832, 36.622],
  [-85.502, 36.615],
  [-85.277, 36.627],
  [-85.027, 36.619],
  [-84.83, 36.605],
  [-83.988, 36.589],
  [-83.691, 36.583],
  [-83.675, 36.601],
  [-83.249, 36.594],
  [-81.934, 36.594],
  [-81.923, 36.616],
  [-81.647, 36.612],
];

/** The latitude of the Kentucky / Tennessee line at a longitude (flat beyond either end). */
export function kyTnLineLat(lng: number): number {
  const line = KY_TN_LINE;
  if (lng <= line[0]![0]) return line[0]![1];
  for (let i = 1; i < line.length; i++) {
    const [x1, y1] = line[i]!;
    if (lng <= x1) {
      const [x0, y0] = line[i - 1]!;
      return y0 + ((y1 - y0) * (lng - x0)) / (x1 - x0);
    }
  }
  return line[line.length - 1]![1];
}

/**
 * The state a point is in, as a default the salesperson can edit: Tennessee inside its box and
 * south of the line, else Kentucky (the page's home state).
 */
export function stateForPoint(lat: number, lng: number): CoveredState {
  return inTennesseeBox(lat, lng) && lat < kyTnLineLat(lng) ? "TN" : "KY";
}

/** "Tennessee" / "tenn." / "tn" → "TN"; "Kentucky" → "KY"; another two-letter code as is. */
export function stateCode(s: string | null | undefined): string | null {
  const t = (s ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!t) return null;
  if (t === "tn" || t === "tenn" || t === "tennessee") return "TN";
  if (t === "ky" || t === "kent" || t === "kentucky") return "KY";
  return /^[a-z]{2}$/.test(t) ? t.toUpperCase() : null;
}

/** County names both states use (Franklin, Warren, Montgomery, … 34 of them), lower-cased. */
export const SHARED_COUNTY_NAMES: ReadonlySet<string> = new Set(
  TN_COUNTIES.map((c) => c.name.toLowerCase()).filter((n) =>
    KY_COUNTIES.some((k) => k.toLowerCase() === n),
  ),
);

/** One entry in the county filter; `state` is set only where the name exists in both states. */
export interface CountyOption {
  /** The Select value: the county, or "County|ST" for a name both states have. */
  key: string;
  county: string;
  state: CoveredState | null;
  /** "Franklin, TN" for a shared name; the county alone otherwise. */
  label: string;
  count: number;
}

/** "Franklin|TN" / "Adair" → the county and, for a shared name, its state. */
export function parseCountyKey(key: string): { county: string; state: CoveredState | null } {
  const m = /^(.*)\|(KY|TN)$/.exec(key);
  return m ? { county: m[1]!, state: m[2] as CoveredState } : { county: key, state: null };
}

/**
 * The county filter's entries: counts per county name (what the database groups by), with each
 * name both states use split into "Name, KY" and "Name, TN" from the Tennessee count, so
 * Franklin County, Kentucky and Franklin County, Tennessee never merge. Alphabetical.
 */
export function countyOptions(
  counts: { county: string; count: number }[],
  tnCounts: ReadonlyMap<string, number>,
): CountyOption[] {
  const out: CountyOption[] = [];
  for (const { county, count } of counts) {
    if (!SHARED_COUNTY_NAMES.has(county.toLowerCase())) {
      out.push({ key: county, county, state: null, label: county, count });
      continue;
    }
    const tn = Math.min(count, tnCounts.get(county) ?? 0);
    const ky = count - tn;
    if (ky > 0)
      out.push({ key: `${county}|KY`, county, state: "KY", label: `${county}, KY`, count: ky });
    if (tn > 0)
      out.push({ key: `${county}|TN`, county, state: "TN", label: `${county}, TN`, count: tn });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The map's Tennessee outline overlay: the USA Structures polygons of 5,000 sq ft and up (the
 * prospecting floor) inside a [west, south, east, north] box, as WGS84 GeoJSON. The layer is a
 * hosted FeatureServer (no map "export" to draw raster tiles from, as Kentucky's overlay does),
 * so the map asks per view; 2,000 is the layer's page size.
 */
export function tnOutlinesQueryUrl(
  layerUrl: string,
  box: [number, number, number, number],
  minSqFt = 5000,
): string {
  const p = new URLSearchParams({
    where: `SQFEET >= ${minSqFt}`,
    geometry: box.map((v) => v.toFixed(5)).join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "BUILD_ID",
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: "6",
    resultRecordCount: "2000",
    f: "geojson",
  });
  return `${layerUrl.replace(/\/+$/, "")}/query?${p.toString()}`;
}

/** The part of a [w, s, e, n] box inside another, or null when they do not meet. */
export function clipBox(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] | null {
  const w = Math.max(a[0], b[0]);
  const s = Math.max(a[1], b[1]);
  const e = Math.min(a[2], b[2]);
  const n = Math.min(a[3], b[3]);
  return w < e && s < n ? [w, s, e, n] : null;
}

/** Does box `outer` contain box `inner` ([w, s, e, n])? */
export const boxContains = (
  outer: [number, number, number, number],
  inner: [number, number, number, number],
): boolean =>
  inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];

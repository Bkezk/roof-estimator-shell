/**
 * Re-roof marking — SERVER ONLY (fetches a public layer; refreshLeads loads it with a dynamic
 * import).
 *
 * Owner, Sep 29: "The marking buildings as done is very useful, please implement it showing
 * when it was done and who did it." A commercial re-roof permit is not a lead (the job already
 * went to the roofer who pulled it); it is a building salespeople should not call on for a
 * while. Each lead refresh (in-app and nightly) ends with markReroofedBuildings:
 *
 *   1. one query per city for its roofing permits (a year back on the first run, then 120 days),
 *      kept in public.reroof_permits (upsert on source + permit number);
 *   2. every permit not handled yet, issued in the last 12 months, whose scope is a re-roof
 *      (isReroofPurpose: not rooftop HVAC work, not siding, not a small repair) is matched to a
 *      building: same street address in the same city, else the building whose outline holds
 *      the permit point, else the nearest building within 40 m;
 *   3. a match writes one roof record on the building (section "Whole roof (permit)", installed
 *      on the issue date, installer = the permit holder, the permit in the notes) and stamps
 *      buildings.last_reroof_on / last_reroof_by and roof_year (both only ever move forward).
 *
 * A permit with no building yet (Tennessee buildings not loaded) is tried again every run for
 * 12 months. matched_at marks a permit handled for good: a roof record someone deletes by hand
 * is not written back.
 *
 * Cities: Metro Nashville only today. Louisville's permit layer has no roofing permit type and
 * no description (a re-roof is an unmarked "Commercial Alteration"), and Chattanooga's layer
 * holds only new construction. A second city is one more entry in REROOF_SOURCES (a fetch that
 * returns ReroofInsert rows); the matching and marking are shared.
 *
 * Prospecting only: nothing here reads or writes bids or estimates.
 */
import type { Database, Json } from "@/integrations/supabase/types";
import { pointInFootprint } from "@/lib/gis/ky-layers";
import {
  NASHVILLE_PERMITS_LAYER,
  centralDay,
  fetchTimeout,
  type NashvillePermit,
} from "@/lib/leads.server";
import type { Client } from "@/lib/notify.server";

export type ReroofInsert = Database["public"]["Tables"]["reroof_permits"]["Insert"];
export type ReroofRow = Database["public"]["Tables"]["reroof_permits"]["Row"];
export type ReroofSourceId = "nashville_permits";

/** The roof record a matched permit writes (the detail panel's roof table shows it). */
export const PERMIT_SECTION = "Whole roof (permit)";
/** First run (nothing stored for the city yet): a year back. Later runs: 120 days. */
export const FIRST_RUN_DAYS = 365;
export const RUN_DAYS = 120;
/** An unmatched re-roof is tried again on every run while it is younger than this. */
export const RETRY_DAYS = 365;
/** Nearest-building match: the building's centre within this many metres of the permit point. */
export const POINT_MATCH_M = 40;
/**
 * How far to look for a building whose outline holds the permit point. A big warehouse's centre
 * can sit well over 40 m from a point near its end.
 */
export const FOOTPRINT_SEARCH_M = 250;
const NOTES_MAX = 400;

/* ------------------------------------------------------------------------------------------------
 * Reading a permit
 * ---------------------------------------------------------------------------------------------- */

/** "no change to exterior building/roof lines", "existing roofline": boilerplate, not roof work. */
const ROOF_LINES = /\broof[\s-]?lines?\b/gi;
const ROOF_WORD =
  /\b(re-?roof\w*|roof\w*|shingl\w*|tpo|epdm|pvc|membrane|tear[\s-]?off|built[\s-]?up|bur|mod(ified)?[\s-]?bit\w*)\b/i;
/**
 * Rooftop equipment. A permit that opens with it is about the units (the roof words are about
 * curbs and supports); a re-roof that mentions the units further on ("tapered insulation at the
 * high side of the HVAC units") is still a re-roof.
 */
const HVAC =
  /\b(hvac|rtus?|roof\s?top\s+(hvac\s+)?units?|rooftop\s+(hvac\s+)?units?|air\s+handl\w*)\b/i;
/** Plainly a re-roof, even next to rooftop equipment. */
const EXPLICIT_REROOF =
  /\b(re-?roof\w*|tear[\s-]?off|new\s+(\w+\s+){0,3}roof(ing)?\s+system|roof(ing)?\s+(system\s+)?replacement)\b/i;
/** Roof work that replaces or covers the roof (not a patch). */
const REPLACES_ROOF =
  /\b(re-?roof\w*|tear[\s-]?off|(replac\w*|remov\w*|install\w*|new|add(ed|ing)?)\b[^.]{0,60}?\b(roof|shingl|tpo|epdm|pvc|membrane)\w*|(roof|shingl|membrane)\w*\s+(system\s+)?(replacement|replaced))/i;

/**
 * Does a Roofing / Siding permit's scope describe a re-roof? Yes when it talks about the roof
 * (roof, re-roof, roofing, shingles, TPO, EPDM, PVC, membrane, tear off …); no for rooftop HVAC
 * work (a first sentence about the units, unless the scope plainly says re-roof), siding only,
 * a repair that replaces nothing, or no scope at all.
 */
export function isReroofPurpose(text: string | null | undefined): boolean {
  const t = (text ?? "").replace(ROOF_LINES, " ").replace(/\s+/g, " ").trim();
  if (!t || !ROOF_WORD.test(t)) return false;
  const opening = t.split(/[.;](?:\s|$)/)[0] ?? t;
  if (HVAC.test(opening)) return EXPLICIT_REROOF.test(t);
  if (/\brepair/i.test(t)) return REPLACES_ROOF.test(t);
  return true;
}

/** Square feet from a scope: "7862SF", "19,063 S.F.", "12,000 sq ft", "36,300 sf" (not "205 sq"). */
export function parseSqft(text: string | null | undefined): number | null {
  const m =
    /(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:s\.?\s?f\.?(?![a-z])|sq\.?\s*(?:ft|feet|foot)\b\.?|square\s+(?:feet|foot)\b)/i.exec(
      text ?? "",
    );
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 100 ? n : null;
}

const ROOF_TYPES: [string, RegExp][] = [
  ["TPO", /\btpo\b/gi],
  ["EPDM", /\bepdm\b/gi],
  ["PVC", /\bpvc\b/gi],
  ["Mod Bit", /\bmod(ified)?[\s-]?bit\w*|\bsbs\b/gi],
  ["Metal", /\bmetal\s+(roof|panel)\w*|\bstanding\s+seam\b/gi],
  ["Shingle", /\bshingl\w*/gi],
  ["Built-up", /\bbuilt[\s-]?up\b|\bbur\b/gi],
];
/** "the existing EPDM", "old BUR", "the underlying EPDM": the roof coming off or staying under. */
const OLD_BEFORE = /\b(existing|old|underlying)\s+(\S+\s+){0,2}$/i;

/** The type named first in `t` that is not the old roof, or null. */
function firstType(t: string): string | null {
  let best: { type: string; at: number } | null = null;
  for (const [type, re] of ROOF_TYPES) {
    for (const m of t.matchAll(re)) {
      if (OLD_BEFORE.test(t.slice(Math.max(0, m.index - 40), m.index))) continue;
      if (!best || m.index < best.at) best = { type, at: m.index };
      break;
    }
  }
  return best?.type ?? null;
}

/**
 * The roof going on: the first type named after "install" / "new" / "with" (the old roof is
 * usually named before it: "Remove old BUR roof … install … new 60mil TPO"), else the first
 * type named anywhere; a type called "existing" / "old" / "underlying" never counts. Null when
 * none is named.
 */
export function parseRoofType(text: string | null | undefined): string | null {
  const t = text ?? "";
  const cue = /\b(install\w*|new|with)\b/i.exec(t);
  return (cue ? firstType(t.slice(cue.index)) : null) ?? firstType(t);
}

const SUFFIXES: Record<string, string> = {
  STREET: "ST",
  STR: "ST",
  AVENUE: "AVE",
  AV: "AVE",
  ROAD: "RD",
  DRIVE: "DR",
  PARKWAY: "PKWY",
  PKY: "PKWY",
  BOULEVARD: "BLVD",
  HIGHWAY: "HWY",
  LANE: "LN",
  COURT: "CT",
  PLACE: "PL",
  CIRCLE: "CIR",
  TERRACE: "TER",
  TRAIL: "TRL",
  EXPRESSWAY: "EXPY",
  PLAZA: "PLZ",
  SQUARE: "SQ",
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
};
/** Street types after which a lone trailing number is a unit ("1330 FOSTER AVE 100"). */
const UNIT_AFTER = new Set([
  "ST",
  "AVE",
  "RD",
  "DR",
  "PKWY",
  "BLVD",
  "LN",
  "CT",
  "PL",
  "CIR",
  "WAY",
  "PIKE",
  "TER",
  "TRL",
  "EXPY",
  "PLZ",
  "SQ",
  "N",
  "S",
  "E",
  "W",
  "NE",
  "NW",
  "SE",
  "SW",
]);
const UNIT_WORDS = new Set([
  "STE",
  "SUITE",
  "UNIT",
  "APT",
  "BLDG",
  "BUILDING",
  "#",
  "FL",
  "FLOOR",
  "RM",
  "ROOM",
]);

/**
 * An address for comparison: upper case, no punctuation, standard street types and directions
 * (STREET → ST, AVENUE → AVE, NORTH → N …), no suite / unit tail, no letter unit after the
 * house number ("654 A WEDGEWOOD AVE" → "654 WEDGEWOOD AVE").
 */
export function normalizeAddress(s: string | null | undefined): string {
  const tokens = (s ?? "")
    .toUpperCase()
    .replace(/#/g, " # ")
    .replace(/[^A-Z0-9# ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SUFFIXES[w] ?? w);
  const cut = tokens.findIndex((w, i) => i > 1 && UNIT_WORDS.has(w));
  if (cut > 0) tokens.length = cut;
  const n = tokens.length;
  if (n > 3 && /^\d+[A-Z]?$/.test(tokens[n - 1]!) && UNIT_AFTER.has(tokens[n - 2]!)) tokens.pop();
  if (tokens.length > 3 && /^\d+$/.test(tokens[0]!) && /^[A-Z]$/.test(tokens[1]!))
    tokens.splice(1, 1);
  return tokens.join(" ");
}

/* ------------------------------------------------------------------------------------------------
 * Metro Nashville
 * ---------------------------------------------------------------------------------------------- */

export const NASHVILLE_REROOF_TYPE = "Building Commercial - Roofing / Siding";

/** One query: every Roofing / Siding permit issued in the last `days` days, newest first. */
export function nashvilleReroofQueryUrl(days: number, now = new Date()): string {
  const since = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const q = new URLSearchParams({
    where: `Permit_Type_Description = '${NASHVILLE_REROOF_TYPE}' AND Date_Issued >= DATE '${since}'`,
    outFields: "*",
    orderByFields: "Date_Issued DESC",
    resultRecordCount: "1000",
    returnGeometry: "false",
    f: "json",
  });
  return `${NASHVILLE_PERMITS_LAYER}/query?${q.toString()}`;
}

/**
 * The permits in one request (polite pulling: no paging). `truncated`: the layer had more than
 * the 1,000 it sent (about 80 a year were issued in 2025–26, so this would be news).
 */
export async function fetchNashvilleReroofPermits(
  days: number,
  now = new Date(),
): Promise<{ permits: NashvillePermit[]; truncated: boolean }> {
  const res = await fetchTimeout(nashvilleReroofQueryUrl(days, now));
  if (!res.ok) throw new Error(`→ ${res.status}`);
  const json = (await res.json()) as {
    error?: { message?: string };
    features?: { attributes: NashvillePermit }[];
    exceededTransferLimit?: boolean;
  };
  if (json.error) throw new Error(`→ ${json.error.message ?? "error"}`);
  return {
    permits: (json.features ?? []).map((f) => f.attributes),
    truncated: !!json.exceededTransferLimit,
  };
}

/** Collapse spaces; drop the clerk's "**Stamped Plans in City Works**" style notes. */
export function cleanPurpose(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/\*{2,}[^*]*\**/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A Nashville permit as a reroof_permits row (null without a number or an issue date). */
export function nashvilleReroofRow(p: NashvillePermit, now = new Date()): ReroofInsert | null {
  const no = String(p.Permit__ ?? "").trim();
  if (!no || !p.Date_Issued) return null;
  const purpose = cleanPurpose(p.Purpose);
  return {
    source: "nashville_permits",
    permit_no: no,
    issued_on: centralDay(p.Date_Issued),
    contractor: (p.Contact ?? "").replace(/\s+/g, " ").trim() || null,
    cost: typeof p.Const_Cost === "number" ? p.Const_Cost : null,
    address: (p.Address ?? "").replace(/\s+/g, " ").trim() || null,
    city: (p.City ?? "").trim() || null,
    state:
      (typeof p.State === "string" && /^[A-Z]{2}$/.test(p.State.trim()) && p.State.trim()) || "TN",
    lat: typeof p.Lat === "number" && p.Lat !== 0 ? p.Lat : null,
    lng: typeof p.Lon === "number" && p.Lon !== 0 ? p.Lon : null,
    description: purpose || null,
    sqft: parseSqft(purpose),
    roof_type: parseRoofType(purpose),
    raw: p as unknown as Json,
    last_seen_at: now.toISOString(),
  };
}

export interface ReroofSource {
  source: ReroofSourceId;
  /** "Metro Nashville": the notes line and the refresh's red line. */
  label: string;
  fetch: (days: number, now: Date) => Promise<{ rows: ReroofInsert[]; truncated: boolean }>;
}

export const REROOF_SOURCES: ReroofSource[] = [
  {
    source: "nashville_permits",
    label: "Metro Nashville",
    fetch: async (days, now) => {
      const { permits, truncated } = await fetchNashvilleReroofPermits(days, now);
      return {
        rows: permits
          .map((p) => nashvilleReroofRow(p, now))
          .filter((r): r is ReroofInsert => r !== null),
        truncated,
      };
    },
  },
];
const LABELS: Record<ReroofSourceId, string> = { nashville_permits: "Metro Nashville" };

/* ------------------------------------------------------------------------------------------------
 * Matching a permit to a building
 * ---------------------------------------------------------------------------------------------- */

export interface MatchCandidate {
  id: string;
  address1: string;
  city: string | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
  footprint: Json | null;
  roof_year: number | null;
  last_reroof_on: string | null;
}
const CANDIDATE_COLUMNS =
  "id, address1, city, centroid_lat, centroid_lng, footprint, roof_year, last_reroof_on";

/** Great-circle distance in metres. */
export function metresBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

const holds = (b: MatchCandidate, lat: number, lng: number) =>
  pointInFootprint(lng, lat, b.footprint as { type: string; coordinates: unknown } | null);
const distance = (b: MatchCandidate, lat: number, lng: number) =>
  b.centroid_lat === null || b.centroid_lng === null
    ? Infinity
    : metresBetween(lat, lng, b.centroid_lat, b.centroid_lng);
/** Outline holding the point first, then the nearest centre. */
function best(list: MatchCandidate[], lat: number | null, lng: number | null) {
  if (lat === null || lng === null || list.length < 2) return list[0] ?? null;
  const rank = (b: MatchCandidate) => (holds(b, lat, lng) ? 0 : 1);
  return [...list].sort(
    (a, b) => rank(a) - rank(b) || distance(a, lat, lng) - distance(b, lat, lng),
  )[0]!;
}

/**
 * The building a permit is for, among buildings not deleted:
 *   1. address: the same normalized street address, city and state (several → the one whose
 *      outline holds the permit point, else the nearest);
 *   2. point: a building whose outline holds the permit point (centre within FOOTPRINT_SEARCH_M),
 *      else the nearest building whose centre is within POINT_MATCH_M.
 */
export async function matchBuilding(
  admin: Client,
  permit: Pick<ReroofRow, "address" | "city" | "state" | "lat" | "lng">,
): Promise<{ building: MatchCandidate; method: "address" | "point" } | null> {
  const want = normalizeAddress(permit.address);
  const house = /^(\d+)/.exec(want)?.[1];
  if (want && house && permit.city?.trim()) {
    // `*` so address_approx comes along when the column exists (and nothing breaks before
    // its migration): an approximate address is the loader's guess from the nearest 911 point
    // (owner, Sep 29), so it never matches a permit by address — the point match below still can.
    const { data, error } = await admin
      .from("buildings")
      .select("*")
      .is("deleted_at", null)
      .eq("state", permit.state)
      .ilike("city", permit.city.trim().replace(/[%_\\]/g, ""))
      .ilike("address1", `${house} %`)
      .limit(50);
    if (error) throw new Error(error.message);
    const same = ((data ?? []) as (MatchCandidate & { address_approx?: boolean | null })[]).filter(
      (b) => b.address_approx !== true && normalizeAddress(b.address1) === want,
    );
    const hit = best(same, permit.lat, permit.lng);
    if (hit) return { building: hit, method: "address" };
  }
  const { lat, lng } = permit;
  if (lat === null || lng === null) return null;
  const dLat = FOOTPRINT_SEARCH_M / 111320;
  const dLng = FOOTPRINT_SEARCH_M / (111320 * Math.cos((lat * Math.PI) / 180));
  const { data, error } = await admin
    .from("buildings")
    .select(CANDIDATE_COLUMNS)
    .is("deleted_at", null)
    .gte("centroid_lat", lat - dLat)
    .lte("centroid_lat", lat + dLat)
    .gte("centroid_lng", lng - dLng)
    .lte("centroid_lng", lng + dLng)
    .limit(500);
  if (error) throw new Error(error.message);
  const near = (data ?? []) as MatchCandidate[];
  const inside = near.filter((b) => holds(b, lat, lng));
  const close = near.filter((b) => distance(b, lat, lng) <= POINT_MATCH_M);
  const hit = best(inside.length ? inside : close, lat, lng);
  return hit ? { building: hit, method: "point" } : null;
}

/* ------------------------------------------------------------------------------------------------
 * The step
 * ---------------------------------------------------------------------------------------------- */

export interface ReroofCounts {
  /** Permits read from the cities this run. */
  permits: number;
  /** Of those, the ones whose scope is a re-roof. */
  reroofs: number;
  /** Permits matched to a building this run (this run's and earlier runs' permits). */
  matched: number;
  /** Buildings whose "re-roofed" stamp was set or moved forward this run. */
  marked: number;
  /** Re-roofs of the last 12 months still without a building (tried again next run). */
  unmatched: number;
  /** For the refresh's red line: a city that failed, a truncated read, a permit that failed. */
  problems: string[];
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** "Metro Nashville permit 2026058410, $510,880: Tear off existing …" (about 400 characters). */
export function permitNote(p: Pick<ReroofRow, "source" | "permit_no" | "cost" | "description">) {
  const label = LABELS[p.source as ReroofSourceId] ?? p.source;
  const head = `${label} permit ${p.permit_no}${p.cost ? `, ${usd(Number(p.cost))}` : ""}`;
  const text = `${head}: ${p.description ?? "(no scope given)"}`;
  return text.length <= NOTES_MAX ? text : `${text.slice(0, NOTES_MAX - 1).trimEnd()}…`;
}

/** Building lookups in flight at once (reads only). */
const MATCH_CONCURRENCY = 6;

/** `fn` over `items`, at most `limit` at a time; results in input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const dayBefore = (now: Date, days: number) =>
  new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);

/**
 * Pull each city's roofing permits, keep them, and mark the buildings they re-roofed. Never
 * throws for one city or one permit (the problem is returned); a database error before any
 * work (the table missing: migration not applied) throws.
 */
export async function markReroofedBuildings(
  admin: Client,
  opts: { sources?: ReroofSource[]; now?: Date } = {},
): Promise<ReroofCounts> {
  const now = opts.now ?? new Date();
  const counts: ReroofCounts = {
    permits: 0,
    reroofs: 0,
    matched: 0,
    marked: 0,
    unmatched: 0,
    problems: [],
  };

  for (const src of opts.sources ?? REROOF_SOURCES) {
    const { count, error } = await admin
      .from("reroof_permits")
      .select("id", { count: "exact", head: true })
      .eq("source", src.source);
    if (error) throw new Error(error.message);
    const days = (count ?? 0) === 0 ? FIRST_RUN_DAYS : RUN_DAYS;
    let rows: ReroofInsert[];
    try {
      const r = await src.fetch(days, now);
      rows = r.rows;
      if (r.truncated)
        counts.problems.push(
          `${src.label} re-roof permits: over 1,000 in ${days} days, only the newest 1,000 read`,
        );
    } catch (e) {
      counts.problems.push(
        `${src.label} re-roof permits ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    // One row per permit number: an upsert touching a row twice is refused.
    const byNo = new Map(rows.map((r) => [r.permit_no, r]));
    rows = [...byNo.values()];
    counts.permits += rows.length;
    counts.reroofs += rows.filter((r) => isReroofPurpose(r.description)).length;
    for (let i = 0; i < rows.length; i += 500) {
      const { error: upErr } = await admin
        .from("reroof_permits")
        .upsert(rows.slice(i, i + 500), { onConflict: "source,permit_no" });
      if (upErr) throw new Error(upErr.message);
    }
  }

  // Everything not handled yet from the last 12 months (this run's and older unmatched ones),
  // oldest first so the newest permit's stamp is the one left on a building.
  const { data: pending, error: pErr } = await admin
    .from("reroof_permits")
    .select("*")
    .is("matched_at", null)
    .gte("issued_on", dayBefore(now, RETRY_DAYS))
    .order("issued_on", { ascending: true })
    .limit(5000);
  if (pErr) throw new Error(pErr.message);

  // What this run has written to each building (a second permit reads the first one's stamp).
  const seen = new Map<string, { roof_year: number | null; last_reroof_on: string | null }>();
  const marked = new Set<string>();
  const failures: string[] = [];
  const reroofs = ((pending ?? []) as ReroofRow[]).filter((p) => isReroofPurpose(p.description));
  // The lookups (reads only) a few at a time — until the Tennessee load every re-roof of the
  // year is looked up on every run; the writes below go one permit at a time, in date order.
  const found = await mapLimit(reroofs, MATCH_CONCURRENCY, (p) =>
    matchBuilding(admin, p).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))),
  );
  for (const [i, p] of reroofs.entries()) {
    try {
      const hit = found[i];
      if (hit instanceof Error) throw hit;
      if (!hit) {
        counts.unmatched++;
        continue;
      }
      const b = hit.building;
      // One roof record per job: several permits for one building on one day (an apartment
      // complex's buildings, a permit re-issued) share the first one's record.
      const { data: same, error: sErr } = await admin
        .from("roofs")
        .select("id")
        .eq("building_id", b.id)
        .eq("section_name", PERMIT_SECTION)
        .eq("install_date", p.issued_on)
        .limit(1);
      if (sErr) throw new Error(sErr.message);
      let roofId = same?.[0]?.id ?? null;
      const inserted = !roofId;
      if (!roofId) {
        const { data: roof, error: rErr } = await admin
          .from("roofs")
          .insert({
            building_id: b.id,
            section_name: PERMIT_SECTION,
            install_date: p.issued_on,
            installer: p.contractor,
            area_sqft: p.sqft,
            roof_type: p.roof_type,
            notes: permitNote(p),
          })
          .select("id")
          .single();
        if (rErr || !roof) throw new Error(rErr?.message ?? "roof record not saved");
        roofId = roof.id;
      }
      const { error: mErr } = await admin
        .from("reroof_permits")
        .update({
          roof_id: roofId,
          building_id: b.id,
          match_method: hit.method,
          matched_at: now.toISOString(),
        })
        .eq("id", p.id);
      if (mErr) throw new Error(mErr.message);
      counts.matched++;

      // The building: roof_year = the newer of what it had and the permit's year (the roofs
      // trigger resets roof_year to the newest roof record's year, which can be older than a
      // year typed by hand, so it is written back whenever a record was added); the stamp only
      // moves forward.
      const before = seen.get(b.id) ?? { roof_year: b.roof_year, last_reroof_on: b.last_reroof_on };
      const year = Number(p.issued_on.slice(0, 4));
      const roofYear = Math.max(before.roof_year ?? 0, year);
      const patch: Database["public"]["Tables"]["buildings"]["Update"] = {};
      if (inserted || roofYear !== before.roof_year) patch.roof_year = roofYear;
      const newer = !before.last_reroof_on || p.issued_on > before.last_reroof_on;
      if (newer) {
        patch.last_reroof_on = p.issued_on;
        patch.last_reroof_by = p.contractor;
      }
      if (Object.keys(patch).length) {
        const { error: bErr } = await admin.from("buildings").update(patch).eq("id", b.id);
        if (bErr) throw new Error(bErr.message);
      }
      seen.set(b.id, {
        roof_year: roofYear,
        last_reroof_on: newer ? p.issued_on : before.last_reroof_on,
      });
      if (newer) marked.add(b.id);
    } catch (e) {
      failures.push(`permit ${p.permit_no}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  counts.marked = marked.size;
  if (failures.length)
    counts.problems.push(
      `Re-roof marking failed for ${failures.length} permit${failures.length === 1 ? "" : "s"} (${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "; …" : ""})`,
    );
  return counts;
}

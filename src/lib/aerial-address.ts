/**
 * A ticket's address → the building on our map (owner, Sep 30: the Aerial section). Pure: the
 * server function (service-aerial.functions.ts) asks the database for candidates that share the
 * house number and a street word, and these decide.
 *
 * 1. `parseStreetAddress` reads a site line ("123 N. Main Street, Suite 2, Murray, KY 42071") and
 *    a 911 / building address ("123 N MAIN ST") into the same normalised parts.
 * 2. `pickAddressMatch` scores each candidate (house number must agree; street words; city and
 *    zip when both sides have them) and takes the best — unless two different places tie, in
 *    which case it declines rather than guess (the owner's rule for approximate addresses,
 *    src/lib/gis/approx-address.ts).
 * 3. `buildingForPoint` puts the matched point on a building: the outline that contains it,
 *    else the nearest outline within the exact matcher's radius (approx-address.ts's
 *    `exactRadiusM`, the same rule the statewide 911 matcher uses).
 */
import { exactRadiusM, metres } from "@/lib/gis/approx-address";
import { pointInFootprint } from "@/lib/gis/ky-layers";
import { stateCode } from "@/lib/prospect";

const SUFFIX: Record<string, string> = {
  STREET: "ST",
  STR: "ST",
  ST: "ST",
  ROAD: "RD",
  RD: "RD",
  DRIVE: "DR",
  DR: "DR",
  AVENUE: "AVE",
  AVE: "AVE",
  AV: "AVE",
  BOULEVARD: "BLVD",
  BLVD: "BLVD",
  LANE: "LN",
  LN: "LN",
  COURT: "CT",
  CT: "CT",
  CIRCLE: "CIR",
  CIR: "CIR",
  PLACE: "PL",
  PL: "PL",
  PARKWAY: "PKWY",
  PKWY: "PKWY",
  TERRACE: "TER",
  TER: "TER",
  TRAIL: "TRL",
  TRL: "TRL",
  WAY: "WAY",
  PIKE: "PIKE",
  PK: "PIKE",
  HIGHWAY: "HWY",
  HWY: "HWY",
  ROUTE: "HWY",
  RTE: "HWY",
  RT: "HWY",
  LOOP: "LOOP",
  SQUARE: "SQ",
  SQ: "SQ",
  PLAZA: "PLZ",
  PLZ: "PLZ",
  EXPRESSWAY: "EXPY",
  EXPY: "EXPY",
  BYPASS: "BYP",
  BYP: "BYP",
  CROSSING: "XING",
  XING: "XING",
};
const DIRECTION: Record<string, string> = {
  NORTH: "N",
  N: "N",
  SOUTH: "S",
  S: "S",
  EAST: "E",
  E: "E",
  WEST: "W",
  W: "W",
  NORTHEAST: "NE",
  NE: "NE",
  NORTHWEST: "NW",
  NW: "NW",
  SOUTHEAST: "SE",
  SE: "SE",
  SOUTHWEST: "SW",
  SW: "SW",
};
/** Unit designators: the rest of the street line after one is dropped ("STE 200", "#4"). */
const UNIT = new Set([
  "SUITE",
  "STE",
  "UNIT",
  "APT",
  "APARTMENT",
  "BLDG",
  "BUILDING",
  "RM",
  "ROOM",
  "FL",
  "FLOOR",
  "LOT",
  "#",
]);

export interface ParsedAddress {
  /** "1169", "12A". */
  house: string;
  /** Normalised street, e.g. "N MAIN ST", "STATE HWY 136 W". */
  street: string;
  /** The street's own words (no direction, no suffix): ["MAIN"], ["STATE", "136"]. */
  core: string[];
  suffix: string | null;
  directions: string[];
  city: string | null;
  state: string | null;
  zip: string | null;
}

const clean = (s: string) =>
  s.toUpperCase().replace(/[.,']/g, " ").replace(/#/g, " # ").replace(/\s+/g, " ").trim();

/**
 * A street address line → its parts. Accepts a full site line ("street, [unit,] city, ST zip")
 * or a bare street ("1169 STATE ROUTE 136 W"). Null when there is no house number to match on.
 */
export function parseStreetAddress(line: string | null | undefined): ParsedAddress | null {
  const parts = (line ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  let city: string | null = null;
  let state: string | null = null;
  let zip: string | null = null;
  const rest = [...parts];
  // Trailing "KY 42071", "KY", "42071", "Kentucky 42071-1234".
  const last = rest.length > 1 ? rest[rest.length - 1]! : null;
  const sz = last?.match(/^([A-Za-z][A-Za-z .]*?)?\s*(\d{5})(?:-\d{4})?$/) ?? null;
  const onlyState = last ? stateCode(last) : null;
  if (sz || (onlyState && /^[A-Za-z .]+$/.test(last!))) {
    rest.pop();
    if (sz) {
      zip = sz[2]!;
      state = sz[1] ? stateCode(sz[1]) : null;
    } else state = onlyState;
    if (rest.length > 1) city = clean(rest.pop()!) || null;
  } else if (rest.length > 1) {
    // "street, city" with no state / zip.
    const maybeCity = rest[rest.length - 1]!;
    if (!/\d/.test(maybeCity) && !UNIT.has(clean(maybeCity).split(" ")[0] ?? "")) {
      city = clean(maybeCity) || null;
      rest.pop();
    }
  }
  const tokens = clean(rest[0] ?? "")
    .split(" ")
    .filter(Boolean);
  const houseTok = tokens[0] ?? "";
  const hm = houseTok.match(/^(\d{1,7})([A-Z]?)(?:-\d+[A-Z]?)?$/);
  if (!hm) return null;
  const house = `${hm[1]}${hm[2] ?? ""}`;
  const words: string[] = [];
  for (const t of tokens.slice(1)) {
    if (UNIT.has(t)) break;
    words.push(t);
  }
  const w = [...words];
  let pre: string | null = null;
  if (w.length > 1 && DIRECTION[w[0]!]) pre = DIRECTION[w.shift()!]!;
  let post: string | null = null;
  if (w.length > 1 && DIRECTION[w[w.length - 1]!]) post = DIRECTION[w.pop()!]!;
  let suffix: string | null = null;
  const lastWord = w[w.length - 1];
  // A trailing street type is the suffix; a highway word stays in the name ("STATE ROUTE 136",
  // "KY HWY 136", "US HIGHWAY 41" all read "… HWY …").
  if (w.length > 1 && lastWord && SUFFIX[lastWord] && SUFFIX[lastWord] !== "HWY") {
    suffix = SUFFIX[w.pop()!]!;
  }
  const directions = [pre, post].filter((d): d is string => d !== null);
  const core = w.map((t) => (SUFFIX[t] === "HWY" ? "HWY" : t));
  if (!core.length) return null;
  const street = [pre, ...core, suffix, post].filter(Boolean).join(" ");
  return { house, street, core, suffix, directions, city, state, zip };
}

/**
 * The street word the database filters on: the longest core word, letters and digits only
 * (never a LIKE wildcard). Null when the street has none worth filtering on.
 */
export function streetFilterWord(a: ParsedAddress): string | null {
  const words = a.core
    .map((w) => w.replace(/[^A-Z0-9]/g, ""))
    .filter(
      (w) =>
        w.length >= 2 && w !== "HWY" && w !== "STATE" && w !== "US" && w !== "KY" && w !== "TN",
    );
  if (!words.length) return null;
  return words.reduce((a, b) => (b.length > a.length ? b : a));
}

/** An address point or a building with its address, from the database. */
export interface AddressCandidate {
  source: "building" | "point";
  id: string;
  address: string;
  city: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  /** The building the candidate is (a building row) or was matched to (a 911 point). */
  building_id: string | null;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((w) => b.includes(w));
const subset = (a: string[], b: string[]) => a.every((w) => b.includes(w));

/**
 * How well a candidate fits the ticket's address; null = not the same address. The house number
 * must agree and the street's own words must agree (all of them, or one side's all inside the
 * other's: "MAIN" / "OLD MAIN"). Suffix, direction, city and zip raise or lower the score when
 * both sides have them.
 */
export function scoreAddress(target: ParsedAddress, c: AddressCandidate): number | null {
  const p = parseStreetAddress(c.address);
  if (!p || p.house !== target.house) return null;
  let score: number;
  if (sameSet(p.core, target.core)) score = 3;
  else if (subset(p.core, target.core) || subset(target.core, p.core)) score = 1.5;
  else return null;
  if (p.suffix && target.suffix) score += p.suffix === target.suffix ? 1 : -1;
  if (p.directions.length && target.directions.length)
    score += sameSet(p.directions, target.directions) ? 0.5 : -1.5;
  const city = c.city ? clean(c.city) : null;
  if (city && target.city) score += city === target.city ? 2 : -1;
  const zip = c.zip?.trim().slice(0, 5) || null;
  if (zip && target.zip) score += zip === target.zip ? 3 : -3;
  return score;
}

export type AddressMatch =
  | { outcome: "match"; candidate: AddressCandidate; score: number }
  /** Equally good candidates in different places (the same street in two towns): no guess. */
  | { outcome: "ambiguous"; count: number }
  | { outcome: "none" };

/** Candidates this close together are the same place (a building and its own 911 point). */
export const SAME_PLACE_M = 150;
/** Below this the street words agree only loosely and nothing corroborates it. */
const MIN_SCORE = 1.5;

export function pickAddressMatch(
  target: ParsedAddress,
  candidates: readonly AddressCandidate[],
): AddressMatch {
  const scored = candidates
    .filter((c) => c.lat != null && c.lng != null)
    .map((c) => ({ c, s: scoreAddress(target, c) }))
    .filter((x): x is { c: AddressCandidate; s: number } => x.s !== null && x.s >= MIN_SCORE)
    .sort((a, b) => b.s - a.s || (a.c.source === "building" ? -1 : 1));
  const best = scored[0];
  if (!best) return { outcome: "none" };
  const ties = scored.filter((x) => best.s - x.s < 0.01);
  const elsewhere = ties.filter(
    (x) => metres(best.c.lat!, best.c.lng!, x.c.lat!, x.c.lng!) > SAME_PLACE_M,
  );
  if (elsewhere.length) return { outcome: "ambiguous", count: ties.length };
  // Of the ties in one place prefer the one that names its building.
  const named = ties.find((x) => x.c.building_id) ?? best;
  return { outcome: "match", candidate: named.c, score: named.s };
}

/** A stored building near a point, as the aerial needs it. */
export interface NearBuilding {
  id: string;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
  roof_sqft: number | null;
  footprint: unknown;
}

export type PointBuilding<B extends NearBuilding> = {
  building: B;
  how: "named" | "contains" | "nearest";
  distanceM: number | null;
} | null;

/**
 * The building a point belongs to: the one it names (a 911 point matched to a building), else
 * the outline containing it (the smallest, if outlines overlap), else the nearest outline whose
 * centroid lies within the exact matcher's radius (100 m, or the building's own size).
 */
export function buildingForPoint<B extends NearBuilding>(
  at: { lat: number; lng: number },
  buildings: readonly B[],
  namedId?: string | null,
): PointBuilding<B> {
  const named = namedId ? buildings.find((b) => b.id === namedId) : undefined;
  if (named) return { building: named, how: "named", distanceM: null };
  const containing = buildings
    .filter((b) =>
      pointInFootprint(
        at.lng,
        at.lat,
        b.footprint as { type: string; coordinates: unknown } | null,
      ),
    )
    .sort((a, b) => (a.roof_sqft ?? Infinity) - (b.roof_sqft ?? Infinity));
  if (containing[0]) return { building: containing[0], how: "contains", distanceM: 0 };
  let best: { b: B; d: number } | null = null;
  for (const b of buildings) {
    if (b.centroid_lat == null || b.centroid_lng == null) continue;
    const d = metres(at.lat, at.lng, b.centroid_lat, b.centroid_lng);
    if (d <= exactRadiusM(b.roof_sqft) && (!best || d < best.d)) best = { b, d };
  }
  return best ? { building: best.b, how: "nearest", distanceM: best.d } : null;
}

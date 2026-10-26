/**
 * Two more ways to put a ticket's building on the map when the state's 911 layer has no point
 * for its house number (owner, Oct 26: "sometimes the aerial photos dont appear" — ticket 6036,
 * 531 E Cumberland Gap Pkwy: the state lists the same building as ADVANCE AUTO PARTS at 187 W
 * Cumberland Gap Pkwy, and nothing at 531).
 *
 *  1. By name: the layer's landmark names on that street in that town, matched against the
 *     property's name (word stems, so "Advanced Auto" meets "ADVANCE AUTO PARTS"). One clear
 *     hit is shown as the building with a note to check it.
 *  2. Nearest numbers: the points the layer does have on that street in that town, nearest the
 *     typed number; their centre is where "Pick the building" opens, and the note says which
 *     numbers were found.
 *
 * Pure: the stems, the town's spellings, the pick and the notes. The state queries are built in
 * gis/ky-layers.ts and run in service-aerial.functions.ts.
 */
import { type AddressCandidate, type ParsedAddress, parseStreetAddress } from "./aerial-address";

/** Words that say nothing about which building it is. */
const STOP = new Set([
  "INC",
  "LLC",
  "LTD",
  "CO",
  "CORP",
  "COMPANY",
  "THE",
  "AND",
  "OF",
  "AT",
  "IN",
  "ON",
  "FOR",
  "NEW",
  "OLD",
  "BUILDING",
  "PROPERTY",
  "STORE",
  "SHOP",
  "ROOF",
]);

/**
 * The name's search stems: each word of 4+ letters that is not a stop word, cut to its first
 * five letters and upper-cased ("Advanced Auto" → ["ADVAN", "AUTO"]), at most three. Empty when
 * the name has nothing to search by.
 */
export function nameSearchStems(name: string | null | undefined): string[] {
  const words = (name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
  const out: string[] = [];
  for (const w of words) {
    const stem = w.slice(0, 5);
    if (!out.includes(stem)) out.push(stem);
    if (out.length === 3) break;
  }
  return out;
}

/** The town as the layer may spell it: "Corbin" and "CORBIN" (both occur in the state's data). */
export function cityVariants(city: string | null | undefined): string[] {
  const c = (city ?? "").trim();
  if (!c) return [];
  const title = c
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const upper = c.toUpperCase();
  return title === upper ? [upper] : [title, upper];
}

export interface NamedPoint extends AddressCandidate {
  landmark: string | null;
}

const sameCore = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((w) => b.includes(w));

const coreOf = (address: string | null | undefined): string[] | null =>
  parseStreetAddress(address)?.core ?? null;

/**
 * The one landmark the name points at: a point whose landmark carries every stem, on the same
 * street as the typed address when any is; null when none or when several buildings qualify (no
 * guess — the map is the honest answer then).
 */
export function pickByName(
  target: ParsedAddress,
  stems: readonly string[],
  points: readonly NamedPoint[],
): NamedPoint | null {
  if (!stems.length) return null;
  const hits = points.filter((p) => {
    const lm = (p.landmark ?? "").toUpperCase();
    return lm && p.lat != null && p.lng != null && stems.every((s) => lm.includes(s));
  });
  if (!hits.length) return null;
  const onStreet = hits.filter((p) => {
    const core = coreOf(p.address);
    return core !== null && sameCore(core, target.core);
  });
  const pool = onStreet.length ? onStreet : hits;
  // Several points of one building (a store and its suite) count as one place.
  const first = pool[0]!;
  const onePlace = pool.every(
    (p) => Math.abs(p.lat! - first.lat!) < 0.0015 && Math.abs(p.lng! - first.lng!) < 0.0015,
  );
  return onePlace ? first : null;
}

export const foundByNameNote = (landmark: string, address: string) =>
  `Found by name: ${landmark}, ${address}. Check it is the right building — pick it on the map if not.`;

export interface NearOnStreet {
  centre: { lat: number; lng: number };
  /** The house numbers found, ascending. */
  numbers: number[];
  /** The street as the layer names it (the commonest spelling among the points). */
  street: string;
}

/**
 * The points the layer has on the typed street (same core words, so 412 MAIN ST never takes
 * MAINARD), the `take` nearest the typed number, and their centre. Null when there are none.
 */
export function nearestOnStreet(
  target: ParsedAddress,
  points: readonly AddressCandidate[],
  take = 6,
): NearOnStreet | null {
  const want = Number(target.house.replace(/[A-Za-z]$/, ""));
  const rows = points.flatMap((p) => {
    const parsed = parseStreetAddress(p.address);
    if (!parsed || p.lat == null || p.lng == null || !sameCore(parsed.core, target.core)) return [];
    const n = Number(parsed.house.replace(/[A-Za-z]$/, ""));
    if (!Number.isFinite(n)) return [];
    return [{ n, lat: p.lat, lng: p.lng, street: parsed.street }];
  });
  if (!rows.length) return null;
  rows.sort((a, b) => Math.abs(a.n - want) - Math.abs(b.n - want) || a.n - b.n);
  const near = rows.slice(0, Math.max(1, take));
  const centre = {
    lat: near.reduce((s, r) => s + r.lat, 0) / near.length,
    lng: near.reduce((s, r) => s + r.lng, 0) / near.length,
  };
  const counts = new Map<string, number>();
  for (const r of near) counts.set(r.street, (counts.get(r.street) ?? 0) + 1);
  const street = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0]![0];
  return { centre, numbers: [...new Set(near.map((r) => r.n))].sort((a, b) => a - b), street };
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** "Nothing at 531 on E Cumberland Gap Pkwy in Corbin; the map opens at 440–700 W Cumberland Gap Pkwy — pick the building." */
export function nearNote(target: ParsedAddress, near: NearOnStreet): string {
  const town = target.city ? ` in ${titleCase(target.city)}` : "";
  const lo = near.numbers[0]!;
  const hi = near.numbers[near.numbers.length - 1]!;
  const range = lo === hi ? `${lo}` : `${lo}–${hi}`;
  return `Nothing at ${target.house} on ${titleCase(target.street)}${town}; the map opens at ${range} ${titleCase(near.street)} — pick the building.`;
}

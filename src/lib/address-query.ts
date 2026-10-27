/**
 * What was typed into "From an address" (owner, Oct 27: make the finder as robust as possible).
 * Pure: a free-typed line → the query the server runs, before any data is asked for.
 *
 *  - Whitespace trimmed and collapsed; everything case-insensitive.
 *  - A full line with commas ("412 Main St, Murray, KY 42071"), the same without commas
 *    ("412 Main St Murray KY 42071"), a missing state (both states are searched, Kentucky then
 *    Tennessee), a missing city (the state is searched by number + street).
 *  - Directionals, suffixes and route prefixes are normalised by parseStreetAddress (its SUFFIX
 *    map, extended here with the owner's list); unit words (Suite, Ste, Unit, Apt, #) are
 *    dropped; a ZIP is read but only ever a hint (there is no ZIP → city table in the app).
 *  - A line with no house number is a place name ("Advance Auto Parts, Corbin KY", "Corbin High
 *    School"): the landmark-by-name search, in the town when one is named.
 *  - Coordinates ("36.9757, -84.1091", "36.9757 -84.1091") and map links (a Google Maps URL with
 *    @lat,lng, !3dlat!4dlng or ?q=lat,lng) go straight to the footprint at that point.
 *  - "Main St & 5th Ave" / "Main St and 5th Ave" is an intersection: refused with a clear message.
 *
 * Also here: the labels naming the step that matched, the candidate shape the picker lists when
 * places tie, and the typo-tolerant street match (`closestStreetName`).
 */
import {
  isStreetSuffixWord,
  parseStreetAddress,
  streetFilterWord,
  type ParsedAddress,
} from "./aerial-address";

export type SearchState = "KY" | "TN";

/** US state codes (so a trailing "KY" / "OH" is read as the state, and nothing else is). */
const US_STATE_CODES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
    " ",
  ),
);
/** Full state names → codes, for "Kentucky", "Tennessee", "Ohio" … typed out. */
const US_STATE_NAMES: Record<string, string> = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  WISCONSIN: "WI",
  WYOMING: "WY",
  TENN: "TN",
  KENT: "KY",
};
const DIRECTIONS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
const UNIT_WORDS = new Set([
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
/** Highway words: the number after them is part of the street name, not a house number. */
const HIGHWAY_WORDS = new Set(["HWY", "HIGHWAY", "ROUTE", "RTE", "RT", "US", "KY", "TN", "SR"]);

/** Zero-width spaces and joiners, a BOM, a no-break space: pasted along with an address. */
const INVISIBLE = new RegExp("[\\u200B-\\u200D\\uFEFF\\u00A0]", "g");

/** Trim, collapse whitespace, drop invisible characters. */
export function normalizeAddressLine(line: string | null | undefined): string {
  return (line ?? "").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
}

export interface AddressPoint {
  lat: number;
  lng: number;
}

export type AddressQuery =
  | { kind: "empty"; line: string; message: string }
  | { kind: "intersection"; line: string; message: string }
  | { kind: "link-without-point"; line: string; message: string }
  | { kind: "point"; line: string; at: AddressPoint }
  | {
      kind: "street";
      line: string;
      parsed: ParsedAddress;
      /** The street word the layers filter on (null when the street has none). */
      word: string | null;
      /** The states to search, in order (empty when the line names another state). */
      states: SearchState[];
      /** The state the line named, as typed, when it is not Kentucky or Tennessee. */
      outsideState: string | null;
      zip: string | null;
    }
  | {
      kind: "place";
      line: string;
      name: string;
      city: string | null;
      states: SearchState[];
      outsideState: string | null;
      zip: string | null;
    };

export const EMPTY_QUERY_MESSAGE = "Type an address, a business name or coordinates to find.";
export const INTERSECTION_MESSAGE =
  "That reads as an intersection; the finder needs a building's number and street, a business name, or its coordinates (right-click the spot in Google Maps and copy them).";
export const LINK_WITHOUT_POINT_MESSAGE =
  "That map link carries no coordinates; in Google Maps open the place so the link shows @lat,lng (or right-click the roof and copy the coordinates), then paste that.";

const inRange = (lat: number, lng: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180 &&
  !(lat === 0 && lng === 0);

/** "36.9757, -84.1091" / "36.9757 -84.1091" → the point (lng/lat swapped if typed that way). */
export function parseCoordinates(line: string): AddressPoint | null {
  const m = /^(-?\d{1,3}(?:\.\d+)?)\s*(?:,|;|\s)\s*(-?\d{1,3}(?:\.\d+)?)°?$/.exec(
    line.replace(/°/g, "").replace(/\s*,\s*/, ", "),
  );
  if (!m) return null;
  // Two plain integers are more likely a house number and something else than a point.
  if (!m[1]!.includes(".") && !m[2]!.includes(".")) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  // Both orders can be valid ("-84.1, 36.9"); the one that lands in the western hemisphere's
  // north (lat > 0, lng < 0 — where the imagery is) wins, else the order typed.
  const readings = [
    { lat: a, lng: b },
    { lat: b, lng: a },
  ].filter((r) => inRange(r.lat, r.lng));
  return readings.find((r) => r.lat > 0 && r.lng < 0) ?? readings[0] ?? null;
}

const looksLikeUrl = (line: string) =>
  /^(?:https?:\/\/|www\.|maps\.|goo\.gl\/|maps\.app\.goo\.gl)/i.test(line) ||
  /\b(?:google\.[a-z.]+\/maps|maps\.apple\.com|bing\.com\/maps|openstreetmap\.org)\b/i.test(line);

/** The point a Google / Apple / OSM map link carries, else null (the link may name a place only). */
export function parseMapLink(line: string): AddressPoint | null {
  const s = decodeURIComponent(line.replace(/\+/g, " "));
  const num = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
  const patterns = [
    // The place's own point in a Google Maps place link ("!3d36.97!4d-84.10").
    new RegExp(String.raw`!3d${num}!4d${num}`),
    // ?q=lat,lng, ?query=lat,lng, ?ll=lat,lng, ?center=, ?destination=, OSM's mlat/mlon.
    new RegExp(
      String.raw`[?&](?:q|query|ll|sll|center|destination|daddr|saddr)=${num}\s*,\s*${num}`,
    ),
    new RegExp(String.raw`[?&#]mlat=${num}(?:&|&amp;)mlon=${num}`),
    new RegExp(String.raw`#map=\d+/${num}/${num}`),
    // The camera position ("/@36.97,-84.10,19z") — close to the place when the link was copied
    // with it in view.
    new RegExp(String.raw`/@${num},${num}`),
  ];
  for (const rx of patterns) {
    const m = rx.exec(s);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (inRange(lat, lng)) return { lat, lng };
  }
  return null;
}

/** Upper-case, punctuation to spaces (commas kept as their own tokens), "#4" → "# 4". */
const tokenize = (line: string): string[] =>
  line
    .toUpperCase()
    .replace(/[.']/g, "")
    .replace(/,/g, " , ")
    .replace(/#/g, " # ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .flatMap(splitRouteToken);

/** "US-25E" / "US25E" / "KY80" / "SR-80" → ["US", "25E"] / ["KY", "80"] / ["STATE", "HWY", "80"]. */
function splitRouteToken(t: string): string[] {
  const m = /^(US|KY|TN|SR|HWY|CR)-?(\d{1,4}[A-Z]?)$/.exec(t);
  if (!m) return t === "SR" ? ["STATE", "HWY"] : [t];
  const prefix = m[1] === "SR" ? ["STATE", "HWY"] : [m[1]!];
  return [...prefix, m[2]!];
}

const isHouseNumber = (t: string | undefined) =>
  !!t && /^\d{1,7}[A-Z]?(?:-\d+[A-Z]?)?$/.test(t) && !/^\d{5}(?:-\d{4})?$/.test(t);

/**
 * The house number and street out of a comma-less line's leading words when a city follows
 * them ("412 MAIN ST MURRAY" → street ["412","MAIN","ST"], city ["MURRAY"]). The city is what
 * follows the last street suffix (and a directional right after it), or, on a highway, what
 * follows its number (and directional). Null city when nothing follows.
 */
function splitStreetAndCity(words: string[]): { street: string[]; city: string[] } {
  let end = -1;
  for (let i = words.length - 1; i >= 2; i--) {
    const w = words[i]!;
    if (isStreetSuffixWord(w) && !HIGHWAY_WORDS.has(w)) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    // "1169 STATE ROUTE 136 W MURRAY": the highway's number ends the street.
    for (let i = 1; i < words.length - 1; i++) {
      if (HIGHWAY_WORDS.has(words[i]!) && /^\d{1,4}[A-Z]?$/.test(words[i + 1] ?? "")) end = i + 1;
    }
  }
  if (end < 0) {
    // No suffix at all: with four or more words after the number, the last is the town
    // ("412 MAIN MURRAY" is too short to tell; it stays a street with no town).
    return words.length >= 5
      ? { street: words.slice(0, -1), city: words.slice(-1) }
      : { street: words, city: [] };
  }
  let i = end + 1;
  // A directional right after the suffix is the street's ("MAIN ST NE", "MAIN ST W MURRAY").
  if (i < words.length && DIRECTIONS.has(words[i]!)) i++;
  return { street: words.slice(0, i), city: words.slice(i) };
}

/** Which of the two imagery states a code is, else null. */
const imageryState = (code: string | null): SearchState | null =>
  code === "KY" || code === "TN" ? code : null;

/** The state and ZIP off the end of the tokens (removed from them), with the state's code. */
function takeStateAndZip(tokens: string[]): { state: string | null; zip: string | null } {
  let zip: string | null = null;
  let state: string | null = null;
  const dropCommas = () => {
    while (tokens.length && tokens[tokens.length - 1] === ",") tokens.pop();
  };
  dropCommas();
  const last = tokens[tokens.length - 1];
  if (last && /^\d{5}(?:-\d{4})?$/.test(last) && tokens.length > 1) {
    zip = last.slice(0, 5);
    tokens.pop();
    dropCommas();
  }
  const t = tokens[tokens.length - 1];
  if (t && tokens.length > 1) {
    const before = tokens[tokens.length - 2];
    if (US_STATE_NAMES[t]) {
      state = US_STATE_NAMES[t]!;
      tokens.pop();
    } else if (US_STATE_CODES.has(t)) {
      // "412 MAIN ST NE": a directional after the suffix, not Nebraska; "… MURRAY NE" is a state.
      const direction =
        DIRECTIONS.has(t) &&
        (before === undefined ||
          isStreetSuffixWord(before) ||
          isHouseNumber(before) ||
          before === ",");
      if (!direction && !(before === "," && tokens.length === 2)) {
        state = t;
        tokens.pop();
      }
    }
  }
  dropCommas();
  return { state, zip };
}

/** The comma groups of the remaining tokens, empty groups dropped. */
const groupsOf = (tokens: string[]): string[][] => {
  const out: string[][] = [[]];
  for (const t of tokens) {
    if (t === ",") out.push([]);
    else out[out.length - 1]!.push(t);
  }
  return out.filter((g) => g.length);
};

const isUnitGroup = (g: string[]) => UNIT_WORDS.has(g[0] ?? "") || /^#/.test(g[0] ?? "");

/** The intersection test: two street-like halves joined by "&" / "and" / "at", no house number. */
function isIntersection(firstGroup: string[]): boolean {
  if (isHouseNumber(firstGroup[0])) return false;
  const text = firstGroup.join(" ");
  const halves = text.split(/\s+(?:&|AND|AT)\s+/);
  if (halves.length !== 2) return false;
  const streetLike = (h: string) => {
    const w = h.split(" ").filter((x) => !DIRECTIONS.has(x));
    return w.length >= 1 && isStreetSuffixWord(w[w.length - 1]!);
  };
  return streetLike(halves[0]!) && streetLike(halves[1]!);
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** The free-typed line → the query to run. */
export function parseAddressQuery(input: string | null | undefined): AddressQuery {
  const line = normalizeAddressLine(input);
  if (!line) return { kind: "empty", line, message: EMPTY_QUERY_MESSAGE };
  const coords = parseCoordinates(line);
  if (coords) return { kind: "point", line, at: coords };
  if (looksLikeUrl(line)) {
    const at = parseMapLink(line);
    return at
      ? { kind: "point", line, at }
      : { kind: "link-without-point", line, message: LINK_WITHOUT_POINT_MESSAGE };
  }
  const tokens = tokenize(line);
  const { state, zip } = takeStateAndZip(tokens);
  const states: SearchState[] = state
    ? imageryState(state)
      ? [imageryState(state)!]
      : []
    : ["KY", "TN"];
  const outsideState = state && !imageryState(state) ? state : null;
  const groups = groupsOf(tokens);
  if (!groups.length) return { kind: "empty", line, message: EMPTY_QUERY_MESSAGE };
  if (isIntersection(groups[0]!))
    return { kind: "intersection", line, message: INTERSECTION_MESSAGE };

  let streetWords: string[];
  let cityWords: string[] = [];
  if (groups.length >= 2) {
    streetWords = groups[0]!;
    // The last group that is not a unit ("Suite 2") and not a number is the town.
    for (let i = groups.length - 1; i >= 1; i--) {
      const g = groups[i]!;
      if (isUnitGroup(g) || g.every((w) => /^\d+$/.test(w))) continue;
      cityWords = g;
      break;
    }
  } else if (isHouseNumber(groups[0]![0])) {
    const split = splitStreetAndCity(groups[0]!);
    streetWords = split.street;
    cityWords = split.city;
  } else {
    streetWords = groups[0]!;
  }
  const city = cityWords.length ? cityWords.join(" ") : null;

  if (isHouseNumber(streetWords[0])) {
    const rebuilt = [
      streetWords.join(" "),
      city ?? "",
      [state ?? "", zip ?? ""].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", ");
    const parsed = parseStreetAddress(rebuilt);
    if (parsed) {
      // parseStreetAddress reads a bare "KY" tail as the state; make sure ours wins.
      const p: ParsedAddress = { ...parsed, city: city ?? parsed.city, state, zip };
      return {
        kind: "street",
        line,
        parsed: p,
        word: streetFilterWord(p),
        states,
        outsideState,
        zip,
      };
    }
  }
  // No house number: a place name. Unit words and "#" mean nothing here.
  const name = titleCase(
    streetWords.filter((w) => !UNIT_WORDS.has(w) && w !== "#").join(" ") || line,
  );
  return { kind: "place", line, name, city, states, outsideState, zip };
}

// ── How a result was found ──────────────────────────────────────────────────────────────────

export type FindHow =
  | "stored"
  | "ky-points"
  | "tn-structures"
  | "by-name"
  | "corrected-street"
  | "nearest"
  | "census"
  | "point"
  | "picked";

/** The step that matched, as the picker's note line names it. */
export const FIND_HOW_LABELS: Record<FindHow, string> = {
  stored: "Found in our map data",
  "ky-points": "Found on Kentucky's address points",
  "tn-structures": "Found on Tennessee's structures",
  "by-name": "Found by name",
  "corrected-street": "Corrected street",
  nearest: "Nearest numbers on the street",
  census: "Census geocoder",
  point: "Found at the coordinates",
  picked: "Picked on the map",
};

export const STATE_NAMES: Record<SearchState, string> = { KY: "Kentucky", TN: "Tennessee" };

/** "Searched Kentucky, then Tennessee" / "Searched Tennessee" — for a line that named no state. */
export const searchedStatesNote = (states: readonly SearchState[]): string | null =>
  states.length > 1 ? `Searched ${states.map((s) => STATE_NAMES[s]).join(", then ")}` : null;

/** "Searched Cumberland Gap (you typed Cumberlnd Gap)". */
export const correctedStreetNote = (corrected: string, typed: string): string =>
  `Searched ${titleCase(corrected)} (you typed ${titleCase(typed)})`;

/** One of several places that tie, for the picker's list (owner: a choice, not a failure). */
export interface FindCandidate {
  address: string;
  city: string | null;
  state: SearchState | null;
  lat: number;
  lng: number;
  how: FindHow;
}

export const candidatesNote = (n: number): string =>
  `${n} places match that address — pick the one you mean.`;

// ── Typo tolerance ──────────────────────────────────────────────────────────────────────────

/** Letters and digits only, upper-case. */
const bare = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Levenshtein distance. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * The street name in the town closest to what was typed, when it is close enough — at most 2
 * edits, or 25% of the longer name's length — and no other name is as close. The names are the
 * layer's own (`LSt_Name` values); the typed value is the street's core words. Null when the
 * exact name is among them (nothing to correct), or nothing is close, or two are equally close.
 */
export function closestStreetName(
  typed: string,
  names: readonly string[],
): { name: string; distance: number } | null {
  const t = bare(typed);
  if (t.length < 3) return null;
  let best: { name: string; distance: number }[] = [];
  for (const n of names) {
    const d = editDistance(t, bare(n));
    if (d === 0) return null;
    const limit = Math.max(2, Math.floor(Math.max(t.length, bare(n).length) * 0.25));
    if (d > limit) continue;
    if (!best.length || d < best[0]!.distance) best = [{ name: n, distance: d }];
    else if (d === best[0]!.distance && bare(n) !== bare(best[0]!.name))
      best.push({ name: n, distance: d });
  }
  return best.length === 1 ? best[0]! : null;
}

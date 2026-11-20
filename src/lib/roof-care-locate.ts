/**
 * Where a Roof Care address is, when the building itself is not on our map (owner, Nov 18: "if it
 * cant find the location on a map can you just provide the address and look it up from there?").
 *
 * The price follows the drive, so an address with no place had no price. Our own map knows
 * Kentucky and Tennessee only, and a new building or a mistyped number is on nobody's map. The
 * chain is now, most exact first:
 *
 *   1. the building, on our stored data and the two states' layers (geocodeAddress);
 *   2. the street address, anywhere in the country (the Census Bureau's geocoder);
 *   3. the centre of its zip code;
 *   4. the centre of its town.
 *
 * Steps 3 and 4 are not the building: the page says the drive is to the town and the price is an
 * estimate. With none of the four there is still no price, and never one at a guessed distance.
 *
 * Pure: the request addresses and the reading of the answers. The fetches are in
 * roof-care.functions.ts. Zip codes and towns come from zippopotam.us (free, no key).
 */

export const ZIP_LOOKUP_BASE = "https://api.zippopotam.us/us";
export const PLACE_TIMEOUT_MS = 6_000;

/** How exactly the address was placed. */
export type PlacedBy = "building" | "street" | "zip" | "town";

export interface Placed {
  lat: number;
  lng: number;
  by: PlacedBy;
  /** What the point is, in words: "London, KY 40741". Null for the building itself. */
  place: string | null;
}

/** "40741" out of "40741", "40741-1234" or " 40741 "; null for anything that is not a US zip. */
export function zip5(zip: string | null | undefined): string | null {
  const m = /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(zip ?? "");
  return m ? m[1]! : null;
}

/** The two-letter state out of "KY", "ky" or " Ky "; null for anything longer or shorter. */
export function state2(state: string | null | undefined): string | null {
  const s = (state ?? "").trim();
  return /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : null;
}

export function zipLookupUrl(zip: string): string {
  return `${ZIP_LOOKUP_BASE}/${zip}`;
}

export function townLookupUrl(state: string, city: string): string {
  return `${ZIP_LOOKUP_BASE}/${state.toLowerCase()}/${encodeURIComponent(city.trim().toLowerCase())}`;
}

type Body = {
  "post code"?: unknown;
  "place name"?: unknown;
  "state abbreviation"?: unknown;
  places?: Array<Record<string, unknown>>;
} | null;

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The points an answer lists, dropping any that are not a place on Earth. */
function points(body: Body): Array<{ lat: number; lng: number; name: string | null }> {
  const out: Array<{ lat: number; lng: number; name: string | null }> = [];
  for (const p of Array.isArray(body?.places) ? body.places : []) {
    const rawLat = p?.["latitude"];
    const rawLng = p?.["longitude"];
    // A blank is not zero degrees.
    if (!text(rawLat) || !text(rawLng)) continue;
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      continue;
    out.push({ lat, lng, name: text(p?.["place name"]) });
  }
  return out;
}

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

function centre(list: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  const lat = list.reduce((a, p) => a + p.lat, 0) / list.length;
  const lng = list.reduce((a, p) => a + p.lng, 0) / list.length;
  return { lat: r5(lat), lng: r5(lng) };
}

/** The centre of a zip code out of the lookup's answer; null for no match or an odd body. */
export function parseZipPlace(body: unknown): Placed | null {
  const b = body as Body;
  const pts = points(b);
  if (!pts.length) return null;
  const zip = text(b?.["post code"]);
  const st = text(b?.places?.[0]?.["state abbreviation"]);
  const town = pts[0]!.name;
  const place = [town, [st, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return { ...centre(pts), by: "zip", place: place || null };
}

/**
 * The centre of a town out of the lookup's answer: a town with several zip codes is listed once
 * for each, and the middle of them is the town. Null for no match or an odd body.
 */
export function parseTownPlace(body: unknown): Placed | null {
  const b = body as Body;
  const pts = points(b);
  if (!pts.length) return null;
  const town = text(b?.["place name"]) ?? pts[0]!.name;
  const st = text(b?.["state abbreviation"]);
  return { ...centre(pts), by: "town", place: [town, st].filter(Boolean).join(", ") || null };
}

/** True when the point is the town and not the building: the price is then an estimate. */
export const placedRoughly = (by: PlacedBy): boolean => by === "zip" || by === "town";

/** The line the page shows under a drive that was worked out to the town. */
export function roughPlaceLine(place: string | null): string {
  return `The street address is not on the map. The drive is to ${
    place ? `the centre of ${place}` : "the centre of its town"
  }, so this price is an estimate until the office confirms the address.`;
}

/**
 * How a drive was worked out, for the office's own page (Nov 20): "by road, from Google" when
 * the owner's Google key answered, "by road, from the free router" when the free public router
 * did (no key, or Google did not answer), and "estimated" from the straight line otherwise.
 */
export function driveSourceWords(d: {
  source: "routed" | "estimated";
  router?: "google" | "free" | null;
}): string {
  if (d.source !== "routed") return "estimated";
  if (d.router === "google") return "by road, from Google";
  if (d.router === "free") return "by road, from the free router";
  return "by road";
}

export const NOT_PLACED_LINE =
  "Neither the address nor its town could be found on the map, so no price is given. Check the street, city, state and zip.";

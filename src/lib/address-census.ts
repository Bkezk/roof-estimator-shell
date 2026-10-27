/**
 * The finder's nationwide fallback (owner, Oct 27): when our layers find nothing, the US Census
 * Bureau geocoder (free, no key) gives the address a point. Pure: the request URL, the answer's
 * reading, and which imagery state (if any) a point falls in. The fetch itself — server side,
 * 6 s timeout, errors swallowed into a note — is in service-aerial.functions.ts.
 */
import { stateForPoint } from "@/lib/prospect";
import { inTennesseeBox } from "@/lib/gis/tn-layers";

import type { AddressPoint, SearchState } from "./address-query";

export const CENSUS_GEOCODER = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
export const CENSUS_TIMEOUT_MS = 6_000;

/** The one-line-address request for `line`. */
export function censusGeocoderUrl(line: string): string {
  const p = new URLSearchParams();
  p.set("address", line);
  p.set("benchmark", "Public_AR_Current");
  p.set("format", "json");
  return `${CENSUS_GEOCODER}?${p.toString()}`;
}

export interface CensusMatch extends AddressPoint {
  /** "412 MAIN ST, MURRAY, KY, 42071" as the geocoder spells it. */
  matchedAddress: string;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/** The first match out of the geocoder's answer, or null (no match, or an odd body). */
export function parseCensusResponse(body: unknown): CensusMatch | null {
  const r = body as {
    result?: {
      addressMatches?: Array<{
        coordinates?: { x?: unknown; y?: unknown };
        matchedAddress?: unknown;
        addressComponents?: { city?: unknown; state?: unknown; zip?: unknown };
      }>;
    };
  } | null;
  const m = r?.result?.addressMatches?.[0];
  if (!m) return null;
  const lng = Number(m.coordinates?.x);
  const lat = Number(m.coordinates?.y);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return null;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    lat,
    lng,
    matchedAddress: s(m.matchedAddress) ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    city: s(m.addressComponents?.city),
    state: s(m.addressComponents?.state),
    zip: s(m.addressComponents?.zip),
  };
}

/** Kentucky's rough box (the map's first view of it). */
export const KY_BOX: [[number, number], [number, number]] = [
  [-89.72, 36.44],
  [-81.88, 39.2],
];

/**
 * The imagery state a point is in — "KY" / "TN" by the rough state boxes (the KY/TN line decides
 * in their overlap) — or null outside both.
 */
export function imageryStateForPoint(lat: number, lng: number): SearchState | null {
  const inKy =
    lat >= KY_BOX[0][1] && lat <= KY_BOX[1][1] && lng >= KY_BOX[0][0] && lng <= KY_BOX[1][0];
  const inTn = inTennesseeBox(lat, lng);
  if (!inKy && !inTn) return null;
  if (inKy && !inTn) return "KY";
  if (inTn && !inKy) return "TN";
  return stateForPoint(lat, lng);
}

export const CENSUS_FOUND_NOTE = (matched: string) =>
  `Found by the Census geocoder at ${matched}; the point is a street-side estimate — check the building, or pick it on the map.`;
export const CENSUS_OUTSIDE_NOTE = (matched: string) =>
  `Found by the Census geocoder (${matched}); outside the Kentucky / Tennessee imagery.`;
export const CENSUS_DOWN_NOTE = "The Census geocoder could not be reached.";
export const CENSUS_NO_MATCH_NOTE = "The Census geocoder has no match for it either.";

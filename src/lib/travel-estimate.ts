/**
 * The automatic travel line (owner, Oct 9: "can we add an automated travel to the time section
 * that tracks the distance between the jbk office and the location on the ticket and calculates
 * the drive time and prefills from there? if its missing any info its just empty as it is now").
 *
 * Pure arithmetic; the server function (service-field.functions.ts estimateTravel) geocodes the
 * office (company_settings' address) and the ticket's site through the aerial's address chain
 * and hands the two points here. Owner, Oct 9, later: "can we have it do the routed drive to
 * have more accurate time" — the server first asks a router for the real road miles and minutes
 * (drive-route.ts: Google when its key is set, else OSRM's public demo) and the line then says
 * "(routed)"; when no router answers, the straight-line distance is stretched by a road factor
 * and driven at an average speed, as before, and the line says "(estimated)". Either way the
 * tech can change the hours before saving.
 *
 * Owner, Oct 9, later still ("the drive time wasnt auto added to the close out"): the main
 * address is the invoice header's PO box, which no geocoder can place, so company_settings now
 * also carries the shop's street (shop_address / shop_city / shop_state / shop_zip,
 * 20261009160000_shop_address.sql) and `travelOrigin` picks where the trucks leave from.
 */
import { parseStreetAddress } from "@/lib/aerial-address";

export interface LatLng {
  lat: number;
  lng: number;
}

/** Road miles ≈ straight-line miles × this (country roads bend; the interstate less so). */
export const ROAD_FACTOR = 1.25;
/** The average speed a service truck makes door to door, town streets and highway together. */
export const AVERAGE_MPH = 45;

const EARTH_RADIUS_MILES = 3958.7613;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in statute miles (haversine). */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Straight-line miles → road miles, to a tenth. */
export function roadMiles(straightMiles: number): number {
  return Math.round(straightMiles * ROAD_FACTOR * 10) / 10;
}

/** Minutes to drive `roadMiles` at AVERAGE_MPH, rounded UP to the next 5 minutes (never 0 for a trip). */
export function driveMinutes(roadMiles: number): number {
  if (!(roadMiles > 0)) return 0;
  const raw = (roadMiles / AVERAGE_MPH) * 60;
  return Math.ceil(raw / 5) * 5;
}

/** Hours for the time line, to 2 dp: there and back by default. */
export function travelHours(oneWayMinutes: number, roundTrip = true): number {
  const minutes = roundTrip ? oneWayMinutes * 2 : oneWayMinutes;
  return Math.round((minutes / 60) * 100) / 100;
}

/** Where the numbers came from: a router's road route, or the straight-line arithmetic here. */
export type TravelSource = "routed" | "estimated";

/** The muted line under the prefilled form and the entry's note; its tail says which source. */
export function travelNote(
  miles: number,
  minutes: number,
  source: TravelSource = "estimated",
): string {
  return `Office → site ≈ ${Math.round(miles)} mi, ${minutes} min each way (${source})`;
}

export interface TravelEstimate {
  /** Road miles one way, to a tenth. */
  miles: number;
  /** Drive minutes one way, to the next 5. */
  minutes: number;
  /** Round-trip hours, to 2 dp: what the Travel line is prefilled with. */
  hours: number;
  note: string;
  source: TravelSource;
}

/** The whole estimate from the two points; null when the two are the same spot (nothing to drive). */
export function estimateTravelBetween(office: LatLng, site: LatLng): TravelEstimate | null {
  const miles = roadMiles(haversineMiles(office, site));
  const minutes = driveMinutes(miles);
  if (minutes <= 0) return null;
  return {
    miles,
    minutes,
    hours: travelHours(minutes),
    note: travelNote(miles, minutes, "estimated"),
    source: "estimated",
  };
}

/**
 * The estimate from a router's answer (drive-route.ts routedDrive: road miles to a tenth, minutes
 * to the next 5): the same round-trip hours and note, marked "(routed)". Null when the route is
 * no drive at all (0 minutes), so the caller falls back the same way as for no answer.
 */
export function travelFromRoute(route: { miles: number; minutes: number }): TravelEstimate | null {
  if (!(route.minutes > 0)) return null;
  return {
    miles: route.miles,
    minutes: route.minutes,
    hours: travelHours(route.minutes),
    note: travelNote(route.miles, route.minutes, "routed"),
    source: "routed",
  };
}

/**
 * The office's one-line address from company_settings (the same columns the invoice header
 * prints: address, city, state, zip); "" when there is no street address to geocode.
 */
export function officeAddressLine(c: {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): string {
  const street = (c.address ?? "").trim();
  if (!street) return "";
  const cityLine = [c.city, [c.state, c.zip].filter((x) => x && x.trim()).join(" ")]
    .filter((x) => x && x.trim())
    .join(", ");
  return [street, cityLine].filter(Boolean).join(", ");
}

/** company_settings' two addresses: the main one (the invoice header's) and the shop's. */
export interface TravelOriginSettings {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** Optional: a row read before 20261009160000_shop_address.sql is applied carries none. */
  shop_address?: string | null | undefined;
  shop_city?: string | null | undefined;
  shop_state?: string | null | undefined;
  shop_zip?: string | null | undefined;
}

/**
 * Where the truck drives from (owner, Oct 9: "the drive time wasnt auto added to the close
 * out" — the main address is "PO Box 466", which has no house number to geocode): the shop
 * address when it has a street line (the aerial's parser finds a house number and street in
 * it), else the main address when IT has a street line, else null — no estimate, the Time
 * section stays as it is. `state` is the geocoder's hint, from the address the line came from
 * (the shop's state, or the main one's when the shop's is blank: the trucks park in the same
 * state as the office unless the settings say otherwise).
 */
export function travelOrigin(
  c: TravelOriginSettings,
): { line: string; state: string | null } | null {
  const shop = officeAddressLine({
    address: c.shop_address ?? null,
    city: c.shop_city ?? null,
    state: c.shop_state ?? null,
    zip: c.shop_zip ?? null,
  });
  if (shop && parseStreetAddress(shop))
    return { line: shop, state: (c.shop_state ?? "").trim() ? c.shop_state! : c.state };
  const main = officeAddressLine(c);
  if (main && parseStreetAddress(main)) return { line: main, state: c.state };
  return null;
}

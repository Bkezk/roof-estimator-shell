/**
 * The automatic travel line (owner, Oct 9: "can we add an automated travel to the time section
 * that tracks the distance between the jbk office and the location on the ticket and calculates
 * the drive time and prefills from there? if its missing any info its just empty as it is now").
 *
 * Pure arithmetic; the server function (service-field.functions.ts estimateTravel) geocodes the
 * office (company_settings' address) and the ticket's site through the aerial's address chain
 * and hands the two points here. No routing service is called (no key, no new dependency): the
 * straight-line distance is stretched by a road factor and driven at an average speed, which
 * is why every line says "(estimated)" and the tech can change the hours before saving.
 */

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

/** The muted line under the prefilled form and the entry's note. */
export function travelNote(miles: number, minutes: number): string {
  return `Office → site ≈ ${Math.round(miles)} mi, ${minutes} min each way (estimated)`;
}

export interface TravelEstimate {
  /** Road miles one way, to a tenth. */
  miles: number;
  /** Drive minutes one way, to the next 5. */
  minutes: number;
  /** Round-trip hours, to 2 dp: what the Travel line is prefilled with. */
  hours: number;
  note: string;
}

/** The whole estimate from the two points; null when the two are the same spot (nothing to drive). */
export function estimateTravelBetween(office: LatLng, site: LatLng): TravelEstimate | null {
  const miles = roadMiles(haversineMiles(office, site));
  const minutes = driveMinutes(miles);
  if (minutes <= 0) return null;
  return { miles, minutes, hours: travelHours(minutes), note: travelNote(miles, minutes) };
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

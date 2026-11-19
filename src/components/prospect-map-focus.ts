/**
 * Where the map goes when it is given a point to open on (prospect-map.tsx `focus`).
 *
 * Two kinds of point. An exact one (a lead's site, a street the address matched): fly to the
 * roof and drop a pin. A rough one, which is only the middle of the address's town or zip code
 * (owner, Nov 19, with a picture of "Pick the building" showing all of Kentucky and Tennessee:
 * "have the map try its best to get close to the location when it brings the map up instead of
 * just showing tn and Ky in its entirety"): open over the town and drop NO pin, because a pin
 * would point at a building that is not the one.
 *
 * A third kind since the same evening: where the phone itself is, asked for when the property
 * has no address at all. Close enough to see the roofs around the person, and no pin: a phone's
 * fix can be a building off, and the pin would name the wrong one.
 */

/** A roof from above. */
export const FOCUS_ZOOM = 18;
/** The roofs around a phone's own position. */
export const HERE_FOCUS_ZOOM = 17;
/** A town from above: its streets read, and two or three zooms in show the building outlines. */
export const ROUGH_FOCUS_ZOOM = 14;

export interface FocusMove {
  center: [number, number];
  zoom: number;
  pin: boolean;
}

/** How sure the point is: exact (a pin on the roof), a town's middle, or the phone's own fix. */
export type FocusKind = boolean | "here" | undefined;

export function focusMove(
  focus: { lat: number; lng: number } | null | undefined,
  rough: FocusKind,
): FocusMove | null {
  if (!focus) return null;
  const center: [number, number] = [focus.lng, focus.lat];
  if (rough === "here") return { center, zoom: HERE_FOCUS_ZOOM, pin: false };
  return rough
    ? { center, zoom: ROUGH_FOCUS_ZOOM, pin: false }
    : { center, zoom: FOCUS_ZOOM, pin: true };
}

/** The first line of "Pick the building" when the map opened on a rough point. */
export function pickRoughLine(place: string | null | undefined): string {
  return `The address is not on our maps, so the map opened over ${place?.trim() || "its town"}. Find the building, or tap the location button if you are standing on it.`;
}

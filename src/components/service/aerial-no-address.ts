/**
 * "Pick the building" on a property with no address (owner, Nov 19: "go" on the report's item:
 * "A property with no address, town or zip still opens the wide map. Solution: use the new
 * location button, or add the address").
 *
 * With nothing to look up the picker used to open on all of Kentucky and Tennessee and say
 * nothing of why. Now it says the property has no address. The office is told that adding one
 * on the property puts the map there next time, with a link to the property. A technician is
 * told to use the phone's location. And on a phone the picker asks for that location itself,
 * once, when it opens: given, the map goes there; refused or not available, the map stays wide
 * with a plain line. A computer at a desk is not asked: it is not at the building, and its fix
 * is the office's.
 *
 * Never asked when the address, or even its town, was found: the map already opened there.
 */

export type HereState =
  /** Not asked (an address was found, or this is a desk computer). */
  | { status: "idle" }
  | { status: "asking" }
  | { status: "here"; lat: number; lng: number }
  /** The person said no. */
  | { status: "refused" }
  /** The phone could not say, or took too long. */
  | { status: "unavailable" };

/** How long the picker waits for the phone's answer (the person has to tap Allow first). */
export const HERE_WAIT_MS = 20_000;

/**
 * Ask for the phone's position when the picker opens? Only with nothing to open on: no saved
 * view, no address or town found, the property with no address at all, a phone or tablet in the
 * hand, and not asked before on this screen.
 */
export function shouldAskHere(i: {
  hasView: boolean;
  near: { lat: number; lng: number } | null | undefined;
  noAddress: boolean | undefined;
  coarse: boolean;
  here: HereState;
}): boolean {
  return !i.hasView && !i.near && !!i.noAddress && i.coarse && i.here.status === "idle";
}

/** The slice of the browser's geolocation this needs (so a test can stand in for it). */
export interface Geo {
  getCurrentPosition: (
    ok: (p: { coords: { latitude: number; longitude: number } }) => void,
    fail: (e: { code: number }) => void,
    opts?: { timeout?: number; maximumAge?: number; enableHighAccuracy?: boolean },
  ) => void;
}

/** One ask. Never throws; answers "unavailable" after `waitMs` whatever the phone does. */
export function askHere(
  geo: Geo | null | undefined,
  waitMs: number = HERE_WAIT_MS,
): Promise<HereState> {
  return new Promise((resolve) => {
    if (!geo) return resolve({ status: "unavailable" });
    let done = false;
    const finish = (v: HereState) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish({ status: "unavailable" }), waitMs);
    try {
      geo.getCurrentPosition(
        (p) => finish({ status: "here", lat: p.coords.latitude, lng: p.coords.longitude }),
        // 1 is PERMISSION_DENIED; anything else is the phone not knowing.
        (e) => finish({ status: e?.code === 1 ? "refused" : "unavailable" }),
        { timeout: waitMs, maximumAge: 120_000, enableHighAccuracy: true },
      );
    } catch {
      finish({ status: "unavailable" });
    }
  });
}

export const NO_ADDRESS_LINE = "This property has no address, so the map cannot open on it.";
export const NO_ADDRESS_OFFICE =
  "Add the address on the property and the map opens there next time.";
export const NO_ADDRESS_OPEN_PROPERTY = "Open the property";
export const NO_ADDRESS_FIELD =
  "If you are at the building, tap the location button on the map and it goes to where you are.";
export const HERE_ASKING = "Asking this phone where it is…";
export const HERE_FOUND =
  "The map opened where this phone is. Find the building and tap inside the roof.";
export const HERE_REFUSED =
  "This phone did not share its location. Move the map to the building, or tap the location button to try again.";
export const HERE_UNAVAILABLE =
  "This phone could not tell where it is. Move the map to the building, or tap the location button to try again.";

/**
 * The lines above the map, in order. `office`: who may open the property and type its address.
 * A technician is never sent to someone else for it.
 */
export function noAddressLines(i: { office: boolean; here: HereState }): string[] {
  const out = [NO_ADDRESS_LINE];
  if (i.here.status === "asking") out.push(HERE_ASKING);
  else if (i.here.status === "here") out.push(HERE_FOUND);
  else if (i.here.status === "refused") out.push(HERE_REFUSED);
  else if (i.here.status === "unavailable") out.push(HERE_UNAVAILABLE);
  else if (!i.office) out.push(NO_ADDRESS_FIELD);
  if (i.office) out.push(NO_ADDRESS_OFFICE);
  return out;
}

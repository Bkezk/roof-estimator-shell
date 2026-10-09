/**
 * The routed drive between two points (owner, Oct 9: "can we have it do the routed drive to
 * have more accurate time"). The travel line (travel-estimate.ts, service-field.functions.ts
 * estimateTravel) used to stretch the straight line by a road factor; now it asks a router for
 * the real road miles and minutes and keeps that arithmetic only as the fallback.
 *
 * Two routers, no new dependency:
 *  - Google Routes API (computeRoutes), used only when GOOGLE_MAPS_API_KEY is set. The owner
 *    sets it in Lovable Cloud › Secrets; this code never reads it anywhere but at call time,
 *    never logs it, and sends it in a header, not the URL. Without the key nothing warns or
 *    fails — the next router is simply used.
 *  - OSRM's public demo server (router.project-osrm.org): free, no key, but a demo with no
 *    guarantee of uptime or rate — it may answer slowly or not at all. Hence the 8 s timeout
 *    and the straight-line fallback the caller keeps.
 *
 * Order: Google when the key is set, then OSRM, then null. Nothing here throws: any network
 * error, timeout, non-2xx answer or unexpected JSON is null, and the caller says "(estimated)".
 * The URL / request builders and the parsers are pure so the tests pin the exact shapes.
 */

export interface RoutePoint {
  lat: number;
  lng: number;
}

/** Road miles (to a tenth) and drive minutes (rounded UP to the next 5) one way, from a router. */
export interface RoutedDrive {
  miles: number;
  minutes: number;
}

export const OSRM_ROUTE_BASE = "https://router.project-osrm.org/route/v1/driving";
export const GOOGLE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
/** How long either router gets before the straight-line estimate takes over. */
export const ROUTE_TIMEOUT_MS = 8_000;

const METRES_PER_MILE = 1609.344;
const metresToMiles = (m: number) => Math.round((m / METRES_PER_MILE) * 10) / 10;
const secondsToMinutes = (s: number) => (s > 0 ? Math.ceil(s / 60 / 5) * 5 : 0);
const isPoint = (p: RoutePoint) => Number.isFinite(p.lat) && Number.isFinite(p.lng);
const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** OSRM: GET …/driving/{lng},{lat};{lng},{lat}?overview=false (no geometry — just the numbers). */
export function osrmRouteUrl(from: RoutePoint, to: RoutePoint): string {
  return `${OSRM_ROUTE_BASE}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
}

/** OSRM's answer: { code: "Ok", routes: [{ distance: metres, duration: seconds }] }. */
export function parseOsrmRoute(json: unknown): RoutedDrive | null {
  if (!isRecord(json) || json["code"] !== "Ok" || !Array.isArray(json["routes"])) return null;
  const r: unknown = json["routes"][0];
  if (!isRecord(r)) return null;
  const distance = r["distance"];
  const duration = r["duration"];
  if (typeof distance !== "number" || typeof duration !== "number") return null;
  if (!Number.isFinite(distance) || !Number.isFinite(duration) || distance < 0 || duration < 0)
    return null;
  return { miles: metresToMiles(distance), minutes: secondsToMinutes(duration) };
}

/**
 * Google Routes API: POST computeRoutes with the key and a field mask in headers (the mask is
 * required; asking for only the two numbers keeps the answer small and the cheapest SKU).
 * TRAFFIC_UNAWARE: a typical drive, not this minute's traffic — the line is a prefill.
 */
export function googleRoutesRequest(
  from: RoutePoint,
  to: RoutePoint,
  key: string,
): { url: string; init: RequestInit } {
  const point = (p: RoutePoint) => ({
    location: { latLng: { latitude: p.lat, longitude: p.lng } },
  });
  return {
    url: GOOGLE_ROUTES_URL,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify({
        origin: point(from),
        destination: point(to),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
      }),
    },
  };
}

/** Google's answer: { routes: [{ distanceMeters: 37015, duration: "2000s" }] }. */
export function parseGoogleRoute(json: unknown): RoutedDrive | null {
  if (!isRecord(json) || !Array.isArray(json["routes"])) return null;
  const r: unknown = json["routes"][0];
  if (!isRecord(r)) return null;
  const distance = r["distanceMeters"];
  const duration = r["duration"];
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) return null;
  // A protobuf Duration: "2000s" (or "2000.5s"); a bare number is tolerated.
  const seconds =
    typeof duration === "number"
      ? duration
      : typeof duration === "string" && /^\d+(\.\d+)?s$/.test(duration)
        ? Number(duration.slice(0, -1))
        : NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return { miles: metresToMiles(distance), minutes: secondsToMinutes(seconds) };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** One router call under the timeout; null for anything but a parsed 2xx answer. */
async function ask(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  parse: (json: unknown) => RoutedDrive | null,
): Promise<RoutedDrive | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ROUTE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctl.signal });
    if (!res.ok) return null;
    return parse(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The routed drive from `from` to `to`, or null. Google only when `env.GOOGLE_MAPS_API_KEY` is a
 * non-empty string (read when called, so a key added in Lovable Cloud is picked up without a
 * restart); OSRM next (also after a Google failure); null when both fail. Never throws.
 */
export async function routedDrive(
  from: RoutePoint,
  to: RoutePoint,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  env: { GOOGLE_MAPS_API_KEY?: string | undefined } = process.env,
): Promise<RoutedDrive | null> {
  if (!isPoint(from) || !isPoint(to)) return null;
  try {
    const key = (env.GOOGLE_MAPS_API_KEY ?? "").trim();
    if (key) {
      const g = googleRoutesRequest(from, to, key);
      const viaGoogle = await ask(fetchImpl, g.url, g.init, parseGoogleRoute);
      if (viaGoogle) return viaGoogle;
    }
    return await ask(fetchImpl, osrmRouteUrl(from, to), { method: "GET" }, parseOsrmRoute);
  } catch {
    return null;
  }
}

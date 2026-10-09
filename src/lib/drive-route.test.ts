/**
 * Owner, Oct 9: "can we have it do the routed drive to have more accurate time". drive-route.ts:
 * the OSRM URL and the Google Routes request as the two services expect them, both parsers on
 * fixture answers (metres → miles to a tenth, seconds → minutes up to the next 5, null on any
 * other shape), and routedDrive's order with a stubbed fetch — Google only with a key, OSRM
 * after it or without one, null when everything fails, never a throw, the key never in a URL.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GOOGLE_ROUTES_URL,
  OSRM_ROUTE_BASE,
  ROUTE_TIMEOUT_MS,
  googleRoutesRequest,
  osrmRouteUrl,
  parseGoogleRoute,
  parseOsrmRoute,
  routedDrive,
} from "@/lib/drive-route";

const LONDON = { lat: 37.1287, lng: -84.0833 };
const CORBIN = { lat: 36.9487, lng: -84.0969 };
/** 23.0 road miles in 33 min 20 s, as each service reports it. */
const OSRM_OK = { code: "Ok", routes: [{ distance: 37015, duration: 2000, legs: [] }] };
const GOOGLE_OK = { routes: [{ distanceMeters: 37015, duration: "2000s" }] };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("drive-route: OSRM", () => {
  it("osrmRouteUrl: …/route/v1/driving/{lng},{lat};{lng},{lat}?overview=false (lng first, no geometry)", () => {
    expect(OSRM_ROUTE_BASE).toBe("https://router.project-osrm.org/route/v1/driving");
    expect(osrmRouteUrl(LONDON, CORBIN)).toBe(
      "https://router.project-osrm.org/route/v1/driving/-84.0833,37.1287;-84.0969,36.9487?overview=false",
    );
  });
  it("parseOsrmRoute: metres → miles to a tenth, seconds → minutes up to the next 5", () => {
    expect(parseOsrmRoute(OSRM_OK)).toEqual({ miles: 23, minutes: 35 });
    expect(parseOsrmRoute({ code: "Ok", routes: [{ distance: 24944, duration: 1240 }] })).toEqual({
      miles: 15.5,
      minutes: 25, // 20.67 min → 25
    });
    expect(parseOsrmRoute({ code: "Ok", routes: [{ distance: 1000, duration: 300 }] })).toEqual({
      miles: 0.6,
      minutes: 5, // exactly 5 stays 5
    });
    expect(parseOsrmRoute({ code: "Ok", routes: [{ distance: 0, duration: 0 }] })).toEqual({
      miles: 0,
      minutes: 0,
    });
  });
  it("parseOsrmRoute: null for code ≠ Ok, no routes, missing or odd numbers, or not an object", () => {
    expect(parseOsrmRoute({ code: "NoRoute", routes: [] })).toBeNull();
    expect(parseOsrmRoute({ code: "Ok", routes: [] })).toBeNull();
    expect(parseOsrmRoute({ code: "Ok" })).toBeNull();
    expect(
      parseOsrmRoute({ code: "Ok", routes: [{ distance: "37015", duration: 2000 }] }),
    ).toBeNull();
    expect(parseOsrmRoute({ code: "Ok", routes: [{ distance: 37015 }] })).toBeNull();
    expect(parseOsrmRoute({ code: "Ok", routes: [{ distance: -1, duration: 2000 }] })).toBeNull();
    expect(parseOsrmRoute({ code: "Ok", routes: [{ distance: NaN, duration: 2000 }] })).toBeNull();
    expect(parseOsrmRoute(null)).toBeNull();
    expect(parseOsrmRoute("Ok")).toBeNull();
    expect(parseOsrmRoute([OSRM_OK])).toBeNull();
    expect(parseOsrmRoute({ message: "Too Many Requests" })).toBeNull();
  });
});

describe("drive-route: Google Routes API", () => {
  it("googleRoutesRequest: POST computeRoutes, key and field mask in headers, DRIVE / TRAFFIC_UNAWARE body, key never in the URL", () => {
    const r = googleRoutesRequest(LONDON, CORBIN, "the-key");
    expect(GOOGLE_ROUTES_URL).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(r.url).toBe(GOOGLE_ROUTES_URL);
    expect(r.url).not.toContain("the-key");
    expect(r.init.method).toBe("POST");
    expect(r.init.headers).toEqual({
      "Content-Type": "application/json",
      "X-Goog-Api-Key": "the-key",
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
    });
    expect(JSON.parse(r.init.body as string)).toEqual({
      origin: { location: { latLng: { latitude: 37.1287, longitude: -84.0833 } } },
      destination: { location: { latLng: { latitude: 36.9487, longitude: -84.0969 } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
    });
  });
  it("parseGoogleRoute: distanceMeters and a protobuf duration ('2000s', '2000.5s' or a number)", () => {
    expect(parseGoogleRoute(GOOGLE_OK)).toEqual({ miles: 23, minutes: 35 });
    expect(parseGoogleRoute({ routes: [{ distanceMeters: 24944, duration: "1240.5s" }] })).toEqual({
      miles: 15.5,
      minutes: 25,
    });
    expect(parseGoogleRoute({ routes: [{ distanceMeters: 24944, duration: 1240 }] })).toEqual({
      miles: 15.5,
      minutes: 25,
    });
  });
  it("parseGoogleRoute: null for no routes, a missing or malformed field, an error body, or not an object", () => {
    expect(parseGoogleRoute({ routes: [] })).toBeNull();
    expect(parseGoogleRoute({})).toBeNull();
    expect(parseGoogleRoute({ routes: [{ distanceMeters: 37015 }] })).toBeNull();
    expect(parseGoogleRoute({ routes: [{ distanceMeters: 37015, duration: "2000" }] })).toBeNull();
    expect(parseGoogleRoute({ routes: [{ distanceMeters: 37015, duration: "abcs" }] })).toBeNull();
    expect(
      parseGoogleRoute({ routes: [{ distanceMeters: "37015", duration: "2000s" }] }),
    ).toBeNull();
    expect(
      parseGoogleRoute({
        error: { code: 403, message: "The request is missing a valid API key." },
      }),
    ).toBeNull();
    expect(parseGoogleRoute(null)).toBeNull();
    expect(parseGoogleRoute(undefined)).toBeNull();
  });
});

// ── routedDrive: the order ───────────────────────────────────────────────────────────────────

type Answer = (url: string, init?: RequestInit) => Promise<Response>;
/** A fetch that answers Google and OSRM separately and records what it was asked. */
function stubFetch(answers: { google?: Answer; osrm?: Answer }) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith(GOOGLE_ROUTES_URL)) {
      if (!answers.google) throw new Error("test: Google was not expected");
      return answers.google(url, init);
    }
    if (url.startsWith(OSRM_ROUTE_BASE)) {
      if (!answers.osrm) throw new Error("test: OSRM was not expected");
      return answers.osrm(url, init);
    }
    throw new Error(`test: unexpected url ${url}`);
  });
  return { f, calls };
}
const hosts = (calls: { url: string }[]) => calls.map((c) => new URL(c.url).host);

describe("routedDrive: Google only with a key, then OSRM, then null; never throws", () => {
  it("no key (absent, empty or blank): OSRM only, Google never asked", async () => {
    for (const env of [
      {},
      { GOOGLE_MAPS_API_KEY: undefined },
      { GOOGLE_MAPS_API_KEY: "" },
      { GOOGLE_MAPS_API_KEY: "   " },
    ]) {
      const { f, calls } = stubFetch({ osrm: async () => json(OSRM_OK) });
      expect(await routedDrive(LONDON, CORBIN, f, env)).toEqual({ miles: 23, minutes: 35 });
      expect(hosts(calls)).toEqual(["router.project-osrm.org"]);
      expect(calls[0]!.url).toBe(osrmRouteUrl(LONDON, CORBIN));
      expect(calls[0]!.init?.method).toBe("GET");
      expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it("with a key: Google first and OSRM is not asked when it answers; the key travels in the header", async () => {
    const { f, calls } = stubFetch({ google: async () => json(GOOGLE_OK) });
    expect(await routedDrive(LONDON, CORBIN, f, { GOOGLE_MAPS_API_KEY: "k-1" })).toEqual({
      miles: 23,
      minutes: 35,
    });
    expect(hosts(calls)).toEqual(["routes.googleapis.com"]);
    expect((calls[0]!.init?.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("k-1");
    expect(calls[0]!.url).not.toContain("k-1");
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });
  it("with a key: a Google failure (non-2xx, error body, network error) falls through to OSRM", async () => {
    const googleFailures: Answer[] = [
      async () => json({ error: { code: 403, message: "PERMISSION_DENIED" } }, 403),
      async () => json({ routes: [] }),
      async () => {
        throw new TypeError("fetch failed");
      },
    ];
    for (const google of googleFailures) {
      const { f, calls } = stubFetch({ google, osrm: async () => json(OSRM_OK) });
      expect(await routedDrive(LONDON, CORBIN, f, { GOOGLE_MAPS_API_KEY: "k" })).toEqual({
        miles: 23,
        minutes: 35,
      });
      expect(hosts(calls)).toEqual(["routes.googleapis.com", "router.project-osrm.org"]);
    }
  });
  it("OSRM failing too (non-2xx, NoRoute, HTML, network error, timeout) → null, no throw", async () => {
    const osrmFailures: Answer[] = [
      async () => json({ code: "NoRoute", message: "Impossible route between points" }),
      async () => json({ message: "Too Many Requests" }, 429),
      async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
      async () => new Response("not json at all", { status: 200 }),
      async () => {
        throw new TypeError("fetch failed");
      },
      async (_url, init) => {
        // What fetch does when the 8 s AbortController fires.
        const e = new DOMException("The operation was aborted.", "AbortError");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        throw e;
      },
    ];
    for (const osrm of osrmFailures) {
      const { f } = stubFetch({ osrm });
      expect(await routedDrive(LONDON, CORBIN, f, {})).toBeNull();
      const withKey = stubFetch({ google: osrm, osrm });
      expect(await routedDrive(LONDON, CORBIN, withKey.f, { GOOGLE_MAPS_API_KEY: "k" })).toBeNull();
      expect(hosts(withKey.calls)).toEqual(["routes.googleapis.com", "router.project-osrm.org"]);
    }
    expect(ROUTE_TIMEOUT_MS).toBe(8_000);
  });
  it("a fetch that never settles is abandoned at the timeout (null), and the signal it was given is aborted", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      const f = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            seen = init?.signal as AbortSignal;
            seen.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError")),
            );
          }),
      );
      const p = routedDrive(LONDON, CORBIN, f, {});
      await vi.advanceTimersByTimeAsync(ROUTE_TIMEOUT_MS + 1);
      expect(await p).toBeNull();
      expect(seen?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("a point that is not a number → null before any call; the default env is process.env, read when called", async () => {
    const { f, calls } = stubFetch({});
    expect(await routedDrive({ lat: NaN, lng: 1 }, CORBIN, f, {})).toBeNull();
    expect(calls).toEqual([]);
    // No key in this process: OSRM only (the default `env` argument).
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const osrmOnly = stubFetch({ osrm: async () => json(OSRM_OK) });
    expect(await routedDrive(LONDON, CORBIN, osrmOnly.f)).toEqual({ miles: 23, minutes: 35 });
    expect(hosts(osrmOnly.calls)).toEqual(["router.project-osrm.org"]);
    // The key set later in the same process is picked up on the next call.
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    const both = stubFetch({ google: async () => json(GOOGLE_OK) });
    expect(await routedDrive(LONDON, CORBIN, both.f)).toEqual({ miles: 23, minutes: 35 });
    expect(hosts(both.calls)).toEqual(["routes.googleapis.com"]);
    vi.unstubAllEnvs();
  });
  it("the module never prints the key or warns when it is absent", () => {
    const warn = vi.spyOn(console, "warn");
    const log = vi.spyOn(console, "log");
    const err = vi.spyOn(console, "error");
    return routedDrive(LONDON, CORBIN, async () => json(OSRM_OK), {}).then(() => {
      expect(warn).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(err).not.toHaveBeenCalled();
      warn.mockRestore();
      log.mockRestore();
      err.mockRestore();
    });
  });
});

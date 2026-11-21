/**
 * Owner, Nov 20: he added his Google Routes key and it has to be provable that Google is the
 * router answering, and noticeable when it stops. A routed drive now says which router gave it,
 * and the office's "Work out the drive" tool on Setup › Roof Care shows it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GOOGLE_ROUTES_URL, OSRM_ROUTE_BASE, routedDrive, routedDriveVia } from "@/lib/drive-route";
import { driveSourceWords } from "@/lib/roof-care-locate";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const A = { lat: 37.1287, lng: -84.0833 };
const B = { lat: 36.9487, lng: -84.0969 };
const OSRM_OK = { code: "Ok", routes: [{ distance: 37015, duration: 2000, legs: [] }] };
const GOOGLE_OK = { routes: [{ distanceMeters: 40000, duration: "2400s" }] };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fetch that answers each router as told, and remembers who was asked. */
function routers(google: unknown | "fail", osrm: unknown | "fail") {
  const asked: string[] = [];
  const fetcher = async (url: string) => {
    if (url === GOOGLE_ROUTES_URL) {
      asked.push("google");
      return google === "fail" ? json({ error: { message: "denied" } }, 403) : json(google);
    }
    if (url.startsWith(OSRM_ROUTE_BASE)) {
      asked.push("free");
      return osrm === "fail" ? json({}, 502) : json(osrm);
    }
    throw new Error(`unexpected ${url}`);
  };
  return { asked, fetcher };
}

describe("a routed drive says which router gave it", () => {
  it("with the key and Google answering: Google, and the free router is not asked", async () => {
    const r = routers(GOOGLE_OK, OSRM_OK);
    const got = await routedDriveVia(A, B, r.fetcher, { GOOGLE_MAPS_API_KEY: "made-up-key" });
    expect(got).toEqual({ drive: { miles: 24.9, minutes: 40 }, via: "google" });
    expect(r.asked).toEqual(["google"]);
  });
  it("with no key: the free router, and Google is never asked", async () => {
    const r = routers(GOOGLE_OK, OSRM_OK);
    const got = await routedDriveVia(A, B, r.fetcher, {});
    expect(got).toEqual({ drive: { miles: 23, minutes: 35 }, via: "free" });
    expect(r.asked).toEqual(["free"]);
  });
  it("with a key Google refuses (a wrong key, billing off): the free router, and it says so", async () => {
    const r = routers("fail", OSRM_OK);
    const got = await routedDriveVia(A, B, r.fetcher, { GOOGLE_MAPS_API_KEY: "made-up-key" });
    expect(got?.via).toBe("free");
    expect(r.asked).toEqual(["google", "free"]);
  });
  it("neither answering: nothing, and no throw", async () => {
    const r = routers("fail", "fail");
    expect(
      await routedDriveVia(A, B, r.fetcher, { GOOGLE_MAPS_API_KEY: "made-up-key" }),
    ).toBeNull();
  });
  it("routedDrive gives the same drive as before, without the name", async () => {
    const r = routers(GOOGLE_OK, OSRM_OK);
    expect(await routedDrive(A, B, r.fetcher, { GOOGLE_MAPS_API_KEY: "made-up-key" })).toEqual({
      miles: 24.9,
      minutes: 40,
    });
  });
});

describe("the words on the office's drive tool", () => {
  it("names the router of a drive by road, and says estimated otherwise", () => {
    expect(driveSourceWords({ source: "routed", router: "google" })).toBe("by road, from Google");
    expect(driveSourceWords({ source: "routed", router: "free" })).toBe(
      "by road, from the free router",
    );
    expect(driveSourceWords({ source: "routed" })).toBe("by road");
    expect(driveSourceWords({ source: "estimated", router: null })).toBe("estimated");
    // An estimate is never credited to a router.
    expect(driveSourceWords({ source: "estimated", router: "google" })).toBe("estimated");
  });
  it("the drive carries the router only when the road answer was used", () => {
    const fn = flat(read("src/lib/roof-care.functions.ts"));
    // Nov 21: the same call, now handed the day's limit of Google lookups for the whole site.
    expect(fn).toContain("const routed = await routedDriveVia( from, to, undefined, undefined,");
    expect(fn).toContain(
      "googleGate(sb as unknown as Parameters<typeof googleGate>[0]), ).catch(() => null);",
    );
    expect(fn).toContain("router: byRoad && routed ? routed.via : null,");
  });
  it("Setup › Roof Care shows it beside the drive", () => {
    const page = flat(read("src/components/roof-care-settings.tsx"));
    expect(page).toContain("({driveSourceWords(drive as RoofCareDrive)}). The list price covers");
  });
  it("the key is still sent in a header from the server and never put in the answer", () => {
    const mod = read("src/lib/drive-route.ts");
    expect(mod).toContain('"X-Goog-Api-Key": key,');
    expect(mod).not.toMatch(/via:\s*key|drive:\s*key/);
  });
});

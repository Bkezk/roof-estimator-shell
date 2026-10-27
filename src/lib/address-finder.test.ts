/**
 * Owner, Oct 27: "make the From an address finder as robust as possible." The server chain
 * (src/lib/service-aerial.functions.ts findAddressAerial) through the fake Supabase with `fetch`
 * standing in for the state servers and the Census geocoder, step by step and in order:
 * stored → Kentucky's points → Tennessee's structures → by name → corrected street → nearest
 * numbers → the Census geocoder; coordinates and map links straight to the footprint; a place
 * name straight to the landmarks; ties as a choice; an intersection refused; every failure a
 * note, never a crash. Fails on the old code (aerialForAddress had none of these steps).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { INTERSECTION_MESSAGE } from "@/lib/address-query";
import { findAddressAerial, pointAerial } from "@/lib/service-aerial.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;

// ── Fixtures: Web Mercator features as the state layers send them ──────────────────────────

const R = 6378137;
const toMercator = (lng: number, lat: number): [number, number] => [
  (lng * Math.PI * R) / 180,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];
function squareRing(lng: number, lat: number, sqft: number): number[][] {
  const [x, y] = toMercator(lng, lat);
  const side = Math.sqrt(sqft / 10.76391) / Math.cos((lat * Math.PI) / 180);
  const h = side / 2;
  return [
    [x - h, y - h],
    [x + h, y - h],
    [x + h, y + h],
    [x - h, y + h],
    [x - h, y - h],
  ];
}
const MURRAY = { lat: 36.6103, lng: -88.3148 };
const MAYFIELD = { lat: 36.7417, lng: -88.6367 };
const CORBIN = { lat: 36.9487, lng: -84.0969 };
const NASHVILLE = { lat: 36.1627, lng: -86.7816 };
const kyPoint = (over: Row = {}, at = MURRAY) => {
  const [x, y] = toMercator(at.lng, at.lat);
  return {
    attributes: {
      OBJECTID: 7,
      Site_NGUID: `SSAP${String(over["Add_Number"] ?? 412)}${String(over["Post_Comm"] ?? "")}@ky`,
      Add_Number: 412,
      LSt_PreDir: null,
      LSt_Name: "MAIN",
      LSt_Type: "ST",
      LSt_PosDir: null,
      Post_Comm: "MURRAY",
      Post_Code: "42071",
      Inc_Muni: "MURRAY",
      County: "Calloway County",
      LandmkName: null,
      Place_Type: "Commercial",
      Lat: null,
      Long: null,
      ...over,
    },
    geometry: { x, y },
  };
};
const footprint = (at: { lat: number; lng: number }, sqft: number, attrs: Row = {}) => ({
  attributes: {
    BUILD_ID: 991,
    SQFEET: sqft,
    FIPS: "21035",
    PROP_ADDR: null,
    PROP_CITY: null,
    PROP_ZIP: null,
    OCC_CLS: "Commercial",
    LATITUDE: at.lat,
    LONGITUDE: at.lng,
    ...attrs,
  },
  geometry: { rings: [squareRing(at.lng, at.lat, sqft)] },
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const censusMatch = (at: { lat: number; lng: number }, matched: string) =>
  json({
    result: {
      addressMatches: [
        { coordinates: { x: at.lng, y: at.lat }, matchedAddress: matched, addressComponents: {} },
      ],
    },
  });

type Key = "Address_Points" | "Building_Footprints" | "USA_Structures" | "geocoding.geo.census.gov";
let env: ReturnType<typeof fakeSupabase>;
let urls: string[];
let inits: (RequestInit | undefined)[];
let answers: Record<Key, (url: string) => Response>;
const where = (url: string) => new URL(url).searchParams.get("where") ?? "";
const hosts = () => urls.map((u) => new URL(u).hostname);

function setup(rpcs: Record<string, () => unknown> = {}) {
  env = fakeSupabase(
    {},
    {
      rpcs: {
        service_aerial_address_candidates: () => [],
        service_aerial_buildings_near: () => [],
        ...rpcs,
      },
    },
  );
  urls = [];
  inits = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      inits.push(init);
      const key = (Object.keys(answers) as Key[]).find((k) => url.includes(k));
      if (!key) throw new Error(`unexpected fetch ${url}`);
      return answers[key](url);
    }),
  );
}
beforeEach(() => {
  answers = {
    Address_Points: () => json({ features: [] }),
    Building_Footprints: () => json({ features: [] }),
    USA_Structures: () => json({ features: [] }),
    "geocoding.geo.census.gov": () => json({ result: { addressMatches: [] } }),
  };
});
afterEach(() => vi.unstubAllGlobals());

const find = (line: string, propertyName: string | null = null) =>
  findAddressAerial(env.db, line, { propertyName });

describe("findAddressAerial: the matching order", () => {
  it("1. our stored data first, with its step named", async () => {
    setup({
      service_aerial_address_candidates: () => [
        {
          source: "point",
          id: "p1",
          address: "412 MAIN ST",
          city: "MURRAY",
          zip: "42071",
          lat: MURRAY.lat,
          lng: MURRAY.lng,
          building_id: null,
        },
      ],
    });
    const r = await find("412 main st murray ky 42071");
    expect(r.how).toBe("stored");
    expect(r.addressState).toBe("KY");
    expect(r.found).toMatchObject({ how: "address", lat: MURRAY.lat, lng: MURRAY.lng });
    expect(r.note).toBe(
      "The address is on the map but no building outline is stored there; pick the building.",
    );
    expect(urls).toEqual([]);
  });

  it("2. Kentucky's address points, from a comma-less line → the outline under the point", async () => {
    setup();
    answers.Address_Points = () => json({ features: [kyPoint()] });
    answers.Building_Footprints = () => json({ features: [footprint(MURRAY, 12000)] });
    const r = await find("412 Main St Murray KY 42071");
    expect(r.how).toBe("ky-points");
    expect(r.addressState).toBe("KY");
    expect(r.note).toBeNull();
    expect(r.candidates).toEqual([]);
    expect(r.found).toMatchObject({ how: "address", state: "KY", address: "412 MAIN ST" });
    expect(r.found!.footprint?.type).toBe("Polygon");
    expect(where(urls[0]!)).toBe("Add_Number = 412 AND LSt_Name LIKE '%MAIN%'");
    expect(urls[1]).toContain("Ky_ORNL_Building_Footprints");
    expect(urls).toHaveLength(2);
  });

  it("2. no state given: Kentucky then Tennessee, and the answer says which matched", async () => {
    setup();
    answers.USA_Structures = (url) =>
      json({
        features: where(url).includes("UPPER(PROP_ADDR) LIKE '412 %'")
          ? [
              footprint(NASHVILLE, 8000, {
                FIPS: "47037",
                PROP_ADDR: "412 MAIN ST",
                PROP_CITY: "NASHVILLE",
                PROP_ZIP: "37201",
              }),
            ]
          : [],
      });
    const r = await find("412 Main St, Nashville");
    expect(r.how).toBe("tn-structures");
    expect(r.addressState).toBe("TN");
    expect(r.found).toMatchObject({ state: "TN", address: "412 MAIN ST, NASHVILLE" });
    expect(r.found!.footprint?.type).toBe("Polygon");
    expect(urls[0]).toContain("Ky_911_Site_Structure_Address_Points");
    expect(urls[1]).toContain("USA_Structures");
    expect(urls).toHaveLength(2);
  });

  it("3. the property's name on Kentucky's landmarks (Oct 26) when the number is not there", async () => {
    setup();
    answers.Address_Points = (url) =>
      json({
        features: where(url).includes("LandmkName LIKE")
          ? [
              kyPoint(
                {
                  Add_Number: 187,
                  LSt_PreDir: "W",
                  LSt_Name: "CUMBERLAND GAP",
                  LSt_Type: "PKWY",
                  Post_Comm: "Corbin",
                  LandmkName: "ADVANCE AUTO PARTS",
                },
                CORBIN,
              ),
            ]
          : [],
      });
    const r = await find("531 E Cumberland Gap Pkwy, Corbin, KY 40701", "Advanced Auto");
    expect(r.how).toBe("by-name");
    expect(r.note).toContain("Found by name: ADVANCE AUTO PARTS, 187 W CUMBERLAND GAP PKWY.");
    expect(r.found).toMatchObject({ lat: CORBIN.lat, lng: CORBIN.lng, state: "KY" });
    expect(where(urls[1]!)).toBe(
      "LandmkName LIKE '%ADVAN%' AND LandmkName LIKE '%AUTO%' AND Post_Comm IN ('Corbin','CORBIN')",
    );
  });

  it("4. a typo in the street: the closest street name in the town is tried and reported", async () => {
    setup();
    answers.Address_Points = (url) => {
      const w = where(url);
      if (
        w.includes("returnDistinctValues") ||
        new URL(url).searchParams.get("outFields") === "LSt_Name"
      )
        return json({
          features: [
            { attributes: { LSt_Name: "CUMBERLAND GAP" } },
            { attributes: { LSt_Name: "MAIN" } },
            { attributes: { LSt_Name: "MASTER" } },
          ],
        });
      if (w.includes("LIKE '%CUMBERLAND%'"))
        return json({
          features: [
            kyPoint(
              {
                Add_Number: 531,
                LSt_PreDir: "E",
                LSt_Name: "CUMBERLAND GAP",
                LSt_Type: "PKWY",
                Post_Comm: "Corbin",
              },
              CORBIN,
            ),
          ],
        });
      return json({ features: [] });
    };
    const r = await find("531 E Cumberlnd Gap Pkwy, Corbin, KY");
    expect(r.how).toBe("corrected-street");
    expect(r.note).toContain("Searched Cumberland Gap (you typed Cumberlnd Gap)");
    expect(r.found).toMatchObject({ address: "531 E CUMBERLAND GAP PKWY", state: "KY" });
    const wheres = urls.map(where);
    expect(wheres[0]).toBe("Add_Number = 531 AND LSt_Name LIKE '%CUMBERLND%'");
    expect(wheres[1]).toBe("Post_Comm IN ('Corbin','CORBIN')");
    expect(new URL(urls[1]!).searchParams.get("returnDistinctValues")).toBe("true");
    expect(wheres[2]).toBe("Add_Number = 531 AND LSt_Name LIKE '%CUMBERLAND%'");
  });

  it("5. the nearest numbers on the street, where Pick the building opens", async () => {
    setup();
    answers.Address_Points = (url) =>
      json({
        features:
          where(url).includes("Post_Comm IN") && where(url).includes("LSt_Name LIKE")
            ? [
                kyPoint({ Add_Number: 400 }, { lat: 36.611, lng: -88.315 }),
                kyPoint({ Add_Number: 420 }, { lat: 36.6116, lng: -88.3154 }),
              ]
            : [],
      });
    const r = await find("412 Main St, Murray, KY 42071");
    expect(r.how).toBe("nearest");
    expect(r.found).toBeNull();
    expect(r.near!.lat).toBeCloseTo(36.6113, 4);
    expect(r.note).toBe(
      "Nothing at 412 on Main St in Murray; the map opens at 400–420 Main St — pick the building.",
    );
    expect(hosts()).not.toContain("geocoding.geo.census.gov");
  });

  it("6. the Census geocoder last: its point in Kentucky → the footprint there", async () => {
    setup();
    answers["geocoding.geo.census.gov"] = () =>
      censusMatch(MURRAY, "412 MAIN ST, MURRAY, KY, 42071");
    answers.Building_Footprints = () => json({ features: [footprint(MURRAY, 9000)] });
    const r = await find("412 Main St, Murray, KY 42071");
    expect(r.how).toBe("census");
    expect(r.addressState).toBe("KY");
    expect(r.found).toMatchObject({ state: "KY", how: "picked" });
    expect(r.found!.footprint?.type).toBe("Polygon");
    expect(r.note).toContain(
      "No building or 911 address point in our map data matches this address.",
    );
    expect(r.note).toContain("Found by the Census geocoder at 412 MAIN ST, MURRAY, KY, 42071");
    const census = urls.findIndex((u) => u.includes("geocoding.geo.census.gov"));
    expect(census).toBeGreaterThan(0);
    const u = new URL(urls[census]!);
    expect(u.pathname).toBe("/geocoder/locations/onelineaddress");
    expect(u.searchParams.get("address")).toBe("412 Main St, Murray, KY 42071");
    expect(u.searchParams.get("benchmark")).toBe("Public_AR_Current");
    expect(u.searchParams.get("format")).toBe("json");
    // A 6 s timeout, so a slow geocoder cannot hold the lookup.
    expect(inits[census]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("6. the Census point outside the imagery: the point and a note, nothing drawn", async () => {
    setup();
    answers["geocoding.geo.census.gov"] = () =>
      censusMatch({ lat: 39.9612, lng: -82.9988 }, "100 HIGH ST, COLUMBUS, OH, 43215");
    const r = await find("100 High St, Columbus, OH 43215");
    expect(r.how).toBe("census");
    expect(r.found).toBeNull();
    expect(r.near).toEqual({ lat: 39.9612, lng: -82.9988 });
    expect(r.note).toBe(
      "OH is outside the Kentucky / Tennessee imagery. Found by the Census geocoder (100 HIGH ST, COLUMBUS, OH, 43215); outside the Kentucky / Tennessee imagery.",
    );
    // Another state named: none of our layers were asked.
    expect(hosts()).toEqual(["geocoding.geo.census.gov"]);
  });

  it("6. the Census geocoder down, or the state server down: a note, no crash", async () => {
    setup();
    answers["geocoding.geo.census.gov"] = () => {
      throw new Error("ECONNRESET");
    };
    const r = await find("412 Main St, Murray, KY 42071");
    expect(r.found).toBeNull();
    expect(r.how).toBeNull();
    expect(r.note).toBe(
      "No building or 911 address point in our map data matches this address. The Census geocoder could not be reached.",
    );
    setup();
    answers["geocoding.geo.census.gov"] = () => json({ result: { addressMatches: [] } });
    answers.Address_Points = () => new Response("down", { status: 503, statusText: "Unavailable" });
    const down = await find("412 Main St, Murray, KY 42071");
    expect(down.found).toBeNull();
    expect(down.note).toContain(
      "Kentucky's address points: 503 Unavailable from kygisserver.ky.gov.",
    );
    expect(down.note).toContain("The Census geocoder has no match for it either.");
  });
});

describe("findAddressAerial: ties, places, points, refusals", () => {
  it("two different places tie → candidates to choose from, not a failure", async () => {
    setup();
    answers.Address_Points = () =>
      json({
        features: [kyPoint(), kyPoint({ Post_Comm: "MAYFIELD", Post_Code: "42066" }, MAYFIELD)],
      });
    const r = await find("412 Main St, KY");
    expect(r.found).toBeNull();
    expect(r.how).toBe("ky-points");
    expect(r.note).toBe("2 places match that address — pick the one you mean.");
    expect(r.candidates).toEqual([
      {
        address: "412 MAIN ST",
        city: "MURRAY",
        state: "KY",
        lat: expect.closeTo(MURRAY.lat, 4),
        lng: expect.closeTo(MURRAY.lng, 4),
        how: "ky-points",
      },
      {
        address: "412 MAIN ST",
        city: "MAYFIELD",
        state: "KY",
        lat: expect.closeTo(MAYFIELD.lat, 4),
        lng: expect.closeTo(MAYFIELD.lng, 4),
        how: "ky-points",
      },
    ]);
    // The town, when typed, breaks the tie as before (the single-match path is unchanged).
    setup();
    answers.Address_Points = () =>
      json({
        features: [kyPoint(), kyPoint({ Post_Comm: "MAYFIELD", Post_Code: "42066" }, MAYFIELD)],
      });
    const one = await find("412 Main St, Mayfield, KY");
    expect(one.candidates).toEqual([]);
    expect(one.found).toMatchObject({ lat: MAYFIELD.lat, lng: MAYFIELD.lng });
  });

  it("a place name goes to the landmarks in its town; with no town, statewide", async () => {
    setup();
    answers.Address_Points = () =>
      json({
        features: [
          kyPoint(
            {
              Add_Number: 187,
              LSt_PreDir: "W",
              LSt_Name: "CUMBERLAND GAP",
              LSt_Type: "PKWY",
              Post_Comm: "Corbin",
              LandmkName: "ADVANCE AUTO PARTS",
            },
            CORBIN,
          ),
        ],
      });
    const r = await find("Advance Auto Parts, Corbin KY");
    expect(r.how).toBe("by-name");
    expect(r.found).toMatchObject({ address: "187 W CUMBERLAND GAP PKWY", state: "KY" });
    expect(where(urls[0]!)).toBe(
      "LandmkName LIKE '%ADVAN%' AND LandmkName LIKE '%AUTO%' AND LandmkName LIKE '%PARTS%' AND Post_Comm IN ('Corbin','CORBIN')",
    );
    expect(env.rpcCalls.map((c) => c.fn)).not.toContain("service_aerial_address_candidates");

    setup();
    answers.Address_Points = () =>
      json({
        features: [
          kyPoint({ Post_Comm: "Corbin", LandmkName: "CORBIN HIGH SCHOOL" }, CORBIN),
          kyPoint({ Post_Comm: "Corbin", LandmkName: "CORBIN HIGH SCHOOL GYM" }, CORBIN),
        ],
      });
    const school = await find("Corbin High School");
    expect(school.how).toBe("by-name");
    expect(where(urls[0]!)).toBe(
      "LandmkName LIKE '%CORBI%' AND LandmkName LIKE '%HIGH%' AND LandmkName LIKE '%SCHOO%'",
    );
    // Two points of one building are one place.
    expect(school.candidates).toEqual([]);
  });

  it("coordinates and a Google Maps link go straight to the footprint at the point", async () => {
    setup();
    answers.Building_Footprints = () => json({ features: [footprint(MURRAY, 9000)] });
    const r = await find("36.6103, -88.3148");
    expect(r.how).toBe("point");
    expect(r.found).toMatchObject({ state: "KY", how: "picked" });
    expect(r.found!.footprint?.type).toBe("Polygon");
    expect(r.note).toBeNull();
    expect(env.rpcCalls.map((c) => c.fn)).toEqual(["service_aerial_buildings_near"]);
    const link = await find("https://www.google.com/maps/@36.6103,-88.3148,19z");
    expect(link.how).toBe("point");
    expect(link.found!.footprint?.type).toBe("Polygon");
    // No outline at the point: the bare point with a note, not an error.
    setup();
    answers.Building_Footprints = () => json({ features: [] });
    const bare = await find("36.6103 -88.3148");
    expect(bare.found).toMatchObject({ footprint: null, lat: 36.6103, lng: -88.3148, state: "KY" });
    expect(bare.note).toBe(
      "No building outline at that spot; drag the picture onto the roof, or pick the building on the map.",
    );
  });

  it("a clicked candidate is looked up at its point", async () => {
    setup();
    answers.Building_Footprints = () => json({ features: [footprint(MAYFIELD, 7000)] });
    const r = await pointAerial(env.db, MAYFIELD, "picked", "412 MAIN ST, MAYFIELD, KY");
    expect(r.how).toBe("picked");
    expect(r.address).toBe("412 MAIN ST, MAYFIELD, KY");
    expect(r.found!.footprint?.type).toBe("Polygon");
  });

  it("an intersection, an empty line and a bare map link are refused with their messages, no server asked", async () => {
    setup();
    expect((await find("Main St & 5th Ave, Murray KY")).note).toBe(INTERSECTION_MESSAGE);
    expect((await find("   ")).note).toBe(
      "Type an address, a business name or coordinates to find.",
    );
    expect((await find("https://www.google.com/maps/place/Corbin,+KY")).note).toContain(
      "That map link carries no coordinates",
    );
    expect(urls).toEqual([]);
    expect(env.rpcCalls).toEqual([]);
  });
});

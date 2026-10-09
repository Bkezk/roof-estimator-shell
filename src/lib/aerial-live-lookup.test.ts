/**
 * Owner, Oct 9: a ticket's Aerial section found its building only in OUR stored map data, which
 * was loaded with a 5,000 sq ft floor (Tennessee strictly; Kentucky keeps the 911 points that
 * read commercial or sit near a stored building), so a small property read "No aerial for this
 * address" although the state servers have every building. When the stored lookup has no match,
 * getTicketAerial now asks the live state layers for the address, with no size floor, and the
 * aerial opens by itself on the outline it finds. Pinned here through the fake Supabase (the rpc
 * answers nothing) with `fetch` standing in for the state servers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { getTicketAerial, type TicketAerial } from "@/lib/service-aerial.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "b1111111-1111-4111-8111-111111111111";

// ── A small square building in Web Mercator (the layers' projection) ───────────────────────

const R = 6378137;
const toMercator = (lng: number, lat: number): [number, number] => [
  (lng * Math.PI * R) / 180,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];
/** A square of `sqft` on the ground centred at lng/lat, as an ArcGIS Mercator ring. */
function squareRing(lng: number, lat: number, sqft: number): number[][] {
  const [x, y] = toMercator(lng, lat);
  // Mercator stretches by 1 / cos(lat); the ring's Mercator side is the ground side scaled up.
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

const KY_AT = { lat: 36.6103, lng: -88.3148 };
const TN_AT = { lat: 36.2074, lng: -86.7823 };

/** One Kentucky 911 point feature, as the state layer sends it (geometry in Mercator). */
const kyPoint = (over: Row = {}) => {
  const [x, y] = toMercator(KY_AT.lng, KY_AT.lat);
  return {
    attributes: {
      OBJECTID: 7,
      Site_NGUID: "SSAP7@calloway.ky",
      AddNum_Pre: null,
      Add_Number: 412,
      AddNum_Suf: " ",
      LSt_PreDir: " ",
      LSt_Name: "MAIN",
      LSt_Type: "ST",
      LSt_PosDir: " ",
      Post_Comm: "MURRAY",
      Post_Code: "42071",
      Inc_Muni: "MURRAY",
      County: "Calloway County",
      LandmkName: null,
      Place_Type: "Residential",
      Lat: null,
      Long: null,
      ...over,
    },
    geometry: { x, y },
  };
};
/** One ORNL footprint feature (both layers share the schema). */
const footprint = (at: { lat: number; lng: number }, sqft: number, attrs: Row = {}) => ({
  attributes: {
    BUILD_ID: 991,
    SQFEET: sqft,
    HEIGHT: null,
    FIPS: "21035",
    PROP_ADDR: null,
    PROP_CITY: null,
    PROP_ZIP: null,
    OCC_CLS: "Residential",
    PRIM_OCC: null,
    LATITUDE: at.lat,
    LONGITUDE: at.lng,
    UUID: null,
    ...attrs,
  },
  geometry: { rings: [squareRing(at.lng, at.lat, sqft)] },
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let env: ReturnType<typeof fakeSupabase>;
let fetchMock: ReturnType<typeof vi.fn>;
let urls: string[];
/** The state servers: one answer per layer, keyed by a piece of the layer URL. */
let answers: Record<"Address_Points" | "Building_Footprints" | "USA_Structures", () => Response>;

function setup(address: string, siteState: string | null = null) {
  env = fakeSupabase({
    profiles: [
      {
        id: ME,
        role: "user",
        access: ["service"],
        technician: true,
        full_name: "Tech",
        email: "t@x",
      },
    ],
    service_jobs: [
      {
        id: JOB,
        number: 101,
        site_id: siteState ? "site-1" : null,
        site_address: address,
        account_id: null,
        technician_id: ME,
        stage: "scheduled",
      },
    ],
    crm_sites: siteState
      ? [{ id: "site-1", address1: "x", address2: null, city: null, state: siteState, zip: null }]
      : [],
    service_job_photos: [],
  });
  urls = [];
  fetchMock = vi.fn(async (url: string) => {
    urls.push(url);
    const key = (Object.keys(answers) as (keyof typeof answers)[]).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch ${url}`);
    return answers[key]();
  });
  vi.stubGlobal("fetch", fetchMock);
}
/** The where clause a state server was sent. */
const where = (url: string) => new URL(url).searchParams.get("where");
const noRpcMatch = { service_aerial_address_candidates: () => [] };
beforeEach(() => {
  answers = {
    Address_Points: () => json({ features: [] }),
    Building_Footprints: () => json({ features: [] }),
    USA_Structures: () => json({ features: [] }),
  };
});
afterEach(() => vi.unstubAllGlobals());

const run = async (): Promise<TicketAerial> =>
  (getTicketAerial as unknown as (a: { data: Row; context: unknown }) => Promise<TicketAerial>)({
    data: { id: JOB },
    context: { supabase: env.db, userId: ME },
  });

const withRpcs = (rpcs: Record<string, () => unknown>) => {
  env = fakeSupabase(env.tables, { rpcs });
};

describe("getTicketAerial falls back to the live state layers (owner, Oct 9)", () => {
  it("Kentucky: a 1,200 sq ft house our data never stored opens on its outline", async () => {
    setup("412 Main St, Murray, KY 42071");
    withRpcs(noRpcMatch);
    answers.Address_Points = () => json({ features: [kyPoint()] });
    answers.Building_Footprints = () => json({ features: [footprint(KY_AT, 1200)] });
    const r = await run();
    expect(r.addressState).toBe("KY");
    expect(r.note).toBeNull();
    expect(r.found).not.toBeNull();
    expect(r.found!.how).toBe("address");
    expect(r.found!.state).toBe("KY");
    expect(r.found!.id).toBeNull();
    expect(r.found!.footprint?.type).toBe("Polygon");
    expect(r.found!.areaSqFt).toBeGreaterThan(1200 - 60);
    expect(r.found!.areaSqFt).toBeLessThan(1200 + 60);
    expect(r.found!.address).toBe("412 MAIN ST");
    expect(r.found!.lat).toBeCloseTo(KY_AT.lat, 3);
    expect(r.found!.lng).toBeCloseTo(KY_AT.lng, 3);
    // The 911 points by address first, then the outline under the matched point; nothing in TN.
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("Ky_911_Site_Structure_Address_Points");
    expect(where(urls[0]!)).toBe("Add_Number = 412 AND LSt_Name LIKE '%MAIN%'");
    expect(urls[1]).toContain("Ky_ORNL_Building_Footprints");
    expect(env.rpcCalls.map((c) => c.fn)).toEqual(["service_aerial_address_candidates"]);
  });

  it("Kentucky: the point is on the state map but no outline covers it → the point, and a note", async () => {
    setup("412 Main St, Murray, KY 42071");
    withRpcs(noRpcMatch);
    answers.Address_Points = () => json({ features: [kyPoint()] });
    const r = await run();
    expect(r.found).toMatchObject({
      id: null,
      footprint: null,
      how: "address",
      state: "KY",
      address: "412 MAIN ST",
      areaSqFt: null,
    });
    expect(r.found!.lat).toBeCloseTo(KY_AT.lat, 3);
    expect(r.note).toBe(
      "The address is on the state map but no building outline covers it; pick the building.",
    );
  });

  it("Kentucky: a point that is a different street with the same number is not taken", async () => {
    setup("412 Main St, Murray, KY 42071");
    withRpcs(noRpcMatch);
    answers.Address_Points = () => json({ features: [kyPoint({ LSt_Name: "MAINARD" })] });
    const r = await run();
    expect(r.found).toBeNull();
    expect(r.note).toBe("No building or 911 address point in our map data matches this address.");
  });

  it("Tennessee: the structure carrying the address is the outline, no size floor", async () => {
    setup("88 Elm Street, Nashville, TN 37207");
    withRpcs(noRpcMatch);
    answers.USA_Structures = () =>
      json({
        features: [
          footprint(TN_AT, 1200, {
            BUILD_ID: 5,
            FIPS: "47037",
            PROP_ADDR: "88 ELM ST",
            PROP_CITY: "NASHVILLE",
            PROP_ZIP: "37207",
          }),
          // A decoy on another street with the same number.
          footprint({ lat: 36.3, lng: -86.9 }, 900, {
            BUILD_ID: 6,
            FIPS: "47037",
            PROP_ADDR: "88 ELMWOOD AVE",
            PROP_CITY: "NASHVILLE",
          }),
        ],
      });
    const r = await run();
    expect(r.addressState).toBe("TN");
    expect(r.note).toBeNull();
    expect(r.found).toMatchObject({
      id: null,
      how: "address",
      state: "TN",
      address: "88 ELM ST, NASHVILLE",
    });
    expect(r.found!.footprint?.type).toBe("Polygon");
    expect(r.found!.areaSqFt).toBeGreaterThan(1200 - 60);
    expect(r.found!.areaSqFt).toBeLessThan(1200 + 60);
    expect(r.found!.lat).toBeCloseTo(TN_AT.lat, 3);
    expect(urls).toHaveLength(1);
    expect(where(urls[0]!)).toBe(
      "UPPER(PROP_ADDR) LIKE '88 %' AND UPPER(PROP_ADDR) LIKE '%ELM%' AND FIPS LIKE '47%'",
    );
  });

  it("an address with no state asks Kentucky, then Tennessee", async () => {
    setup("88 Elm Street");
    withRpcs(noRpcMatch);
    answers.USA_Structures = () =>
      json({
        features: [footprint(TN_AT, 1200, { BUILD_ID: 5, FIPS: "47037", PROP_ADDR: "88 ELM ST" })],
      });
    const r = await run();
    expect(r.addressState).toBeNull();
    expect(r.found?.state).toBe("TN");
    expect(r.found?.areaSqFt).toBeGreaterThan(1000);
    expect(urls.map((u) => (u.includes("Address_Points") ? "ky" : "tn"))).toEqual(["ky", "tn"]);
  });

  it("the state server failing leaves the ticket as before: nothing found, the old note, no throw", async () => {
    setup("412 Main St, Murray, KY 42071");
    withRpcs(noRpcMatch);
    answers.Address_Points = () => {
      throw new TypeError("fetch failed");
    };
    const r = await run();
    expect(r.found).toBeNull();
    expect(r.note).toBe("No building or 911 address point in our map data matches this address.");
    // An ArcGIS error body is swallowed the same way.
    setup("412 Main St, Murray, KY 42071");
    withRpcs(noRpcMatch);
    answers.Address_Points = () => json({ error: { code: 400, message: "Invalid query" } });
    expect((await run()).found).toBeNull();
  });

  it("our stored data still wins: a stored match never reaches the state server", async () => {
    setup("412 Main St, Murray, KY 42071");
    withRpcs({
      service_aerial_address_candidates: () => [
        {
          source: "point",
          id: "p1",
          address: "412 MAIN ST",
          city: "MURRAY",
          zip: "42071",
          lat: KY_AT.lat,
          lng: KY_AT.lng,
          building_id: null,
        },
      ],
      service_aerial_buildings_near: () => [],
    });
    const r = await run();
    expect(r.found?.how).toBe("address");
    expect(r.note).toBe(
      "The address is on the map but no building outline is stored there; pick the building.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an ambiguous stored match keeps its note and does not go live", async () => {
    setup("412 Main St, Murray, KY 42071");
    const cand = (id: string, lat: number) => ({
      source: "point",
      id,
      address: "412 MAIN ST",
      city: null,
      zip: null,
      lat,
      lng: KY_AT.lng,
      building_id: null,
    });
    withRpcs({
      service_aerial_address_candidates: () => [cand("a", 36.61), cand("b", 37.2)],
    });
    const r = await run();
    expect(r.found).toBeNull();
    expect(r.note).toBe(
      "The address matches 2 places in our map data; pick the building on the map.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

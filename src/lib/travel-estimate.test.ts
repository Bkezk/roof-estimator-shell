/**
 * Owner, Oct 9: "can we add an automated travel to the time section that tracks the distance
 * between the jbk office and the location on the ticket and calculates the drive time and
 * prefills from there? if its missing any info its just empty as it is now."
 *
 * The arithmetic (travel-estimate.ts), the server function through the fake Supabase with the
 * state servers and the routers stubbed (estimateTravel: a hit returns numbers; a missing site
 * address, no office address or no geocode hit is null; no Service access throws), and the Time
 * section's prefilled form on the close-out (field-shared.tsx TimeEntries, closeout.tsx) — not
 * on the office ticket page.
 *
 * Later the same day: "can we have it do the routed drive to have more accurate time and it
 * should use the address in the customer profile." The server asks a router first (drive-route
 * .ts: Google with its key, else OSRM) and says "(routed)"; the straight-line arithmetic stays as
 * the fallback, "(estimated)". The destination is the ticket's property address when it has a
 * street line, else the customer's physical address (crm_accounts), else null.
 *
 * Later still: "i just made a ticket with the site 2 property and the drive time wasnt auto
 * added to the close out." The live main address is "PO Box 466, Corbin, KY 40702" — no house
 * number, so the office never geocoded and the estimate was null for every ticket. The origin
 * is now travelOrigin: the shop_* street (20261009160000_shop_address.sql) when set, else the
 * main address when it is a street, else null; the main address stays the PO box the invoice
 * prints.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/ticket-events.server", () => ({ afterTicketStage: vi.fn(async () => {}) }));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => {}) }));

import {
  AVERAGE_MPH,
  ROAD_FACTOR,
  driveMinutes,
  estimateTravelBetween,
  haversineMiles,
  officeAddressLine,
  roadMiles,
  travelFromRoute,
  travelHours,
  travelNote,
  travelOrigin,
} from "@/lib/travel-estimate";
import { GOOGLE_ROUTES_URL, OSRM_ROUTE_BASE, osrmRouteUrl } from "@/lib/drive-route";
import { estimateTravel } from "@/lib/service-field.functions";
import { clearGeocodeCache } from "@/lib/service-aerial.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const LONDON = { lat: 37.1287, lng: -84.0833 };
const CORBIN = { lat: 36.9487, lng: -84.0969 };

describe("travel-estimate: the arithmetic", () => {
  it("haversineMiles: London KY → Corbin KY is about 12.4 straight-line miles, symmetric, zero to itself", () => {
    const d = haversineMiles(LONDON, CORBIN);
    expect(d).toBeGreaterThan(12.2);
    expect(d).toBeLessThan(12.6);
    expect(haversineMiles(CORBIN, LONDON)).toBeCloseTo(d, 9);
    expect(haversineMiles(LONDON, LONDON)).toBe(0);
    // A degree of latitude is about 69 miles.
    expect(haversineMiles({ lat: 36, lng: -84 }, { lat: 37, lng: -84 })).toBeCloseTo(69.1, 0);
  });
  it("roadMiles stretches the straight line by ROAD_FACTOR (1.25), to a tenth", () => {
    expect(ROAD_FACTOR).toBe(1.25);
    expect(roadMiles(12.4)).toBe(15.5);
    expect(roadMiles(10)).toBe(12.5);
    expect(roadMiles(0)).toBe(0);
  });
  it("driveMinutes: road miles at AVERAGE_MPH (45), rounded UP to the next 5 minutes", () => {
    expect(AVERAGE_MPH).toBe(45);
    expect(driveMinutes(15.5)).toBe(25); // 20.67 min → 25
    expect(driveMinutes(45)).toBe(60); // exactly an hour stays an hour
    expect(driveMinutes(0.1)).toBe(5); // any trip is at least five minutes
    expect(driveMinutes(0)).toBe(0);
    expect(driveMinutes(90)).toBe(120);
  });
  it("travelHours: round trip by default, to 2 dp; one way when asked", () => {
    expect(travelHours(25)).toBe(0.83);
    expect(travelHours(25, false)).toBe(0.42);
    expect(travelHours(60)).toBe(2);
    expect(travelHours(35)).toBe(1.17);
  });
  it("travelNote reads 'Office → site ≈ 23 mi, 35 min each way (estimated)', or '(routed)' from a router", () => {
    expect(travelNote(23, 35)).toBe("Office → site ≈ 23 mi, 35 min each way (estimated)");
    expect(travelNote(15.5, 25)).toBe("Office → site ≈ 16 mi, 25 min each way (estimated)");
    expect(travelNote(23, 35, "routed")).toBe("Office → site ≈ 23 mi, 35 min each way (routed)");
    expect(travelNote(23, 35, "estimated")).toBe(
      "Office → site ≈ 23 mi, 35 min each way (estimated)",
    );
  });
  it("estimateTravelBetween composes the four, marked estimated; the same spot is no trip (null)", () => {
    const e = estimateTravelBetween(LONDON, CORBIN)!;
    expect(e).toEqual({
      miles: 15.6,
      minutes: 25,
      hours: 0.83,
      note: "Office → site ≈ 16 mi, 25 min each way (estimated)",
      source: "estimated",
    });
    expect(estimateTravelBetween(LONDON, LONDON)).toBeNull();
  });
  it("travelFromRoute: a router's miles and minutes, the same round-trip hours, marked routed; 0 minutes is null", () => {
    expect(travelFromRoute({ miles: 23, minutes: 35 })).toEqual({
      miles: 23,
      minutes: 35,
      hours: 1.17,
      note: "Office → site ≈ 23 mi, 35 min each way (routed)",
      source: "routed",
    });
    expect(travelFromRoute({ miles: 0, minutes: 0 })).toBeNull();
  });
  it("officeAddressLine joins company_settings' address, city, state and zip; no street → ''", () => {
    expect(
      officeAddressLine({ address: "200 Main St", city: "London", state: "KY", zip: "40744" }),
    ).toBe("200 Main St, London, KY 40744");
    expect(officeAddressLine({ address: "200 Main St", city: null, state: null, zip: null })).toBe(
      "200 Main St",
    );
    expect(officeAddressLine({ address: "  ", city: "London", state: "KY", zip: "40744" })).toBe(
      "",
    );
    expect(officeAddressLine({ address: null, city: "London", state: "KY", zip: null })).toBe("");
  });
});

// ── Where the truck leaves from (owner, Oct 9: the main address is a PO box) ───────────────────

describe("travelOrigin: the shop's street, else the main address when it is a street, else null", () => {
  /** The live row (company_settings id 1): the invoice header's PO box. */
  const PO_BOX = { address: "PO Box 466", city: "Corbin", state: "KY", zip: "40702" };
  const STREET = { address: "200 Main St", city: "London", state: "KY", zip: "40744" };
  const NO_SHOP = { shop_address: null, shop_city: null, shop_state: null, shop_zip: null };
  const SHOP = {
    shop_address: "100 Depot St",
    shop_city: "Corbin",
    shop_state: "KY",
    shop_zip: "40701",
  };
  it("a PO-box main address and no shop → null (the bug: nothing to geocode)", () => {
    expect(travelOrigin({ ...PO_BOX, ...NO_SHOP })).toBeNull();
    // Blank shop boxes count as none; so does a row read before the migration (no shop keys).
    expect(
      travelOrigin({ ...PO_BOX, shop_address: "  ", shop_city: "", shop_state: "", shop_zip: "" }),
    ).toBeNull();
    expect(travelOrigin(PO_BOX)).toBeNull();
  });
  it("a PO-box main address and a shop street → the shop, with its state as the geocoder's hint", () => {
    expect(travelOrigin({ ...PO_BOX, ...SHOP })).toEqual({
      line: "100 Depot St, Corbin, KY 40701",
      state: "KY",
    });
    expect(travelOrigin({ ...PO_BOX, ...SHOP, shop_state: "TN", shop_zip: null })).toEqual({
      line: "100 Depot St, Corbin, TN",
      state: "TN",
    });
    // A shop with only a street and city borrows the main address's state for the hint.
    expect(
      travelOrigin({
        ...PO_BOX,
        shop_address: "100 Depot St",
        shop_city: "Corbin",
        shop_state: "",
      }),
    ).toEqual({ line: "100 Depot St, Corbin", state: "KY" });
  });
  it("a street main address and no shop → the main address (as before the shop existed)", () => {
    expect(travelOrigin({ ...STREET, ...NO_SHOP })).toEqual({
      line: "200 Main St, London, KY 40744",
      state: "KY",
    });
    expect(travelOrigin(STREET)).toEqual({ line: "200 Main St, London, KY 40744", state: "KY" });
  });
  it("a shop that is itself a PO box falls to the main address when that is a street; two PO boxes → null", () => {
    expect(
      travelOrigin({ ...STREET, ...SHOP, shop_address: "PO Box 9", shop_city: "Lexington" }),
    ).toEqual({ line: "200 Main St, London, KY 40744", state: "KY" });
    expect(travelOrigin({ ...PO_BOX, ...SHOP, shop_address: "PO Box 9" })).toBeNull();
  });
  it("the shop wins over a street main address when both are streets (the trucks park at the shop)", () => {
    expect(travelOrigin({ ...STREET, ...SHOP })).toEqual({
      line: "100 Depot St, Corbin, KY 40701",
      state: "KY",
    });
  });
});

// ── estimateTravel on the server ──────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALES = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB = "c1111111-1111-4111-8111-111111111111";
const OFFICE = { id: 1, address: "200 Main St", city: "London", state: "KY", zip: "40744" };
const cand = (house: string, street: string, at: { lat: number; lng: number }) => ({
  source: "point",
  id: `${house}-${street}`,
  address: `${house} ${street}`,
  city: null,
  zip: null,
  lat: at.lat,
  lng: at.lng,
  building_id: null,
});
/** Our stored map data: the office at London, the site at Corbin, nothing else. */
const storedRpc = {
  service_aerial_address_candidates: (args: Row) =>
    args["p_house"] === "200"
      ? [cand("200", "MAIN ST", LONDON)]
      : args["p_house"] === "100"
        ? [cand("100", "DEPOT ST", CORBIN)]
        : [],
};

/** A routed answer: 23.0 road miles in 33 min 20 s, as OSRM and Google each report it. */
const OSRM_OK = { code: "Ok", routes: [{ distance: 37015, duration: 2000 }] };
const GOOGLE_OK = { routes: [{ distanceMeters: 37015, duration: "2000s" }] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let env: ReturnType<typeof fakeSupabase>;
let fetchMock: ReturnType<typeof vi.fn>;
/** What fetch was asked, by host: the routers and the state layers are told apart by URL. */
const fetched = () => fetchMock.mock.calls.map((c) => String(c[0]));
const osrmCalls = () => fetched().filter((u) => u.startsWith(OSRM_ROUTE_BASE));
const googleCalls = () => fetched().filter((u) => u.startsWith(GOOGLE_ROUTES_URL));
const layerCalls = () =>
  fetched().filter((u) => !u.startsWith(OSRM_ROUTE_BASE) && !u.startsWith(GOOGLE_ROUTES_URL));
function world(over: {
  office?: Row | null;
  job?: Row;
  sites?: Row[];
  accounts?: Row[];
  rpcs?: Record<string, (args: Row) => unknown>;
  /** The routers' answers; by default OSRM finds no route and Google is not configured. */
  osrm?: () => Promise<Response>;
  google?: () => Promise<Response>;
}) {
  env = fakeSupabase(
    {
      profiles: [
        {
          id: ME,
          role: "user",
          access: ["service"],
          technician: true,
          full_name: "T",
          email: "t@x",
        },
        {
          id: SALES,
          role: "user",
          access: ["sales"],
          technician: false,
          full_name: "S",
          email: "s@x",
        },
      ],
      company_settings: over.office === null ? [] : [over.office ?? OFFICE],
      service_jobs: [
        over.job ?? {
          id: JOB,
          site_id: null,
          site_address: "100 Depot St, Corbin, KY 40701",
          technician_id: ME,
        },
      ],
      crm_sites: over.sites ?? [],
      crm_accounts: over.accounts ?? [],
    },
    { rpcs: over.rpcs ?? storedRpc },
  );
  // The routers (OSRM: no route unless the test says; Google: never expected without a key) and
  // the state servers (the live geocode fallback): nothing found anywhere.
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith(OSRM_ROUTE_BASE))
      return over.osrm ? over.osrm() : json({ code: "NoRoute", routes: [] });
    if (url.startsWith(GOOGLE_ROUTES_URL)) {
      if (!over.google) throw new Error("test: Google was asked without a key");
      return over.google();
    }
    return json({ features: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
}
const run = (who = ME) =>
  (estimateTravel as unknown as (a: { data: Row; context: unknown }) => Promise<unknown>)({
    data: { id: JOB },
    context: { supabase: env.db, userId: who },
  });
beforeEach(() => {
  clearGeocodeCache();
  // No Google key in the test process unless a test sets one.
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("estimateTravel (the server)", () => {
  it("office and site both in our map data, no router: road miles, minutes, round-trip hours and the '(estimated)' note", async () => {
    world({});
    expect(await run()).toEqual({
      miles: 15.6,
      minutes: 25,
      hours: 0.83,
      note: "Office → site ≈ 16 mi, 25 min each way (estimated)",
      source: "estimated",
    });
    // Both addresses went through the stored-data rpc; the state servers were not needed. The
    // only fetch was OSRM, asked once for the two points (lng,lat;lng,lat).
    expect(env.rpcCalls.map((c) => c.args["p_house"]).sort()).toEqual(["100", "200"]);
    expect(layerCalls()).toEqual([]);
    expect(googleCalls()).toEqual([]);
    expect(osrmCalls()).toEqual([osrmRouteUrl(LONDON, CORBIN)]);
  });
  it("OSRM answers: its road miles and minutes, the same round-trip hours, '(routed)'", async () => {
    world({ osrm: async () => json(OSRM_OK) });
    expect(await run()).toEqual({
      miles: 23,
      minutes: 35,
      hours: 1.17,
      note: "Office → site ≈ 23 mi, 35 min each way (routed)",
      source: "routed",
    });
  });
  it("OSRM down (network error, 5xx, junk) → the straight-line estimate, never an error", async () => {
    for (const osrm of [
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => new Response("<html>502</html>", { status: 502 }),
      async () => json({ message: "Too Many Requests" }, 429),
    ]) {
      world({ osrm });
      expect(await run()).toMatchObject({ miles: 15.6, minutes: 25, source: "estimated" });
    }
  });
  it("with GOOGLE_MAPS_API_KEY set (Lovable Cloud › Secrets): Google Routes first, in the header; OSRM only if Google fails", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    world({ google: async () => json(GOOGLE_OK) });
    expect(await run()).toMatchObject({ miles: 23, minutes: 35, hours: 1.17, source: "routed" });
    expect(googleCalls()).toEqual([GOOGLE_ROUTES_URL]);
    expect(osrmCalls()).toEqual([]);
    const init = fetchMock.mock.calls.find((c) => String(c[0]) === GOOGLE_ROUTES_URL)![1] as {
      method: string;
      headers: Record<string, string>;
    };
    expect(init.method).toBe("POST");
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(init.headers["X-Goog-FieldMask"]).toBe("routes.distanceMeters,routes.duration");
    // Google refusing → OSRM.
    world({
      google: async () => json({ error: { code: 403, message: "PERMISSION_DENIED" } }, 403),
      osrm: async () => json(OSRM_OK),
    });
    expect(await run()).toMatchObject({ miles: 23, minutes: 35, source: "routed" });
    expect(googleCalls()).toHaveLength(1);
    expect(osrmCalls()).toHaveLength(1);
    // Both failing → estimated.
    world({ google: async () => json({ routes: [] }) });
    expect(await run()).toMatchObject({ miles: 15.6, minutes: 25, source: "estimated" });
  });
  it("the site's address comes from its crm_sites row when the ticket has none typed", async () => {
    world({
      job: { id: JOB, site_id: "site-1", site_address: null, technician_id: ME },
      sites: [
        {
          id: "site-1",
          address1: "100 Depot St",
          address2: null,
          city: "Corbin",
          state: "KY",
          zip: "40701",
        },
      ],
    });
    expect(await run()).toMatchObject({ miles: 15.6, minutes: 25, hours: 0.83 });
  });
  it("no site address and no customer → null, and nothing is geocoded or routed for it", async () => {
    world({ job: { id: JOB, site_id: null, site_address: "   ", technician_id: ME } });
    expect(await run()).toBeNull();
    expect(env.rpcCalls.map((c) => c.args["p_house"])).not.toContain("100");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── Where the truck goes (owner, Oct 9: "it should use the address in the customer profile")
  const ACCOUNT = "e3333333-3333-4333-8333-333333333333";
  const corbinAccount = (over: Row = {}): Row => ({
    id: ACCOUNT,
    name: "Depot Hardware",
    address1: "100 Depot St",
    address2: null,
    city: "Corbin",
    state: "KY",
    zip: "40701",
    // The mailing address is somewhere else on purpose: it must not be used.
    mailing_same: false,
    mailing_address1: "PO Box 9",
    mailing_city: "Lexington",
    mailing_state: "KY",
    mailing_zip: "40502",
    ...over,
  });
  it("a ticket with no property address falls back to the customer's physical address (crm_accounts address1 / city / state / zip)", async () => {
    world({
      job: { id: JOB, site_id: null, site_address: null, technician_id: ME, account_id: ACCOUNT },
      accounts: [corbinAccount()],
    });
    expect(await run()).toMatchObject({ miles: 15.6, minutes: 25, source: "estimated" });
    expect(env.rpcCalls.map((c) => c.args["p_house"]).sort()).toEqual(["100", "200"]);
  });
  it("the property address wins when it has a street line — typed on the ticket, else its crm_sites row — even with a customer address", async () => {
    // Typed on the ticket: a different house than the customer's.
    const rpcs = {
      service_aerial_address_candidates: (args: Row) =>
        args["p_house"] === "200"
          ? [cand("200", "MAIN ST", LONDON)]
          : args["p_house"] === "100"
            ? [cand("100", "DEPOT ST", CORBIN)]
            : args["p_house"] === "7"
              ? [cand("7", "MILL RD", { lat: 36.8, lng: -84.2 })]
              : [],
    };
    world({
      job: {
        id: JOB,
        site_id: null,
        site_address: "7 Mill Rd, Williamsburg, KY 40769",
        technician_id: ME,
        account_id: ACCOUNT,
      },
      accounts: [corbinAccount()],
      rpcs,
    });
    expect(await run()).not.toBeNull();
    expect(env.rpcCalls.map((c) => c.args["p_house"]).sort()).toEqual(["200", "7"]);
    // Its crm_sites row, when nothing is typed (the office's point is forgotten so both ends are
    // looked up again).
    clearGeocodeCache();
    world({
      job: {
        id: JOB,
        site_id: "site-1",
        site_address: null,
        technician_id: ME,
        account_id: ACCOUNT,
      },
      sites: [
        {
          id: "site-1",
          address1: "7 Mill Rd",
          address2: null,
          city: "Williamsburg",
          state: "KY",
          zip: "40769",
        },
      ],
      accounts: [corbinAccount()],
      rpcs,
    });
    expect(await run()).not.toBeNull();
    expect(env.rpcCalls.map((c) => c.args["p_house"]).sort()).toEqual(["200", "7"]);
  });
  it("a property address with no street line ('Corbin, KY'; a site row with no address1) is skipped for the customer's", async () => {
    world({
      job: {
        id: JOB,
        site_id: null,
        site_address: "Corbin, KY",
        technician_id: ME,
        account_id: ACCOUNT,
      },
      accounts: [corbinAccount()],
    });
    expect(await run()).toMatchObject({ miles: 15.6, minutes: 25 });
    expect(env.rpcCalls.map((c) => c.args["p_house"]).sort()).toEqual(["100", "200"]);
    world({
      job: {
        id: JOB,
        site_id: "site-1",
        site_address: "  ",
        technician_id: ME,
        account_id: ACCOUNT,
      },
      sites: [
        { id: "site-1", address1: null, address2: null, city: "Corbin", state: "KY", zip: "40701" },
      ],
      accounts: [corbinAccount()],
    });
    expect(await run()).toMatchObject({ miles: 15.6, minutes: 25 });
  });
  it("a customer with no street address either (or no such customer) → null, nothing geocoded for the site", async () => {
    world({
      job: { id: JOB, site_id: null, site_address: null, technician_id: ME, account_id: ACCOUNT },
      accounts: [corbinAccount({ address1: "  ", address2: null })],
    });
    expect(await run()).toBeNull();
    expect(env.rpcCalls.map((c) => c.args["p_house"])).not.toContain("100");
    world({
      job: { id: JOB, site_id: null, site_address: null, technician_id: ME, account_id: ACCOUNT },
      accounts: [],
    });
    expect(await run()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("the geocoder's state hint comes from the row the address came from: the customer's state column when its line carries none", async () => {
    // Nothing stored for the customer's house: the live layers are asked — Tennessee's only,
    // from crm_accounts.state, although the line itself ("500 Church St") names no state.
    world({
      job: { id: JOB, site_id: null, site_address: null, technician_id: ME, account_id: ACCOUNT },
      accounts: [corbinAccount({ address1: "500 Church St", city: null, state: "TN", zip: null })],
      rpcs: {
        service_aerial_address_candidates: (args: Row) =>
          args["p_house"] === "200" ? [cand("200", "MAIN ST", LONDON)] : [],
      },
    });
    expect(await run()).toBeNull();
    expect(layerCalls().length).toBeGreaterThan(0);
    expect(layerCalls().some((u) => u.includes("kygisserver.ky.gov"))).toBe(false);
    expect(layerCalls().some((u) => u.includes("USA_Structures"))).toBe(true);
    // The same line from a Kentucky customer asks Kentucky's 911 points.
    world({
      job: { id: JOB, site_id: null, site_address: null, technician_id: ME, account_id: ACCOUNT },
      accounts: [corbinAccount({ address1: "500 Church St", city: null, state: "KY", zip: null })],
      rpcs: {
        service_aerial_address_candidates: (args: Row) =>
          args["p_house"] === "200" ? [cand("200", "MAIN ST", LONDON)] : [],
      },
    });
    expect(await run()).toBeNull();
    expect(layerCalls().some((u) => u.includes("kygisserver.ky.gov"))).toBe(true);
  });
  it("no office address (blank street, or no company_settings row) → null before any lookup", async () => {
    world({ office: { ...OFFICE, address: null } });
    expect(await run()).toBeNull();
    expect(env.rpcCalls).toEqual([]);
    world({ office: null });
    expect(await run()).toBeNull();
    expect(env.rpcCalls).toEqual([]);
  });

  // ── Where the truck leaves from (owner, Oct 9: "the drive time wasnt auto added to the close
  // out" — the live main address is the invoice's PO box).
  const PO_BOX_OFFICE = { id: 1, address: "PO Box 466", city: "Corbin", state: "KY", zip: "40702" };
  const SHOP = {
    shop_address: "200 Main St",
    shop_city: "London",
    shop_state: "KY",
    shop_zip: "40744",
  };
  it("the live row — a PO-box main address, no shop street — → null before any lookup (the bug, now by design until the shop is set)", async () => {
    world({
      office: {
        ...PO_BOX_OFFICE,
        shop_address: null,
        shop_city: null,
        shop_state: null,
        shop_zip: null,
      },
    });
    expect(await run()).toBeNull();
    expect(env.rpcCalls).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("a PO-box main address with the shop's street set → the shop is geocoded as the office and the estimate comes back", async () => {
    world({ office: { ...PO_BOX_OFFICE, ...SHOP } });
    expect(await run()).toEqual({
      miles: 15.6,
      minutes: 25,
      hours: 0.83,
      note: "Office → site ≈ 16 mi, 25 min each way (estimated)",
      source: "estimated",
    });
    // The shop ("200 Main St") and the site went through the stored-data rpc; the PO box never.
    expect(env.rpcCalls.map((c) => c.args["p_house"]).sort()).toEqual(["100", "200"]);
    expect(osrmCalls()).toEqual([osrmRouteUrl(LONDON, CORBIN)]);
  });
  it("a shop that is itself a PO box falls back to the main address when that is a street", async () => {
    world({
      office: { ...OFFICE, ...SHOP, shop_address: "PO Box 9", shop_city: "Lexington" },
    });
    expect(await run()).toMatchObject({ miles: 15.6, minutes: 25, source: "estimated" });
    expect(env.rpcCalls.map((c) => c.args["p_house"]).sort()).toEqual(["100", "200"]);
  });
  it("a geocode miss (nothing stored, nothing on the state layers) → null, no throw", async () => {
    world({
      rpcs: {
        service_aerial_address_candidates: (args: Row) =>
          args["p_house"] === "200" ? [cand("200", "MAIN ST", LONDON)] : [],
      },
    });
    expect(await run()).toBeNull();
    // The live layers were asked for the site (Kentucky's 911 points, from the state hint).
    expect(fetchMock).toHaveBeenCalled();
    // A failing state server is a miss too.
    world({ rpcs: { service_aerial_address_candidates: () => [] } });
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await run()).toBeNull();
  });
  it("a ticket that cannot be read → null; a login without Service access is refused", async () => {
    world({ job: { id: "d2222222-2222-4222-8222-222222222222", site_address: "x" } });
    expect(await run()).toBeNull();
    world({});
    await expect(run(SALES)).rejects.toThrow("Forbidden: Service access required");
  });
  it("the office is geocoded once per process (cached by its address line); the site every time", async () => {
    world({});
    await run();
    const first = env.rpcCalls.length;
    expect(first).toBe(2);
    await run();
    expect(env.rpcCalls.length).toBe(3);
    expect(env.rpcCalls[2]!.args["p_house"]).toBe("100");
  });
});

// ── The Time section on the close-out ─────────────────────────────────────────────────────────

describe("the Time section prefills a Travel line from the estimate (close-out only)", () => {
  const shared = readFileSync("src/components/service/field-shared.tsx", "utf8");
  const list = shared.slice(
    shared.indexOf("export function TimeEntries("),
    shared.indexOf("function TimeFields("),
  );
  const newRow = shared.slice(shared.indexOf("function NewTimeRow("));
  const closeout = readFileSync("src/components/service/closeout.tsx", "utf8");
  const office = readFileSync("src/components/service/ticket-field-sections.tsx", "utf8");

  it("reads estimateTravel under ['service-travel-estimate', jobId], fresh for an hour, only while offered, editable and no Travel line exists", () => {
    expect(readFileSync("src/components/service/field-utils.ts", "utf8")).toContain(
      'travelEstimate: (id: string) => ["service-travel-estimate", id] as const,',
    );
    expect(list).toContain('const hasTravel = (q.data ?? []).some((r) => r.kind === "travel");');
    expect(list).toMatch(
      /queryKey: fieldKeys\.travelEstimate\(jobId\),\s*queryFn: \(\) => travelFn\(\{ data: \{ id: jobId \} \}\),\s*enabled: !!session && !!suggestTravel && editable && q\.isSuccess && !hasTravel,\s*staleTime: 60 \* 60_000,/,
    );
    expect(shared).toContain("suggestTravel?: boolean | undefined;");
  });
  it("with an estimate and no Travel line the Add form opens prefilled: kind Travel, the round-trip hours, the note under it, one 'Add travel' tap; Cancel puts the plain button back", () => {
    expect(list).toMatch(
      /\{suggested && !adding \? \(\s*<NewTimeRow\s*key="travel-estimate"\s*jobId=\{jobId\}\s*defaultHelpers=\{defaultHelpers\}\s*initial=\{\{ kind: "travel", hours: suggested\.hours \}\}\s*note=\{suggested\.note\}\s*hint=\{`\$\{suggested\.note\} — round trip`\}\s*submitLabel="Add travel"\s*onClose=\{\(\) => setTravelDismissed\(true\)\}\s*\/>\s*\) : adding \? \(/,
    );
    expect(list).toContain(
      "suggestTravel && editable && !hasTravel && !travelDismissed ? (travel.data ?? null) : null;",
    );
    // The form: the prefill, today's date, the hint line, the label, the note saved on the entry
    // (service_time_entries.note), the hours still editable (TimeFields as for any new line).
    expect(newRow).toMatch(/kind: initial\?\.kind \?\? "labor",\s*hours: initial\?\.hours \?\? 0,/);
    expect(newRow).toContain("on_date: localYmd(),");
    expect(newRow).toContain('{hint && <p className="text-xs text-muted-foreground">{hint}</p>}');
    expect(newRow).toContain("{submitLabel}");
    expect(newRow).toContain("...(note ? { note } : {}),");
    expect(newRow).toContain(
      "<TimeFields vals={vals} onChange={setVals} disabled={save.isPending} />",
    );
    expect(newRow).toContain(
      'toast.success(row.kind === "travel" ? "Travel added" : "Time added");',
    );
  });
  it("no estimate (null): the section is exactly as before — 'No time recorded yet.' and the empty Add time button", () => {
    expect(list).toMatch(
      /\{rows\.length === 0 && !adding && !suggested && \(\s*<p className="text-sm text-muted-foreground">No time recorded yet\.<\/p>/,
    );
    expect(list).toMatch(/<Plus className="mr-1 h-4 w-4" \/> Add time/);
    // The plain form is still blank labor (no prefill props).
    expect(list).toMatch(
      /\) : adding \? \(\s*<NewTimeRow\s*jobId=\{jobId\}\s*defaultHelpers=\{defaultHelpers\}\s*onClose=\{\(\) => setAdding\(false\)\}\s*\/>/,
    );
  });
  it("offered on the close-out's step 5, not on the office ticket page", () => {
    expect(closeout).toMatch(
      /<TimeEntries\s*jobId=\{job\.id\}\s*editable\s*defaultHelpers=\{job\.helper_count\}\s*suggestTravel\s*\/>/,
    );
    expect(office).toMatch(
      /<TimeEntries\s*jobId=\{job\.id\}\s*editable=\{officeOrAdmin\}\s*defaultHelpers=\{job\.helper_count\}\s*compact\s*\/>/,
    );
    expect(office).not.toContain("suggestTravel");
  });
  it("the server function takes the office from company_settings (the shop's street, else the invoice header's address: travelOrigin), the destination in order, then the router before the arithmetic", () => {
    const fns = readFileSync("src/lib/service-field.functions.ts", "utf8");
    expect(fns).toMatch(
      /\.from\("company_settings"\)\s*\.select\("address, city, state, zip, shop_address, shop_city, shop_state, shop_zip"\)\s*\.eq\("id", 1\)\s*\.maybeSingle\(\);\s*const origin = office \? travelOrigin\(office\) : null;\s*if \(!origin\) return null;/,
    );
    expect(fns).not.toContain("officeAddressLine(");
    expect(fns).toContain('.select("id, site_id, site_address, account_id")');
    expect(fns).toContain("const dest = await travelDestination(sb, job);");
    expect(fns).toMatch(
      /geocodeAddressCached\(sb, origin\.line, origin\.state\),\s*geocodeAddress\(sb, dest\.line, dest\.state\),/,
    );
    expect(fns).toMatch(
      /const routed = await routedDrive\(from, to\);\s*return \(routed && travelFromRoute\(routed\)\) \?\? estimateTravelBetween\(from, to\);/,
    );
    // The destination: property with a street line (typed, else its site row), else the customer.
    expect(fns).toMatch(
      /if \(hasStreetLine\(typed\)\) return \{ line: typed, state: siteState \};\s*if \(!job\.account_id\) return null;\s*const \{ data: a \} = await sb\s*\.from\("crm_accounts"\)\s*\.select\("address1, address2, city, state, zip"\)/,
    );
    expect(fns).not.toContain("mailing_address1");
    // The module header says what the free router is and how the key switches to Google.
    const route = readFileSync("src/lib/drive-route.ts", "utf8");
    expect(route).toMatch(
      /OSRM's public demo server \(router\.project-osrm\.org\): free, no key, but a demo with no\s+\*\s+guarantee/,
    );
    expect(route).toContain("GOOGLE_MAPS_API_KEY");
    expect(route).toContain("Lovable Cloud › Secrets");
    expect(route).not.toMatch(/console\.(log|warn|error)/);
    // The same address chain the aerial uses, shared, not copied.
    const aerial = readFileSync("src/lib/service-aerial.functions.ts", "utf8");
    expect(aerial).toContain("export async function geocodeAddress(");
    expect(aerial.match(/await locateAddress\(/g)).toHaveLength(2);
    expect(aerial.match(/service_aerial_address_candidates/g)).toHaveLength(1);
  });
});

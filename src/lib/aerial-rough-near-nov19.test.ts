/**
 * "Pick the building" opens close to the address (owner, Nov 19, with a picture of the map
 * showing all of Kentucky and Tennessee: "if the location can't be located at a map and you try
 * to attach it to yourself have the map try its best to get close to the location when it
 * brings the map up instead of just showing tn and Ky in its entirety").
 *
 * Before: an address on none of our maps gave the picker nothing to open on, so it showed both
 * states. Now the read also returns the middle of the address's zip code, else of its town, and
 * the map opens over the town with no pin. Each test here fails on the code before.
 *
 *  server   lib/service-aerial.functions.ts roughNear, getTicketAerial (nearRough, nearPlace)
 *  map      components/prospect-map-focus.ts focusMove, pickRoughLine; prospect-map.tsx
 *  screen   components/service/aerial-markup.tsx
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  FOCUS_ZOOM,
  focusMove,
  pickRoughLine,
  ROUGH_FOCUS_ZOOM,
} from "@/components/prospect-map-focus";
import {
  getTicketAerial,
  ROUGH_TIMEOUT_MS,
  roughNear,
  type TicketAerial,
} from "@/lib/service-aerial.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

// What the public zip code lookup sends (made-up places).
const zipBody = {
  "post code": "40999",
  places: [
    {
      "place name": "Testville",
      latitude: "36.9000",
      longitude: "-84.1000",
      "state abbreviation": "KY",
    },
  ],
};
const townBody = {
  "place name": "Testville",
  "state abbreviation": "KY",
  places: [
    { "place name": "Testville", "post code": "40999", latitude: "36.9000", longitude: "-84.1000" },
    { "place name": "Testville", "post code": "40998", latitude: "36.9200", longitude: "-84.1200" },
  ],
};

describe("roughNear: the middle of the zip code, else of the town", () => {
  it("the zip code first, and the town is not asked when it answers", async () => {
    const asked: string[] = [];
    const r = await roughNear({ city: "Testville", state: "KY", zip: "40999-1234" }, async (u) => {
      asked.push(u);
      return zipBody;
    });
    expect(r).toEqual({ lat: 36.9, lng: -84.1, place: "Testville, KY 40999" });
    expect(asked).toEqual(["https://api.zippopotam.us/us/40999"]);
  });
  it("the town when the zip code is missing, unknown, or its lookup fails", async () => {
    const town = async (u: string) => (u.endsWith("/ky/testville") ? townBody : null);
    const mid = { lat: 36.91, lng: -84.11, place: "Testville, KY" };
    expect(await roughNear({ city: " Testville ", state: "ky", zip: null }, town)).toEqual(mid);
    expect(await roughNear({ city: "Testville", state: "KY", zip: "40999" }, town)).toEqual(mid);
    const zipDown = async (u: string) => {
      if (!u.endsWith("/ky/testville")) throw new Error("timed out");
      return townBody;
    };
    expect(await roughNear({ city: "Testville", state: "KY", zip: "40999" }, zipDown)).toEqual(mid);
  });
  it("nothing known: null, and nothing is asked", async () => {
    const fetcher = vi.fn(async () => zipBody);
    expect(await roughNear({ city: "", state: null, zip: "" }, fetcher)).toBeNull();
    // A town without its state, or a state without a town, is not enough.
    expect(await roughNear({ city: "Testville", state: null, zip: null }, fetcher)).toBeNull();
    expect(await roughNear({ city: null, state: "KY", zip: null }, fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("never throws: a lookup that is down, or an odd answer, is null", async () => {
    const down = async () => {
      throw new Error("down");
    };
    expect(await roughNear({ city: "Testville", state: "KY", zip: "40999" }, down)).toBeNull();
    expect(
      await roughNear({ city: "Testville", state: "KY", zip: "40999" }, async () => "<html>"),
    ).toBeNull();
  });
  it("a technician is waiting: each lookup gets three seconds", () => {
    expect(ROUGH_TIMEOUT_MS).toBe(3000);
    expect(flat(read("src/lib/service-aerial.functions.ts"))).toContain(
      "signal: AbortSignal.timeout(ROUGH_TIMEOUT_MS),",
    );
  });
});

// ── The ticket's read ────────────────────────────────────────────────────────────────────────

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "b1111111-1111-4111-8111-111111111111";
let urls: string[] = [];

function env(site: Row, lookup: (url: string) => unknown, ticketAddress = "") {
  const e = fakeSupabase(
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
      ],
      service_jobs: [
        {
          id: JOB,
          number: 101,
          site_id: "site-1",
          site_address: ticketAddress,
          account_id: null,
          technician_id: ME,
          stage: "scheduled",
        },
      ],
      crm_sites: [{ id: "site-1", name: "Test site", address2: null, ...site }],
      service_job_photos: [],
    },
    { rpcs: { service_aerial_address_candidates: () => [] } },
  );
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      // The state map servers have nothing for this address.
      if (!url.includes("api.zippopotam.us"))
        return new Response(JSON.stringify({ features: [] }), {
          headers: { "content-type": "application/json" },
        });
      const body = lookup(url);
      return body === undefined
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    }),
  );
  return e;
}
const run = async (e: ReturnType<typeof fakeSupabase>): Promise<TicketAerial> =>
  (getTicketAerial as unknown as (a: { data: Row; context: unknown }) => Promise<TicketAerial>)({
    data: { id: JOB },
    context: { supabase: e.db, userId: ME },
  });
afterEach(() => vi.unstubAllGlobals());

describe("getTicketAerial: an address on no map of ours", () => {
  it("returns the middle of its zip code, marked rough and named", async () => {
    const e = env(
      { address1: "99 Nowhere Rd", city: "Testville", state: "KY", zip: "40999" },
      (u) => (u.endsWith("/40999") ? zipBody : undefined),
    );
    const r = await run(e);
    expect(r.found).toBeNull();
    expect(r.saved).toBeNull();
    expect(r.near).toEqual({ lat: 36.9, lng: -84.1 });
    expect(r.nearRough).toBe(true);
    expect(r.nearPlace).toBe("Testville, KY 40999");
    // The note still says the address was not found: the map opening close by is not a match.
    expect(r.note).toBeTruthy();
  });
  it("a ticket that carries its own address opens over THAT address's town, not the property's", async () => {
    const e = env(
      { address1: "1 Other St", city: "Othertown", state: "KY", zip: "41111" },
      (u) => (u.endsWith("/40999") ? zipBody : undefined),
      "99 Nowhere Rd, Testville, KY 40999",
    );
    const r = await run(e);
    expect(r.address).toBe("99 Nowhere Rd, Testville, KY 40999");
    expect(r.nearPlace).toBe("Testville, KY 40999");
    expect(urls.filter((u) => u.includes("zippopotam"))).toEqual([
      "https://api.zippopotam.us/us/40999",
    ]);
  });
  it("a property with no street at all still opens over its town", async () => {
    const e = env({ address1: "", city: "Testville", state: "KY", zip: "" }, (u) =>
      u.endsWith("/ky/testville") ? townBody : undefined,
    );
    const r = await run(e);
    expect(r.near).toEqual({ lat: 36.91, lng: -84.11 });
    expect(r.nearRough).toBe(true);
    expect(r.nearPlace).toBe("Testville, KY");
  });
  it("no town and no zip code, or the lookup has nothing: as before, no point and no rough mark", async () => {
    const none = await run(env({ address1: "", city: "", state: "KY", zip: "" }, () => undefined));
    expect(none.near).toBeNull();
    expect(none.nearRough).toBeUndefined();
    expect(urls.filter((u) => u.includes("zippopotam"))).toEqual([]);
    const miss = await run(
      env(
        { address1: "99 Nowhere Rd", city: "Testville", state: "KY", zip: "40999" },
        () => undefined,
      ),
    );
    expect(miss.near).toBeNull();
    expect(miss.nearRough).toBeUndefined();
    expect(miss.addressState).toBe("KY");
  });
  it("a street the address did match is still the exact point: the rough lookup runs only with nothing closer", () => {
    const s = flat(read("src/lib/service-aerial.functions.ts"));
    expect(s).toContain(
      "if (near) return { address, addressState, saved: null, found: null, note, near };",
    );
    // (Nov 19, later: the town and zip code are gathered first, to say "no address" when there
    // is none of them; aerial-no-address-nov19.test.ts.)
    expect(s.indexOf("if (near) return { address,")).toBeLessThan(
      s.indexOf("const rough = await roughNear(place);"),
    );
  });
});

// ── The map ──────────────────────────────────────────────────────────────────────────────────

describe("the map's move", () => {
  const at = { lat: 36.9, lng: -84.1 };
  it("a rough point: over the town, with no pin", () => {
    expect(focusMove(at, true)).toEqual({
      center: [-84.1, 36.9],
      zoom: ROUGH_FOCUS_ZOOM,
      pin: false,
    });
    expect(ROUGH_FOCUS_ZOOM).toBe(14);
  });
  it("an exact point: on the roof, with a pin, as before", () => {
    expect(focusMove(at, false)).toEqual({ center: [-84.1, 36.9], zoom: FOCUS_ZOOM, pin: true });
    expect(focusMove(at, undefined)?.pin).toBe(true);
    expect(FOCUS_ZOOM).toBe(18);
  });
  it("no point: no move", () => {
    expect(focusMove(null, true)).toBeNull();
    expect(focusMove(undefined, false)).toBeNull();
  });
  it("the map draws the move it is given, and a pin only when the move says so", () => {
    const m = flat(read("src/components/prospect-map.tsx"));
    expect(m).toContain("const move = focusMove(focus, focusRough);");
    expect(m).toMatch(/if \(move\.pin\)\s*focusPin\.current = new Marker\(/);
    expect(m).toContain("m.easeTo({ center: move.center, zoom: move.zoom, duration: 800 });");
    expect(m).toContain("}, [focus, focusRough]);");
  });
  it("the location button is only on a map that asks for it, and asks the phone nothing until tapped", () => {
    const m = flat(read("src/components/prospect-map.tsx"));
    expect(m).toMatch(/if \(locate\.current\)\s*m\.addControl\(\s*new GeolocateControl\(/);
    expect(m).not.toContain("navigator.geolocation");
    expect(m).not.toContain(".trigger()");
  });
});

describe("the picker", () => {
  const a = flat(read("src/components/service/aerial-markup.tsx"));
  it("opens on the rough point without a pin, and offers the location button", () => {
    // (Nov 19, later: a property with no address at all opens where the phone is, when the
    // phone says; aerial-no-address-nov19.test.ts. The rough point still comes first.)
    expect(a).toContain(
      "focus={ view ? { lat: view.center[1], lng: view.center[0] } : (data.near ?? hereAt ?? null) }",
    );
    expect(a).toContain(
      'focusRough={!view && (data.nearRough ? true : !data.near && hereAt ? "here" : false)}',
    );
    expect(a).toMatch(/focusRough=\{!view && \(data\.nearRough \? true.*?locateMe/);
    // Both states only when there is no point at all.
    expect(a).toContain("fitTo={view || data.near || hereAt ? undefined : data.addressState}");
  });
  it("says where it opened", () => {
    expect(a).toContain('{!view && data.nearRough ? `${pickRoughLine(data.nearPlace)} ` : ""}');
    expect(pickRoughLine("Testville, KY 40999")).toBe(
      "The address is not on our maps, so the map opened over Testville, KY 40999. Find the building, or tap the location button if you are standing on it.",
    );
    expect(pickRoughLine(null)).toContain("opened over its town.");
  });
});

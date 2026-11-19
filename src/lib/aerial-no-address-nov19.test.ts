/**
 * "Pick the building" on a property with no address at all (owner, Nov 19: "go" on the report's
 * item: "A property with no address, town or zip still opens the wide map. Solution: use the new
 * location button, or add the address").
 *
 * Before: with nothing to look up the picker opened on all of Kentucky and Tennessee, said "No
 * aerial for this address" as if an address had been looked for, and left the location button
 * for the person to find. Now the read says there is no address; the picker says so, tells the
 * office to add it (with a link to the property) and a technician to use the phone's location,
 * and on a phone asks for that location itself as it opens. Each test here fails on the code
 * before.
 *
 *  server   lib/service-aerial.functions.ts nothingToLookUp, getTicketAerial (noAddress)
 *  rules    components/service/aerial-no-address.ts
 *  map      components/prospect-map-focus.ts focusMove ("here")
 *  screen   components/service/aerial-markup.tsx
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { FOCUS_ZOOM, focusMove, HERE_FOCUS_ZOOM } from "@/components/prospect-map-focus";
import {
  askHere,
  HERE_ASKING,
  HERE_FOUND,
  HERE_REFUSED,
  HERE_UNAVAILABLE,
  HERE_WAIT_MS,
  NO_ADDRESS_FIELD,
  NO_ADDRESS_LINE,
  NO_ADDRESS_OFFICE,
  noAddressLines,
  shouldAskHere,
  type Geo,
  type HereState,
} from "@/components/service/aerial-no-address";
import {
  getTicketAerial,
  nothingToLookUp,
  type TicketAerial,
} from "@/lib/service-aerial.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "b1111111-1111-4111-8111-111111111111";
let urls: string[] = [];
function env(site: Row, ticketAddress = "") {
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
      return url.includes("api.zippopotam.us")
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify({ features: [] }), {
            headers: { "content-type": "application/json" },
          });
    }),
  );
  return e;
}
const run = async (e: ReturnType<typeof fakeSupabase>): Promise<TicketAerial> =>
  (getTicketAerial as unknown as (a: { data: Row; context: unknown }) => Promise<TicketAerial>)({
    data: { id: JOB },
    context: { supabase: e.db, userId: ME },
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the read says when there is nothing to look up", () => {
  it("no street, no town and no zip code: nothing a map can be asked", () => {
    expect(nothingToLookUp({ address: "", city: null, zip: undefined })).toBe(true);
    expect(nothingToLookUp({ address: "   ", city: " ", zip: "" })).toBe(true);
    expect(nothingToLookUp({ address: "1 Main St", city: "", zip: "" })).toBe(false);
    expect(nothingToLookUp({ address: "", city: "Testville", zip: "" })).toBe(false);
    expect(nothingToLookUp({ address: "", city: "", zip: "40999" })).toBe(false);
  });
  it("a property with no address at all is marked, with no point, and no lookup is made", async () => {
    const r = await run(env({ address1: "", city: "", state: "", zip: "" }));
    expect(r.noAddress).toBe(true);
    expect(r.near).toBeNull();
    expect(r.nearRough).toBeUndefined();
    expect(r.found).toBeNull();
    expect(urls.filter((u) => u.includes("zippopotam"))).toEqual([]);
  });
  it("a state alone is still no address", async () => {
    const r = await run(env({ address1: "", city: "", state: "KY", zip: "" }));
    expect(r.noAddress).toBe(true);
    // The picker still frames the state, as it did.
    expect(r.addressState).toBe("KY");
  });
  it("an address that was looked for and not found is NOT 'no address'", async () => {
    const street = await run(env({ address1: "99 Nowhere Rd", city: "", state: "KY", zip: "" }));
    expect(street.noAddress).toBeUndefined();
    const town = await run(env({ address1: "", city: "Testville", state: "KY", zip: "" }));
    expect(town.noAddress).toBeUndefined();
    // A ticket that carries its own address has one, whatever the property lacks.
    const own = await run(
      env({ address1: "", city: "", state: "", zip: "" }, "5 Oak St, Corbin, KY"),
    );
    expect(own.noAddress).toBeUndefined();
  });
});

const idle: HereState = { status: "idle" };
const ask = (over: Partial<Parameters<typeof shouldAskHere>[0]> = {}) =>
  shouldAskHere({ hasView: false, near: null, noAddress: true, coarse: true, here: idle, ...over });

describe("when the picker asks the phone where it is", () => {
  it("a property with no address, on a phone, the first time the picker opens", () => {
    expect(ask()).toBe(true);
  });
  it("never when an address, or even its town, was found", () => {
    expect(ask({ near: { lat: 36.9, lng: -84.1 } })).toBe(false);
    expect(ask({ noAddress: false })).toBe(false);
    expect(ask({ noAddress: undefined })).toBe(false);
    // A saved view or a found building: the map is already on the roof.
    expect(ask({ hasView: true })).toBe(false);
  });
  it("not from a desk computer: it is not at the building", () => {
    expect(ask({ coarse: false })).toBe(false);
  });
  it("once: not again after an answer, a refusal, or while it is asking", () => {
    expect(ask({ here: { status: "asking" } })).toBe(false);
    expect(ask({ here: { status: "refused" } })).toBe(false);
    expect(ask({ here: { status: "unavailable" } })).toBe(false);
    expect(ask({ here: { status: "here", lat: 1, lng: 2 } })).toBe(false);
  });
});

describe("the ask itself", () => {
  const geo = (
    act: (
      ok: Parameters<Geo["getCurrentPosition"]>[0],
      fail: Parameters<Geo["getCurrentPosition"]>[1],
    ) => void,
  ): Geo => ({
    getCurrentPosition: (ok, fail) => act(ok, fail),
  });
  it("given: where the phone is", async () => {
    const r = await askHere(geo((ok) => ok({ coords: { latitude: 36.95, longitude: -84.09 } })));
    expect(r).toEqual({ status: "here", lat: 36.95, lng: -84.09 });
  });
  it("refused is told apart from a phone that cannot say", async () => {
    expect(await askHere(geo((_ok, fail) => fail({ code: 1 })))).toEqual({ status: "refused" });
    expect(await askHere(geo((_ok, fail) => fail({ code: 2 })))).toEqual({ status: "unavailable" });
    expect(await askHere(geo((_ok, fail) => fail({ code: 3 })))).toEqual({ status: "unavailable" });
  });
  it("no location on the device, or one that throws: unavailable, never an error", async () => {
    expect(await askHere(null)).toEqual({ status: "unavailable" });
    expect(
      await askHere({
        getCurrentPosition: () => {
          throw new Error("blocked by policy");
        },
      }),
    ).toEqual({ status: "unavailable" });
  });
  it("a phone that never answers is given up on, so the line does not say Asking for ever", async () => {
    vi.useFakeTimers();
    const p = askHere(geo(() => {}));
    await vi.advanceTimersByTimeAsync(HERE_WAIT_MS + 1);
    expect(await p).toEqual({ status: "unavailable" });
    // Long enough for the person to read the browser's question and tap Allow.
    expect(HERE_WAIT_MS).toBeGreaterThanOrEqual(15_000);
  });
});

describe("what the picker says", () => {
  it("the office: no address, and adding it puts the map there next time", () => {
    expect(noAddressLines({ office: true, here: idle })).toEqual([
      NO_ADDRESS_LINE,
      NO_ADDRESS_OFFICE,
    ]);
    expect(NO_ADDRESS_LINE).toBe("This property has no address, so the map cannot open on it.");
  });
  it("a technician: the location button, and never to go and ask someone else", () => {
    const lines = noAddressLines({ office: false, here: idle });
    expect(lines).toEqual([NO_ADDRESS_LINE, NO_ADDRESS_FIELD]);
    expect(lines.join(" ")).not.toMatch(/office|ask|call/i);
  });
  it("while asking, once given, refused, and when the phone cannot say", () => {
    const second = (here: HereState) => noAddressLines({ office: false, here })[1];
    expect(second({ status: "asking" })).toBe(HERE_ASKING);
    expect(second({ status: "here", lat: 1, lng: 2 })).toBe(HERE_FOUND);
    expect(second({ status: "refused" })).toBe(HERE_REFUSED);
    expect(second({ status: "unavailable" })).toBe(HERE_UNAVAILABLE);
    // Refused or not, the map stays usable and the button is named for another try.
    for (const s of [HERE_REFUSED, HERE_UNAVAILABLE]) {
      expect(s).toContain("Move the map to the building");
      expect(s).toContain("location button");
    }
  });
});

describe("the map and the screen", () => {
  it("the phone's own position: the roofs around it, with no pin", () => {
    expect(focusMove({ lat: 36.95, lng: -84.09 }, "here")).toEqual({
      center: [-84.09, 36.95],
      zoom: HERE_FOCUS_ZOOM,
      pin: false,
    });
    expect(HERE_FOCUS_ZOOM).toBeLessThan(FOCUS_ZOOM);
    // The two that were there are as they were.
    expect(focusMove({ lat: 1, lng: 2 }, false)?.pin).toBe(true);
    expect(focusMove({ lat: 1, lng: 2 }, true)?.pin).toBe(false);
  });
  const a = flat(read("src/components/service/aerial-markup.tsx"));
  it("both buttons that open the picker ask through the one rule", () => {
    expect(a).not.toContain("onClick={() => setPickOpen(true)}");
    expect(a.match(/onClick=\{openPicker\}/g)).toHaveLength(2);
    expect(a).toContain(
      "shouldAskHere({ hasView: !!view, near: data.near, noAddress: data.noAddress, coarse: coarsePointer(), here, })",
    );
    expect(a).toContain(
      'void askHere(typeof navigator === "undefined" ? null : navigator.geolocation).then(setHere);',
    );
  });
  it("the map opens where the phone is, and both states only with no point at all", () => {
    expect(a).toContain(
      "focus={ view ? { lat: view.center[1], lng: view.center[0] } : (data.near ?? hereAt ?? null) }",
    );
    expect(a).toContain(
      'focusRough={!view && (data.nearRough ? true : !data.near && hereAt ? "here" : false)}',
    );
    expect(a).toContain("fitTo={view || data.near || hereAt ? undefined : data.addressState}");
  });
  it("the lines show above the map and before it is opened, with the office's link to the property", () => {
    expect(a).toContain("{noAddressLines({ office, here }).map((line) => (");
    expect(a).toContain(
      '{office && job.site_id && ( <Link to="/properties/$id" params={{ id: job.site_id }}',
    );
    expect(a).toContain("{noAddressNote} {pickOpen && (");
    expect(a).toContain("{!pickOpen && noAddressNote}");
    expect(a).toContain(
      '{data.noAddress ? "No address on this property" : "No aerial for this address"}',
    );
  });
});

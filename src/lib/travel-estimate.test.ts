/**
 * Owner, Oct 9: "can we add an automated travel to the time section that tracks the distance
 * between the jbk office and the location on the ticket and calculates the drive time and
 * prefills from there? if its missing any info its just empty as it is now."
 *
 * The arithmetic (travel-estimate.ts), the server function through the fake Supabase with the
 * state servers stubbed (estimateTravel: a hit returns numbers; a missing site address, no
 * office address or no geocode hit is null; no Service access throws), and the Time section's
 * prefilled form on the close-out (field-shared.tsx TimeEntries, closeout.tsx) — not on the
 * office ticket page.
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
  travelHours,
  travelNote,
} from "@/lib/travel-estimate";
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
  it("travelNote reads 'Office → site ≈ 23 mi, 35 min each way (estimated)'", () => {
    expect(travelNote(23, 35)).toBe("Office → site ≈ 23 mi, 35 min each way (estimated)");
    expect(travelNote(15.5, 25)).toBe("Office → site ≈ 16 mi, 25 min each way (estimated)");
  });
  it("estimateTravelBetween composes the four; the same spot is no trip (null)", () => {
    const e = estimateTravelBetween(LONDON, CORBIN)!;
    expect(e).toEqual({
      miles: 15.6,
      minutes: 25,
      hours: 0.83,
      note: "Office → site ≈ 16 mi, 25 min each way (estimated)",
    });
    expect(estimateTravelBetween(LONDON, LONDON)).toBeNull();
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

let env: ReturnType<typeof fakeSupabase>;
let fetchMock: ReturnType<typeof vi.fn>;
function world(over: {
  office?: Row | null;
  job?: Row;
  sites?: Row[];
  rpcs?: Record<string, (args: Row) => unknown>;
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
    },
    { rpcs: over.rpcs ?? storedRpc },
  );
  // The state servers (the live fallback): nothing found anywhere.
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ features: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
}
const run = (who = ME) =>
  (estimateTravel as unknown as (a: { data: Row; context: unknown }) => Promise<unknown>)({
    data: { id: JOB },
    context: { supabase: env.db, userId: who },
  });
beforeEach(() => clearGeocodeCache());
afterEach(() => vi.unstubAllGlobals());

describe("estimateTravel (the server)", () => {
  it("office and site both in our map data: road miles, minutes, round-trip hours and the note", async () => {
    world({});
    expect(await run()).toEqual({
      miles: 15.6,
      minutes: 25,
      hours: 0.83,
      note: "Office → site ≈ 16 mi, 25 min each way (estimated)",
    });
    // Both addresses went through the stored-data rpc; the state servers were not needed.
    expect(env.rpcCalls.map((c) => c.args["p_house"]).sort()).toEqual(["100", "200"]);
    expect(fetchMock).not.toHaveBeenCalled();
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
  it("no site address → null, and nothing is geocoded for it", async () => {
    world({ job: { id: JOB, site_id: null, site_address: "   ", technician_id: ME } });
    expect(await run()).toBeNull();
    expect(env.rpcCalls.map((c) => c.args["p_house"])).not.toContain("100");
  });
  it("no office address (blank street, or no company_settings row) → null before any lookup", async () => {
    world({ office: { ...OFFICE, address: null } });
    expect(await run()).toBeNull();
    expect(env.rpcCalls).toEqual([]);
    world({ office: null });
    expect(await run()).toBeNull();
    expect(env.rpcCalls).toEqual([]);
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
  it("the server function takes the office from company_settings (the invoice header's address) and the site as the aerial reads it", () => {
    const fns = readFileSync("src/lib/service-field.functions.ts", "utf8");
    expect(fns).toMatch(
      /\.from\("company_settings"\)\s*\.select\("address, city, state, zip"\)\s*\.eq\("id", 1\)\s*\.maybeSingle\(\);\s*const officeLine = office \? officeAddressLine\(office\) : "";\s*if \(!officeLine\) return null;/,
    );
    expect(fns).toContain("if (!siteLine) siteLine = siteAddressLine(s);");
    expect(fns).toMatch(
      /geocodeAddressCached\(sb, officeLine, office!\.state\),\s*geocodeAddress\(sb, siteLine, siteState\),/,
    );
    expect(fns).toContain("return estimateTravelBetween(from, to);");
    // The same address chain the aerial uses, shared, not copied.
    const aerial = readFileSync("src/lib/service-aerial.functions.ts", "utf8");
    expect(aerial).toContain("export async function geocodeAddress(");
    expect(aerial.match(/await locateAddress\(/g)).toHaveLength(2);
    expect(aerial.match(/service_aerial_address_candidates/g)).toHaveLength(1);
  });
});

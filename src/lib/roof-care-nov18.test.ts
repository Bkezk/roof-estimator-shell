/**
 * Roof Care plans, step 1: the price follows the drive (owner, Nov 18; docs/roof-care-plans.md).
 *
 * The owner's words: "that sheet just shows its profitable it doesnt adjust the price to make it
 * profitable. we need the prices to adjust to the travel distance x paying the crew to get there
 * and back based on customer location", and "the baseline assumes 2 hour round trip drive time no
 * matter what, but based on the distance of the address from jbk office determines if its more
 * than that and the price should auto adjust accordingly". Asked how, the owner chose "at cost".
 *
 * THE NUMBERS HERE ARE MADE UP for the sums to be easy to follow. The owner's own are in the
 * database and nowhere in this repository; the engine was checked against all five rows of his
 * sheet with them, outside the repository (docs/qa/roof-care-pricing-2026-11-18.md).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { pageForPath } from "@/lib/access";
import { isSettingsPath, SETTINGS_TABS } from "@/lib/menu-places";
import {
  draftFrom,
  draftKey,
  NOT_A_NUMBER,
  readBox,
  settingsFromDraft,
} from "@/lib/roof-care-form";
import {
  asRoofCareSettings,
  emptyRoofCareSettings,
  hoursAt,
  money0,
  PLAN_NAMES,
  roofCareQuote,
  settingsProblems,
  travelPerTrip,
  tripsPerYear,
  type RoofCareSettings,
} from "@/lib/roof-care-price";
import {
  addressLine,
  getRoofCareSettings,
  ROOF_CARE_ADMIN_ONLY,
  roundTrip,
  saveRoofCareSettings,
} from "@/lib/roof-care.functions";
import { fakeSupabase } from "@/test/fake-supabase";
import { readGeneratedTypes } from "@/test/generated-types";

const read = (p: string) => readFileSync(p, "utf8");

/** Made up. A crew of 3 at $30 is $90 an hour; the list price covers 1 hour and 40 miles. */
const S = (over: Partial<RoofCareSettings> = {}): RoofCareSettings => ({
  crew_cost_per_hour: 30,
  crew_size: 3,
  baseline_drive_hours: 1,
  baseline_miles: 40,
  vehicle_cost_per_mile: 0.5,
  report_cost_per_visit: 20,
  repair_cost_pct: 40,
  allowance_used_pct: 50,
  guard_leak_calls: 2,
  guard_hours_per_leak_call: 1,
  guard_storm_inspections: 1,
  guard_forecast_cost: 30,
  custom_quote_over_sqft: 60_000,
  // (Nov 19: the price floor; none in these cases. roof-care-floor-nov19.test.ts.)
  min_price_sqft: null,
  // (Nov 19, night: what a card payment costs, taken off a refund. Blank here.)
  card_fee_pct: null,
  card_fee_flat: null,
  // Nov 20: the two boxes of the plan's own trip rate. Blank here, as before they existed.
  trip_charge_per_hour: null,
  trip_charge_per_mile: null,
  plans: {
    watch: { base: 500, per_sqft: 0.02, allowance: null },
    care: { base: 800, per_sqft: 0.05, allowance: 400 },
    guard: { base: 1500, per_sqft: 0.08, allowance: 1000 },
  },
  hours: [
    { sqft: 10_000, inspection: 1, drains: 1, gutters: 0.5 },
    { sqft: 30_000, inspection: 3, drains: 2, gutters: 1.5 },
  ],
  ...over,
});
const quote = (s: RoofCareSettings, sqft: number, drive?: { hours: number; miles: number }) => {
  const r = roofCareQuote(s, drive ? { sqft, drive } : { sqft });
  if (!r.quote) throw new Error(`no quote: ${r.problems.join("; ")}`);
  return r.quote;
};
const row = (q: ReturnType<typeof quote>) =>
  Object.fromEntries(q.plans.map((p) => [p.plan, [p.list, p.travel, p.price, p.cost, p.profit]]));

describe("the costing sheet, line for line, at the drive the list price covers", () => {
  // trip  = 1 h x $90 + 40 mi x $0.50                     = 110
  // visit = trip + 1 h on the roof x $90 + $20 report      = 220
  it("Roof Watch is two visits", () => {
    const q = quote(S(), 10_000);
    expect(row(q)["watch"]).toEqual([700, 0, 700, 440, 260]);
  });
  it("Roof Care adds the drains at both visits and the repairs expected to be used", () => {
    // 440 + 2 x 1 h x 90 (180) + 400 x 50% x 40% (80) = 700
    expect(row(quote(S(), 10_000))["care"]).toEqual([1300, 0, 1300, 700, 600]);
  });
  it("Roof Guard adds the gutters, its leak calls, its storm inspection and the forecast", () => {
    // 440 + 2 x 1.5 h x 90 (270) + 1000 x 50% x 40% (200)
    //     + 2 leak calls x (trip 110 + 1 h x 90) (400) + 1 storm inspection x visit (220) + 30
    expect(row(quote(S(), 10_000))["guard"]).toEqual([2300, 0, 2300, 1560, 740]);
  });
  it("the list price is the base plus the price per square foot, to the dollar", () => {
    const q = quote(S(), 25_000);
    expect(q.plans.map((p) => p.list)).toEqual([1000, 2050, 3500]);
    expect(q.plans.map((p) => p.name)).toEqual(Object.values(PLAN_NAMES));
    expect(q.drive).toEqual({ hours: 1, miles: 40 });
    expect(q.beyond_baseline).toBe(false);
  });
});

describe("a building further than the list price covers pays for the extra drive", () => {
  const far = { hours: 2.5, miles: 100 };
  it("each trip adds the hours over the baseline at the crew's pay and the miles over it", () => {
    // 1.5 h x $90 = 135, plus 60 mi x $0.50 = 30
    expect(travelPerTrip(S(), far)).toBe(165);
  });
  it("for every trip of the plan year: the two visits, and Roof Guard's leak calls and storm inspection", () => {
    expect(tripsPerYear(S(), "watch")).toBe(2);
    expect(tripsPerYear(S(), "care")).toBe(2);
    expect(tripsPerYear(S(), "guard")).toBe(5); // 2 visits + 2 leak calls + 1 storm inspection
    const q = quote(S(), 10_000, far);
    expect(q.plans.map((p) => [p.plan, p.trips, p.travel, p.price])).toEqual([
      ["watch", 2, 330, 1030],
      ["care", 2, 330, 1630],
      ["guard", 5, 825, 3125],
    ]);
    expect(q.beyond_baseline).toBe(true);
  });
  it("at cost: the plan earns the same dollars far away as at the baseline", () => {
    const near = quote(S(), 10_000);
    const q = quote(S(), 10_000, far);
    // The cost side is worked with the real drive: trip 275, visit 385.
    expect(q.plans.map((p) => p.cost)).toEqual([770, 1030, 2385]);
    expect(q.plans.map((p) => p.profit)).toEqual(near.plans.map((p) => p.profit));
    // The old way, a price that does not move, would have lost money on Roof Guard here.
    const fixed = near.plans.map((p, i) => p.price - q.plans[i]!.cost);
    expect(fixed).toEqual([-70, 270, -85]);
  });
  it("hours and miles are each counted on their own: a slow short road adds hours only", () => {
    expect(travelPerTrip(S(), { hours: 2, miles: 30 })).toBe(90);
    expect(travelPerTrip(S(), { hours: 0.5, miles: 90 })).toBe(25);
  });
  it("a closer building pays the list price, never less; the plan simply earns more", () => {
    const q = quote(S(), 10_000, { hours: 0.5, miles: 10 });
    expect(q.plans.map((p) => [p.travel, p.price])).toEqual([
      [0, 700],
      [0, 1300],
      [0, 2300],
    ]);
    expect(q.plans[0]!.profit).toBe(380); // trip 50, visit 160, cost 320
    expect(q.beyond_baseline).toBe(false);
  });
  // Nov 20: the two halves ("billed at each visit") are gone from this quote. A plan is paid
  // for the year before it starts (Nov 19), and the owner asked why the Setup page still showed
  // a half per visit. The yearly price is what is charged.
  it("the yearly price is one amount: no half per visit", () => {
    expect(quote(S(), 10_000, far).plans[0]!.price).toBe(1030);
    const odd = quote(S(), 10_050).plans[0]!;
    expect(odd.price).toBe(701);
    expect("per_visit" in odd).toBe(false);
  });
});

describe("hours on site follow the roof's size", () => {
  const rows = S().hours;
  it("a size between two rows takes the hours in between", () => {
    expect(hoursAt(rows, 20_000)).toEqual({ inspection: 2, drains: 1.5, gutters: 1 });
    expect(hoursAt(rows, 15_000)).toEqual({ inspection: 1.5, drains: 1.25, gutters: 0.75 });
  });
  it("smaller than the first row or larger than the last takes that row's hours; the order typed does not matter", () => {
    expect(hoursAt(rows, 2_000)).toEqual({ inspection: 1, drains: 1, gutters: 0.5 });
    expect(hoursAt(rows, 90_000)).toEqual({ inspection: 3, drains: 2, gutters: 1.5 });
    expect(hoursAt([...rows].reverse(), 20_000)).toEqual(hoursAt(rows, 20_000));
    expect(hoursAt([], 20_000)).toBeNull();
  });
  it("a roof over the limit is a custom quote: no plan price at all", () => {
    expect(quote(S(), 60_000).custom_quote).toBe(false);
    const q = quote(S(), 60_001);
    expect(q.custom_quote).toBe(true);
    expect(q.plans).toEqual([]);
    // No limit typed: every size is priced.
    expect(quote(S({ custom_quote_over_sqft: null }), 200_000).custom_quote).toBe(false);
  });
});

describe("a blank is missing, never zero", () => {
  it("with nothing typed, every number is asked for and no price is given", () => {
    const r = roofCareQuote(emptyRoofCareSettings(), { sqft: 20_000 });
    expect(r.quote).toBeNull();
    expect(r.problems).toContain("Type “Crew member cost per hour ($)”");
    expect(r.problems).toContain("Type the base price of Roof Watch");
    expect(r.problems).toContain("Type the repair allowance of Roof Guard");
    expect(r.problems).toContain("Add at least one row to Hours on site per visit");
    // Roof Watch includes no repairs: its allowance is not asked for.
    expect(r.problems.join(" ")).not.toContain("repair allowance of Roof Watch");
  });
  it("one number missing stops every price and is named", () => {
    const r = roofCareQuote(S({ vehicle_cost_per_mile: null }), { sqft: 20_000 });
    expect(r.quote).toBeNull();
    expect(r.problems).toEqual(["Type “Vehicle cost per mile ($)”"]);
    expect(settingsProblems(S())).toEqual([]);
    // A typed 0 is a number: no leak calls is a real answer.
    expect(settingsProblems(S({ guard_leak_calls: 0 }))).toEqual([]);
    expect(tripsPerYear(S({ guard_leak_calls: 0 }), "guard")).toBe(3);
  });
  it("a roof size or a drive that is not one is said, not guessed", () => {
    expect(roofCareQuote(S(), { sqft: 0 }).problems).toEqual([
      "Type the roof's size in square feet",
    ]);
    expect(
      roofCareQuote(S(), { sqft: 10_000, drive: { hours: Number.NaN, miles: 10 } }).problems,
    ).toEqual(["The drive time could not be worked out"]);
  });
  it("what the database holds is read part by part: one bad part does not blank the rest", () => {
    expect(asRoofCareSettings(null)).toEqual(emptyRoofCareSettings());
    expect(asRoofCareSettings(S())).toEqual(S());
    const mixed = asRoofCareSettings({ crew_size: 2, crew_cost_per_hour: "forty", hours: "x" });
    expect(mixed.crew_size).toBe(2);
    expect(mixed.crew_cost_per_hour).toBeNull();
    expect(mixed.hours).toEqual([]);
  });
});

describe("the page's boxes", () => {
  it("start as the saved numbers, blank where nothing is saved", () => {
    const d = draftFrom(S());
    expect(d.values.crew_cost_per_hour).toBe("30");
    expect(d.plans.watch.allowance).toBe("");
    expect(d.hours.map((h) => h.sqft)).toEqual(["10000", "30000"]);
    expect(draftFrom(emptyRoofCareSettings()).values.crew_size).toBe("");
  });
  it("a box is blank, a number of 0 or more, or not a number", () => {
    expect(readBox("")).toEqual({ ok: true, value: null });
    expect(readBox(" 0 ")).toEqual({ ok: true, value: 0 });
    expect(readBox("$1,500")).toEqual({ ok: true, value: 1500 });
    expect(readBox(".03")).toEqual({ ok: true, value: 0.03 });
    expect(readBox("50%")).toEqual({ ok: true, value: 50 });
    for (const bad of ["abc", "-5", "1.2.3", "12,5x"]) expect(readBox(bad)).toEqual({ ok: false });
    expect(NOT_A_NUMBER).toBe("Type a number, 0 or more");
  });
  it("go back to the same numbers; a box that is not a number is a problem, never read as blank", () => {
    expect(settingsFromDraft(draftFrom(S()))).toEqual({ settings: S(), problems: [] });
    const d = draftFrom(S());
    d.values.crew_size = "three";
    const r = settingsFromDraft(d);
    expect(r.problems).toEqual(["Crew size (people): type a number, 0 or more"]);
  });
  it("the hours table: a half-filled row is said, a blank row is dropped, a size twice is refused", () => {
    const d = draftFrom(S());
    d.hours.push({ sqft: "", inspection: "", drains: "", gutters: "" });
    expect(settingsFromDraft(d).settings.hours).toHaveLength(2);
    d.hours.push({ sqft: "50000", inspection: "4", drains: "", gutters: "" });
    expect(settingsFromDraft(d).problems).toEqual([
      "Hours on site, row 4: fill in all four boxes, or clear the row",
    ]);
    const twice = draftFrom(S());
    twice.hours.push({ sqft: "10000", inspection: "2", drains: "2", gutters: "2" });
    expect(settingsFromDraft(twice).problems).toEqual([
      "Two rows of Hours on site have the same roof size. Keep one of them.",
    ]);
  });
  it("“unsaved changes” is the boxes as typed", () => {
    const d = draftFrom(S());
    expect(draftKey(d)).toBe(draftKey(draftFrom(S())));
    d.values.crew_size = "4";
    expect(draftKey(d)).not.toBe(draftKey(draftFrom(S())));
  });
  it("money is shown to the dollar", () => {
    expect(money0(1250)).toBe("$1,250");
    expect(money0(-85)).toBe("−$85");
  });
});

describe("the numbers are an admin's alone", () => {
  const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const world = (data: unknown = {}) =>
    fakeSupabase({
      profiles: [
        { id: ADMIN, role: "admin", access: [], full_name: "Ann Admin", email: "a@x" },
        { id: MGR, role: "manager", access: [], full_name: "Mo Manager", email: "m@x" },
      ],
      roof_care_settings: [{ id: 1, data, updated_at: null, updated_by_name: null }],
    });
  const call = <T>(fn: unknown, env: ReturnType<typeof world>, userId: string, data?: unknown) =>
    (fn as (a: { data: unknown; context: unknown }) => Promise<T>)({
      data,
      context: { supabase: env.db, userId },
    });

  it("a manager is refused the read and the save; nothing is written", async () => {
    const env = world(S());
    await expect(call(getRoofCareSettings, env, MGR)).rejects.toThrow(ROOF_CARE_ADMIN_ONLY);
    await expect(call(saveRoofCareSettings, env, MGR, S())).rejects.toThrow(ROOF_CARE_ADMIN_ONLY);
    expect(env.writes).toEqual([]);
  });
  it("an admin reads what is stored and saves the whole set, with who and when", async () => {
    const env = world();
    const before = await call<{ settings: RoofCareSettings }>(getRoofCareSettings, env, ADMIN);
    expect(before.settings).toEqual(emptyRoofCareSettings());
    const after = await call<{ settings: RoofCareSettings; updated_by_name: string }>(
      saveRoofCareSettings,
      env,
      ADMIN,
      S(),
    );
    expect(after.settings).toEqual(S());
    expect(after.updated_by_name).toBe("Ann Admin");
    expect(env.tables["roof_care_settings"]).toHaveLength(1);
    expect(env.tables["roof_care_settings"]![0]).toMatchObject({ id: 1, updated_by: ADMIN });
  });
  it("the save refuses a negative number and a roof size typed twice", async () => {
    const env = world();
    await expect(
      Promise.resolve().then(() =>
        call(saveRoofCareSettings, env, ADMIN, S({ crew_cost_per_hour: -1 })),
      ),
    ).rejects.toThrow();
    const twice = S({
      hours: [...S().hours, { sqft: 10_000, inspection: 9, drains: 9, gutters: 9 }],
    });
    await expect(call(saveRoofCareSettings, env, ADMIN, twice)).rejects.toThrow(
      "Two rows of Hours on site have the same roof size",
    );
    expect(env.writes).toEqual([]);
  });
  it("the page is behind the admin gate and is Settings' third tab", () => {
    expect(pageForPath("/admin/roof-care")).toBe("admin");
    expect(SETTINGS_TABS.map((t) => [t.label, t.to])).toEqual([
      ["Users & access", "/admin/users"],
      ["Reminders", "/admin/reminders"],
      ["Roof Care plans", "/admin/roof-care"],
    ]);
    expect(isSettingsPath("/admin/roof-care")).toBe(true);
  });
  it("the database: one row, read and written by an admin only, empty until typed", () => {
    const sql = read("supabase/migrations/20261118230000_roof_care_settings.sql")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join(" ")
      .replace(/\s+/g, " ");
    expect(sql).toContain("id integer primary key default 1 check (id = 1)");
    expect(sql).toContain("data jsonb not null default '{}'::jsonb");
    expect(sql).toContain("alter table public.roof_care_settings enable row level security;");
    expect(sql).toContain("revoke all on public.roof_care_settings from anon;");
    expect(sql).toContain(
      "for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));",
    );
    expect(sql.match(/create policy/g)).toHaveLength(1);
    expect(readGeneratedTypes()).toContain("roof_care_settings: {");
  });
  it("no price, rate or hour is in the code: the engine, the page and the database file hold none", () => {
    // The migration seeds an empty row. The engine names every number and types none.
    expect(read("supabase/migrations/20261118230000_roof_care_settings.sql")).toContain(
      "insert into public.roof_care_settings (id) values (1) on conflict (id) do nothing;",
    );
    const engine = read("src/lib/roof-care-price.ts");
    expect(engine).toContain("crew_cost_per_hour: null,");
    expect(engine).not.toMatch(/(base|per_sqft|allowance|crew_cost_per_hour|crew_size): \d/);
    expect(read("src/components/roof-care-settings.tsx")).not.toMatch(/value="\d/);
  });
});

describe("the drive from the office", () => {
  it("the address goes to the map as one line", () => {
    expect(addressLine({ address: "12 Mill St", city: "London", state: "KY", zip: "40741" })).toBe(
      "12 Mill St, London, KY 40741",
    );
    expect(addressLine({ address: "12 Mill St" })).toBe("12 Mill St");
    expect(addressLine({ address: "12 Mill St", state: "KY" })).toBe("12 Mill St, KY");
  });
  it("a one-way estimate becomes the round trip the price is worked with", () => {
    expect(roundTrip({ miles: 42.3, minutes: 55 })).toEqual({ hours: 1.83, miles: 84.6 });
    expect(roundTrip({ miles: 75, minutes: 90 })).toEqual({ hours: 3, miles: 150 });
  });
  it("uses the routing the close-out uses, and gives no price for an address it cannot place", () => {
    const fn = read("src/lib/roof-care.functions.ts");
    // Later on Nov 18 the address gained three fallbacks (roof-care-locate-nov18.test.ts); the
    // building on our own map is still asked first.
    expect(fn).toContain("const building = await geocodeAddress(sb, line, a.state ?? null);");
    // Nov 20: the same call, now also saying which router answered.
    expect(fn).toContain("const routed = await routedDriveVia(from, to).catch(() => null);");
    expect(fn).toContain("if (!to) return null;");
    const page = read("src/components/roof-care-settings.tsx");
    expect(page).toContain("{NOT_PLACED_LINE}");
    // A changed address has no drive until it is worked out again.
    expect(page).toContain("setDrive(null);");
  });
});

/**
 * Roof Care, the owner's go-aheads of Nov 20, evening: "go with 2, 11, 25, 31 ( we should
 * probably ensure if someone ticks auto renew we dont charge them more if prices change and they
 * auto renew w/o knowing)", "go with 4", and "why does it say billed at each visit?". Number 2
 * (a draft invoice's credit) has its own test.
 *
 *  11  A return trip is worked on at least the round trip the list price covers.
 *  25  The database itself refuses a size or a drive that is not a real number, terms that are
 *      not a terms version, a sign-up with no check or card, and a price other than the one shown.
 *  31  The storm inspections a plan includes are kept on the plan. The return trip's charge and
 *      a billed storm inspection keep following today's settings. A renewal paid early is dated
 *      from the old year's last day, and the receipt says so.
 *      A plan that renews by itself never charges more than was last agreed, unless told.
 *   4  A retry of the 8:00 notice tells only who has not heard.
 *  The "Billed at each visit" column is gone from the price page.
 *
 * Added the same evening ("go with ... 14, new issue 1, new issue 2"):
 *  14  A first inspection cannot be pushed so far that the second falls after the plan ends.
 *  New issue 2  A manager can change a refund that is owed; every change is kept.
 *  New issue 1  Card money that has to go back is listed until it is marked sent back.
 *
 * Every dollar figure here is made up and matches no plan price and no cost of the office's.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

type Sent = { kind: string; title: string; body: string; url: string; followup_id?: string };
const sent = vi.hoisted(() =>
  vi.fn<(ids: string[], msg: Sent, sb: unknown) => Promise<number>>(async (ids) => ids.length),
);
vi.mock("@/lib/notify.server", () => ({
  notify: sent,
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => true,
}));

import { planHoldsInvoice } from "@/lib/invoice-payment";
import { ATTENTION_DEFAULTS, attentionList } from "@/lib/owner-attention";
import { careCardBackOwed } from "@/lib/owner-attention.functions";
import { receiptEmail } from "@/lib/roof-care-email";
import {
  autoRenewCharge,
  cardBackOf,
  cardBackWords,
  firstDaysProblem,
  firstDaysTooFar,
  maxFirstDays,
  ownStormCount,
  planDates,
  readFieldPlans,
  readRefundChanges,
  refundChangeProblem,
  refundChangeWords,
  refundStatusWords,
  secondFits,
} from "@/lib/roof-care-plan";
import { changeRoofCareRefund, markRoofCareCardSentBack } from "@/lib/roof-care-plan.functions";
import {
  TRIP_FLOOR_LINE,
  emptyRoofCareSettings,
  returnTripDrive,
  roofCareQuote,
  tripChargeNote,
  tripCharged,
  tripCostAndCharge,
} from "@/lib/roof-care-price";
import {
  careNoticeGroups,
  toldKey,
  toldSet,
  type CareTicketToAnnounce,
} from "@/lib/roof-care-ticket-announce";
import { dispatchCareTicketAnnouncements } from "@/lib/roof-care-ticket-announce.server";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");
const M = "supabase/migrations/";
const TRIP = flat(`${M}20261120810000_roof_care_smallest_return_trip.sql`);
const STORM = flat(`${M}20261120820000_roof_care_storm_count_kept_on_plan.sql`);
const SANE = flat(`${M}20261120830000_roof_care_sign_up_refuses_nonsense.sql`);
const TOLD = flat(`${M}20261120840000_roof_care_ticket_told.sql`);
const FIT = flat(`${M}20261120842000_roof_care_first_inspection_must_fit.sql`);
const REFUND = flat(`${M}20261120844000_roof_care_refund_change.sql`);
const CARD = flat(`${M}20261120846000_roof_care_card_sent_back.sql`);

/** The body of one function in a migration, spaces flattened. */
const fnOf = (sql: string, name: string): string => {
  const from = sql.indexOf(`create or replace function public.${name}(`);
  expect(from, name).toBeGreaterThan(-1);
  return sql.slice(from, sql.indexOf("$function$;", from));
};

// ---- 11 -----------------------------------------------------------------------------------------

describe("11. a return trip is never worked on less than the round trip the list price covers", () => {
  const s = {
    ...emptyRoofCareSettings(),
    crew_cost_per_hour: 31,
    crew_size: 2,
    vehicle_cost_per_mile: 0.4,
    baseline_drive_hours: 3,
    baseline_miles: 90,
  };
  it("a nearer property is raised to that round trip, each of the two on its own", () => {
    expect(returnTripDrive(s, { hours: 0.25, miles: 10 })).toEqual({ hours: 3, miles: 90 });
    // A plan priced on a drive of 0 used to have no amount at all.
    expect(returnTripDrive(s, { hours: 0, miles: 0 })).toEqual({ hours: 3, miles: 90 });
    // A slow short road: its own hours, the baseline miles.
    expect(returnTripDrive(s, { hours: 5, miles: 20 })).toEqual({ hours: 5, miles: 90 });
    // Further away: its own drive, as before.
    expect(returnTripDrive(s, { hours: 6, miles: 240 })).toEqual({ hours: 6, miles: 240 });
    // No baseline typed yet: nothing to raise it to.
    expect(returnTripDrive(emptyRoofCareSettings(), { hours: 0.5, miles: 12 })).toEqual({
      hours: 0.5,
      miles: 12,
    });
  });
  it("so the property next door is charged what the baseline trip is charged", () => {
    const near = tripCostAndCharge(s, returnTripDrive(s, { hours: 0.25, miles: 10 }));
    const base = tripCostAndCharge(s, { hours: 3, miles: 90 });
    // 3 h x 2 people x 31 + 90 mi x 0.40 = 222. On its own drive it was 19.50.
    expect(base.cost).toBe(222);
    expect(tripCharged(near.charge, near.cost)).toBe(222);
    expect(tripCostAndCharge(s, { hours: 0.25, miles: 10 }).cost).toBe(19.5);
  });
  it("the note under the two boxes says it", () => {
    expect(TRIP_FLOOR_LINE).toBe(
      "This round trip is the smallest return trip: a property nearer than this is charged it too.",
    );
    expect(tripChargeNote(s)).toBe(
      `A return trip is never charged less than it costs us. For a round trip of 3 hours and 90 miles: it costs us $222.00, so it is charged at least that. Leave both boxes blank for that, or type rates here to charge more. ${TRIP_FLOOR_LINE} A property further away is charged its own drive.`,
    );
  });
  it("the database, which is what counts, raises each of the two to the baseline", () => {
    const fn = fnOf(TRIP, "roof_care_trip_charge");
    expect(fn).toContain(
      "v_bh := greatest(coalesce(nullif(d->>'baseline_drive_hours', '')::numeric, 0), 0);",
    );
    expect(fn).toContain(
      "select greatest(coalesce(p.drive_hours, 0), v_bh), greatest(coalesce(p.drive_miles, 0), v_bm) into v_hours, v_miles from public.roof_care_plans p where p.id = p_plan;",
    );
    // A plan that does not exist still has no amount.
    expect(fn).toContain("if not found then return null; end if;");
    // The rest is as it was: the higher of the rates and the cost, never zero.
    expect(fn).toContain("return nullif(greatest(nullif(v_rate, 0), nullif(v_cost, 0)), 0);");
    expect(TRIP).toContain(
      "revoke all on function public.roof_care_trip_charge(uuid) from public, anon, authenticated;",
    );
  });
});

// ---- 25 -----------------------------------------------------------------------------------------

describe("25. the database itself refuses a sign-up that makes no sense", () => {
  it("the price function refuses a size or a drive that is not a real number, or out of range", () => {
    const fn = fnOf(SANE, "roof_care_price");
    expect(fn).toContain(
      "if p_sqft is not null and (p_sqft = 'NaN'::numeric or p_sqft > 100000000) then",
    );
    expect(fn).toContain(
      "if (p_hours is not null and (p_hours = 'NaN'::numeric or p_hours > 24)) or (p_miles is not null and (p_miles = 'NaN'::numeric or p_miles > 2000)) then",
    );
    expect(fn).toContain(
      "The drive to this property did not come out as a real round trip (at most 24 hours and 2,000 miles), so there is no price. Ask an admin to check where the property is on the map.",
    );
    // The check is made before anything is read or worked out.
    expect(fn.indexOf("p_hours > 24")).toBeLessThan(fn.indexOf("public.roof_care_settings"));
    // Who may read prices is as it was (Nov 20, number 28).
    expect(fn).toContain("public.has_access('service') or public.has_access('customers')");
  });
  it("the sign-up refuses the same drive, terms that are no terms version, and no way of paying", () => {
    const fn = fnOf(SANE, "roof_care_sign_up_await_payment");
    expect(fn).toContain(
      "if p_hours = 'NaN'::numeric or p_miles = 'NaN'::numeric or p_hours > 24 or p_miles > 2000 then",
    );
    expect(fn).toContain(
      "if trim(p_terms) !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}(\\.[0-9]{1,3})?$' then raise exception 'The plan''s terms could not be read, so nothing was signed. Reload the page and sign the plan up again.';",
    );
    expect(fn).toContain(
      "if p_pay_method is null or p_pay_method not in ('check', 'card') then raise exception 'Pick how they are paying: by check or by card';",
    );
    // The terms versions the site has used, and text that is none.
    const version = /^20[0-9]{2}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$/;
    for (const ok of ["2026-11-18", "2026-11-19.4", "2026-11-20.1"])
      expect(version.test(ok), ok).toBe(true);
    for (const bad of ["whatever I like", "v2", "2026-11-20.1 and more", "1999-01-01"])
      expect(version.test(bad), bad).toBe(false);
  });
  it("with the price the screen showed, the plan is saved at that price or not at all", () => {
    const fn = fnOf(SANE, "roof_care_sign_up_await_payment");
    expect(fn).toContain("p_size_ok boolean default false, p_shown_price numeric default null)");
    expect(fn).toContain(
      "if p_shown_price is not null and round(p_shown_price) <> round((v_row->>'price')::numeric) then raise exception 'The price changed: this plan is now $%, not the $% shown.",
    );
    // The check comes before the plan is written.
    expect(fn.indexOf("p_shown_price is not null")).toBeLessThan(
      fn.indexOf("insert into public.roof_care_plans"),
    );
    // One function of that name: the old one is dropped first.
    expect(SANE).toContain(
      "drop function if exists public.roof_care_sign_up_await_payment(uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text, text, text, boolean);",
    );
    // The site's server sends what the customer was shown.
    const server = flat("src/lib/roof-care-plan.functions.ts");
    expect(server).toContain("p_shown_price: data.shown_price,");
    expect(read("src/integrations/supabase/types.ts")).toContain("p_shown_price?: number");
  });
  it("what was fixed earlier today is still there (the roof size against the map)", () => {
    const fn = fnOf(SANE, "roof_care_sign_up_await_payment");
    expect(fn).toContain("if v_map is not null and p_sqft < v_map * 0.8 then");
    expect(fn).toContain("v_map, v_map is null,");
  });
});

// ---- 31 -----------------------------------------------------------------------------------------

describe("31. the storm inspections a plan includes are kept on the plan", () => {
  it("the plan's own number wins; the setting is only for a plan from before it was kept", () => {
    // Signed with 1; the setting was later raised to 3: this plan still includes 1.
    expect(ownStormCount(1, 3)).toBe(1);
    // Signed with 2; the setting was later lowered to 0: still 2.
    expect(ownStormCount(2, 0)).toBe(2);
    // A plan that includes none says none, whatever the setting.
    expect(ownStormCount(0, 4)).toBe(0);
    // No number on the plan: the setting, as before.
    expect(ownStormCount(null, 3)).toBe(3);
    expect(ownStormCount(undefined, undefined)).toBe(0);
    expect(ownStormCount("2", 5)).toBe(2);
    expect(ownStormCount(-1, 2)).toBe(2);
  });
  it("a technician's read of a plan carries the plan's own number", () => {
    const [p] = readFieldPlans(
      [
        {
          id: "33333333-3333-4333-8333-333333333331",
          account_id: "11111111-1111-4111-8111-111111111111",
          site_id: "22222222-2222-4222-8222-222222222221",
          plan: "guard",
          status: "active",
          pay_first: true,
          plan_number: 1001,
          first_visit: "now",
          signed_on: "2026-11-01",
          renews_on: "2027-11-01",
          roof_sqft: 20000,
          agreed_by: "Pat Smith",
          sold_by_name: "Tom Tech",
          storm_included: 1,
          visits: [],
        },
      ],
      { guard: 3 },
    );
    expect(p?.storm_included).toBe(1);
  });
  it("the database keeps it at a sign-up and at a renewal, and reads it for the storm inspection", () => {
    expect(STORM).toContain(
      "add column if not exists storm_included integer check (storm_included is null or (storm_included >= 0 and storm_included <= 24));",
    );
    // Plans from before: filled in once from the setting of that day.
    expect(STORM).toContain("update public.roof_care_plans p set storm_included = case when");
    const state = fnOf(STORM, "roof_care_storm_state");
    expect(state).toContain(
      "v_allowed := p.storm_included; if v_allowed is null then select greatest(round(coalesce(nullif(s.data->>'guard_storm_inspections', '')::numeric, 0))::integer, 0) into v_allowed",
    );
    const insert = "repair_allowance, free_travel_calls, storm_included, pay_method, pay_note,";
    expect(fnOf(STORM, "roof_care_renew")).toContain(insert);
    expect(fnOf(SANE, "roof_care_sign_up_await_payment")).toContain(insert);
    expect(fnOf(STORM, "roof_care_field_plans")).toContain("'storm_included', p.storm_included,");
    // The office's read asks for the column and uses the plan's own number.
    const server = flat("src/lib/roof-care-plan.functions.ts");
    expect(server).toContain("free_travel_calls, storm_included, pay_method,");
    expect(server).toContain(
      "storm_included: ownStormCount(p.storm_included, benefits?.[plan].storm),",
    );
  });
  it("what a return trip is charged and a billed storm inspection keep following today's settings", () => {
    // On purpose: prices of work not yet done. Nothing of them is kept on the plan.
    const trip = fnOf(TRIP, "roof_care_trip_charge");
    expect(trip).toContain("select s.data into d from public.roof_care_settings s where s.id = 1;");
    expect(trip).toContain("nullif(d->>'trip_charge_per_hour', '')::numeric");
    const state = fnOf(STORM, "roof_care_storm_state");
    expect(state).toContain(
      "v_price := public.roof_care_price(p.roof_sqft, p.drive_hours, p.drive_miles);",
    );
    const types = read("src/integrations/supabase/types.ts");
    expect(types).not.toContain("trip_charge_kept");
    expect(types).not.toContain("storm_price_kept");
  });
});

describe("31. a renewal paid before the old year is over loses no day", () => {
  const facts = {
    plan: "guard" as const,
    plan_number: 1042,
    site: "Main Plant",
    address: "",
    agreed_by: "Pat Smith",
    signed_on: "2026-11-20",
    price: 2468,
    pay_method: "check" as const,
    first_visit: "window" as const,
    first_days: null,
    terms_version: "2026-11-20.1",
    benefits: null,
    company: "JBK Test Roofing",
    contact: "",
  };
  it("the new year is dated from the old year's last day (the database)", () => {
    // 20261120730000 held the newest roof_care_start that night. Since Nov 23 the new year
    // starts the day AFTER the old year's last day (20261124200000, the owner: "start the new
    // year the day after"); roof-care-go-aheads-nov23-night.test.ts guards that.
    const start = fnOf(
      flat(`${M}20261120730000_roof_care_merge_and_renewal_note.sql`),
      "roof_care_start",
    );
    expect(start).toContain("v_start := greatest(v_paid, v_old.renews_on);");
    expect(start).toContain("v_renews := (v_start + interval '1 year')::date;");
    // The first inspection of a renewal waits for the new year: the window open on its first
    // day, never one before it.
    expect(start).toContain("v_day := greatest(v_today, v_start);");
    // A carried inspection is owed 60 days into the new year, counted from its first day.
    expect(start).toContain("due_by = v_start + 60");
  });
  it("the receipt says when the new year starts, and that there is no break", () => {
    // Paid Nov 20; the old year runs to Dec 20: the new one is Dec 21, 2026 to Dec 20, 2027
    // (Nov 23: it starts the day after, so Dec 20 is not covered by both years).
    const early = receiptEmail({
      ...facts,
      paid: 2468,
      paid_on: "2026-11-20",
      starts_on: "2026-12-21",
      renews_on: "2027-12-20",
      invoice_number: null,
    });
    expect(early.text).toContain(
      "Your new plan year starts Dec 21, 2026, the day after your current plan year ends, and runs until Dec 20, 2027. You are covered without a break.",
    );
    expect(early.text).not.toContain("Your plan started");
    // Paid on its first day, or a first plan: as before.
    const usual = receiptEmail({
      ...facts,
      paid: 2468,
      paid_on: "2026-11-20",
      starts_on: "2026-11-20",
      renews_on: "2027-11-20",
      invoice_number: null,
    });
    expect(usual.text).toContain("Your plan started Nov 20, 2026 and runs until Nov 20, 2027.");
  });
  it("the plan on the property page says the same", () => {
    const card = flat("src/components/roof-care/plan-card.tsx");
    expect(card).toContain("? ` Paid. The plan year starts ${longDay(active.starts_on)}.`");
  });
});

describe("31. a plan that renews by itself never charges more than was last agreed, unless told", () => {
  const renews = "2027-11-20";
  it("the price went up and nobody told them: the price they agreed to is charged", () => {
    expect(autoRenewCharge(2000, 2300, null, renews)).toEqual({ charge: 2000, held: true });
  });
  it("told the new price before the renewal day: the new price", () => {
    expect(autoRenewCharge(2000, 2300, { price: 2300, on: "2027-10-15" }, renews)).toEqual({
      charge: 2300,
      held: false,
    });
  });
  it("told on the day itself, or after, is not told beforehand", () => {
    for (const on of ["2027-11-20", "2027-11-25"])
      expect(autoRenewCharge(2000, 2300, { price: 2300, on }, renews)).toEqual({
        charge: 2000,
        held: true,
      });
  });
  it("never more than the price they were told", () => {
    expect(autoRenewCharge(2000, 2500, { price: 2300, on: "2027-10-15" }, renews)).toEqual({
      charge: 2300,
      held: true,
    });
  });
  it("a price that went down, or did not move, is charged as it is", () => {
    expect(autoRenewCharge(2000, 1900, null, renews)).toEqual({ charge: 1900, held: false });
    expect(autoRenewCharge(2000, 2000, null, renews)).toEqual({ charge: 2000, held: false });
    // Told a lower price that never came: the price agreed to still caps it.
    expect(autoRenewCharge(2000, 2150, { price: 1750, on: "2027-10-15" }, renews)).toEqual({
      charge: 2000,
      held: true,
    });
  });
  it("a renewal made by hand shows today's price and refuses one that moved since", () => {
    const renew = fnOf(STORM, "roof_care_renew");
    expect(renew).toContain(
      "if p_shown_price is not null and round(p_shown_price) <> round(v_amount) then raise exception 'The price changed: this plan is now $%, not the $% shown.",
    );
    expect(flat("src/lib/roof-care-plan.functions.ts")).toContain(
      "p_shown_price: data.shown_price,",
    );
  });
  it("the rule is written where the Stripe work will find it", () => {
    const doc = flat("docs/roof-care-plans.md");
    expect(doc).toContain(
      "A plan that renews by itself never charges more than the yearly price the customer last agreed to, unless they were told the new price before the renewal day and the telling is on record",
    );
    expect(doc).toContain("`autoRenewCharge()`");
  });
});

// ---- new issue 4 -------------------------------------------------------------------------------

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TECH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACC = "11111111-1111-4111-8111-111111111111";
const job = (n: number) => `44444444-4444-4444-8444-4444444440${String(n).padStart(2, "0")}`;
const visit = (n: number) => `55555555-5555-4555-8555-5555555550${String(n).padStart(2, "0")}`;
const MORNING = new Date("2026-11-20T14:00:00Z");
const LATER = new Date("2026-11-20T14:05:00Z");

const profiles = [
  { id: ADMIN, role: "admin", access: [], technician: false, full_name: "Ada Admin", email: "a@x" },
  {
    id: MANAGER,
    role: "manager",
    access: [],
    technician: false,
    full_name: "Mo Manager",
    email: "m@x",
  },
  {
    id: TECH,
    role: "user",
    access: ["service"],
    technician: true,
    full_name: "Tia Tech",
    email: "t@x",
  },
];
const careJob = (n: number, over: Row = {}): Row => ({
  id: job(n),
  number: 7000 + n,
  account_id: ACC,
  site_id: "22222222-2222-4222-8222-222222222221",
  customer_name: "Made Up Mills",
  site_name: `Plant ${n}`,
  description: "Care plan inspection (Roof Care), visit 1 of 2",
  service_type: "inspection",
  stage: "open",
  technician_id: null,
  scheduled_date: null,
  roof_care_visit_id: visit(n),
  invoice_id: null,
  notes_tech_visible: true,
  helper_count: 0,
  deleted_at: null,
  created_by: null,
  updated_by_name: "Roof Care plans",
  ...over,
});
/** The database functions of 20261120700000 and 20261120840000, over the in-memory tables. */
const rpcs = (timer?: FakeRpc): Record<string, FakeRpc> => ({
  roof_care_ticket_announce_claim: (_args, tables) => {
    const notices = (tables["roof_care_ticket_notices"] ??= []);
    const out: Row[] = [];
    for (const j of tables["service_jobs"] ?? []) {
      if (notices.some((n) => n["service_job_id"] === j["id"])) continue;
      notices.push({ service_job_id: j["id"], claimed_at: "now", announced_at: null });
      out.push({
        id: j["id"],
        number: j["number"],
        customer_name: j["customer_name"],
        site_name: j["site_name"],
        description: j["description"],
        stage: j["stage"],
        account_id: j["account_id"],
        technician_id: j["technician_id"],
        scheduled_date: j["scheduled_date"],
        plan: "care",
        visit_kind: "visit1",
        due_from: "2026-11-25",
        due_by: "2026-12-30",
      });
    }
    return out;
  },
  roof_care_ticket_announce_finish: (args, tables) => {
    const ids = args["p_ids"] as string[];
    const notices = (tables["roof_care_ticket_notices"] ??= []);
    const mine = notices.filter(
      (n) => ids.includes(String(n["service_job_id"])) && n["announced_at"] == null,
    );
    if (args["p_written"]) for (const n of mine) n["announced_at"] = "now";
    else tables["roof_care_ticket_notices"] = notices.filter((n) => !mine.includes(n));
    return mine.length;
  },
  roof_care_ticket_told_list: (args, tables) =>
    (tables["roof_care_ticket_told"] ?? []).filter((r) =>
      (args["p_ids"] as string[]).includes(String(r["service_job_id"])),
    ),
  roof_care_ticket_told_mark: (args, tables) => {
    const rows = (tables["roof_care_ticket_told"] ??= []);
    let n = 0;
    for (const j of args["p_jobs"] as string[])
      for (const who of args["p_people"] as string[]) {
        if (rows.some((r) => r["service_job_id"] === j && r["profile_id"] === who)) continue;
        rows.push({ service_job_id: j, profile_id: who });
        n++;
      }
    return n;
  },
  followup_sync_upsert:
    timer ??
    ((args) => ({
      action: "started",
      id: `f-${String(args["p_item_id"])}`,
      due_at: "2026-11-23T13:00:00Z",
      every_days: 2,
      first_remind_at: "2026-11-23T13:00:00Z",
    })),
});
const world = (jobs: Row[], timer?: FakeRpc) =>
  fakeSupabase(
    {
      profiles,
      crm_settings: [{ id: 1 }],
      service_jobs: jobs,
      roof_care_ticket_notices: [],
      roof_care_ticket_told: [],
    },
    { rpcs: rpcs(timer) },
  );
/** Every notice that was written (one that failed is not here). */
const written: { ids: string[]; msg: Sent }[] = [];
const write = (ids: string[], msg: Sent): number => {
  written.push({ ids, msg });
  return ids.length;
};
/** Each "Opened" notice that was written: who got it, and the ticket numbers it names. */
const opened = () =>
  written
    .filter((w) => w.msg.kind === "ticket_watch")
    .map((w) => ({
      to: [...w.ids].sort(),
      tickets: [...`${w.msg.title} ${w.msg.body}`.matchAll(/#(7\d{3})/g)].map((x) => Number(x[1])),
    }));

beforeEach(() => {
  sent.mockReset();
  written.length = 0;
  sent.mockImplementation(async (ids, msg) => write(ids, msg));
});

describe("4. a retry of the 8:00 notice tells only who has not heard", () => {
  const t = (n: number, over: Partial<CareTicketToAnnounce> = {}): CareTicketToAnnounce => ({
    id: job(n),
    number: 7000 + n,
    customer_name: "Made Up Mills",
    site_name: `Plant ${n}`,
    description: "",
    stage: "open",
    account_id: ACC,
    technician_id: null,
    scheduled_date: null,
    plan: "care",
    visit_kind: "visit1",
    due_from: "2026-11-25",
    due_by: "2026-12-30",
    ...over,
  });

  it("a person is left out of the tickets they have already heard", () => {
    const list = [t(1), t(2)];
    const told = toldSet([
      { service_job_id: job(1), profile_id: ADMIN },
      { service_job_id: job(2), profile_id: ADMIN },
      { service_job_id: job(2), profile_id: MANAGER },
    ]);
    expect(told.has(toldKey(job(1), ADMIN))).toBe(true);
    // The admin has heard both: nothing. The manager has heard one: the other only.
    expect(careNoticeGroups(list, [ADMIN, MANAGER], told)).toEqual([
      { ids: [MANAGER], tickets: [list[0]] },
    ]);
    // Nobody told yet: as before.
    expect(careNoticeGroups(list, [ADMIN, MANAGER])).toEqual([
      { ids: [ADMIN, MANAGER], tickets: list },
    ]);
    expect(toldSet(null).size).toBe(0);
  });

  it("one group's notice fails: the next run tells that group only, not everyone again", async () => {
    // Ticket 2 is the manager's own, so the manager's Opened notice names ticket 1 alone and
    // the admin's names both: two groups, two sends.
    const env = world([careJob(1), careJob(2, { technician_id: MANAGER })]);
    let failOnce = true;
    sent.mockImplementation(async (ids, msg) => {
      if (failOnce && msg.kind === "ticket_watch" && ids.includes(MANAGER)) {
        failOnce = false;
        throw new Error("the notices table hiccuped");
      }
      return write(ids, msg);
    });
    const first = await dispatchCareTicketAnnouncements(env.db, MORNING);
    expect(first).toMatchObject({ tickets_checked: 2, tickets_announced: 1, tickets_held: 1 });
    // The admin heard both tickets; the manager's notice was not written.
    expect(opened()).toEqual([{ to: [ADMIN], tickets: [7001, 7002] }]);
    expect(
      (env.tables["roof_care_ticket_told"] ?? []).map(
        (r) =>
          `${String(r["service_job_id"]).slice(-2)}:${r["profile_id"] === ADMIN ? "admin" : "?"}`,
      ),
    ).toEqual(["01:admin", "02:admin"]);

    sent.mockClear();
    written.length = 0;
    const second = await dispatchCareTicketAnnouncements(env.db, LATER);
    expect(second).toMatchObject({ tickets_checked: 1, tickets_announced: 1, tickets_held: 0 });
    // Only the manager, about the ticket that was held. Before, the admin heard #7001 twice.
    expect(opened()).toEqual([{ to: [MANAGER], tickets: [7001] }]);
    // Nothing is left to tell.
    sent.mockClear();
    written.length = 0;
    const third = await dispatchCareTicketAnnouncements(env.db, new Date(LATER.getTime() + 60_000));
    expect(third.tickets_checked).toBe(0);
    expect(sent).not.toHaveBeenCalled();
  });

  it("a ticket held back for its timer is not announced a second time to those who heard", async () => {
    let timerFails = true;
    const env = world(
      [careJob(1, { technician_id: TECH, scheduled_date: "2026-11-23" }), careJob(2)],
      (args) => {
        if (timerFails) throw new Error("the timer function failed");
        return {
          action: "started",
          id: `f-${String(args["p_item_id"])}`,
          due_at: "2026-11-23T13:00:00Z",
          every_days: 2,
          first_remind_at: "2026-11-23T13:00:00Z",
        };
      },
    );
    const first = await dispatchCareTicketAnnouncements(env.db, MORNING);
    expect(first).toMatchObject({ tickets_announced: 1, tickets_held: 1 });
    expect(opened()).toEqual([{ to: [ADMIN, MANAGER], tickets: [7001, 7002] }]);
    sent.mockClear();
    written.length = 0;
    timerFails = false;
    const second = await dispatchCareTicketAnnouncements(env.db, LATER);
    expect(second).toMatchObject({ tickets_checked: 1, tickets_announced: 1, timers_started: 1 });
    // The admins and managers are not told about #7001 again; its technician now is.
    expect(opened()).toEqual([]);
    expect(written.map((w) => `${w.msg.kind}:${w.ids.join(",")}`)).toEqual([`assigned:${TECH}`]);
  });

  it("when who was told cannot be read, the run goes on: a second notice beats none", async () => {
    const env = fakeSupabase(
      {
        profiles,
        crm_settings: [{ id: 1 }],
        service_jobs: [careJob(1)],
        roof_care_ticket_notices: [],
      },
      {
        rpcs: {
          ...rpcs(),
          roof_care_ticket_told_list: () => {
            throw new Error("not reachable");
          },
        },
      },
    );
    const r = await dispatchCareTicketAnnouncements(env.db, MORNING);
    // The ticket is told as if nobody had heard, and marked announced.
    expect(r).toMatchObject({ tickets_checked: 1, tickets_announced: 1, tickets_held: 0 });
    expect(opened()).toEqual([{ to: [ADMIN, MANAGER], tickets: [7001] }]);
  });

  it("the database keeps who was told beside the ticket, for the server alone", () => {
    expect(TOLD).toContain(
      "create table if not exists public.roof_care_ticket_told ( service_job_id uuid not null references public.service_jobs (id) on delete cascade, profile_id uuid not null references public.profiles (id) on delete cascade, told_at timestamptz not null default now(), primary key (service_job_id, profile_id) );",
    );
    expect(TOLD).toContain("alter table public.roof_care_ticket_told enable row level security;");
    expect(TOLD).toContain(
      "revoke all on table public.roof_care_ticket_told from public, anon, authenticated;",
    );
    for (const f of [
      "roof_care_ticket_told_list(uuid[])",
      "roof_care_ticket_told_mark(uuid[], uuid[])",
    ]) {
      expect(TOLD).toContain(
        `revoke all on function public.${f} from public, anon, authenticated;`,
      );
      expect(TOLD).toContain(`grant execute on function public.${f} to service_role;`);
    }
    expect(fnOf(TOLD, "roof_care_ticket_told_mark")).toContain(
      "on conflict (service_job_id, profile_id) do nothing;",
    );
    const server = flat("src/lib/roof-care-ticket-announce.server.ts");
    expect(server).toContain("for (const g of careNoticeGroups(tickets, watchers, told)) {");
    // Written only after the notice went out.
    expect(server.indexOf("await notify(g.ids, { kind: TICKET_WATCH_KIND")).toBeLessThan(
      server.indexOf('rpc("roof_care_ticket_told_mark"'),
    );
  });
});

// ---- "Billed at each visit" --------------------------------------------------------------------

describe('"Billed at each visit" is gone from the price page', () => {
  it("Try a building shows the yearly price, with no half per visit", () => {
    const page = read("src/components/roof-care-settings.tsx");
    expect(page).not.toContain("Billed at each visit");
    expect(page).not.toMatch(/\bper_visit\b/);
    expect(page).toContain("Price a year");
  });
  it("the quote holds one yearly amount", () => {
    const s = {
      ...emptyRoofCareSettings(),
      crew_cost_per_hour: 31,
      crew_size: 2,
      baseline_drive_hours: 3,
      baseline_miles: 90,
      vehicle_cost_per_mile: 0.4,
    };
    const r = roofCareQuote(s, { sqft: 12_000, drive: { hours: 3, miles: 90 } });
    // Whatever else is still to type, no plan row carries a half per visit.
    for (const p of r.quote?.plans ?? []) expect("per_visit" in p).toBe(false);
    expect(read("src/lib/roof-care-price.ts")).not.toMatch(/\bper_visit\b/);
  });
});

// ---- 14 -----------------------------------------------------------------------------------------

describe("14. a first inspection cannot be pushed so far that the second falls after the plan ends", () => {
  // The largest number of days that still fits, as the database answered for the same days
  // (roof_care_max_first_days, Nov 20): screen and database are one rule.
  const FROM_THE_DATABASE: Record<string, number> = {
    "2026-11-20": 245,
    "2026-01-10": 222,
    "2026-03-01": 172,
    "2026-05-02": 245,
    "2026-05-03": 244,
    "2026-07-04": 182,
    "2026-09-30": 94,
    "2026-12-31": 232,
    "2027-02-28": 173,
    "2028-02-29": 173,
  };
  it("the screen works out the same largest number of days as the database", () => {
    for (const [day, max] of Object.entries(FROM_THE_DATABASE))
      expect(maxFirstDays(day), day).toBe(max);
  });
  it("one day more is refused, in the database's own words; the largest is not", () => {
    // Signed Nov 20, 2026: 245 days puts the first on Jul 23, 2027 and the second on the plan's
    // last day, Nov 20, 2027. 246 days would put the second in March 2028.
    const fits = planDates("2026-11-20", "days", 245)!;
    expect(fits.first.from).toBe("2027-07-23");
    expect(fits.second.from).toBe("2027-11-20");
    expect(fits.renews).toBe("2027-11-20");
    expect(secondFits(fits)).toBe(true);
    expect(firstDaysProblem("2026-11-20", "days", 245)).toBeNull();
    const late = planDates("2026-11-20", "days", 246)!;
    expect(late.second.from > late.renews).toBe(true);
    expect(firstDaysProblem("2026-11-20", "days", 246)).toBe(
      "The second inspection would fall after the plan ends. Choose 245 days or fewer, or pick the inspection window.",
    );
    // The break test's own case.
    expect(firstDaysProblem("2026-11-20", "days", 250)).toBe(firstDaysTooFar(245));
    // A number that is not 1 to 365 has its own line; nothing is said here.
    expect(firstDaysProblem("2026-11-20", "days", 0)).toBeNull();
    expect(firstDaysProblem("2026-11-20", "days", null)).toBeNull();
  });
  it("today and the inspection window fit on every day of two years", () => {
    let d = "2026-01-01";
    let bad = 0;
    for (let n = 0; n < 731; n++) {
      for (const first of ["now", "window"] as const) {
        if (!secondFits(planDates(d, first, null)!)) bad++;
        expect(firstDaysProblem(d, first, null)).toBeNull();
      }
      d = planDates(d, "days", 1)!.first.from;
    }
    expect(bad).toBe(0);
  });
  it("the sign-up says it under the days box and keeps the button off", () => {
    const card = flat("src/components/roof-care/plan-card.tsx");
    expect(card).toContain("const daysTooFar = firstDaysProblem(today, first, dayCount);");
    expect(card).toContain('daysBad: first === "days" && (!dates || !!daysTooFar),');
    expect(card).toContain(
      '{daysTooFar && ( <p className="text-xs text-destructive" data-sign-line="days-too-far"> {daysTooFar} </p> )}',
    );
  });
  it("the database refuses it at the sign-up, and brings it forward at a late payment", () => {
    const fits = fnOf(FIT, "roof_care_second_fits");
    expect(fits).toContain(
      "select x.f <= p_last from (select greatest(w.w_from, p_first + 120) as f, w.w_to as t from public.roof_care_windows(p_first + 120) w) x where x.t - x.f >= 13 order by x.f limit 1",
    );
    const sign = fnOf(FIT, "roof_care_sign_up_await_payment");
    expect(sign).toContain(
      "if p_first = 'days' and not public.roof_care_second_fits(v_today + p_days, (v_today + interval '1 year')::date) then raise exception 'The second inspection would fall after the plan ends. Choose % days or fewer, or pick the inspection window.', public.roof_care_max_first_days(v_today);",
    );
    // Everything the earlier evening's sign-up refuses is still refused.
    expect(sign).toContain("if p_pay_method is null or p_pay_method not in ('check', 'card') then");
    expect(sign).toContain("p_shown_price is not null");
    const start = fnOf(FIT, "roof_care_start");
    // The payment is never refused for it: the first inspection is brought forward.
    expect(start).toContain(
      "while v_days > 1 and not public.roof_care_second_fits(v_today + v_days, (v_start + interval '1 year')::date) loop v_days := v_days - 1; end loop;",
    );
    expect(start).toContain(
      "first_days = case when first_visit = 'days' then v_days else first_days end,",
    );
    // A renewal paid early is still dated from the old year's last day (as of that migration;
    // since Nov 23 from the day after it, 20261124200000).
    expect(start).toContain("v_start := greatest(v_paid, v_old.renews_on);");
    for (const f of ["roof_care_second_fits(date, date)", "roof_care_max_first_days(date)"])
      expect(FIT).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
    expect(FIT).toContain(
      "revoke all on function public.roof_care_start(uuid, date) from public, anon, authenticated;",
    );
  });
});

// ---- new issue 2 --------------------------------------------------------------------------------

const PLAN_ID = "33333333-3333-4333-8333-333333333331";
const callAs = <T>(fn: unknown, db: unknown, data: unknown, userId = ADMIN) =>
  (fn as (a: { data: unknown; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: db, userId },
  });

describe("new issue 2. a manager can change a refund that is owed", () => {
  const change = {
    from: 612,
    to: 0,
    reason: "check bounced",
    by_name: "Mo Manager",
    on: "2026-11-20",
  };
  it("every change is kept and said: from, to, who, when, why", () => {
    expect(refundChangeWords(change)).toBe(
      "Changed from $612.00 to $0.00 by Mo Manager on Nov 20, 2026: check bounced",
    );
    expect(readRefundChanges([change, "junk", { from: "x" }, null])).toEqual([change]);
    expect(readRefundChanges(null)).toEqual([]);
  });
  it("a refund changed to nothing says so, and one never changed says nothing at 0", () => {
    expect(refundStatusWords({ due: 0, sent_on: null, ref: null, changes: [change] })).toBe(
      "No refund is owed.",
    );
    expect(refundStatusWords({ due: 0, sent_on: null, ref: null })).toBe("");
    expect(refundStatusWords({ due: 612, sent_on: null, ref: null })).toBe("Refund owed: $612.00.");
  });
  it("the box refuses a blank amount, one below zero, the same amount, and no reason", () => {
    expect(refundChangeProblem("", "check bounced", 612)).toBe("Type the refund: 0 or more");
    expect(refundChangeProblem("-5", "x", 612)).toBe("Type the refund: 0 or more");
    expect(refundChangeProblem("$612.00", "x", 612)).toBe("The refund is already $612.00.");
    expect(refundChangeProblem("0", "  ", 612)).toBe("Type why the refund is changed");
    expect(refundChangeProblem("0", "check bounced", 612)).toBeNull();
    expect(refundChangeProblem("1,275.50", "they paid more", 612)).toBeNull();
  });
  it("the server hands it to the database, which decides who may", async () => {
    const env = fakeSupabase(
      { profiles },
      { rpcs: { roof_care_change_refund: () => ({ from: 612, to: 0 }) } },
    );
    await callAs(changeRoofCareRefund, env.db, {
      plan_id: PLAN_ID,
      amount: 0,
      reason: " check bounced ",
    });
    expect(env.rpcCalls.filter((c) => c.fn === "roof_care_change_refund")).toEqual([
      {
        fn: "roof_care_change_refund",
        args: { p_plan: PLAN_ID, p_amount: 0, p_reason: "check bounced" },
      },
    ]);
    // No reason, or an amount below zero, never reaches the database.
    for (const bad of [
      { plan_id: PLAN_ID, amount: 0, reason: "  " },
      { plan_id: PLAN_ID, amount: -1, reason: "x" },
    ])
      expect(() => callAs(changeRoofCareRefund, env.db, bad)).toThrow();
    // The database's refusal comes back in its own words.
    const no = fakeSupabase(
      { profiles },
      {
        rpcs: {
          roof_care_change_refund: () => {
            throw new Error("Only a manager or an admin changes a refund");
          },
        },
      },
    );
    await expect(
      callAs(changeRoofCareRefund, no.db, { plan_id: PLAN_ID, amount: 0, reason: "x" }),
    ).rejects.toThrow("Only a manager or an admin changes a refund");
  });
  it("the database: a manager's, on an ended plan, not once sent, never more than was paid", () => {
    const fn = fnOf(REFUND, "roof_care_change_refund");
    expect(fn).toContain(
      "if auth.uid() is null or not (public.is_admin() or public.is_manager()) then raise exception 'Only a manager or an admin changes a refund'",
    );
    expect(fn).toContain("if not found or p.status <> 'ended' then");
    expect(fn).toContain(
      "if p.refund_sent_on is not null then raise exception 'This refund was marked sent on %, so it cannot be changed.',",
    );
    expect(fn).toContain("if p_amount is null or p_amount = 'NaN'::numeric or p_amount < 0 then");
    expect(fn).toContain("if coalesce(trim(p_reason), '') = '' then");
    expect(fn).toContain(
      "if v_new > v_paid then raise exception 'The refund cannot be more than the $% paid for this plan year.',",
    );
    // What it was, what it is, why, who and when are added to the plan's list of changes.
    expect(fn).toContain(
      "refund_changes = coalesce(refund_changes, '[]'::jsonb) || jsonb_build_array(v_entry),",
    );
    expect(REFUND).toContain(
      "add column if not exists refund_changes jsonb not null default '[]'::jsonb;",
    );
  });
  it("what reads the refund follows the new amount: at 0 nothing is owed anywhere", () => {
    // Needs attention: no row for a refund of nothing.
    const list = attentionList({
      today: "2026-11-25",
      now: "2026-11-25T15:00:00Z",
      limits: ATTENTION_DEFAULTS,
      tickets: [],
      untouched: [],
      opps: [],
      bids: [],
      invoices: [],
      followups: [],
      repairFrom: [],
      bidFrom: [],
      names: {},
      careRefunds: [
        { plan_id: "p0", site_id: "s1", title: "t", ended_on: "2026-11-20", amount: 0 },
        { plan_id: "p1", site_id: "s1", title: "t", ended_on: "2026-11-20", amount: 123.46 },
      ],
    });
    expect(list.rows.filter((r) => r.kind === "care_plan_refund").map((r) => r.amount)).toEqual([
      123.46,
    ]);
    // The server reads only plans with something owed, and the Roof Care income the same.
    expect(flat("src/lib/owner-attention.functions.ts")).toContain(
      '.eq("status", "ended") .gt("refund_due", 0) .is("refund_sent_on", null);',
    );
    const margin = flat("src/lib/margin-report.functions.ts");
    expect(margin).toContain('.gt("refund_due", 0)');
    expect(margin).toContain("subtotal: -(Number(p.refund_due) || 0),");
    // The payment a refund was worked from stays while the refund stands, and can come off at 0
    // (the bounced check).
    const paid = { status: "paid", total: 840, paid_amount: 840 };
    const ended = (refund_due: number) => ({ status: "ended", plan_number: 1042, refund_due });
    expect(planHoldsInvoice(ended(612), paid, { status: "final", paid_amount: 0 })).toContain(
      "The payment stays on the invoice while that refund stands.",
    );
    expect(planHoldsInvoice(ended(0), paid, { status: "final", paid_amount: 0 })).toBeNull();
  });
  it("the plan's card: the button is a manager's, and gone once the refund is marked sent", () => {
    const card = flat("src/components/roof-care/plan-card.tsx");
    expect(card).toContain(
      '{manager && !r.sent_on && !changing && ( <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setChanging(true)} data-action="roof-care-refund-change" > {REFUND_CHANGE} </Button> )}',
    );
    expect(card).toContain(
      "disabled={!!refundChangeProblem(amount, why, r.due) || change.isPending}",
    );
    expect(card).toContain(
      '{(r.changes ?? []).map((c, i) => ( <p key={i} className="text-muted-foreground" data-refund-change> {refundChangeWords(c)} </p> ))}',
    );
    // Nothing to send at 0.
    expect(card).toContain("{!r.sent_on && r.due > 0 && (");
    expect(flat("src/lib/roof-care-plan.functions.ts")).toContain(
      "changes: readRefundChanges(p.refund_changes),",
    );
  });
});

// ---- new issue 1 --------------------------------------------------------------------------------

describe("new issue 1. card money that has to go back is listed until it is marked sent back", () => {
  const row = {
    id: "66666666-6666-4666-8666-666666666661",
    plan_id: PLAN_ID,
    outcome: "send_back",
    reason: "paid_already" as string | null,
    amount: 840,
    over: 0,
    owed: null as number | null,
    ref: "pi_9",
    paid_on: "2026-11-20",
    sent_back_on: null as string | null,
    sent_back_ref: null as string | null,
    sent_back_by_name: null as string | null,
  };
  it("what is owed back of a card payment: all of one to send back, the part over of one that started the plan", () => {
    expect(cardBackOf(row)).toMatchObject({ owed: 840, why: "paid_already", sent_back: null });
    expect(cardBackOf({ ...row, reason: "ended" })?.why).toBe("ended");
    expect(cardBackOf({ ...row, reason: "short", amount: 740, owed: 840 })).toMatchObject({
      owed: 740,
      why: "short",
      was_owed: 840,
    });
    expect(
      cardBackOf({ ...row, outcome: "started", reason: null, amount: 940, over: 100 }),
    ).toMatchObject({ owed: 100, why: "over" });
    // A payment that started the plan with nothing over owes nothing back.
    expect(cardBackOf({ ...row, outcome: "started", reason: null, over: 0 })).toBeNull();
  });
  it("the words on the plan's card, owed and sent", () => {
    expect(cardBackWords(cardBackOf(row)!)).toBe(
      "Card money to send back: $840.00. The plan was already paid when this card payment came in. Paid Nov 20, 2026, reference pi_9.",
    );
    expect(cardBackWords(cardBackOf({ ...row, reason: "short", amount: 740, owed: 840 })!)).toBe(
      "Card money to send back: $740.00. It did not cover the $840.00 owed, so the plan did not start on it. Paid Nov 20, 2026, reference pi_9.",
    );
    expect(
      cardBackWords(
        cardBackOf({
          ...row,
          sent_back_on: "2026-11-21",
          sent_back_ref: "re_3",
          sent_back_by_name: "Mo Manager",
        })!,
      ),
    ).toBe("Sent back $840.00 on Nov 21, 2026 (re_3) by Mo Manager.");
  });
  it("Needs attention: red from the first day, with the amount, the reference and how old", () => {
    const list = attentionList({
      today: "2026-11-25",
      now: "2026-11-25T15:00:00Z",
      limits: ATTENTION_DEFAULTS,
      tickets: [],
      untouched: [],
      opps: [],
      bids: [],
      invoices: [],
      followups: [],
      repairFrom: [],
      bidFrom: [],
      names: {},
      careCardBack: [
        {
          payment_id: row.id,
          site_id: "s1",
          title: "Roof Care · Main Plant (Acme)",
          amount: 840,
          ref: "pi_9",
          paid_on: "2026-11-20",
          why: "The plan was already paid when this card payment came in.",
        },
      ],
    });
    const r = list.rows.find((x) => x.kind === "care_plan_card_back")!;
    expect(r.key).toBe(`care_plan_card_back:${row.id}`);
    expect(r.tone).toBe("red");
    expect(r.amount).toBe(840);
    expect(r.age).toBe(5);
    expect(r.href).toBe("/properties/s1");
    expect(r.why).toBe(
      "A card payment has to go back to the customer. The plan was already paid when this card payment came in. Reference pi_9. Send it back, then a manager or an admin marks it sent back on the property.",
    );
  });
  it("the server lists what is still owed back, whatever became of the plan, and drops what was sent", async () => {
    const SITE = "22222222-2222-4222-8222-222222222221";
    const env = fakeSupabase({
      roof_care_card_payments: [
        row,
        // Sent back already: not listed.
        {
          ...row,
          id: "66666666-6666-4666-8666-666666666662",
          ref: "pi_8",
          sent_back_on: "2026-11-21",
        },
        // Started the plan with nothing over: nothing owed.
        {
          ...row,
          id: "66666666-6666-4666-8666-666666666663",
          ref: "pi_7",
          outcome: "started",
          reason: null,
        },
        // Started the plan, 100 over.
        {
          ...row,
          id: "66666666-6666-4666-8666-666666666664",
          ref: "pi_6",
          outcome: "started",
          reason: null,
          amount: 940,
          over: 100,
        },
      ],
      roof_care_plans: [
        { id: PLAN_ID, plan: "care", site_id: SITE, account_id: ACC, status: "ended" },
      ],
      crm_sites: [{ id: SITE, name: "Main Plant" }],
      crm_accounts: [{ id: ACC, name: "Acme" }],
    });
    const owed = await careCardBackOwed(env.db as never);
    expect(owed.map((o) => [o.ref, o.amount, o.title])).toEqual([
      ["pi_9", 840, "Roof Care · Main Plant (Acme)"],
      ["pi_6", 100, "Roof Care · Main Plant (Acme)"],
    ]);
    expect(owed[1]!.why).toBe("The card was charged more than was owed for the plan year.");
    expect(flat("src/lib/owner-attention.functions.ts")).toContain("careCardBack: cardBack,");
  });
  it("Mark sent back is handed to the database with the day and the reference", async () => {
    const env = fakeSupabase({ profiles }, { rpcs: { roof_care_card_sent_back: () => null } });
    await callAs(markRoofCareCardSentBack, env.db, {
      payment_id: row.id,
      on: "2026-11-21",
      ref: " re_3 ",
    });
    expect(env.rpcCalls.filter((c) => c.fn === "roof_care_card_sent_back")).toEqual([
      {
        fn: "roof_care_card_sent_back",
        args: { p_payment: row.id, p_on: "2026-11-21", p_ref: "re_3" },
      },
    ]);
    expect(() =>
      callAs(markRoofCareCardSentBack, env.db, { payment_id: row.id, on: "Nov 21" }),
    ).toThrow();
  });
  it("the database: a manager's, once, on a day that is not before the payment nor still to come", () => {
    const fn = fnOf(CARD, "roof_care_card_sent_back");
    expect(fn).toContain(
      "if auth.uid() is null or not (public.is_admin() or public.is_manager()) then raise exception 'Only a manager or an admin marks card money as sent back'",
    );
    expect(fn).toContain("if not (c.outcome = 'send_back' or coalesce(c.over, 0) > 0) then");
    expect(fn).toContain("if c.sent_back_on is not null then");
    expect(fn).toContain("if p_on is null or p_on > v_today then");
    expect(fn).toContain("if p_on < c.paid_on then");
    expect(fn).toContain("sent_back_by_name = coalesce(v_name, '')");
    expect(CARD).toContain("add column if not exists sent_back_by_name text;");
  });
  it("the plan's card shows each one, with the button for a manager", () => {
    const card = flat("src/components/roof-care/plan-card.tsx");
    expect(card).toContain(
      "{q.data .flatMap((p) => p.card_back ?? []) .map((c) => ( <CardBackLine key={c.id} siteId={siteId} back={c} manager={manager} today={today} /> ))}",
    );
    expect(card).toContain("{!back.sent_back && manager && (");
    expect(card).toContain('data-action="roof-care-card-sent-back"');
    expect(flat("src/lib/roof-care-plan.functions.ts")).toContain(
      "card_back: money ? (cardBackOfPlan.get(p.id) ?? []) : null,",
    );
  });
});

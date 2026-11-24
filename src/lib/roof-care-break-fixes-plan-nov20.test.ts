/**
 * Roof Care, the break test of Nov 20: the plan screens and the inspections. The owner's words:
 * "fix 1, 4 (what happens if it cant be found on the map?), 7, 8, 9, … 20, 21, … 27, … 29".
 *
 *   4  The typed roof size is checked against the map's. More than 20% smaller is not signed,
 *      unless a manager or an admin ticks that it is right. No size on the map: taken, marked.
 *   7  One storm inspection a day unless a second is confirmed; a manager takes one off.
 *   8  Taking a "no access" record off works the rest again: the first is free.
 *   9  A renewal's answer against the rule is a manager's; ended over 60 days: nothing owed.
 *  20  "Skip this inspection"; a plan inspection's ticket is not deleted.
 *  21  A technician's "2 of 2 done" is counted by the server from every ticket.
 *  27  A technician reads a plan with the money left out, from the database's own functions.
 *  29  Sign-up words: what is still missing, sizes that cannot be right, one press.
 *
 * The database rules were tried on the live database, rolled back
 * (docs/qa/roof-care-break-fixes-plan-2026-11-20.md). Every amount here is made up.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const drive = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/roof-care.functions", () => ({
  officeOrigin: async () => ({ line: "1 Office Rd, London, KY", state: "KY" }),
  driveTo: (...a: unknown[]) => drive(...a),
}));

import { benefitsUsed, signUpMissing, signUpMissingLine } from "@/lib/roof-care-benefits";
import { readVisitCleaning } from "@/lib/roof-care-cleaning.functions";
import { noAccessTakeOffWords, readNoAccessTakeOff } from "@/lib/roof-care-no-access";
import { readTicketNoAccess, removeRoofCareNoAccess } from "@/lib/roof-care-no-access.functions";
import {
  onePressAtATime,
  planSizeWords,
  readFieldPlans,
  readRenewalOffer,
  readsPlanTables,
  renewalLapsedWords,
  SIZE_NEEDED,
  sizeAgainstMap,
  sizeSmallerLine,
  skippedWords,
  visitsDone,
  visitsDoneWords,
  visitState,
  type PlanVisit,
  type RoofCarePlan,
} from "@/lib/roof-care-plan";
import {
  addRoofCareStorm,
  listRoofCarePlans,
  roofCareOffer,
  signUpRoofCare,
  skipRoofCareVisit,
  type RoofCareOffer,
} from "@/lib/roof-care-plan.functions";
import { readStormOffer, stormAgainLine, stormCanAdd } from "@/lib/roof-care-storm";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const M = "supabase/migrations/";
const READS = flat(read(`${M}20261120650000_roof_care_technician_reads.sql`));
const SKIP = flat(read(`${M}20261120660000_roof_care_skip_inspection.sql`));
const ACCESS = flat(read(`${M}20261120670000_roof_care_no_access_reworked_storm_once_a_day.sql`));
const SIZE = flat(read(`${M}20261120680000_roof_care_sign_up_size_check.sql`));
const RENEW = flat(read(`${M}20261120690000_roof_care_renewal_default_and_lapsed.sql`));
const CARD = flat(read("src/components/roof-care/plan-card.tsx"));

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const OFFICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac";
const TECH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SITE = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";
const V1 = "44444444-4444-4444-8444-444444444441";
const V2 = "44444444-4444-4444-8444-444444444442";
const JOB = "55555555-5555-4555-8555-555555555555";
const JOB2 = "55555555-5555-4555-8555-555555555556";
const NA = "66666666-6666-4666-8666-666666666661";

type Tables = Record<string, Record<string, unknown>[]>;
const people = [
  { id: ADMIN, role: "admin", access: [], technician: false, full_name: "Ann Admin", email: "a@x" },
  { id: MANAGER, role: "manager", access: [], technician: false, full_name: "Mo", email: "m@x" },
  {
    id: OFFICE,
    role: "user",
    access: ["estimate", "customers", "service", "invoices"],
    technician: true,
    full_name: "Olive Office",
    email: "o@x",
  },
  {
    id: TECH,
    role: "user",
    access: ["service"],
    technician: true,
    full_name: "Tom Tech",
    email: "t@x",
  },
];
const site = (map: number | null) => ({
  id: SITE,
  account_id: ACCOUNT,
  name: "Plant 2",
  address1: "100 Main St",
  address2: null,
  city: "London",
  state: "KY",
  zip: "40741",
  lat: null,
  lng: null,
  map_roof_sqft: map,
  deleted_at: null,
});
const priced = {
  ready: true,
  custom_quote: false,
  plans: [
    { plan: "watch", list: 100, travel: 10, price: 110, visit1: 55, visit2: 55, trips: 2 },
    { plan: "care", list: 200, travel: 10, price: 210, visit1: 105, visit2: 105, trips: 2 },
    { plan: "guard", list: 300, travel: 21, price: 321, visit1: 161, visit2: 160, trips: 4 },
  ],
};
type Rpcs = Record<string, (a: Record<string, unknown>) => unknown>;
const world = (map: number | null, over: Tables = {}, rpcs: Rpcs = {}) =>
  fakeSupabase(
    { profiles: people, crm_sites: [site(map)], ...over },
    { rpcs: { roof_care_price: () => priced, ...rpcs } },
  );
type Env = ReturnType<typeof world>;
const call = <T>(fn: unknown, env: Env, data?: unknown, userId = ADMIN) =>
  (fn as (a: { data: unknown; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const signData = (over: Record<string, unknown> = {}) => ({
  site_id: SITE,
  plan: "care",
  sqft: 1,
  first: "now",
  pay_method: "check",
  agreed_by: "Pat Smith",
  terms_agreed: true,
  shown_price: 210,
  ...over,
});
const visit = (over: Partial<PlanVisit> = {}): PlanVisit => ({
  id: V1,
  kind: "visit1",
  due_from: "2026-11-01",
  due_by: "2026-12-31",
  first_due_by: "2026-12-31",
  amount: 0,
  push_reason: null,
  pushed_by_name: null,
  customer_asked: false,
  lost_on: null,
  ticket: null,
  billed: null,
  ...over,
});

beforeEach(() => {
  drive.mockReset();
  drive.mockResolvedValue({
    hours: 1,
    miles: 50,
    source: "routed",
    note: "25 mi each way",
    placed_by: "building",
    place: null,
  });
});

// ── 4 ───────────────────────────────────────────────────────────────────────────────────────

describe("4. the typed roof size against the map's", () => {
  it("more than 20% smaller is told apart; exactly 80% and anything larger are taken", () => {
    expect(sizeAgainstMap(1, 60000)).toBe("smaller");
    expect(sizeAgainstMap(47999, 60000)).toBe("smaller");
    expect(sizeAgainstMap(48000, 60000)).toBe("ok");
    expect(sizeAgainstMap(60000, 60000)).toBe("ok");
    expect(sizeAgainstMap(250000, 60000)).toBe("ok");
  });
  it("no size on the map, or an outline too small to be the roof: unchecked", () => {
    expect(sizeAgainstMap(20000, null)).toBe("unchecked");
    expect(sizeAgainstMap(20000, undefined)).toBe("unchecked");
    expect(sizeAgainstMap(20000, 499)).toBe("unchecked");
  });
  it("the words give both sizes, and say who can go on", () => {
    expect(sizeSmallerLine(60040, 1, false)).toBe(
      "The map shows about 60,000 sq ft of roof at this property, and 1 sq ft was typed: more than 20% smaller. Check the size and type the whole roof. If the typed size is right, a manager or an admin signs this plan up: they can confirm it.",
    );
    expect(sizeSmallerLine(60040, 1, true)).toContain(
      'Tick "The typed size is right" to sign the plan up at the typed size. Your name is kept with it.',
    );
  });
  it("the server refuses a technician and the office alike, before anything is saved", async () => {
    for (const who of [TECH, OFFICE]) {
      const env = world(60000);
      await expect(call(signUpRoofCare, env, signData(), who)).rejects.toThrow(
        "The map shows about 60,000 sq ft of roof at this property, and 1 sq ft was typed",
      );
      // Their own tick changes nothing.
      await expect(call(signUpRoofCare, env, signData({ size_ok: true }), who)).rejects.toThrow(
        "a manager or an admin signs this plan up",
      );
      expect(env.rpcCalls.map((c) => c.fn)).not.toContain("roof_care_sign_up_await_payment");
    }
  });
  it("a manager goes on only after the tick, and the tick is sent to the database", async () => {
    const calls: Record<string, unknown>[] = [];
    const env = world(
      60000,
      {},
      {
        roof_care_sign_up_await_payment: (a) => {
          calls.push(a);
          return PLAN;
        },
      },
    );
    await expect(call(signUpRoofCare, env, signData(), MANAGER)).rejects.toThrow(
      'Tick "The typed size is right"',
    );
    expect(calls).toEqual([]);
    // The plan is not in the made-up tables, so the read-back fails; the sign-up was sent.
    await expect(call(signUpRoofCare, env, signData({ size_ok: true }), MANAGER)).rejects.toThrow(
      "could not be read back",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ p_sqft: 1, p_size_ok: true });
  });
  it("a size the map agrees with, and a property the map has no size for, go through with no tick", async () => {
    for (const [map, sqft] of [
      [60000, 50000],
      [null, 20000],
    ] as const) {
      const calls: Record<string, unknown>[] = [];
      const env = world(
        map,
        {},
        {
          roof_care_sign_up_await_payment: (a) => {
            calls.push(a);
            return PLAN;
          },
        },
      );
      // (The read-back of a technician asks the database's function, which is not stood in
      // for here: the sign-up was sent before it.)
      await expect(call(signUpRoofCare, env, signData({ sqft }), TECH)).rejects.toThrow(
        "roof_care_field_plans",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]).not.toHaveProperty("p_size_ok");
    }
  });
  it("the price answer carries the map's size for the screen, and none when the map has none", async () => {
    const a = await call<RoofCareOffer>(roofCareOffer, world(60000), { site_id: SITE, sqft: 5 });
    expect(a.map_sqft).toBe(60000);
    const b = await call<RoofCareOffer>(roofCareOffer, world(null), { site_id: SITE, sqft: 5 });
    expect(b.map_sqft).toBeNull();
    const c = await call<RoofCareOffer>(roofCareOffer, world(300), { site_id: SITE, sqft: 5 });
    expect(c.map_sqft).toBeNull();
  });
  it("the database: the same rule, the manager's name kept, and the mark when the map has nothing", () => {
    expect(SIZE).toContain(
      "v_map := case when v_site.map_roof_sqft >= 500 then v_site.map_roof_sqft end;",
    );
    expect(SIZE).toContain("if v_map is not null and p_sqft < v_map * 0.8 then");
    expect(SIZE).toContain(
      "v_boss := public.is_admin() or public.is_manager(); if not v_boss then raise exception",
    );
    expect(SIZE).toContain("if not coalesce(p_size_ok, false) then raise exception");
    expect(SIZE).toContain(
      "v_map, v_map is null, case when v_confirmed then v_today end, case when v_confirmed then coalesce(v_name, '') end)",
    );
    // A manager or an admin confirms the unchecked one afterwards.
    expect(SIZE).toContain(
      "raise exception 'Only a manager or an admin confirms a plan''s roof size' using errcode = '42501';",
    );
    expect(SIZE).toContain("where id = p_plan and size_unchecked;");
    // A renewal keeps the size and what was kept about it.
    expect(RENEW).toContain(
      "p.size_map_sqft, p.size_unchecked, p.size_confirmed_on, p.size_confirmed_by_name)",
    );
  });
  it("the plan says it: unchecked until a manager confirms, then who confirmed", () => {
    const base = { roof_sqft: 20000 } as Pick<RoofCarePlan, "roof_sqft" | "size">;
    expect(
      planSizeWords({ ...base, size: { unchecked: true, map_sqft: null, confirmed: null } }),
    ).toBe(
      "Roof size 20,000 sq ft: typed by hand, not checked against the map. A manager or an admin confirms it.",
    );
    expect(
      planSizeWords({
        ...base,
        size: {
          unchecked: false,
          map_sqft: 60000,
          confirmed: { on: "2026-11-20", by_name: "Mo" },
        },
      }),
    ).toBe(
      "Roof size 20,000 sq ft, confirmed by Mo on Nov 20, 2026 (the map showed about 60,000 sq ft).",
    );
    expect(
      planSizeWords({ ...base, size: { unchecked: false, map_sqft: 60000, confirmed: null } }),
    ).toBe("");
    expect(CARD).toContain('data-action="roof-care-size-confirm"');
    expect(CARD).toContain("data-size-ok");
  });
});

// ── 7 ───────────────────────────────────────────────────────────────────────────────────────

describe("7. one storm inspection a day unless confirmed, and a manager takes one off", () => {
  const offer = {
    billed: false,
    included: 2,
    used: 1,
    billed_so_far: 0,
    added_today: { by_name: "Olive Office", at: "2026-11-20T19:15:00Z" },
  };
  it("the box is told who added one today and when, and holds the button until the tick", () => {
    const o = readStormOffer(offer)!;
    expect(o.added_today).toEqual({ by_name: "Olive Office", at: "2026-11-20T19:15:00Z" });
    expect(stormCanAdd(o, false)).toBe(false);
    expect(stormCanAdd(o, true)).toBe(true);
    expect(stormAgainLine(o.added_today!)).toBe(
      "A storm inspection was already added to this plan today, by Olive Office at 2:15 PM. Tick the box to add a second one today.",
    );
    // None today: nothing to tick.
    const none = readStormOffer({ ...offer, added_today: null })!;
    expect(none.added_today).toBeNull();
    expect(stormCanAdd(none, false)).toBe(true);
  });
  it("the tick is sent, and only when it was given", async () => {
    const calls: Record<string, unknown>[] = [];
    const env = world(
      null,
      {},
      {
        roof_care_add_storm: (a) => {
          calls.push(a);
          return null;
        },
      },
    );
    await call(addRoofCareStorm, env, { plan_id: PLAN });
    await call(addRoofCareStorm, env, { plan_id: PLAN, again_ok: true });
    expect(calls).toEqual([
      { p_plan: PLAN, p_billed_ok: false },
      { p_plan: PLAN, p_billed_ok: false, p_again_ok: true },
    ]);
    expect(CARD).toContain("data-storm-again-ok");
  });
  it("the database refuses a second one the same day without it, naming who and when", () => {
    expect(ACCESS).toContain(
      "if jsonb_typeof(s->'added_today') = 'object' and not coalesce(p_again_ok, false) then raise exception 'A storm inspection was already added to this plan today%. To add a second one the same day, open the plan, press Storm inspection and confirm it there.',",
    );
    expect(ACCESS).toContain("and (v.created_at at time zone 'America/New_York')::date = v_today");
    // The older two-argument function is gone, so a page from before gets the new rule.
    expect(ACCESS).toContain("drop function if exists public.roof_care_add_storm(uuid, boolean);");
  });
  it("the take-off: a manager's, not once started or invoiced; inspection and ticket go", () => {
    expect(ACCESS).toContain(
      "raise exception 'Only a manager or an admin takes a storm inspection off' using errcode = '42501';",
    );
    expect(ACCESS).toContain(
      "raise exception 'Ticket #% of this storm inspection is already started. It is not taken off.', j.number;",
    );
    expect(ACCESS).toContain(
      "raise exception 'This storm inspection is on invoice #%. Take it off that invoice first.', v_other;",
    );
    expect(ACCESS).toContain("delete from public.roof_care_visits where id = p_visit;");
    // An included one taken off: a billed one still to do becomes the included one.
    expect(ACCESS).toContain("update public.roof_care_visits set amount = 0 where id = n.id;");
    expect(CARD).toContain('data-action="roof-care-storm-off-confirm"');
  });
});

// ── 8 ───────────────────────────────────────────────────────────────────────────────────────

describe("8. taking a no access record off works the rest again", () => {
  it("the server asks the database to take it off and reads what changed", async () => {
    const env = world(
      null,
      {},
      {
        roof_care_no_access_take_off: () => ({
          changed: [{ id: NA, on_date: "2026-11-19", charged: false }],
          kept_billed: [],
        }),
      },
    );
    const r = await call<ReturnType<typeof readNoAccessTakeOff>>(removeRoofCareNoAccess, env, {
      id: NA,
    });
    expect(r).toEqual({ changed: [{ id: NA, on: "2026-11-19", charged: false }], kept_billed: [] });
    expect(noAccessTakeOffWords(r)).toBe(
      "Taken off. The visit of Nov 19, 2026 is now the first of the plan year: its return trip is at no charge.",
    );
  });
  it("one already on an invoice stays as billed, and is said so", () => {
    const r = readNoAccessTakeOff({
      changed: [],
      kept_billed: [{ id: NA, on_date: "2026-11-19", invoice: "1234" }],
    });
    expect(noAccessTakeOffWords(r)).toBe(
      "Taken off. The visit of Nov 19, 2026 is now the first of the plan year, but its return trip is on invoice #1234, so it stays as billed. Take it off that invoice if it should not be charged.",
    );
    // An answer that is not one changes nothing and says only that it is off.
    expect(noAccessTakeOffWords(readNoAccessTakeOff(null))).toBe("Taken off.");
  });
  it("the database: date order, the first not billed is free, the next is counted from the free ones", () => {
    expect(ACCESS).toContain("where n.plan_id = p_plan order by n.at, n.id loop");
    expect(ACCESS).toContain("if r.invoice is not null then");
    expect(ACCESS).toContain(
      "update public.roof_care_no_access set charged = false, amount = null where id = r.id;",
    );
    expect(ACCESS).toContain(
      "select count(*), count(*) filter (where not coalesce(n.charged, false)) into v_count, v_free_used",
    );
    expect(ACCESS).toContain("v_charged := v_free_used >= c_free;");
    // One number for "how many are free", read by both.
    expect(
      ACCESS.match(/c_free constant integer := public\.roof_care_no_access_free\(\);/g),
    ).toHaveLength(2);
    // The older name does the same for a page published before this.
    expect(ACCESS).toContain("perform public.roof_care_no_access_take_off(p_id);");
  });
});

// ── 9 ───────────────────────────────────────────────────────────────────────────────────────

describe("9. a renewal's answer against the rule, and a plan that ended long ago", () => {
  const raw = {
    renews_on: "2028-01-10",
    opens_on: "2027-11-11",
    open: true,
    price: 1840,
    price_was: 1840,
    owed: [],
    owed_count: 0,
    default_choice: null,
    default_reason: null,
    credit_if_half_off: 0,
    carried_until: "2028-03-10",
    pay_method: "check",
    has_renewal: false,
    can_change: false,
    lapsed: true,
    lapsed_owed: 1,
    ended_on: "2026-09-01",
  };
  it("the offer says who may change the answer, and that the plan lapsed", () => {
    const o = readRenewalOffer(raw)!;
    expect(o).toMatchObject({
      can_change: false,
      lapsed: true,
      lapsed_owed: 1,
      ended_on: "2026-09-01",
    });
    expect(renewalLapsedWords(o)).toBe(
      "This plan ended Sep 1, 2026, more than 60 days ago, so it renews at the full price. The inspection that was not done is not taken off the price and not carried into the new year.",
    );
    expect(renewalLapsedWords({ lapsed: false, lapsed_owed: 0, ended_on: null })).toBe("");
  });
  it("the box holds an office user to the rule's answer and says who can change it", () => {
    expect(CARD).toContain("disabled={!o.can_change && c !== o.default_choice}");
    expect(CARD).toContain("{RENEWAL_CHANGE_NEEDS_MANAGER}");
    expect(CARD).toContain('data-renew-line="lapsed"');
  });
  it("the database refuses the other answer from anyone but a manager or an admin", () => {
    expect(RENEW).toContain(
      "v_default := case when v_asked or not v_late then 'full' else 'half_off' end; if v_choice <> v_default and not (public.is_admin() or public.is_manager()) then",
    );
    expect(RENEW).toContain(
      "Taking its price off instead is for a manager or an admin. Renew it charged in full, or ask one of them to renew it.",
    );
    expect(RENEW).toContain(
      "Charging it in full instead is for a manager or an admin. Renew it with the price taken off, or ask one of them to renew it.",
    );
  });
  it("the database: ended more than 60 days ago, no credit and nothing carried, whoever asks", () => {
    expect(RENEW).toContain(
      "if p.status = 'ended' and v_today > coalesce(p.ended_on, p.renews_on) + 60 then v_n := 0; v_choice := null; end if;",
    );
    // Nothing owed is saved on the renewal, so nothing is carried when it is paid.
    expect(RENEW).toContain("p.id, case when v_n > 0 then v_choice end, v_credit, v_n,");
    expect(RENEW).toContain("'lapsed', v_lapsed,");
  });
});

// ── 20 ──────────────────────────────────────────────────────────────────────────────────────

describe("20. skip an inspection; its ticket is not deleted", () => {
  const skipped = visit({
    skipped_on: "2026-11-20",
    skip_reason: "The roof is being replaced.",
    skipped_by_name: "Mo",
  });
  it("a skipped inspection reads Skipped, never Late, and is not one of the two done", () => {
    expect(visitState(skipped, "2027-06-01")).toBe("skipped");
    expect(skippedWords(skipped)).toBe(
      "Skipped Nov 20, 2026 by Mo: The roof is being replaced. Still owed to the customer.",
    );
    expect(visitsDone({ visits: [skipped] }, "2027-06-01")).toEqual({ visits: 0, storm: 0 });
    // Done wins: a ticket put back and finished is an inspection done.
    expect(
      visitState(
        {
          ...skipped,
          ticket: {
            id: JOB,
            number: 1,
            stage: "done",
            scheduled_date: null,
            completed_at: null,
            invoice_id: null,
          },
        },
        "2027-06-01",
      ),
    ).toBe("done");
  });
  it("the server sends the reason to the database and hands back the ticket taken off", async () => {
    const calls: Record<string, unknown>[] = [];
    const env = world(
      null,
      {},
      {
        roof_care_skip_visit: (a) => {
          calls.push(a);
          return { visit_id: V1, job_id: JOB, number: 7001 };
        },
      },
    );
    const r = await call<{ ticket: number | null }>(skipRoofCareVisit, env, {
      visit_id: V1,
      reason: "  The roof is being replaced  ",
    });
    expect(r).toEqual({ ticket: 7001 });
    expect(calls).toEqual([{ p_visit: V1, p_reason: "The roof is being replaced" }]);
  });
  it("the database: a manager's, with a reason; the morning run passes a skipped one over", () => {
    expect(SKIP).toContain(
      "raise exception 'Only a manager or an admin skips a Roof Care plan inspection' using errcode = '42501';",
    );
    expect(SKIP).toContain("raise exception 'Type why this inspection is skipped';");
    expect(SKIP).toContain(
      "set skipped_on = v_today, skip_reason = v_reason, skipped_by_name = coalesce(v_name, '')",
    );
    expect(SKIP).toContain(
      "and v.lost_on is null and v.skipped_on is null and v.due_from - 14 <= v_today",
    );
  });
  it("it still counts as owed: what is owed and what a refund counts are not redefined", () => {
    // roof_care_owed(): every inspection with no done ticket that is not lost. A skip leaves
    // lost_on alone, so the renewal credits or carries it and the refund counts it not done.
    expect(SKIP).not.toContain("lost_on = v_today");
    for (const sql of [READS, SKIP, ACCESS, SIZE, RENEW]) {
      expect(sql).not.toContain("function public.roof_care_owed(");
      expect(sql).not.toContain("function public.roof_care_refund_worked(");
    }
    const owed = flat(read(`${M}20261119800000_roof_care_renewal.sql`));
    expect(owed).toContain("v.kind in ('visit1', 'visit2') and v.lost_on is null");
  });
  it("deleting the ticket any other way is refused, in words that point to Skip", () => {
    expect(SKIP).toContain(
      "create trigger service_jobs_care_plan_delete_rule before delete or update of deleted_at on public.service_jobs",
    );
    expect(SKIP).toContain(
      "To drop it, open Care Plan at the property and press Skip this inspection (a manager or an admin). It then counts as an inspection still owed to the customer.",
    );
    // The site's own removals pass: a plan that is over, a lost or skipped inspection, the
    // morning run, and the functions that say so.
    expect(SKIP).toContain(
      "if not found or v.status <> 'active' or v.lost_on is not null or v.skipped_on is not null then",
    );
    expect(SKIP).toContain(
      "if not v_person or coalesce(current_setting('jbk.care_ticket_off', true), '') = 'on' then",
    );
    // Putting the ticket back undoes the skip; a carried inspection is no longer skipped.
    expect(SKIP).toContain(
      "set skipped_on = null, skip_reason = null, skipped_by_name = null where id = new.roof_care_visit_id and skipped_on is not null;",
    );
    expect(SKIP).toContain("if new.kind = 'carried' and old.kind is distinct from 'carried' then");
  });
  it("the plan offers Skip to a manager, on an inspection that is neither done nor a storm one", () => {
    expect(CARD).toContain(
      '{onSkip && visit.kind !== "storm" && !["done", "skipped", "lost"].includes(state) && (',
    );
    expect(CARD).toContain(
      // Nov 24: `full` is the Care Plan pop-up, where the inspections are listed.
      "{...(manager && full ? { onSkip: setSkipping, onStormOff: setStormOff } : {})}",
    );
  });
});

// ── 21 and 27 ───────────────────────────────────────────────────────────────────────────────

describe("21 and 27. a technician's plan: counted by the server, the money left out", () => {
  const answer = [
    {
      id: PLAN,
      account_id: ACCOUNT,
      site_id: SITE,
      plan: "guard",
      status: "active",
      pay_first: true,
      plan_number: 1001,
      first_visit: "now",
      signed_on: "2026-11-01",
      renews_on: "2027-11-01",
      roof_sqft: 20000,
      repair_allowance: 1300,
      free_travel_calls: 2,
      agreed_by: "Pat Smith",
      sold_by_name: "Tom Tech",
      size_unchecked: true,
      visits: [
        {
          id: V2,
          kind: "visit2",
          due_from: "2027-03-15",
          due_by: "2027-05-15",
          first_due_by: "2027-05-15",
          ticket: { id: JOB2, number: 7002, stage: "done", mine: true },
        },
        {
          id: V1,
          kind: "visit1",
          due_from: "2026-11-01",
          due_by: "2026-11-01",
          first_due_by: "2026-11-01",
          // Somebody else's ticket: the technician cannot read it, the server says its stage.
          ticket: { id: JOB, number: 7001, stage: "authorized", mine: false },
        },
        { id: "s1", kind: "storm", due_from: "2026-11-20", due_by: "2026-12-04", extra: true },
      ],
    },
  ];
  it('both inspections done reads "2 of 2 inspections done", whoever did them', () => {
    const [p] = readFieldPlans(answer, { guard: 1 });
    expect(p!.visits.map((v) => v.kind)).toEqual(["visit1", "visit2", "storm"]);
    expect(visitsDoneWords(p!, "2027-06-01")).toBe("2 of 2 inspections done");
    expect(p!.visits[0]!.ticket).toMatchObject({ number: 7001, stage: "authorized", mine: false });
    // The old way: only the tickets that technician can read.
    const own = {
      visits: p!.visits.map((v) => (v.ticket?.mine === false ? { ...v, ticket: null } : v)),
    };
    expect(visitsDoneWords(own, "2027-06-01")).toBe("1 of 2 inspections done");
  });
  it("no amount is in it: price, credit, refund, what was used and what an inspection bills", () => {
    const [p] = readFieldPlans(answer, { guard: 1 });
    expect(p).toMatchObject({
      price: 0,
      renewal_credit: 0,
      refund: null,
      invoice: null,
      allowance_used: null,
      free_travel_used: null,
      card_paid: null,
      pay_note: null,
      no_access: null,
    });
    expect(p!.visits.every((v) => v.amount === 0 && v.billed === null)).toBe(true);
    // What the plan includes stays: it is what the technician tells the customer.
    expect(p!.repair_allowance).toBe(1300);
    expect(p!.storm_included).toBe(1);
    // A billed storm inspection is told apart with no amount.
    const storm = benefitsUsed(p!, "2026-11-21", 1).find((b) => b.key === "storm");
    expect(storm!.words).toBe("0 of 1 used, and 1 more, not included: billed by itself");
  });
  it("what is not a plan is left out, never guessed", () => {
    expect(readFieldPlans(null)).toEqual([]);
    expect(readFieldPlans([{ id: PLAN }, "x", null])).toEqual([]);
  });
  it("who the plan tables answer: the office, never a technician", () => {
    expect(readsPlanTables(people[0])).toBe(true);
    expect(readsPlanTables(people[1])).toBe(true);
    expect(readsPlanTables(people[2])).toBe(true);
    expect(readsPlanTables(people[3])).toBe(false);
    expect(readsPlanTables({ role: "user", access: ["service"], technician: false })).toBe(true);
    expect(readsPlanTables({ role: "user", access: [], technician: false })).toBe(false);
    expect(readsPlanTables(null)).toBe(false);
  });
  it("a technician's list comes from the database's function, not from the plan tables", async () => {
    // The tables hold a price; a technician's answer must not come from them.
    const env = world(
      null,
      {
        roof_care_plans: [
          { id: PLAN, site_id: SITE, account_id: ACCOUNT, plan: "guard", price: 4680 },
        ],
        roof_care_visits: [],
      },
      {
        roof_care_field_plans: () => answer,
        roof_care_benefits: () => ({
          watch: { allowance: 0, leak_calls: 0, storm: 0 },
          care: { allowance: 400, leak_calls: 0, storm: 0 },
          guard: { allowance: 1300, leak_calls: 2, storm: 1 },
        }),
      },
    );
    const mine = await call<RoofCarePlan[]>(listRoofCarePlans, env, { site_ids: [SITE] }, TECH);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.price).toBe(0);
    expect(JSON.stringify(mine)).not.toContain("4680");
    expect(env.rpcCalls[0]).toEqual({ fn: "roof_care_field_plans", args: { p_sites: [SITE] } });
    expect(visitsDone(mine[0]!, "2027-06-01").visits).toBe(2);
  });
  it("their no access records come from the database's function, with no amount", async () => {
    const tables = {
      service_jobs: [{ id: JOB, roof_care_visit_id: V1 }],
      // What the table holds is not what a technician is given.
      roof_care_no_access: [
        {
          id: NA,
          visit_id: V1,
          on_date: "2026-11-19",
          note: "x",
          by_name: "T",
          charged: true,
          amount: 406,
          at: "a",
        },
      ],
    };
    const rpcs = {
      roof_care_field_no_access: () => [
        {
          id: NA,
          on_date: "2026-11-19",
          note: "Gate locked",
          by_name: "Tom Tech",
          charged: true,
          at: "a",
        },
      ],
      roof_care_no_access_preview: () => {
        throw new Error("This inspection is already done");
      },
    };
    const env = world(null, tables, rpcs);
    type Sb = Parameters<typeof readTicketNoAccess>[0];
    const field = await readTicketNoAccess(env.db as unknown as Sb, JOB, { field: true });
    expect(field.records).toEqual([
      { id: NA, on: "2026-11-19", note: "Gate locked", by_name: "Tom Tech", charged: true },
    ]);
    expect(JSON.stringify(field)).not.toContain("406");
    expect(env.rpcCalls.map((c) => c.fn)).toEqual([
      "roof_care_field_no_access",
      "roof_care_no_access_preview",
    ]);
    // The office reads the table, as before.
    const office = world(null, tables, {
      roof_care_no_access_preview: rpcs.roof_care_no_access_preview,
    });
    const all = await readTicketNoAccess(office.db as unknown as Sb, JOB);
    expect(all.records.map((r) => r.note)).toEqual(["x"]);
    expect(office.rpcCalls.map((c) => c.fn)).toEqual(["roof_care_no_access_preview"]);
  });
  it("the cleaning answers of an inspection the tables do not answer for come the same way", async () => {
    const env = world(
      null,
      { roof_care_visits: [], roof_care_plans: [] },
      {
        roof_care_field_cleaning: () => ({
          id: V1,
          plan_id: PLAN,
          kind: "visit1",
          plan: "guard",
          drains_cleaned: true,
          gutters_cleaned: null,
          cleaning_note: null,
          cleaning_by_name: "Tom Tech",
          cleaning_at: "2026-11-20T15:00:00Z",
        }),
      },
    );
    type Sb = Parameters<typeof readVisitCleaning>[0];
    const c = await readVisitCleaning(env.db as unknown as Sb, V1);
    expect(c).toMatchObject({ visit_id: V1, plan: "guard", drains: true, gutters: null });
    // The office's inspection is read from the tables, with no call to the function.
    const office = world(null, {
      roof_care_visits: [{ id: V1, plan_id: PLAN, kind: "visit1", drains_cleaned: false }],
      roof_care_plans: [{ id: PLAN, plan: "care" }],
    });
    const o = await readVisitCleaning(office.db as unknown as Sb, V1);
    expect(o).toMatchObject({ plan: "care", drains: false });
    expect(office.rpcCalls).toEqual([]);
  });
  it("the database: the tables stop answering a technician, and the functions name no amount", () => {
    expect(READS).toContain(
      "alter policy roof_care_plans_read on public.roof_care_plans using ( (select public.has_access('customers')) or (select public.has_access('estimate')) or ((select public.has_access('service')) and not (select public.is_technician())));",
    );
    expect(READS).toContain(
      "alter policy roof_care_no_access_read on public.roof_care_no_access using ( not (select public.is_technician()) and ((select public.has_access('service')) or (select public.has_access('customers'))));",
    );
    const field = READS.slice(
      READS.indexOf("create or replace function public.roof_care_field_plans("),
      READS.indexOf("create or replace function public.roof_care_field_cleaning("),
    );
    for (const money of [
      "p.price,",
      "list_price",
      "travel_price",
      "drive_hours",
      "drive_miles",
      "refund_",
      "renewal_credit",
      "card_paid",
      "'amount'",
      "n.amount",
      "pay_note",
    ])
      expect(field, money).not.toContain(money);
    // The inspection's ticket, whoever it is with.
    expect(field).toContain("where j.roof_care_visit_id = v.id and j.deleted_at is null");
    expect(field).toContain("and n.by_user = auth.uid();");
  });
  it("the pop-up names a ticket that is with somebody else, and does not link to it", () => {
    expect(CARD).toContain(
      'visit.ticket.mine === false ? ( <span className="text-muted-foreground" data-visit-ticket="other">',
    );
  });
});

// ── 29 ──────────────────────────────────────────────────────────────────────────────────────

describe("29. the sign-up's words", () => {
  const all = {
    priced: true,
    stale: false,
    plan: true,
    first: true,
    daysBad: false,
    pay: true,
    name: true,
    emailBad: false,
    agreed: true,
  };
  it("says what is still missing, in the order of the form; nothing when nothing is", () => {
    expect(signUpMissing(all)).toEqual([]);
    expect(signUpMissingLine([])).toBe("");
    const none = signUpMissing({
      priced: false,
      stale: false,
      plan: false,
      first: false,
      daysBad: false,
      pay: false,
      name: false,
      emailBad: false,
      agreed: false,
    });
    expect(signUpMissingLine(none)).toBe(
      "Still needed: the roof size, then Show my price; a plan; when the first inspection is; how you are paying; your name; the tick that you agree to the terms.",
    );
    expect(signUpMissing({ ...all, stale: true })).toEqual([
      "Show my price again: the roof size changed",
    ]);
    expect(signUpMissing({ ...all, daysBad: true })).toEqual([
      "the days to the first inspection, 1 to 365",
    ]);
    expect(signUpMissing({ ...all, emailBad: true })).toEqual([
      "an email address that reads right, or none",
    ]);
    expect(signUpMissing({ ...all, size: "tick" })).toEqual([
      "the tick that the typed roof size is right",
    ]);
    expect(signUpMissing({ ...all, size: "blocked" })).toEqual([
      "a roof size that matches the map, or a manager to sign it",
    ]);
    expect(CARD).toContain('data-sign-line="missing"');
  });
  it("a size too large to be real goes to the database, which answers with the custom quote", async () => {
    const asked: unknown[] = [];
    const env = world(
      null,
      {},
      {
        roof_care_price: (a) => {
          asked.push(a["p_sqft"]);
          return { ready: true, custom_quote: true, custom_quote_over_sqft: 75000, plans: [] };
        },
      },
    );
    const o = await call<RoofCareOffer>(roofCareOffer, env, { site_id: SITE, sqft: 9_000_000 });
    expect(asked).toEqual([9_000_000]);
    expect(o.price).toMatchObject({ ready: true, custom_quote: true, over_sqft: 75000 });
    // The check that answered with what the program expected is gone.
    const fns = flat(read("src/lib/roof-care-plan.functions.ts"));
    expect(fns).not.toContain("max(5_000_000)");
  });
  it("a size of 0 or below has its own words, from the server and from the database", async () => {
    for (const sqft of [0, -5]) {
      const env = world(null);
      await expect(call(roofCareOffer, env, { site_id: SITE, sqft })).rejects.toThrow(SIZE_NEEDED);
      await expect(call(signUpRoofCare, env, signData({ sqft }))).rejects.toThrow(SIZE_NEEDED);
      expect(env.rpcCalls).toEqual([]);
    }
    expect(SIZE).toContain(
      "if p_sqft is null or p_sqft <= 0 then raise exception 'Type the roof''s size in square feet: a number above 0';",
    );
    expect(SIZE).toContain(
      "if p_hours < 0 or p_miles < 0 then raise exception 'The drive to this property came out below zero, which cannot be right. Ask an admin to check where the property is on the map.';",
    );
  });
  it("two presses in the same instant are one run", async () => {
    const press = onePressAtATime();
    let runs = 0;
    let finish: () => void = () => undefined;
    const work = () =>
      new Promise<void>((done) => {
        runs++;
        finish = done;
      });
    expect(press(work)).toBe(true);
    expect(press(work)).toBe(false);
    expect(runs).toBe(1);
    finish();
    await new Promise((r) => setTimeout(r, 0));
    // Once it is over the button works again, also after a run that failed.
    expect(press(() => Promise.reject(new Error("no")))).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(press(work)).toBe(true);
    expect(runs).toBe(2);
    expect(CARD).toContain("onClick={() => press(() => sign.mutateAsync())}");
  });
});

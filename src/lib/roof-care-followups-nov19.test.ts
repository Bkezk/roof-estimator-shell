/**
 * Roof Care, the owner's answers of Nov 19 after the audit:
 *
 *   "Go with 1, 6, 7, 8, 9 (don't show plus x for drive) they shouldn't know they're paying more
 *    for distance neither the customer or tech. 10. We should probably have that under the plan
 *    status on the customer properties pages (think about how we can ensure this is followed) I
 *    like the tick idea"
 *
 *   1  An inspection's share of the plan goes on one live invoice.
 *   6  An inspection done and on no invoice is said: on the plan and on Needs attention.
 *   7  A second-inspection window is never under two weeks.
 *   8  The office's 30 days count from each inspection's own first date; reasons are kept.
 *   9  The sign-up shows one price. Nothing of the drive reaches the browser.
 *  10  The yearly minor repairs: on the plan, on the property page, and asked on the invoice.
 *
 * The database rules were tried on the live database (docs/qa/roof-care-followups-2026-11-19.md).
 * Every amount here is made up.
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

import { buildLinesFromJob } from "@/lib/invoices.server";
import { ATTENTION_DEFAULTS, attentionList, type AttentionIn } from "@/lib/owner-attention";
import {
  ALLOWANCE_UNANSWERED,
  allowanceAfterChange,
  allowanceAmount,
  allowanceCap,
  allowanceLine,
  allowanceLineSource,
  allowancePlanOf,
  allowanceStatusWords,
  allowanceStep,
  allowanceTaken,
  allowanceUnanswered,
  billableBefore,
  invoiceAllowance,
  isAllowanceLine,
} from "@/lib/roof-care-allowance";
import {
  invoiceAllowanceOf,
  syncAllowance,
  setInvoiceAllowance,
  type SetAllowanceResult,
} from "@/lib/roof-care-allowance.functions";
import {
  carePlanLineSource,
  planDates,
  PRICE_ESTIMATE_JUST_NOW,
  PRICE_ESTIMATE_ROUGH,
  SECOND_WINDOW_MIN_DAYS,
  shownPrice,
  visitUnbilled,
  type PlanVisit,
  type RoofCarePlan,
} from "@/lib/roof-care-plan";
import {
  listRoofCarePlans,
  plansOfSites,
  roofCareOffer,
  type RoofCareOffer,
} from "@/lib/roof-care-plan.functions";
import { daysBetween } from "@/lib/followup-rules";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const SQL = flat(read("supabase/migrations/20261119200000_roof_care_followups.sql"));

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TECH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SITE = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";
const V1 = "44444444-4444-4444-8444-444444444441";
const V2 = "44444444-4444-4444-8444-444444444442";
const JOB = "55555555-5555-4555-8555-555555555555";
const REPAIR = "66666666-6666-4666-8666-666666666666";
const INV = "77777777-7777-4777-8777-777777777771";
const INV_B = "77777777-7777-4777-8777-777777777772";

type Tables = Record<string, Record<string, unknown>[]>;
const people = [
  { id: ADMIN, role: "admin", access: [], technician: false, full_name: "Ann Admin", email: "a@x" },
  {
    id: TECH,
    role: "user",
    access: ["service"],
    technician: true,
    full_name: "Tom Tech",
    email: "t@x",
  },
];
const planRow = (over: Record<string, unknown> = {}) => ({
  id: PLAN,
  account_id: ACCOUNT,
  site_id: SITE,
  plan: "care",
  status: "active",
  signed_on: "2026-11-18",
  renews_on: "2027-11-18",
  roof_sqft: 20000,
  price: 2000,
  list_price: 1800,
  travel_price: 200,
  price_estimated: false,
  repair_allowance: 300,
  agreed_by: "Pat Smith",
  sold_by_name: "Ann Admin",
  notes: "",
  ended_on: null,
  ended_reason: null,
  ...over,
});
const visitRow = (id: string, kind: string, over: Record<string, unknown> = {}) => ({
  id,
  plan_id: PLAN,
  kind,
  due_from: "2026-11-18",
  due_by: "2026-11-18",
  first_due_by: "2026-11-18",
  amount: 1000,
  push_reason: null,
  pushed_by_name: null,
  customer_asked: false,
  lost_on: null,
  ...over,
});
const world = (
  over: Tables = {},
  rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {},
) =>
  fakeSupabase(
    {
      profiles: people,
      crm_sites: [
        {
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
          deleted_at: null,
        },
      ],
      roof_care_plans: [planRow()],
      roof_care_visits: [visitRow(V1, "visit1"), visitRow(V2, "visit2")],
      service_jobs: [],
      invoices: [],
      invoice_lines: [],
      ...over,
    },
    { rpcs },
  );
type Env = ReturnType<typeof world>;
const call = <T>(fn: unknown, env: Env, data?: unknown, userId = ADMIN) =>
  (fn as (a: { data: unknown; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
type Sb = Parameters<typeof plansOfSites>[0];
const sb = (env: Env) => env.db as unknown as Sb;

beforeEach(() => {
  drive.mockReset();
  drive.mockResolvedValue({
    hours: 6.5,
    miles: 311,
    source: "routed",
    note: "155 mi each way",
    placed_by: "building",
    place: null,
  });
});

// ── 9 ───────────────────────────────────────────────────────────────────────────────────────

describe("9. the sign-up shows one price, and nothing of the drive", () => {
  const priced = {
    ready: true,
    custom_quote: false,
    baseline_hours: 2,
    baseline_miles: 100,
    beyond_baseline: true,
    plans: [
      { plan: "watch", list: 100, travel: 10, price: 110, visit1: 55, visit2: 55, trips: 2 },
      { plan: "care", list: 200, travel: 10, price: 210, visit1: 105, visit2: 105, trips: 2 },
      { plan: "guard", list: 300, travel: 21, price: 321, visit1: 161, visit2: 160, trips: 4 },
    ],
  };
  it("the server sends the price of each plan and no part of how it was made", async () => {
    const env = world({}, { roof_care_price: () => priced });
    const o = await call<RoofCareOffer>(roofCareOffer, env, { site_id: SITE, sqft: 20000 });
    expect(o).toEqual({
      site: { id: SITE, name: "Plant 2" },
      placed: true,
      estimate: null,
      price: {
        ready: true,
        custom_quote: false,
        plans: [
          { plan: "watch", name: "Roof Watch", price: 110, visit1: 55, visit2: 55 },
          { plan: "care", name: "Roof Care", price: 210, visit1: 105, visit2: 105 },
          { plan: "guard", name: "Roof Guard", price: 321, visit1: 161, visit2: 160 },
        ],
      },
    });
    // Not the hours, the miles, the list price, what the distance adds, or that it adds anything.
    const sent = JSON.stringify(o);
    for (const word of ["6.5", "311", "155 mi", "travel", "list", "baseline", "hours", "miles"])
      expect(sent, word).not.toContain(word);
  });
  it("an estimate is said without saying why the distance matters", async () => {
    drive.mockResolvedValue({
      hours: 3,
      miles: 150,
      source: "estimated",
      note: "",
      placed_by: "building",
      place: null,
    });
    const env = world({}, { roof_care_price: () => priced });
    const a = await call<RoofCareOffer>(roofCareOffer, env, { site_id: SITE, sqft: 20000 });
    expect(a.estimate).toBe("just-now");
    drive.mockResolvedValue({
      hours: 3,
      miles: 150,
      source: "routed",
      note: "",
      placed_by: "town",
      place: "London, KY",
    });
    const b = await call<RoofCareOffer>(roofCareOffer, env, { site_id: SITE, sqft: 20000 });
    expect(b.estimate).toBe("rough");
    for (const line of [PRICE_ESTIMATE_JUST_NOW, PRICE_ESTIMATE_ROUGH])
      expect(line).not.toMatch(/drive|distance|mile|hour|route|far/i);
  });
  it("the price answer is read strictly first, then stripped", () => {
    expect(shownPrice({ ready: false })).toEqual({ ready: false });
    expect(shownPrice({ ready: true, custom_quote: true, over_sqft: 90000, plans: [] })).toEqual({
      ready: true,
      custom_quote: true,
      over_sqft: 90000,
      plans: [],
    });
  });
  it("the form has no line about the drive", () => {
    const card = read("src/components/roof-care/plan-card.tsx");
    expect(card).not.toContain("for the drive");
    expect(card).not.toContain("Round trip from the office");
    expect(card).not.toContain("the drive from the office");
    expect(card).not.toContain("o.travel");
    expect(card).not.toContain("offer.drive");
    expect(card).not.toContain("roughPlaceLine");
  });
  it("a plan's saved parts are not sent with the plan either", async () => {
    const env = world();
    const plans = await call<RoofCarePlan[]>(listRoofCarePlans, env, { site_ids: [SITE] });
    expect(plans[0]!.price).toBe(2000);
    expect(JSON.stringify(plans)).not.toMatch(/list_price|travel_price/);
  });
});

// ── 7 ───────────────────────────────────────────────────────────────────────────────────────

describe("7. the second inspection's window is never under two weeks", () => {
  const days = (w: { from: string; to: string }) => daysBetween(w.from, w.to) + 1;
  it("mid January, inspection today: the autumn window, not May 15 alone", () => {
    const d = planDates("2027-01-15", "now", null)!;
    // 120 days on is May 15, the spring window's last day.
    expect(d.second).toEqual({ from: "2027-10-15", to: "2027-12-31" });
    expect(d.renews).toBe("2028-01-15");
  });
  it("early September, inspection today: next spring, not Dec 31 alone", () => {
    expect(planDates("2027-09-02", "now", null)!.second).toEqual({
      from: "2028-03-15",
      to: "2028-05-15",
    });
  });
  it("the plan year ending on the window's first day still leaves two weeks", () => {
    const d = planDates("2027-10-15", "window", null)!;
    expect(d.first).toEqual({ from: "2028-03-15", to: "2028-05-15" });
    expect(d.second).toEqual({ from: "2028-10-15", to: "2028-10-28" });
    // Nov 19, later: the plan year is twelve months and no longer. The renewal no longer
    // follows an inspection that ends after it (it had moved to 2028-10-28).
    expect(d.renews).toBe("2028-10-15");
  });
  it("two weeks left is enough, thirteen days is not", () => {
    // 120 days after Jan 2, 2027 is May 2: 14 days to May 15.
    expect(planDates("2027-01-02", "now", null)!.second).toEqual({
      from: "2027-05-02",
      to: "2027-05-15",
    });
    expect(planDates("2027-01-03", "now", null)!.second.from).toBe("2027-10-15");
  });
  it("on every day of two years, by each choice, it is at least two weeks", () => {
    let d = "2027-01-01";
    let short = 0;
    for (let n = 0; n < 731; n++) {
      for (const [mode, k] of [
        ["now", null],
        ["window", null],
        ["days", 45],
      ] as const)
        if (days(planDates(d, mode, k)!.second) < SECOND_WINDOW_MIN_DAYS) short++;
      const t = new Date(`${d}T12:00:00Z`);
      t.setUTCDate(t.getUTCDate() + 1);
      d = t.toISOString().slice(0, 10);
    }
    expect(short).toBe(0);
  });
  it("the database works it out the same way", () => {
    expect(SQL).toContain("where x.t - x.f >= 13 order by x.f limit 1;");
    expect(SQL).toContain("v2_by := least(v2_by, greatest(v_renews, v2_from + 13));");
    expect(SQL).toContain("v_renews := greatest(v_renews, v2_by);");
  });
});

// ── 8 ───────────────────────────────────────────────────────────────────────────────────────

describe("8. push back", () => {
  const fn = SQL.slice(
    SQL.indexOf("create or replace function public.roof_care_push_back("),
    SQL.indexOf("create or replace function public.invoice_lines_care_rule()"),
  );
  it("the inspection carried along keeps its own first date", () => {
    expect(fn).toContain("set due_from = x.due_from + p_days, due_by = x.due_by + p_days where");
    expect(fn).not.toContain("first_due_by = x.first_due_by + p_days");
  });
  it("a reason is added to the ones before it, and no reason leaves them alone", () => {
    expect(fn).toContain("when v_reason is null then push_reason");
    expect(fn).toContain("else concat_ws('; ', nullif(push_reason, ''),");
  });
  it("more than 30 days is still a manager's, with a reason", () => {
    expect(fn).toContain("if v_total > 30 then");
    expect(fn).toContain("More than 30 days needs a manager.");
  });
});

// ── 1 ───────────────────────────────────────────────────────────────────────────────────────

describe("1. an inspection's share of the plan goes on one live invoice", () => {
  type Client = Parameters<typeof buildLinesFromJob>[0];
  const build = (invoices: Tables[string], lines: Tables[string]) =>
    fakeSupabase(
      {
        service_jobs: [{ id: JOB, labor_rate_kind: "standard", roof_care_visit_id: V1 }],
        service_rates: [
          { rate_kind: "standard", role: "lead", time_kind: "labor", bill_rate: 85, cost_rate: 40 },
        ],
        service_time_entries: [],
        service_job_techs: [],
        inventory_movements: [],
        profiles: [],
        service_job_purchase_orders: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
            service_job_id: JOB,
            po_number: "1",
            title: "Sealant",
            price: 100,
            po_date: "2026-11-10",
            created_at: "2026-11-10T15:00:00Z",
            vendor_id: null,
            vendor_text: "Supply",
          },
        ],
        roof_care_visits: [visitRow(V1, "visit1", { amount: 450 })],
        roof_care_plans: [planRow()],
        invoices,
        invoice_lines: lines,
      },
      { rpcs: { technician_bill_rates: () => [] } },
    );
  const planLine = { id: 1, invoice_id: INV, source: carePlanLineSource(V1) };
  const totalsOf = async (env: ReturnType<typeof build>, invoiceId: string | null) =>
    (await buildLinesFromJob(env.db as unknown as Client, JOB, { poMarkup: false, invoiceId })).map(
      (l) => [l.kind, Number(l.total)],
    );

  it("the first invoice opens with the plan's line and prices nothing else", async () => {
    expect(await totalsOf(build([], []), null)).toEqual([
      ["other", 450],
      ["material", 0],
    ]);
  });
  it("another invoice on the ticket is built from its work, without the half again", async () => {
    const env = build([{ id: INV, service_job_id: JOB, status: "draft" }], [planLine]);
    expect(await totalsOf(env, null)).toEqual([["material", 100]]);
  });
  it("the invoice that has the line keeps it when it is rebuilt", async () => {
    const env = build([{ id: INV, service_job_id: JOB, status: "draft" }], [planLine]);
    expect(await totalsOf(env, INV)).toEqual([
      ["other", 450],
      ["material", 0],
    ]);
  });
  it("a void invoice does not hold the half", async () => {
    const env = build([{ id: INV, service_job_id: JOB, status: "void" }], [planLine]);
    expect((await totalsOf(env, null))[0]).toEqual(["other", 450]);
  });
  it("the database refuses the same share on a second live invoice", () => {
    expect(SQL).toContain(
      "where l.source = new.source and l.invoice_id <> new.invoice_id and i.status <> 'void'",
    );
    expect(SQL).toContain(
      "raise exception 'This inspection''s share of the plan is already on invoice #%. It is billed once.', v_other;",
    );
    expect(flat(read("src/lib/invoices.functions.ts"))).toContain("invoiceId: inv.id,");
  });
});

// ── 6 ───────────────────────────────────────────────────────────────────────────────────────

describe("6. an inspection that is done and on no invoice", () => {
  const visit = (over: Partial<PlanVisit> = {}): PlanVisit => ({
    id: V1,
    kind: "visit1",
    due_from: "2026-11-18",
    due_by: "2026-11-18",
    first_due_by: "2026-11-18",
    amount: 1000,
    push_reason: null,
    pushed_by_name: null,
    customer_asked: false,
    lost_on: null,
    ticket: {
      id: JOB,
      number: 7001,
      stage: "authorized",
      scheduled_date: null,
      completed_at: "2026-11-20T15:00:00Z",
      invoice_id: null,
    },
    billed: false,
    ...over,
  });
  it("is one that is authorized or further, bills something, and has no live invoice", () => {
    expect(visitUnbilled(visit())).toBe(true);
    expect(visitUnbilled(visit({ billed: true }))).toBe(false);
    // Done and waiting to be authorized: the invoice is made at that press, not before.
    expect(visitUnbilled(visit({ ticket: { ...visit().ticket!, stage: "done" } }))).toBe(false);
    expect(visitUnbilled(visit({ ticket: null }))).toBe(false);
    // A storm inspection bills nothing.
    expect(visitUnbilled(visit({ kind: "storm", amount: 0 }))).toBe(false);
    // A reader who does not see invoices is told nothing either way.
    expect(visitUnbilled(visit({ billed: null }))).toBe(false);
  });
  const jobs = [
    {
      id: JOB,
      number: 7001,
      stage: "authorized",
      scheduled_date: null,
      completed_at: "2026-11-20T15:00:00Z",
      invoice_id: null,
      roof_care_visit_id: V1,
      deleted_at: null,
    },
  ];
  it("the plan read says which inspections are billed, for someone who sees invoices", async () => {
    const env = world({
      service_jobs: jobs,
      invoices: [
        { id: INV, status: "draft", display_number: "7001" },
        { id: INV_B, status: "void", display_number: "7001.2" },
      ],
      invoice_lines: [{ id: 1, invoice_id: INV_B, source: carePlanLineSource(V1), total: 1000 }],
    });
    // Only a void invoice carries the line: not billed.
    let [p] = await plansOfSites(sb(env), [SITE], { money: true });
    expect(p!.visits.map((v) => v.billed)).toEqual([false, false]);
    env.tables["invoice_lines"]!.push({
      id: 2,
      invoice_id: INV,
      source: carePlanLineSource(V1),
      total: 1000,
    });
    [p] = await plansOfSites(sb(env), [SITE], { money: true });
    expect(p!.visits.map((v) => v.billed)).toEqual([true, false]);
    // Without the money: nothing said.
    [p] = await plansOfSites(sb(env), [SITE]);
    expect(p!.visits.map((v) => v.billed)).toEqual([null, null]);
  });
  it("a technician's read carries no billing and no amounts used", async () => {
    const env = world({ service_jobs: jobs });
    const [mine] = await call<RoofCarePlan[]>(listRoofCarePlans, env, { site_ids: [SITE] }, TECH);
    expect(mine!.visits[0]!.billed).toBeNull();
    expect(mine!.allowance_used).toBeNull();
    const [office] = await call<RoofCarePlan[]>(listRoofCarePlans, env, { site_ids: [SITE] });
    expect(office!.visits[0]!.billed).toBe(false);
    expect(office!.allowance_used).toBe(0);
  });
  it("Needs attention lists it under Waiting on the office, from the first day", () => {
    const base: AttentionIn = {
      today: "2026-11-23",
      now: "2026-11-23T15:00:00Z",
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
      careUnbilled: [
        {
          visit_id: V1,
          job_id: JOB,
          number: 7001,
          title: "Roof Care · Plant 2 (Acme)",
          label: "Inspection 1",
          amount: 1000,
          since: "2026-11-20T15:00:00Z",
        },
      ],
    };
    const { rows } = attentionList(base);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: `care_plan_unbilled:${V1}`,
      group: "office",
      kind: "care_plan_unbilled",
      tag: "Roof Care",
      title: "Roof Care · Plant 2 (Acme)",
      why: "Inspection 1 is done and its share of the plan is on no invoice. Open ticket #7001 and press Invoice this care plan inspection.",
      who: "Office",
      age: 3,
      ageText: "3 days",
      tone: "amber",
      amount: 1000,
      href: `/service?id=${JOB}`,
    });
    expect(attentionList({ ...base, careUnbilled: [] }).rows).toEqual([]);
  });
  it("the plan card flags it for those who see money", () => {
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain("{showMoney && visitUnbilled(visit) && (");
    expect(card).toContain("{VISIT_UNBILLED_WORDS}");
  });
});

// ── 10 ──────────────────────────────────────────────────────────────────────────────────────

describe("10. the yearly minor repairs: the sums", () => {
  const src = allowanceLineSource(PLAN);
  it("a line that takes from a plan is known by its source", () => {
    expect(src).toBe(`roof-care-allowance:${PLAN}`);
    expect(isAllowanceLine({ source: src })).toBe(true);
    expect(allowancePlanOf({ source: src })).toBe(PLAN);
    // The plan's own inspection line is not one.
    expect(isAllowanceLine({ source: carePlanLineSource(V1) })).toBe(false);
    expect(isAllowanceLine({ source: null })).toBe(false);
  });
  it("the most an invoice can take: what is left, and never more than its own work", () => {
    expect(allowanceCap({ allowance: 300, usedElsewhere: 0, billable: 800 })).toBe(300);
    expect(allowanceCap({ allowance: 300, usedElsewhere: 120, billable: 800 })).toBe(180);
    expect(allowanceCap({ allowance: 300, usedElsewhere: 0, billable: 75.5 })).toBe(75.5);
    expect(allowanceCap({ allowance: 300, usedElsewhere: 300, billable: 800 })).toBe(0);
    expect(allowanceCap({ allowance: 300, usedElsewhere: 400, billable: 800 })).toBe(0);
    expect(allowanceCap({ allowance: 300, usedElsewhere: 0, billable: -20 })).toBe(0);
  });
  it("blank takes all that can be taken; a typed amount is held to it", () => {
    expect(allowanceAmount(null, 180)).toBe(180);
    expect(allowanceAmount(undefined, 180)).toBe(180);
    expect(allowanceAmount(50, 180)).toBe(50);
    expect(allowanceAmount(500, 180)).toBe(180);
    expect(allowanceAmount(-5, 180)).toBe(0);
  });
  it("the line takes money off, is listed with its amount, and is not taxed", () => {
    expect(allowanceLine({ id: PLAN, plan: "guard" }, 180, 4)).toEqual({
      sort: 4,
      kind: "other",
      description: "Roof Guard plan: minor repairs included in your plan",
      qty: 1,
      unit: "ea",
      rate: -180,
      total: -180,
      cost_rate: 0,
      cost_total: 0,
      on_date: null,
      source: src,
      taxable: false,
      rate_overridden: true,
      show_on_invoice: true,
      hide_price: false,
    });
  });
  it("where an invoice stands", () => {
    const lines = [
      { source: "time:1", total: 500 },
      { source: null, total: 250 },
      { source: src, total: -100 },
    ];
    expect(billableBefore(lines)).toBe(750);
    expect(allowanceTaken(lines)).toBe(100);
    const a = invoiceAllowance({
      plan_id: PLAN,
      plan: "care",
      allowance: 300,
      usedElsewhere: 120,
      lines,
      choice: "applied",
    });
    expect(a).toEqual({
      plan_id: PLAN,
      plan: "care",
      allowance: 300,
      used_elsewhere: 120,
      left: 180,
      billable: 750,
      cap: 180,
      choice: "applied",
      applied: 100,
    });
  });
  it("Finalise waits only while nobody has answered and there is something to cover", () => {
    const a = (over: Record<string, unknown>) =>
      invoiceAllowance({
        plan_id: PLAN,
        plan: "care",
        allowance: 300,
        usedElsewhere: 0,
        lines: [{ source: null, total: 500 }],
        choice: null,
        ...over,
      });
    expect(allowanceUnanswered(a({}))).toBe(true);
    expect(allowanceUnanswered(a({ choice: "declined" }))).toBe(false);
    expect(allowanceUnanswered(a({ choice: "applied" }))).toBe(false);
    expect(allowanceUnanswered(a({ usedElsewhere: 300 }))).toBe(false);
    expect(allowanceUnanswered(a({ lines: [] }))).toBe(false);
    expect(allowanceUnanswered(null)).toBe(false);
    expect(ALLOWANCE_UNANSWERED(180)).toBe(
      "This property has a Roof Care plan with $180.00 of minor repairs left this plan year. Choose in the Roof Care plan box on the invoice whether it uses the plan, then finalise.",
    );
  });
  it("after the invoice changes, the line never takes more than the invoice bills", () => {
    expect(allowanceAfterChange(180, 750)).toBe(180);
    expect(allowanceAfterChange(180, 90)).toBe(90);
    expect(allowanceAfterChange(180, 0)).toBe(0);
    expect(allowanceAfterChange(180, -10)).toBe(0);
  });
  it("what the property page says", () => {
    expect(allowanceStatusWords({ repair_allowance: 300, allowance_used: 120 })).toBe(
      "Minor repairs: $120.00 of $300.00 used this plan year. $180.00 left.",
    );
  });
});

describe("10. the yearly minor repairs: on an invoice", () => {
  const repair = { id: REPAIR, site_id: SITE, roof_care_visit_id: null, deleted_at: null };
  const draft = (over: Record<string, unknown> = {}) => ({
    id: INV,
    status: "draft",
    service_job_id: REPAIR,
    bill_to_vendor_id: null,
    care_allowance_choice: null,
    care_allowance_plan_id: null,
    display_number: "7002",
    tax_rate: 0,
    ...over,
  });
  const work = (id: number, total: number, invoice_id = INV) => ({
    id,
    invoice_id,
    sort: id,
    kind: "labor",
    description: "Repair",
    qty: 1,
    unit: "ea",
    rate: total,
    total,
    cost_rate: 0,
    cost_total: 0,
    source: `time:${id}`,
    taxable: false,
  });
  const taken = (id: number, amount: number, invoice_id: string) => ({
    ...work(id, -amount, invoice_id),
    kind: "other",
    source: allowanceLineSource(PLAN),
  });
  type Inv = Parameters<typeof invoiceAllowanceOf>[1];
  type Lines = Parameters<typeof invoiceAllowanceOf>[2];
  const where = (env: Env, inv = env.tables["invoices"]![0]!) =>
    invoiceAllowanceOf(
      sb(env) as unknown as Parameters<typeof invoiceAllowanceOf>[0],
      inv as unknown as Inv,
      env.tables["invoice_lines"]!.filter((l) => l["invoice_id"] === inv["id"]) as unknown as Lines,
    );

  it("a repair at a property with a plan is asked; what the plan's other invoices took is counted", async () => {
    const env = world({
      service_jobs: [repair],
      invoices: [
        draft(),
        { id: INV_B, status: "final", service_job_id: REPAIR },
        { id: "void-1", status: "void", service_job_id: REPAIR },
      ],
      invoice_lines: [work(1, 800), taken(2, 120, INV_B), taken(3, 90, "void-1")],
    });
    const a = await where(env);
    // The void invoice's 90 is given back.
    expect(a).toMatchObject({ allowance: 300, used_elsewhere: 120, left: 180, cap: 180 });
    expect(allowanceUnanswered(a)).toBe(true);
  });
  it("the plan has no say on its own inspection, a vendor's invoice, a plan with none, or an ended plan", async () => {
    const lines = [work(1, 800)];
    const none = async (over: Tables, inv = draft()) =>
      where(world({ service_jobs: [repair], invoices: [inv], invoice_lines: lines, ...over }), inv);
    expect(await none({ service_jobs: [{ ...repair, roof_care_visit_id: V1 }] })).toBeNull();
    expect(await none({}, draft({ bill_to_vendor_id: "v" }))).toBeNull();
    expect(await none({}, draft({ service_job_id: null }))).toBeNull();
    expect(await none({ roof_care_plans: [planRow({ repair_allowance: 0 })] })).toBeNull();
    expect(await none({ roof_care_plans: [planRow({ status: "ended" })] })).toBeNull();
    expect(await none({ roof_care_plans: [] })).toBeNull();
    expect(await none({})).not.toBeNull();
  });
  it("Use the plan: one line for all that can be taken, the totals follow, the answer is kept", async () => {
    const env = world({
      service_jobs: [repair],
      invoices: [draft(), { id: INV_B, status: "final", service_job_id: REPAIR }],
      invoice_lines: [work(1, 800), taken(2, 120, INV_B)],
    });
    const r = await call<SetAllowanceResult>(setInvoiceAllowance, env, {
      id: INV,
      choice: "applied",
    });
    const own = r.lines.filter(isAllowanceLine);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
      total: -180,
      rate: -180,
      taxable: false,
      show_on_invoice: true,
    });
    // No amount typed: all it can take, and it follows the invoice from here on.
    expect(r.invoice).toMatchObject({
      care_allowance_choice: "auto",
      care_allowance_plan_id: PLAN,
      subtotal: 620,
      total: 620,
    });
    expect(r.allowance).toMatchObject({ applied: 180, choice: "auto", left: 180 });
    // Pressed again with a smaller amount: still one line, at the new amount.
    const again = await call<SetAllowanceResult>(setInvoiceAllowance, env, {
      id: INV,
      choice: "applied",
      amount: 50,
    });
    expect(again.lines.filter(isAllowanceLine).map((l) => Number(l.total))).toEqual([-50]);
    expect(again.invoice.total).toBe(750);
    // More than is left is held to what is left.
    const more = await call<SetAllowanceResult>(setInvoiceAllowance, env, {
      id: INV,
      choice: "applied",
      amount: 5000,
    });
    expect(more.lines.filter(isAllowanceLine).map((l) => Number(l.total))).toEqual([-180]);
  });
  it("Does not use the plan: the line goes, and the answer is kept", async () => {
    const env = world({
      service_jobs: [repair],
      invoices: [draft({ care_allowance_choice: "applied", care_allowance_plan_id: PLAN })],
      invoice_lines: [work(1, 800), taken(2, 100, INV)],
    });
    const r = await call<SetAllowanceResult>(setInvoiceAllowance, env, {
      id: INV,
      choice: "declined",
    });
    expect(r.lines.filter(isAllowanceLine)).toEqual([]);
    expect(r.invoice).toMatchObject({ care_allowance_choice: "declined", total: 800 });
    expect(allowanceUnanswered(r.allowance)).toBe(false);
  });
  it("it is refused on a final invoice, with nothing to take, where the plan has no say, and for a technician", async () => {
    const set = (env: Env, userId = ADMIN) =>
      call(setInvoiceAllowance, env, { id: INV, choice: "applied" }, userId);
    await expect(
      set(
        world({
          service_jobs: [repair],
          invoices: [draft({ status: "final" })],
          invoice_lines: [],
        }),
      ),
    ).rejects.toThrow("This invoice is final");
    await expect(
      set(world({ service_jobs: [repair], invoices: [draft()], invoice_lines: [] })),
    ).rejects.toThrow("There is nothing for the plan to cover");
    await expect(
      set(
        world({
          service_jobs: [repair],
          invoices: [draft()],
          invoice_lines: [work(1, 800)],
          roof_care_plans: [],
        }),
      ),
    ).rejects.toThrow("no Roof Care plan allowance to use");
    const env = world({
      service_jobs: [repair],
      invoices: [draft()],
      invoice_lines: [work(1, 800)],
    });
    await expect(set(env, TECH)).rejects.toThrow();
    expect(env.writes).toEqual([]);
  });
  // Owner, Nov 19: "can we have the tick auto ticked if there is still any allowance left?"
  const step = async (env: Env, over: Record<string, unknown> = {}) => {
    type Step = Parameters<typeof syncAllowance>;
    const inv = { ...env.tables["invoices"]![0]!, ...over };
    const changed = await syncAllowance(
      sb(env) as unknown as Step[0],
      inv as unknown as Step[1],
      env.tables["invoice_lines"]!.filter(
        (l) => l["invoice_id"] === inv["id"],
      ) as unknown as Step[2],
    );
    const lines = env.tables["invoice_lines"]!.filter((l) => l["invoice_id"] === INV);
    return { changed, lines, own: lines.filter(isAllowanceLine), inv: env.tables["invoices"]![0]! };
  };
  const at = (invoice: Record<string, unknown>, lines: Tables[string], over: Tables = {}) =>
    world({ service_jobs: [repair], invoices: [draft(invoice)], invoice_lines: lines, ...over });
  it("it is ticked by itself: a new repair invoice takes all the plan can cover", async () => {
    const r = await step(at({}, [work(1, 800)]));
    expect(r.changed).toBe(true);
    expect(r.own).toHaveLength(1);
    expect(r.own[0]).toMatchObject({ total: -300, rate: -300, taxable: false });
    expect(r.inv).toMatchObject({
      care_allowance_choice: "auto",
      care_allowance_plan_id: PLAN,
      subtotal: 500,
      total: 500,
    });
    // A smaller invoice is covered whole, and no further.
    const small = await step(at({}, [work(1, 75)]));
    expect(small.own[0]).toMatchObject({ total: -75 });
    expect(small.inv["total"]).toBe(0);
  });
  it("ticked by itself, it follows the invoice up and down", async () => {
    const auto = { care_allowance_choice: "auto", care_allowance_plan_id: PLAN };
    // The work grew from 100 to 800: the line grows to all that is left.
    let r = await step(at(auto, [work(1, 800), taken(2, 100, INV)]));
    expect(r.own.map((l) => l["total"])).toEqual([-300]);
    // The work was cut to 60: the line follows it down.
    r = await step(at(auto, [work(1, 60), taken(2, 300, INV)]));
    expect(r.own.map((l) => l["total"])).toEqual([-60]);
    expect(r.inv["care_allowance_choice"]).toBe("auto");
    // Nothing left to bill: the line goes, to come back with the work.
    r = await step(at(auto, [taken(2, 300, INV)]));
    expect(r.own).toEqual([]);
    expect(r.inv["care_allowance_choice"]).toBeNull();
    // Already right: nothing is written.
    const env = at(auto, [work(1, 800), taken(2, 300, INV)]);
    expect((await step(env)).changed).toBe(false);
    expect(env.writes).toEqual([]);
  });
  it("only what the plan's other invoices left is taken", async () => {
    const r = await step(
      at({}, [work(1, 800), taken(2, 120, INV_B)], {
        invoices: [draft(), { id: INV_B, status: "final", service_job_id: REPAIR }],
      }),
    );
    expect(r.own.map((l) => l["total"])).toEqual([-180]);
    // Used up: nothing is ticked and nothing is asked.
    const none = await step(
      at({}, [work(1, 800), taken(2, 300, INV_B)], {
        invoices: [draft(), { id: INV_B, status: "final", service_job_id: REPAIR }],
      }),
    );
    expect(none.changed).toBe(false);
    expect(none.own).toEqual([]);
  });
  it("an amount typed by the office is held: it never grows, and is cut to what the invoice bills", async () => {
    const typed = { care_allowance_choice: "applied", care_allowance_plan_id: PLAN };
    let r = await step(at(typed, [work(1, 800), taken(2, 100, INV)]));
    expect(r.changed).toBe(false);
    r = await step(at(typed, [work(1, 60), taken(2, 100, INV)]));
    expect(r.own.map((l) => l["total"])).toEqual([-60]);
    expect(r.inv["care_allowance_choice"]).toBe("applied");
  });
  it("a no stays a no, whatever the invoice then bills", async () => {
    const env = at({ care_allowance_choice: "declined", care_allowance_plan_id: PLAN }, [
      work(1, 800),
    ]);
    const r = await step(env);
    expect(r.changed).toBe(false);
    expect(r.own).toEqual([]);
    expect(env.writes).toEqual([]);
  });
  it("an invoice switched to a vendor takes nothing from the customer's plan", async () => {
    const env = at({ care_allowance_choice: "auto", care_allowance_plan_id: PLAN }, [
      work(1, 800),
      taken(2, 300, INV),
    ]);
    const r = await step(env, { bill_to_vendor_id: "v" });
    expect(r.changed).toBe(true);
    expect(r.own).toEqual([]);
    expect(r.inv).toMatchObject({ care_allowance_choice: null, total: 800 });
  });
  it("the plan's own inspection, and a property with no plan, are left alone", async () => {
    const own = world({
      service_jobs: [{ ...repair, roof_care_visit_id: V1 }],
      invoices: [draft()],
      invoice_lines: [work(1, 800)],
    });
    expect((await step(own)).changed).toBe(false);
    const none = at({}, [work(1, 800)], { roof_care_plans: [] });
    expect((await step(none)).changed).toBe(false);
    expect(none.writes).toEqual([]);
  });
  it("the rule, case by case", () => {
    expect(allowanceStep({ choice: null, taken: 0, cap: 300 })).toEqual({
      choice: "auto",
      amount: 300,
    });
    expect(allowanceStep({ choice: null, taken: 0, cap: 0 })).toEqual({ choice: null, amount: 0 });
    expect(allowanceStep({ choice: "auto", taken: 100, cap: 300 })).toEqual({
      choice: "auto",
      amount: 300,
    });
    expect(allowanceStep({ choice: "auto", taken: 300, cap: 0 })).toEqual({
      choice: null,
      amount: 0,
    });
    expect(allowanceStep({ choice: "applied", taken: 100, cap: 300 })).toEqual({
      choice: "applied",
      amount: 100,
    });
    expect(allowanceStep({ choice: "applied", taken: 100, cap: 60 })).toEqual({
      choice: "applied",
      amount: 60,
    });
    expect(allowanceStep({ choice: "declined", taken: 0, cap: 300 })).toEqual({
      choice: "declined",
      amount: 0,
    });
  });
  it("what the allowance has taken shows on the plan, with the invoices", async () => {
    const env = world({
      invoices: [
        { id: INV, status: "final", display_number: "7002" },
        { id: INV_B, status: "draft", display_number: "7003" },
        { id: "void-1", status: "void", display_number: "7004" },
      ],
      invoice_lines: [taken(1, 120, INV), taken(2, 30.5, INV_B), taken(3, 90, "void-1")],
    });
    const [p] = await plansOfSites(sb(env), [SITE], { money: true });
    expect(p!.repair_allowance).toBe(300);
    expect(p!.allowance_used).toBe(150.5);
    expect(p!.allowance_uses).toEqual([
      { invoice_id: INV, number: "7002", amount: 120 },
      { invoice_id: INV_B, number: "7003", amount: 30.5 },
    ]);
  });
});

describe("10. the yearly minor repairs: how it is made sure of", () => {
  it("Finalise asks before the PDF is drawn, and the database refuses it too", () => {
    const fn = flat(read("src/lib/invoices.functions.ts"));
    const final = fn.slice(
      fn.indexOf("async function finalizeDraft("),
      fn.indexOf("const pdfPath ="),
    );
    expect(final).toContain(
      "if (allowanceUnanswered(allowance)) throw new Error(ALLOWANCE_UNANSWERED(allowance.left));",
    );
    expect(final.indexOf("allowanceUnanswered(allowance)")).toBeLessThan(
      final.indexOf("renderInvoicePdf(sb, b)"),
    );
    expect(SQL).toContain(
      "if not (old.status = 'draft' and new.status not in ('draft', 'void')) then",
    );
    expect(SQL).toContain(
      "raise exception 'This property has a Roof Care plan with $% of minor repairs left this plan year. Choose on the invoice whether it uses the plan, then finalise.',",
    );
    expect(SQL).toContain(
      "create trigger invoices_care_allowance_rule before update of status on public.invoices",
    );
  });
  it("the database never lets a plan's lines pass its allowance, or add money", () => {
    expect(SQL).toContain("if v_used - new.total > v_allow + 0.005 then");
    expect(SQL).toContain(
      "raise exception 'Only $% of this plan''s minor repairs allowance is left.',",
    );
    expect(SQL).toContain(
      "raise exception 'A plan allowance line takes money off the invoice. It cannot add to it.';",
    );
    // A void invoice gives its amount back.
    expect(SQL).toContain(
      "where l.source = new.source and i.status <> 'void' and l.id is distinct from new.id;",
    );
    expect(SQL).toContain(
      "revoke all on function public.invoice_lines_care_rule() from public, anon, authenticated;",
    );
  });
  it("the plan keeps its allowance from the day it is signed", () => {
    expect(SQL).toContain(
      "alter table public.roof_care_plans add column if not exists repair_allowance numeric not null default 0;",
    );
    expect(SQL).toContain("s.data->'plans'->p_plan->>'allowance'");
    expect(SQL).toContain("trim(p_terms), greatest(coalesce(v_allowance, 0), 0))");
  });
  it("the editor's save cannot type over the line, and a rebuild carries it", () => {
    const fn = flat(read("src/lib/invoices.functions.ts"));
    // (Later on Nov 19: the leak call's travel line is the plan's too, so these read isPlanLine.
    // roof-care-leak-calls-nov19.test.ts.)
    expect(fn).toContain("if (isPlanLine(l) || (prev && isPlanLine(prev))) {");
    // The editor never drops the line either: it is kept whatever was sent.
    expect(fn).toContain("for (const l of oldLines ?? []) if (isPlanLine(l)) kept.add(l.id);");
    expect(fn).toContain(
      // (Later on Nov 19: the leak call's travel first, then the credit, in syncPlanLines.)
      "if (await syncPlanLines(sb, { ...inv, bill_to_vendor_id: billedTo }, lines)) {",
    );
    expect(fn).toContain(
      "? allowanceAfterChange(allowanceTaken(allowanceOld), billableBefore(lines))",
    );
    expect(fn).toContain(
      "...(allowanceGone ? { care_allowance_choice: null, care_allowance_plan_id: null } : {}),",
    );
    // A new draft and a rebuilt one both take the plan into account.
    expect(fn).toContain("return withPlanAllowance(sb, inv); }");
    expect(fn).toContain("return withPlanAllowance(sb, updated);");
    expect(fn).toContain("if (!(await syncPlanLines(sb, inv, made.lines))) return made;");
  });
  it("the invoice has the box and the read-only line; the property page has the status", () => {
    const editor = flat(read("src/components/service/invoice-editor.tsx"));
    expect(editor).toContain("{job && allowanceQ.data && (");
    expect(editor).toContain("Does this invoice use the plan? Finalise waits for the answer.");
    // Ticked by itself, and said so, with the way out.
    expect(editor).toContain('{a.choice === "auto" && (');
    expect(editor).toContain("If this is not a minor repair, press Does not use the plan.");
    expect(editor).toContain("const own = r.lines.filter(isPlanLine).map(lineFrom);");
    expect(editor).toContain('data-action="allowance-apply"');
    expect(editor).toContain('data-action="allowance-decline"');
    expect(editor).toContain("isPlanLine(l) ? (");
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    // (Nov 19, later: what is used and left is one tally with the plan's other benefits,
    // "Used this plan year" (roof-care-benefits.ts benefitsUsed; its own tests are in
    // roof-care-customer-facing-nov19.test.ts). The invoices that used it stay listed here.)
    expect(card).toContain(
      "{!short && active.repair_allowance > 0 && active.allowance_used !== null && (",
    );
    expect(card).toContain(
      "{!short && <PlanBenefits plan={active} today={today} open={includesOpen} />}",
    );
    expect(card).not.toContain("allowanceStatusWords({");
  });
});

describe("10. the database lets the three answers through, and no other", () => {
  it("auto, applied, declined", () => {
    const sql = flat(read("supabase/migrations/20261119300000_roof_care_allowance_auto.sql"));
    expect(sql).toContain(
      "check (care_allowance_choice is null or care_allowance_choice in ('auto', 'applied', 'declined'));",
    );
  });
});

describe("10. on the customer's copy", () => {
  it("what the plan takes off is listed under the work, not above it", () => {
    const server = flat(read("src/lib/invoices.server.ts"));
    const listed = server.indexOf("if (!isPlanLine(row.line)) listLine(row);");
    const rollup = server.indexOf("doc.text(rows.rollup.label, cols.desc, 9);");
    const taken = server.indexOf("if (isAllowanceLine(row.line)) listLine(row);");
    expect(listed).toBeGreaterThan(0);
    expect(rollup).toBeGreaterThan(listed);
    expect(taken).toBeGreaterThan(rollup);
  });
});

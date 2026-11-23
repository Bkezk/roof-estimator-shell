/**
 * Roof Care plans, step 2: a property's plan, its inspections, the push-back and the invoice
 * (owner, Nov 18; docs/roof-care-plans.md, docs/qa/roof-care-plans-2026-11-18.md).
 *
 * The owner's words: "i love the auto generating inspection idea just make sure it works, when
 * does that start? at sign up? will there be a visual indicator on the customer page showing
 * theyve had 1, 2, or 3 (called storm inspection) done this year? the inspection needs to
 * specify that it is a care plan inspection and it needs to be able to be pushed back and the
 * subsequent inspection pushed back with it", "it is billed half at first visit half at second
 * visit and invoiced", and of the first visit: "the option to do the inspection immediately or
 * push it back x amount of days or wait until the next window. the two windows should be mid
 * march to mid may and mid oct thru december."
 *
 * The rules are the database's and were tried there (the record lists the trials). Here: their
 * twin for the screens, the server functions against a stand-in database, and the text of the
 * database change. Every dollar amount is made up.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

type DriveAnswer = {
  hours: number;
  miles: number;
  source: string;
  note: string;
  placed_by: string;
  place: string | null;
} | null;
const drive = vi.fn<(...a: unknown[]) => Promise<DriveAnswer>>();
vi.mock("@/lib/roof-care.functions", () => ({
  officeOrigin: async () => ({ line: "1 Office Rd, London, KY", state: "KY" }),
  driveTo: (...a: unknown[]) => drive(...a),
}));
const announced = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const moved = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
vi.mock("@/lib/service.functions", () => ({
  announceCarePlanTickets: (...a: unknown[]) => announced(...a),
  moveCarePlanTicketDate: (...a: unknown[]) => moved(...a),
}));

import { isFieldOnly } from "@/lib/access";
import { buildLinesFromJob } from "@/lib/invoices.server";
import { attentionLimits, attentionList } from "@/lib/owner-attention";
import { carePlanCovered, carePlanInvoiceLines, carePlanOwnLine } from "@/lib/roof-care-invoice";
import {
  carePlanLineSource,
  carePlanLineWords,
  ADDITIONAL_SERVICES_LABEL,
  CARE_PLAN_LABEL,
  dueWords,
  nextWindow,
  planBadge,
  planDates,
  pushPreview,
  PUSH_NEEDS_MANAGER,
  isPriceChanged,
  priceChangedLine,
  PUSH_NEEDS_REASON,
  readPriceAnswer,
  ROOF_CARE_TERMS,
  ROOF_CARE_TERMS_VERSION,
  runsLate,
  TERMS_NOT_AGREED,
  visitsDone,
  visitsDoneWords,
  visitState,
  windowsFrom,
  windowWords,
  type PlanVisit,
  type RoofCarePlan,
} from "@/lib/roof-care-plan";
import {
  addRoofCareStorm,
  listRoofCarePlans,
  NO_ADDRESS_FOR_PRICE,
  pushBackRoofCareVisit,
  requestAdditionalService,
  roofCareOffer,
  signUpRoofCare,
  SITE_NOT_YOURS,
  type PushBackResult,
  type RoofCareOffer,
} from "@/lib/roof-care-plan.functions";
import { NOT_PLACED_LINE } from "@/lib/roof-care-locate";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const visit = (over: Partial<PlanVisit> = {}): PlanVisit => ({
  id: "v1",
  kind: "visit1",
  due_from: "2027-03-15",
  due_by: "2027-05-15",
  first_due_by: "2027-05-15",
  amount: 500,
  push_reason: null,
  pushed_by_name: null,
  customer_asked: false,
  lost_on: null,
  ticket: null,
  billed: null,
  ...over,
});
const ticket = (stage: string) => ({
  id: "j1",
  number: 7001,
  stage,
  scheduled_date: null,
  completed_at: null,
  invoice_id: null,
});

describe("the two windows", () => {
  it("are mid March to mid May and mid October to the end of December", () => {
    expect(windowsFrom("2026-11-18").slice(0, 3)).toEqual([
      { from: "2026-10-15", to: "2026-12-31" },
      { from: "2027-03-15", to: "2027-05-15" },
      { from: "2027-10-15", to: "2027-12-31" },
    ]);
    // A window that has ended is not offered.
    expect(windowsFrom("2027-05-16")[0]).toEqual({ from: "2027-10-15", to: "2027-12-31" });
    // Its last day still counts.
    expect(windowsFrom("2027-05-15")[0]).toEqual({ from: "2027-03-15", to: "2027-05-15" });
  });
  // Nov 20 (break test 19): a window open today is used when two weeks of it are left, from
  // today to its last day. Before, a sign-up in November waited until March.
  it("the inspection window is the one open today with two weeks left, else the next to open", () => {
    expect(nextWindow("2026-11-18")).toEqual({ from: "2026-11-18", to: "2026-12-31" });
    expect(nextWindow("2026-07-01")).toEqual({ from: "2026-10-15", to: "2026-12-31" });
    expect(nextWindow("2027-03-15")).toEqual({ from: "2027-03-15", to: "2027-05-15" });
    expect(nextWindow("2027-03-14")).toEqual({ from: "2027-03-15", to: "2027-05-15" });
    // Exactly two weeks left counts; one day less waits for the next window.
    expect(nextWindow("2026-12-18")).toEqual({ from: "2026-12-18", to: "2026-12-31" });
    expect(nextWindow("2026-12-19")).toEqual({ from: "2027-03-15", to: "2027-05-15" });
  });
  it("are said in words", () => {
    expect(windowWords({ from: "2027-03-15", to: "2027-05-15" })).toBe("Mar 15 to May 15, 2027");
    expect(dueWords({ due_from: "2026-11-28", due_by: "2026-11-28" })).toBe("Due Nov 28, 2026");
    expect(dueWords({ due_from: "2027-03-15", due_by: "2027-05-15" })).toBe(
      "Due Mar 15 to May 15, 2027",
    );
  });
});

describe("when a new plan's two inspections fall (the same sum as the database's sign-up)", () => {
  // Each of these was produced by roof_care_sign_up on the live database on Nov 18.
  it("today: the second is four months on, inside the spring window", () => {
    expect(planDates("2026-11-18", "now", null)).toEqual({
      first: { from: "2026-11-18", to: "2026-11-18" },
      second: { from: "2027-03-18", to: "2027-05-15" },
      renews: "2027-11-18",
    });
  });
  it("pushed back 10 days: both move with it", () => {
    expect(planDates("2026-11-18", "days", 10)).toEqual({
      first: { from: "2026-11-28", to: "2026-11-28" },
      second: { from: "2027-03-28", to: "2027-05-15" },
      renews: "2027-11-18",
    });
  });
  // Nov 20 (break test 19): Nov 18 is inside the fall window with six weeks left, so the first
  // inspection is in it, and the second four months on in spring. It used to wait for March.
  it("the window: the one open today, then spring four months on", () => {
    expect(planDates("2026-11-18", "window", null)).toEqual({
      first: { from: "2026-11-18", to: "2026-12-31" },
      second: { from: "2027-03-18", to: "2027-05-15" },
      renews: "2027-11-18",
    });
    // Under two weeks of the window left: the next one, and the fall up to the plan year's end.
    expect(planDates("2026-12-20", "window", null)).toEqual({
      first: { from: "2027-03-15", to: "2027-05-15" },
      second: { from: "2027-10-15", to: "2027-12-20" },
      renews: "2027-12-20",
    });
  });
  // Nov 19: it used to carry the renewal with it (to 2028-05-15). The plan year is twelve
  // months and no longer: such an inspection is owed at renewal.
  it("a second inspection that cannot fit the plan year does not move the renewal", () => {
    // Signed Jan 20, first inspection 300 days on (Nov 16): four months later is past Jan 20.
    const d = planDates("2027-01-20", "days", 300)!;
    expect(d.first.from).toBe("2027-11-16");
    expect(d.second).toEqual({ from: "2028-03-15", to: "2028-05-15" });
    expect(d.renews).toBe("2028-01-20");
  });
  it("the two are never both in one season", () => {
    // Late September: four months on is January, so the second waits for spring.
    expect(planDates("2026-09-20", "now", null)!.second).toEqual({
      from: "2027-03-15",
      to: "2027-05-15",
    });
    // July: the fall window.
    expect(planDates("2026-07-20", "now", null)!.second).toEqual({
      from: "2026-11-17",
      to: "2026-12-31",
    });
  });
  it("no days, or days out of range, is no plan", () => {
    expect(planDates("2026-11-18", "days", null)).toBeNull();
    expect(planDates("2026-11-18", "days", 0)).toBeNull();
    expect(planDates("2026-11-18", "days", 366)).toBeNull();
    expect(planDates("2026-11-18", "days", 1.5)).toBeNull();
  });
  it("a plan signed on Feb 29 renews on Feb 28", () => {
    expect(planDates("2028-02-29", "now", null)!.renews).toBe("2029-02-28");
  });
});

describe("the indicator on the property: how many inspections are done", () => {
  const plan = (visits: PlanVisit[]): Pick<RoofCarePlan, "visits"> => ({ visits });
  it("an inspection is done once its ticket is Done or further", () => {
    for (const s of ["done", "authorized", "invoiced", "closed"])
      expect(visitState(visit({ ticket: ticket(s) }), "2027-04-01")).toBe("done");
    expect(visitState(visit({ ticket: ticket("scheduled") }), "2027-04-01")).toBe("ticket");
    expect(visitState(visit(), "2027-04-01")).toBe("waiting");
  });
  it("late is past its last day and not done, with or without a ticket", () => {
    expect(visitState(visit(), "2027-05-15")).toBe("waiting");
    expect(visitState(visit(), "2027-05-16")).toBe("late");
    expect(visitState(visit({ ticket: ticket("open") }), "2027-05-16")).toBe("late");
    expect(visitState(visit({ ticket: ticket("done") }), "2027-05-16")).toBe("done");
  });
  it("counts 0, 1 and 2, and the storm inspection on its own", () => {
    const v1 = visit({ ticket: ticket("authorized") });
    const v2 = visit({ id: "v2", kind: "visit2" });
    const storm = visit({ id: "s", kind: "storm", amount: 0, ticket: ticket("done") });
    expect(visitsDone(plan([visit(), v2]), "2027-04-01")).toEqual({ visits: 0, storm: 0 });
    expect(visitsDoneWords(plan([v1, v2]), "2027-04-01")).toBe("1 of 2 inspections done");
    expect(visitsDoneWords(plan([v1, { ...v2, ticket: ticket("closed") }]), "2027-04-01")).toBe(
      "2 of 2 inspections done",
    );
    expect(visitsDoneWords(plan([v1, v2, storm]), "2027-04-01")).toBe(
      "1 of 2 inspections done, and a storm inspection",
    );
  });
  it("names the plan, and says when it has ended", () => {
    expect(planBadge({ plan: "guard", status: "active" })).toBe("Roof Guard");
    expect(planBadge({ plan: "watch", status: "ended" })).toBe("Roof Watch (ended)");
  });
  it("running late is a renewal date past twelve months from sign-up", () => {
    expect(runsLate({ signed_on: "2026-11-18", renews_on: "2027-11-18" })).toBe(false);
    expect(runsLate({ signed_on: "2026-11-18", renews_on: "2027-11-19" })).toBe(true);
  });
});

describe("pushing an inspection back", () => {
  const v = { due_by: "2026-11-18", first_due_by: "2026-11-18" };
  it("up to 30 days past the first date is anyone's in the office", () => {
    expect(pushPreview(v, 30, { manager: false, reason: "" })).toEqual({
      due_by: "2026-12-18",
      total: 30,
      problem: null,
    });
  });
  it("more than 30 days needs a manager", () => {
    expect(pushPreview(v, 31, { manager: false, reason: "the customer asked" })!.problem).toBe(
      PUSH_NEEDS_MANAGER(31),
    );
  });
  it("and from a manager, a reason", () => {
    expect(pushPreview(v, 31, { manager: true, reason: "  " })!.problem).toBe(
      PUSH_NEEDS_REASON(31),
    );
    expect(pushPreview(v, 31, { manager: true, reason: "roof under snow" })!.problem).toBeNull();
  });
  it("the 30 days are counted from the first date, not from the last push", () => {
    const pushedOnce = { due_by: "2026-12-08", first_due_by: "2026-11-18" };
    expect(pushPreview(pushedOnce, 10, { manager: false, reason: "" })!.problem).toBeNull();
    expect(pushPreview(pushedOnce, 11, { manager: false, reason: "" })!.total).toBe(31);
    expect(pushPreview(pushedOnce, 11, { manager: false, reason: "" })!.problem).toBe(
      PUSH_NEEDS_MANAGER(31),
    );
  });
  it("no days typed is nothing to preview", () => {
    expect(pushPreview(v, null, { manager: true, reason: "" })).toBeNull();
    expect(pushPreview(v, 0, { manager: true, reason: "" })).toBeNull();
  });
});

describe("the price the database hands back is read strictly", () => {
  const offer = (plan: string, price: number) => ({
    plan,
    list: price,
    travel: 0,
    price,
    visit1: Math.ceil(price / 2),
    visit2: price - Math.ceil(price / 2),
    trips: 2,
  });
  const good = {
    ready: true,
    custom_quote: false,
    baseline_hours: 1,
    baseline_miles: 40,
    beyond_baseline: false,
    plans: [offer("watch", 801), offer("care", 1200), offer("guard", 2000)],
  };
  it("three plans, each with its two halves", () => {
    const a = readPriceAnswer(good);
    expect(a.ready && !a.custom_quote && a.plans.map((p) => [p.name, p.price])).toEqual([
      ["Roof Watch", 801],
      ["Roof Care", 1200],
      ["Roof Guard", 2000],
    ]);
    expect(a.ready && !a.custom_quote && [a.plans[0]!.visit1, a.plans[0]!.visit2]).toEqual([
      401, 400,
    ]);
  });
  it("carries no cost and no profit, whatever is sent", () => {
    const a = readPriceAnswer({
      ...good,
      plans: good.plans.map((p) => ({ ...p, cost: 1, profit: 2 })),
    });
    expect(JSON.stringify(a)).not.toMatch(/cost|profit/);
  });
  it("anything odd is “not ready”, never a price", () => {
    expect(readPriceAnswer(null)).toEqual({ ready: false });
    expect(readPriceAnswer({ ready: false })).toEqual({ ready: false });
    expect(readPriceAnswer({ ...good, plans: good.plans.slice(0, 2) })).toEqual({ ready: false });
    expect(
      readPriceAnswer({
        ...good,
        plans: [{ ...good.plans[0], price: "abc" }, ...good.plans.slice(1)],
      }),
    ).toEqual({ ready: false });
    expect(readPriceAnswer({ ...good, baseline_hours: null })).toEqual({ ready: false });
  });
  it("a roof over the limit is a custom quote with no plans", () => {
    expect(
      readPriceAnswer({
        ready: true,
        custom_quote: true,
        custom_quote_over_sqft: 60000,
        plans: [],
      }),
    ).toEqual({ ready: true, custom_quote: true, over_sqft: 60000, plans: [] });
  });
});

// ── The server functions ────────────────────────────────────────────────────────────────────

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SITE = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";
const V1 = "44444444-4444-4444-8444-444444444441";
const V2 = "44444444-4444-4444-8444-444444444442";
const JOB = "55555555-5555-4555-8555-555555555555";

const ROUTED = {
  hours: 3.5,
  miles: 180,
  source: "routed",
  note: "",
  placed_by: "building",
  place: null,
};

function world(
  over: Record<string, Record<string, unknown>[]> = {},
  rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {},
) {
  return fakeSupabase(
    {
      profiles: [{ id: ADMIN, role: "admin", access: [], full_name: "Ann Admin", email: "a@x" }],
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
      roof_care_plans: [],
      roof_care_visits: [],
      service_jobs: [],
      ...over,
    },
    { rpcs },
  );
}
const call = <T>(fn: unknown, env: ReturnType<typeof world>, data?: unknown, userId = ADMIN) =>
  (fn as (a: { data: unknown; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });

beforeEach(() => {
  drive.mockReset();
  drive.mockResolvedValue(ROUTED);
  announced.mockClear();
  moved.mockClear();
});

describe("the price for a property", () => {
  it("is asked of the database with the drive worked out on the server", async () => {
    const env = world({}, { roof_care_price: () => ({ ready: false }) });
    const o = await call<RoofCareOffer>(roofCareOffer, env, { site_id: SITE, sqft: 20000 });
    expect(env.rpcCalls).toEqual([
      { fn: "roof_care_price", args: { p_sqft: 20000, p_hours: 3.5, p_miles: 180 } },
    ]);
    // (Nov 19: the drive stays on the server. The screen is told the property was placed.)
    expect(o.placed).toBe(true);
    expect(o.estimate).toBeNull();
    expect(o.price).toEqual({ ready: false });
    // The address went to the map as the property has it.
    expect(drive.mock.calls[0]![2]).toEqual({
      address: "100 Main St",
      city: "London",
      state: "KY",
      zip: "40741",
    });
    expect(drive.mock.calls[0]![4]).toBeNull();
  });
  it("a property with a point on its record is driven to that point", async () => {
    const env = world({
      crm_sites: [
        {
          id: SITE,
          account_id: ACCOUNT,
          name: "P",
          address1: "",
          lat: 37.1,
          lng: -84.1,
          deleted_at: null,
        },
      ],
    });
    await call(roofCareOffer, env, { site_id: SITE });
    expect(drive.mock.calls[0]![4]).toEqual({ lat: 37.1, lng: -84.1 });
  });
  it("no roof size: the drive alone, and the database is not asked", async () => {
    const env = world();
    const o = await call<RoofCareOffer>(roofCareOffer, env, { site_id: SITE });
    expect(o.price).toBeNull();
    expect(env.rpcCalls).toEqual([]);
  });
  it("an address that cannot be placed has no price", async () => {
    drive.mockResolvedValue(null);
    const env = world();
    const o = await call<RoofCareOffer>(roofCareOffer, env, { site_id: SITE, sqft: 20000 });
    expect(o).toEqual({
      site: { id: SITE, name: "Plant 2" },
      placed: false,
      estimate: null,
      price: null,
      // (Nov 20: the map's roof size for the property; none here.)
      map_sqft: null,
    });
    expect(env.rpcCalls).toEqual([]);
  });
  it("a property with no address and no point says so", async () => {
    const env = world({
      crm_sites: [
        {
          id: SITE,
          account_id: ACCOUNT,
          name: "P",
          address1: " ",
          lat: null,
          lng: null,
          deleted_at: null,
        },
      ],
    });
    await expect(call(roofCareOffer, env, { site_id: SITE, sqft: 1 })).rejects.toThrow(
      NO_ADDRESS_FOR_PRICE,
    );
  });
  it("a property the reader cannot open is not found", async () => {
    const env = world({ crm_sites: [] });
    await expect(call(roofCareOffer, env, { site_id: SITE })).rejects.toThrow(SITE_NOT_YOURS);
  });
});

describe("signing a customer up", () => {
  const signed = (rpc: (a: Record<string, unknown>) => unknown) =>
    world(
      {
        roof_care_plans: [
          {
            id: PLAN,
            account_id: ACCOUNT,
            site_id: SITE,
            plan: "guard",
            status: "active",
            signed_on: "2026-11-18",
            renews_on: "2027-11-18",
            roof_sqft: 20000,
            price: 2000,
            list_price: 1800,
            travel_price: 200,
            price_estimated: false,
            agreed_by: "Pat Smith",
            sold_by_name: "Ann Admin",
            notes: "",
            ended_on: null,
            ended_reason: null,
          },
        ],
        roof_care_visits: [
          {
            id: V1,
            plan_id: PLAN,
            kind: "visit1",
            due_from: "2026-11-18",
            due_by: "2026-11-18",
            first_due_by: "2026-11-18",
            amount: 1000,
            push_reason: null,
            pushed_by_name: null,
            customer_asked: false,
            lost_on: null,
          },
          {
            id: V2,
            plan_id: PLAN,
            kind: "visit2",
            due_from: "2027-03-18",
            due_by: "2027-05-15",
            first_due_by: "2027-05-15",
            amount: 1000,
            push_reason: null,
            pushed_by_name: null,
            customer_asked: false,
            lost_on: null,
          },
        ],
        service_jobs: [
          {
            id: JOB,
            number: 7001,
            stage: "scheduled",
            scheduled_date: "2026-11-18",
            completed_at: null,
            invoice_id: null,
            roof_care_visit_id: V1,
            deleted_at: null,
          },
        ],
      },
      // Nov 19: the sign-up asks the database for the price first, to hold it against the one
      // the form showed (made-up numbers; the real ones are not in the repository).
      // (Later on Nov 19: the sign-up leaves the plan waiting for its payment, through
      // roof_care_sign_up_await_payment. roof-care-pay-first-nov19.test.ts.)
      { roof_care_sign_up_await_payment: rpc, roof_care_price: () => priced.answer },
    );
  const priced = {
    answer: {
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
    } as Record<string, unknown>,
  };
  const form = {
    site_id: SITE,
    plan: "guard",
    sqft: 20000,
    first: "now",
    days: null,
    // (Nov 19: the sign-up asks how they pay, by check or by card.)
    pay_method: "check",
    agreed_by: " Pat Smith ",
    notes: "",
    terms_agreed: true,
    shown_price: 321,
  };

  it("a price that is no longer the one shown is refused, and nothing is saved (Nov 19)", async () => {
    // The owner, of the audit's finding that the saved price could differ from the shown one:
    // "Fix". The drive is worked out again at sign-up; if it or the numbers changed, the plan
    // would have been saved at a price the customer never saw.
    const seen: Record<string, unknown>[] = [];
    const env = signed((a) => {
      seen.push(a);
      return PLAN;
    });
    await expect(call(signUpRoofCare, env, { ...form, shown_price: 300 })).rejects.toThrow(
      priceChangedLine(300, 321),
    );
    expect(seen).toEqual([]);
    expect(env.writes).toEqual([]);
    expect(announced).not.toHaveBeenCalled();
    expect(isPriceChanged(priceChangedLine(300, 321))).toBe(true);
    expect(priceChangedLine(1300, 12086)).toBe(
      "The price changed: this plan is now $12,086, not the $1,300 shown. The prices have been read again. Check them with the customer and press again.",
    );
    // The same price goes through.
    await call(signUpRoofCare, env, form);
    expect(seen).toHaveLength(1);
  });
  it("the form sends the price it showed, and reads the prices again when it is refused", () => {
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain("shown_price: plans.find((o) => o.plan === plan)!.price,");
    expect(card).toContain(
      "if (isPriceChanged(message) && size) { setAgreed(false); price.mutate(size); }",
    );
  });
  it("a drive worked from the straight line marks the price as an estimate, and the form says so", async () => {
    drive.mockResolvedValue({ ...ROUTED, source: "estimated" });
    const seen: Record<string, unknown>[] = [];
    const env = signed((a) => {
      seen.push(a);
      return PLAN;
    });
    await call(signUpRoofCare, env, form);
    expect(seen[0]!["p_estimated"]).toBe(true);
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    // (Nov 19: the form says the price is an estimate, and nothing of the drive.)
    expect(card).toContain('{offer?.estimate === "just-now" && (');
    expect(card).toContain("{PRICE_ESTIMATE_JUST_NOW}");
  });

  it("the database is given the server's own drive, and the price is its to work out", async () => {
    const seen: Record<string, unknown>[] = [];
    const env = signed((a) => {
      seen.push(a);
      return PLAN;
    });
    const made = await call<RoofCarePlan>(signUpRoofCare, env, {
      ...form,
      hours: 0,
      miles: 0,
      price: 1,
    });
    expect(seen).toEqual([
      {
        p_site: SITE,
        p_plan: "guard",
        p_sqft: 20000,
        p_hours: 3.5,
        p_miles: 180,
        p_estimated: false,
        p_first: "now",
        p_days: 0,
        p_agreed_by: "Pat Smith",
        p_notes: "",
        p_terms: ROOF_CARE_TERMS_VERSION,
        p_pay_method: "check",
        p_pay_note: "",
        // Nov 20 (break test 25): the price the customer was shown goes along, and the
        // database saves the plan at that price or not at all.
        p_shown_price: 321,
      },
    ]);
    expect(made.plan).toBe("guard");
    expect(made.visits.map((v) => [v.kind, v.ticket?.number ?? null])).toEqual([
      ["visit1", 7001],
      ["visit2", null],
    ]);
    // No table is written from here: the function is the only door.
    expect(env.writes).toEqual([]);
  });
  it("no ticket is announced at the sign-up: none is made until the plan is paid (Nov 19)", async () => {
    // Before the plan was paid for first, the sign-up made the first inspection's ticket and
    // announced it. Now the tickets are made, and announced, when the plan's invoice is marked
    // paid (roof-care-pay-first-nov19.test.ts).
    const env = signed(() => PLAN);
    await call(signUpRoofCare, env, form);
    expect(announced).not.toHaveBeenCalled();
  });
  it("a drive to the town marks the price as an estimate", async () => {
    drive.mockResolvedValue({ ...ROUTED, placed_by: "zip", place: "London, KY 40741" });
    const seen: Record<string, unknown>[] = [];
    const env = signed((a) => {
      seen.push(a);
      return PLAN;
    });
    await call(signUpRoofCare, env, { ...form, first: "days", days: 10 });
    expect(seen[0]!["p_estimated"]).toBe(true);
    expect(seen[0]!["p_first"]).toBe("days");
    expect(seen[0]!["p_days"]).toBe(10);
  });
  it("an address that cannot be placed is not signed up at a guessed price", async () => {
    drive.mockResolvedValue(null);
    const env = signed(() => PLAN);
    await expect(call(signUpRoofCare, env, form)).rejects.toThrow(NOT_PLACED_LINE);
    expect(env.rpcCalls).toEqual([]);
  });
  it("the database's refusal is said in its words", async () => {
    const env = signed(() => {
      throw new Error("This property already has a Roof Care plan");
    });
    await expect(call(signUpRoofCare, env, form)).rejects.toThrow(
      "This property already has a Roof Care plan",
    );
    expect(announced).not.toHaveBeenCalled();
  });
  it("the name of who agreed is needed", async () => {
    const env = signed(() => PLAN);
    await expect(
      (async () => call(signUpRoofCare, env, { ...form, agreed_by: "  " }))(),
    ).rejects.toThrow("Type the name of the person who agreed to the plan");
    expect(env.rpcCalls).toEqual([]);
  });

  it("the property's plans read back with each inspection's ticket", async () => {
    const env = signed(() => PLAN);
    const plans = await call<RoofCarePlan[]>(listRoofCarePlans, env, { site_ids: [SITE] });
    expect(plans).toHaveLength(1);
    expect(plans[0]!.visits[0]).toMatchObject({
      kind: "visit1",
      amount: 1000,
      ticket: { id: JOB, number: 7001, stage: "scheduled" },
    });
    expect(visitsDoneWords(plans[0]!, "2026-11-18")).toBe("0 of 2 inspections done");
  });
});

describe("push back and the storm inspection", () => {
  it("the ticket's day moves with the push, by the ticket's own path", async () => {
    const env = world(
      {},
      {
        roof_care_push_back: () => ({
          job_id: JOB,
          date_from: "2026-11-18",
          date_to: "2026-11-28",
          due_by: "2026-11-28",
          days_past_first: 10,
        }),
      },
    );
    const r = await call<PushBackResult>(pushBackRoofCareVisit, env, { visit_id: V1, days: 10 });
    expect(env.rpcCalls[0]).toEqual({
      fn: "roof_care_push_back",
      args: { p_visit: V1, p_days: 10, p_reason: "" },
    });
    expect(moved.mock.calls[0]!.slice(1)).toEqual([
      JOB,
      "2026-11-28",
      { id: ADMIN, name: "Ann Admin" },
    ]);
    expect(r).toEqual({ due_by: "2026-11-28", days_past_first: 10, ticket_moved_to: "2026-11-28" });
  });
  it("an inspection with no dated ticket moves nothing else", async () => {
    const env = world(
      {},
      {
        roof_care_push_back: () => ({
          job_id: null,
          date_to: null,
          due_by: "2027-06-04",
          days_past_first: 20,
        }),
      },
    );
    const r = await call<PushBackResult>(pushBackRoofCareVisit, env, {
      visit_id: V2,
      days: 20,
      reason: "wet spring",
    });
    expect(moved).not.toHaveBeenCalled();
    expect(r.ticket_moved_to).toBeNull();
  });
  it("a ticket day that could not be moved is said out loud", async () => {
    moved.mockRejectedValueOnce(new Error("no access"));
    const env = world(
      {},
      {
        roof_care_push_back: () => ({
          job_id: JOB,
          date_to: "2026-11-28",
          due_by: "2026-11-28",
          days_past_first: 10,
        }),
      },
    );
    await expect(call(pushBackRoofCareVisit, env, { visit_id: V1, days: 10 })).rejects.toThrow(
      "The inspection was pushed back, but its ticket's day was not moved: no access",
    );
  });
  it("a storm inspection's ticket is announced too", async () => {
    const env = world({}, { roof_care_add_storm: () => JOB });
    expect(await call(addRoofCareStorm, env, { plan_id: PLAN })).toEqual({ job_id: JOB });
    expect(announced.mock.calls[0]![1]).toEqual([JOB]);
  });
});

// ── The invoice ─────────────────────────────────────────────────────────────────────────────

describe("the invoice of a care plan inspection", () => {
  const ref = { id: V1, kind: "visit1", amount: 1000, plan: "guard" };
  it("opens with the plan's line at the visit's half", () => {
    expect(carePlanOwnLine(ref)).toMatchObject({
      sort: 0,
      kind: "other",
      description: "Roof Guard plan: inspection 1 of 2 (half of the yearly price)",
      qty: 1,
      rate: 1000,
      total: 1000,
      cost_total: 0,
      source: `roof-care:${V1}`,
      taxable: false,
      show_on_invoice: true,
    });
    expect(carePlanLineWords("care", "visit2")).toBe(
      "Roof Care plan: inspection 2 of 2 (half of the yearly price)",
    );
    expect(carePlanLineSource("x")).toBe("roof-care:x");
  });
  it("a storm inspection bills nothing and says it is included", () => {
    const l = carePlanOwnLine({ id: "s", kind: "storm", amount: 0, plan: "guard" });
    expect(l.total).toBe(0);
    expect(l.description).toBe("Roof Guard plan: storm inspection (included in the plan)");
  });
  it("the visit's own time is at no charge, with its cost kept", () => {
    const labor = {
      sort: 0,
      kind: "labor",
      qty: 3,
      rate: 85,
      total: 255,
      cost_rate: 40,
      cost_total: 120,
      taxable: false,
      source: "time:1",
    };
    // (Nov 19: every line now names the three switches, so the rows can be saved together;
    // roof-care-audit-fixes-nov19.test.ts.)
    expect(carePlanCovered(labor, 1)).toEqual({
      ...labor,
      sort: 1,
      rate: 0,
      total: 0,
      rate_overridden: true,
      show_on_invoice: false,
      hide_price: false,
    });
    const lines = carePlanInvoiceLines([labor], ref);
    expect(lines.map((l) => l.total)).toEqual([1000, 0]);
    expect(lines.reduce((n, l) => n + (l.cost_total ?? 0), 0)).toBe(120);
  });

  type Client = Parameters<typeof buildLinesFromJob>[0];
  const JOBX = "66666666-6666-4666-8666-666666666666";
  const build = (job: Record<string, unknown>, visits: Record<string, unknown>[] = []) =>
    fakeSupabase(
      {
        service_jobs: [{ id: JOBX, labor_rate_kind: "standard", ...job }],
        service_rates: [
          { rate_kind: "standard", role: "lead", time_kind: "labor", bill_rate: 85, cost_rate: 40 },
        ],
        service_time_entries: [],
        service_job_techs: [],
        inventory_movements: [],
        profiles: [],
        service_job_purchase_orders: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            service_job_id: JOBX,
            po_number: "1",
            title: "Sealant",
            price: 100,
            po_date: "2026-11-10",
            created_at: "2026-11-10T15:00:00Z",
            vendor_id: null,
            vendor_text: "Supply",
          },
        ],
        roof_care_visits: visits,
        roof_care_plans: [{ id: PLAN, plan: "care" }],
      },
      // (Nov 20: the builder also reads what an hour of each person costs.)
      { rpcs: { technician_bill_rates: () => [], technician_cost_rates: () => [] } },
    );
  it("the builder gives a plan's ticket the plan line and prices nothing else", async () => {
    const env = build({ roof_care_visit_id: V1 }, [
      { id: V1, kind: "visit1", amount: 450, plan_id: PLAN },
    ]);
    const lines = await buildLinesFromJob(env.db as unknown as Client, JOBX, { poMarkup: true });
    expect(lines.map((l) => [l.kind, l.total])).toEqual([
      ["other", 450],
      ["material", 0],
    ]);
    expect(lines[0]!.description).toBe(
      "Roof Care plan: inspection 1 of 2 (half of the yearly price)",
    );
    // The purchase order's cost is still the visit's cost.
    expect(Number(lines[1]!.cost_total)).toBe(100);
  });
  it("any other ticket is built as it always was", async () => {
    const env = build({ roof_care_visit_id: null });
    const lines = await buildLinesFromJob(env.db as unknown as Client, JOBX, { poMarkup: false });
    expect(lines.map((l) => [l.kind, Number(l.total)])).toEqual([["material", 100]]);
  });

  it("is started by anyone who makes invoices, and made when the ticket is authorized", () => {
    const inv = flat(read("src/lib/invoices.functions.ts"));
    expect(inv).toContain(
      "if (isInspectionType(job.service_type) && !job.roof_care_visit_id && !actor.manages) {",
    );
    expect(inv).toContain(
      // (Nov 19: the rule has a name, billsItself; roof-care-audit-fixes-nov19.test.ts.)
      "if (!billsItself(visit)) return false;",
    );
    expect(inv).toContain("if ((await liveInvoices(sb, jobId)).length) return false;");
    const svc = flat(read("src/lib/service.functions.ts"));
    expect(svc).toContain(
      'if (row.roof_care_visit_id && data.stage === "authorized" && prev.stage !== "authorized") {',
    );
    expect(svc).toContain("await ensureCarePlanInvoice(context.supabase, row.id, {");
    const card = flat(read("src/components/service/invoice-block.tsx"));
    expect(card).toContain("const carePlan = !!job.roof_care_visit_id;");
    expect(card).toContain("{(carePlan || managesTickets(profile)) && (");
  });
});

// ── The database change ─────────────────────────────────────────────────────────────────────

describe("the database change", () => {
  const sql = flat(read("supabase/migrations/20261118240000_roof_care_plans.sql"));
  it("nobody writes the two tables by hand", () => {
    expect(sql).toContain("revoke all on public.roof_care_plans from anon, authenticated;");
    expect(sql).toContain("grant select on public.roof_care_plans to authenticated;");
    expect(sql).toContain("revoke all on public.roof_care_visits from anon, authenticated;");
    expect(sql).not.toMatch(
      /create policy roof_care_\w+ on public\.roof_care_\w+ for (insert|update|delete|all)/,
    );
  });
  it("a property has one plan in force", () => {
    expect(sql).toContain(
      "create unique index if not exists roof_care_plans_one_active on public.roof_care_plans (site_id) where status = 'active';",
    );
  });
  it("the price function hands back prices and reads the admin's numbers itself", () => {
    const fn = sql.slice(
      sql.indexOf("function public.roof_care_price("),
      sql.indexOf("function public.roof_care_windows("),
    );
    expect(fn).toContain("security definer");
    expect(fn).toContain("select data into d from public.roof_care_settings where id = 1;");
    expect(fn).toContain("v_price := round(v_list + v_travel);");
    expect(fn).toContain("v_first := ceil(v_price / 2);");
    // Never below the list price: only what is over the baseline counts.
    expect(fn).toContain("greatest(0, coalesce(p_hours, v_bh) - v_bh) * v_crew * v_size");
    expect(fn).not.toMatch(/'cost'|'profit'/);
    expect(sql).toContain(
      "revoke all on function public.roof_care_price(numeric, numeric, numeric) from public, anon;",
    );
  });
  it("the sign-up works the price out again and makes the two inspections", () => {
    expect(sql).toContain("v_price := public.roof_care_price(p_sqft, p_hours, p_miles);");
    expect(sql).toContain("raise exception 'This property already has a Roof Care plan';");
    expect(sql).toContain("where w.w_from > v_today");
    expect(sql).toContain("from public.roof_care_windows(v_from + 120) w");
    expect(sql).toContain("perform public.roof_care_make_tickets(v_plan);");
  });
  it("a ticket is made two weeks ahead, once, and says it is a care plan inspection", () => {
    expect(sql).toContain("and v.due_from - 14 <= v_today");
    expect(sql).toContain(
      "and not exists ( select 1 from public.service_jobs j where j.roof_care_visit_id = v.id and j.deleted_at is null)",
    );
    expect(sql).toContain("'Care plan inspection (' || v_name || '), visit 1 of 2'");
    expect(sql).toContain("'Care plan storm inspection (' || v_name || ')'");
    expect(sql).toContain(
      "perform cron.schedule('roof-care-tickets', '40 11 * * *', 'select public.roof_care_make_tickets()');",
    );
  });
  it("more than 30 days back needs a manager and a reason, and the next inspection follows", () => {
    expect(sql).toContain("v_total := v_new_by - v.first_due_by;");
    expect(sql).toContain("if v_total > 30 then");
    expect(sql).toContain("More than 30 days needs a manager.");
    expect(sql).toContain(
      "set due_from = x.due_from + p_days, due_by = x.due_by + p_days, first_due_by = x.first_due_by + p_days",
    );
    expect(sql).toContain("set renews_on = greatest(renews_on, v_last), updated_at = now()");
  });
  it("a care plan ticket is not scheduled past its last day, nor linked by hand", () => {
    expect(sql).toContain("if v_by is not null and new.scheduled_date > v_by then");
    expect(sql).toContain("A care plan inspection is linked to its plan by the site");
    expect(sql).toContain("perform set_config('jbk.care_link', 'off', true);");
  });
  it("the office starts a care plan inspection's invoice; any other inspection is a manager's", () => {
    expect(sql).toContain("if v_type = 'inspection' and v_care is null and not exists (");
  });
});

describe("another service asked for on site", () => {
  it("goes to the database's function with the typed words, and nothing else is written", async () => {
    const env = world(
      {},
      { request_additional_service: () => "99999999-9999-4999-8999-999999999999" },
    );
    const r = await call<{ id: string }>(requestAdditionalService, env, {
      site_id: SITE,
      services: "  Gutter cleaning ",
      details: "",
    });
    expect(r).toEqual({ id: "99999999-9999-4999-8999-999999999999" });
    expect(env.rpcCalls).toEqual([
      {
        fn: "request_additional_service",
        args: { p_site: SITE, p_services: "Gutter cleaning", p_details: "" },
      },
    ]);
    expect(env.writes).toEqual([]);
  });
  it("blank words are refused before the database is asked", async () => {
    const env = world({}, { request_additional_service: () => "x" });
    await expect(
      (async () => call(requestAdditionalService, env, { site_id: SITE, services: "   " }))(),
    ).rejects.toThrow("Type what the customer is asking for");
    expect(env.rpcCalls).toEqual([]);
  });
  it("the database makes the opportunity with the name of who took it down", () => {
    const sql = flat(read("supabase/migrations/20261118250000_additional_service_request.sql"));
    expect(sql).toContain(
      "alter table public.crm_opportunities add column if not exists referred_by text;",
    );
    expect(sql).toContain("'open', 'On-site request', nullif(v_name, ''),");
    expect(sql).toContain("and (not public.is_technician() or public.tech_sees_site(p_site))))");
    // (Later on Nov 18: the name is in a box the office can type in, "Referred by";
    // opportunity-referred-by-nov18.test.ts.)
    expect(read("src/components/opportunities-page.tsx")).toContain("data-opp-referred-by");
    expect(read("src/components/roof-care/plan-card.tsx")).toContain(
      'data-action="additional-services"',
    );
  });
});

describe("the Owner page's Needs attention list", () => {
  const base = {
    today: "2027-06-01",
    now: "2027-06-01T15:00:00Z",
    limits: attentionLimits(null),
    tickets: [],
    untouched: [],
    opps: [],
    bids: [],
    invoices: [],
    followups: [],
    repairFrom: [],
    bidFrom: [],
    names: {},
  };
  const care = (over: Record<string, unknown> = {}) => ({
    visit_id: "v1",
    site_id: SITE,
    title: "Roof Guard · Plant 2 (Acme)",
    label: "Inspection 1",
    due_by: "2027-05-15",
    amount: 1000,
    pastPlanYear: false,
    ...over,
  });
  it("lists an inspection past its last day, with what it bills and how late it is", () => {
    const { rows } = attentionList({ ...base, careVisits: [care()] });
    expect(rows).toEqual([
      {
        key: "care_plan_late:v1",
        group: "office",
        kind: "care_plan_late",
        tag: "Roof Care",
        title: "Roof Guard · Plant 2 (Acme)",
        why: "Inspection 1 was due by Sat, May 15 and is not done.",
        who: "Office",
        whoKey: "office",
        age: 17,
        ageText: "17 days late",
        tone: "red",
        amount: 1000,
        href: `/properties/${SITE}`,
      },
    ]);
  });
  it("an inspection still inside its days is not listed", () => {
    expect(attentionList({ ...base, careVisits: [care({ due_by: "2027-06-01" })] }).rows).toEqual(
      [],
    );
    expect(attentionList({ ...base, careVisits: [care({ due_by: "2027-06-02" })] }).rows).toEqual(
      [],
    );
  });
  it("a plan pushed past its year is listed as running late before the day comes", () => {
    const [row] = attentionList({
      ...base,
      careVisits: [
        care({ label: "Inspection 2", due_by: "2027-12-20", pastPlanYear: true, amount: 0 }),
      ],
    }).rows;
    expect(row).toMatchObject({
      ageText: "Running late",
      tone: "amber",
      amount: null,
      why: "Inspection 2 was pushed past the plan year, so the renewal moved. It is due by Mon, Dec 20.",
    });
  });
  it("without any plan the list is as it was", () => {
    expect(attentionList(base).rows).toEqual([]);
  });
});

describe("where it shows", () => {
  const card = read("src/components/roof-care/plan-card.tsx");
  it("the plan itself: under each property on the customer, and on the property", () => {
    expect(read("src/components/customers-page.tsx")).toContain(
      '<RoofCareCard siteId={s.id} className="mt-2" />',
    );
    expect(read("src/components/property-page.tsx")).toContain(
      "{!deleted && <RoofCareCard siteId={s.id} />}",
    );
    // A property that never had a plan shows nothing there.
    expect(card).toContain("if (!plan) return null;");
    expect(card).toContain("data-roof-care-badge={plan.plan}");
  });
  it("the sign-up's roof size and days boxes start blank", () => {
    // Nov 21: blank still, unless the sign-up was opened from a customer's own public request,
    // which carries the size they gave.
    expect(card).toContain(
      'prefill?.sqft != null && prefill.sqft > 0 ? String(Math.round(prefill.sqft)) : "",',
    );
    expect(card).toContain('const [days, setDays] = useState("");');
  });
});

// ── Later on Nov 18: the two buttons, the terms, and technicians in the workflow ──────────────

describe("Care Plan and Additional Services (owner, Nov 18)", () => {
  // "lets have the two buttons 'Care Plan' and 'Additional Services' as two buttons under the
  // open ticket and status dropdown instead of its current location in a ticket. same for this
  // view have the two buttons under the new ticket button", and "on the ticket workflow lets
  // have two buttons that stay pinned to the bottom of the screen".
  const card = read("src/components/roof-care/plan-card.tsx");
  it("are named as the owner named them", () => {
    expect(CARE_PLAN_LABEL).toBe("Care Plan");
    expect(ADDITIONAL_SERVICES_LABEL).toBe("Additional Services");
    expect(card).toContain("{CARE_PLAN_LABEL}");
    expect(card).toContain("{ADDITIONAL_SERVICES_LABEL}");
    expect(card).not.toContain("Sign up for a Roof Care plan\n        </Button>");
    expect(card).not.toContain("Customer wants another service");
  });
  it("Care Plan opens the plan when the property has one, and the sign-up when it has none", () => {
    const f = flat(card);
    expect(f).toContain(
      // (Nov 19: a plan signed and waiting for its payment opens the plan too, never a second
      // sign-up.)
      // (Nov 19, night: a plan whose year is over opens too, for its renewal.)
      '{open === "plan" && (active || waiting || lapsed ? ( <PlanDialog siteId={siteId} visitId={visitId ?? null} onClose={() => setOpen(null)} /> ) : ( <SignUpDialog siteId={siteId} today={today} prefill={careRequest ? (prefill.data ?? null) : null} onClose={() => setOpen(null)} /> ))}',
    );
    // The button says which plan and how many inspections are done.
    expect(f).toContain("{planName(active.plan)} · {done.visits}/2");
    // It waits for the plans to be read, so it never opens the sign-up over a plan.
    expect(f).toContain("disabled={!q.data && !q.error}");
  });
  it("are pinned at the bottom of the workflow", () => {
    const closeout = flat(read("src/components/service/closeout.tsx"));
    // (Later on Nov 18: the bar's class has a name, PINNED_BAR, which keeps "sticky bottom-0".)
    expect(closeout).toMatch(/export const PINNED_BAR = "sticky bottom-0 z-10 /);
    const bar = closeout.slice(closeout.indexOf("<div className={PINNED_BAR} data-pinned-bar>"));
    expect(bar.indexOf("<RoofCareButtons")).toBeGreaterThan(0);
    expect(bar.indexOf("<RoofCareButtons")).toBeLessThan(bar.indexOf("<AlertDialog"));
    expect(bar).toContain(
      // (Nov 19, night: each ticket hands the button the ticket, so the press is kept.
      // care-plan-offers-nov19.test.ts.)
      '<RoofCareButtons siteId={job.site_id} visitId={job.roof_care_visit_id} jobId={job.id} big className="mt-2" />',
    );
  });
  it("are there from the workflow's first screen, before Who is here is answered", () => {
    // Owner, Nov 18, with a picture of a ticket still on step 1: "im not seeing the two buttons
    // here about care plan and additonal services?" The bar they sat in belongs to the part of
    // the ticket that opens only after that answer, so a fresh repair ticket showed neither.
    const closeout = flat(read("src/components/service/closeout.tsx"));
    const gate = closeout.indexOf("{waiting && !inspection ? null : !ready ? (");
    const early = closeout.indexOf(
      "{((waiting && !inspection) || !ready) && <PlanBar job={job} />}",
    );
    expect(early).toBeGreaterThan(-1);
    // Outside the gated part, right before it.
    expect(early).toBeLessThan(gate);
    expect(gate - early).toBeLessThan(120);
    const bar = closeout.slice(closeout.indexOf("function PlanBar({ job }"));
    expect(bar).toContain("<div className={PINNED_BAR} data-plan-bar data-pinned-bar>");
    expect(bar).toContain(
      "<RoofCareButtons siteId={job.site_id} visitId={job.roof_care_visit_id} jobId={job.id} big />",
    );
  });
  it("stay on a ticket that is not this person's to close out", () => {
    const closeout = flat(read("src/components/service/closeout.tsx"));
    const screen = closeout.slice(
      closeout.indexOf("export function CloseoutScreen("),
      closeout.indexOf("function PlanBar({ job }"),
    );
    const locked = screen.slice(screen.indexOf("<CloseoutForm key={job.id} job={job} />"));
    expect(locked).toContain("only they or the office can close it out.");
    expect(locked).toContain("<PlanBar job={job} />");
  });
  it("are under Open ticket and the stage on a ticket, and no longer inside it", () => {
    const page = read("src/components/service-page.tsx");
    const f = flat(page);
    expect(f).toContain(
      '<RoofCareButtons siteId={job.site_id} visitId={job.roof_care_visit_id} jobId={job.id} className="justify-end" />',
    );
    expect(page.indexOf("<RoofCareButtons")).toBeGreaterThan(page.indexOf("Open ticket"));
    expect(page.indexOf("<RoofCareButtons")).toBeGreaterThan(
      page.indexOf('<SelectTrigger className="w-[150px]" aria-label="Stage">'),
    );
    expect(page).not.toContain("<RoofCareCard");
  });
  it("are under New ticket on the customer's properties and on the property's page", () => {
    const cust = read("src/components/customers-page.tsx");
    const prop = read("src/components/property-page.tsx");
    for (const src of [cust, prop]) {
      // Nov 21: the property page's tag is now on several lines (it also hands on a public
      // Roof Care request), so the tag alone is looked for.
      const at = src.indexOf("<RoofCareButtons");
      expect(at).toBeGreaterThan(src.indexOf('title="New service ticket at this property"'));
    }
    expect(cust).toContain(
      '{!readOnly && <RoofCareButtons siteId={s.id} className="justify-end" />}',
    );
    expect(prop.replace(/\s+/g, " ")).toContain(
      '{!deleted && ( <RoofCareButtons siteId={s.id} careRequest={careRequest} className="justify-end" /> )}',
    );
  });
});

describe("the terms (owner, Nov 18: “i like all 10 you came up with”)", () => {
  // Nov 19, later: eleven. Term 10 is new (the plan ends after its year, and what happens with
  // an inspection not done), and term 9 names the leak call travel and the storm inspection.
  it("are eleven, dated, and none of them names a price", () => {
    expect(ROOF_CARE_TERMS).toHaveLength(11);
    // (Nov 19: terms 2, 3 and 9 changed with paying for the year first, so the version did.)
    // (Nov 19, night: version 2026-11-19.3. Term 9 also says a year paid by card is refunded
    // less the card fee. roof-care-go-aheads-nov19.test.ts.)
    // (Nov 19, late: version 2026-11-19.4. Term 7 charges the return trip after the first visit
    // we could not do, and term 8 bills a further storm inspection.
    // roof-care-no-access-storm-nov19.test.ts.)
    // (Nov 20: version 2026-11-20.1. Term 7 adds that what is left of the minor repairs amount
    // goes toward a charged return trip first.)
    // (Nov 23: version 2026-11-23.1. Term 3 adds that what the plan includes applies to work
    // done in its twelve months, and that work done before the plan starts is not covered.)
    expect(ROOF_CARE_TERMS_VERSION).toBe("2026-11-23.1");
    expect(ROOF_CARE_TERMS.join(" ")).not.toMatch(/\$\s?\d/);
    expect(ROOF_CARE_TERMS[1]).toBe(
      "The yearly price is paid in full before the plan starts. We send one invoice for the year.",
    );
    expect(ROOF_CARE_TERMS[10]).toBe(
      "The plan is not a warranty and does not cover replacing the roof.",
    );
  });
  it("no plan is started without the tick", async () => {
    const env = world({}, { roof_care_sign_up: () => PLAN });
    const form = {
      site_id: SITE,
      plan: "guard",
      sqft: 20000,
      first: "now",
      days: null,
      agreed_by: "Pat Smith",
      notes: "",
    };
    for (const terms_agreed of [undefined, false])
      await expect(
        (async () => call(signUpRoofCare, env, { ...form, terms_agreed }))(),
      ).rejects.toThrow(TERMS_NOT_AGREED);
    expect(env.rpcCalls).toEqual([]);
  });
  it("the form shows all ten and holds the button until the tick", () => {
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain("{ROOF_CARE_TERMS.map((t) => ( <li key={t}>{t}</li> ))}");
    // Nov 21: unticked still, unless the customer ticked these same terms on the public page.
    expect(card).toContain(
      "const [agreed, setAgreed] = useState( !!prefill && prefill.terms_version === ROOF_CARE_TERMS_VERSION, );",
    );
    // (Nov 19, later: an email address that is typed has to be one, and the tick is in the
    // customer's own words, "I have read these terms and agree to them.")
    // (Nov 20: and nothing else is missing: the size check, and the line that says what is.)
    expect(card).toContain(
      "agreedBy.trim().length > 0 && agreed && !emailBad && plans.length > 0 && !stale && missing.length === 0;",
    );
    expect(card).toContain("<span>{AGREE_WORDS}</span>");
  });
  it("the plan keeps which terms were agreed, and the database refuses a sign-up without them", () => {
    const sql = flat(read("supabase/migrations/20261118260000_roof_care_terms.sql"));
    expect(sql).toContain(
      "alter table public.roof_care_plans add column if not exists terms_version text;",
    );
    expect(sql).toContain(
      "if coalesce(trim(p_terms), '') = '' then raise exception 'The customer has to agree to the plan''s terms'; end if;",
    );
    expect(sql).toContain("sold_by, sold_by_name, notes, terms_version)");
    // One form of the function, not two.
    expect(sql).toContain(
      "drop function if exists public.roof_care_sign_up(uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text);",
    );
    expect(sql).toContain("press Care Plan on the ticket and push it back.");
  });
});

describe("a technician works in the workflow (owner, Nov 18)", () => {
  // "techs should not be able to open this ticket screen, they currently can by clicking the
  // customer name in this case 5k."
  it("on My tickets the name is words for a technician and a link for the office", () => {
    const today = flat(read("src/components/service/today-page.tsx"));
    expect(today).toContain(
      '{isFieldOnly(profile) ? ( <p className="flex min-h-11 items-center text-lg font-semibold leading-snug" data-card-title="plain" > #{j.number} · {j.customer_name} </p> ) : ( <Link to="/service" search={{ id: j.id }}',
    );
    // Open ticket is still the workflow.
    expect(today).toContain(
      'void navigate({ to: "/service", search: { id: j.id, closeout: 1 } });',
    );
  });
  it("the running clock's line opens the workflow for a technician", () => {
    const today = flat(read("src/components/service/today-page.tsx"));
    expect(today).toContain(
      "isFieldOnly(profile) ? { id: clock.service_job_id, closeout: 1 } : { id: clock.service_job_id }",
    );
  });
  it("any link to a ticket opens the workflow for a technician, never the ticket page", () => {
    const page = flat(read("src/components/service-page.tsx"));
    expect(page).toContain(
      "if (closeout || isFieldOnly(profile)) return ( <> {stale} <CloseoutScreen key={job.data.id} job={job.data} /> </> );",
    );
    // Nothing is shown before the profile is known, so the ticket page never flashes first.
    expect(page.indexOf("if (!closeout && !profile)")).toBeLessThan(
      page.indexOf("if (closeout || isFieldOnly(profile))"),
    );
    // isFieldOnly(null) is false: with no profile the rule above it holds the page.
    expect(isFieldOnly(null)).toBe(false);
    expect(isFieldOnly({ role: "user", access: ["service"], technician: true })).toBe(true);
    expect(isFieldOnly({ role: "admin", access: [], technician: true })).toBe(false);
  });
  it("the workflow has no way back to the ticket page for a technician", () => {
    const closeout = flat(read("src/components/service/closeout.tsx"));
    expect(closeout).toContain(
      '{!isTech && ( <Button asChild variant="ghost" size="sm" className="h-10" data-link="ticket-details">',
    );
  });
});

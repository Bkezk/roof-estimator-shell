/**
 * Roof Care: renewal (owner, Nov 19: "go with the first 3 not built yet"; docs/roof-care-plans.md,
 * docs/qa/roof-care-renewal-2026-11-19.md).
 *
 * His rules for a year that closes with an inspection still owed:
 *
 *  1. Sixty days before the renewal, Needs attention lists the plan.
 *  2. Still owed because we did not get there: the renewal is charged with half taken off.
 *  3. The customer kept us off the roof: charged in full, and the inspection stays owed 60 days
 *     into the new year, then it is lost. The office makes the call with the push-back reasons
 *     shown; half off is the default unless a reason says the customer asked.
 *
 * Before this nothing started the next plan year, push back kept no "the customer asked", and
 * Needs attention said nothing of a plan near its renewal.
 *
 * THE NUMBERS HERE ARE MADE UP.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const announced = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const moved = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
vi.mock("@/lib/service.functions", () => ({
  announceCarePlanTickets: (...a: unknown[]) => announced(...a),
  moveCarePlanTicketDate: (...a: unknown[]) => moved(...a),
}));

import { ATTENTION_DEFAULTS, attentionList } from "@/lib/owner-attention";
import {
  asRenewalChoice,
  carePlanLineWords,
  CARRY_DAYS,
  lostWords,
  owedWords,
  readRenewalOffer,
  RENEWAL_CHOICE_NEEDED,
  RENEWAL_OPEN_DAYS,
  renewalChoiceWords,
  renewalCreditSource,
  renewalCreditWords,
  renewalDecisionWords,
  renewalDefaultWords,
  renewalOpen,
  renewalPriceWords,
  renewsWords,
  VISIT_KINDS,
  VISIT_LABEL,
  visitsDone,
  visitsDoneWords,
  visitState,
  type PlanVisit,
  type RenewalOffer,
} from "@/lib/roof-care-plan";
import {
  pushBackRoofCareVisit,
  renewRoofCarePlan,
  roofCareRenewalOffer,
  ticketIdsOfPlan,
} from "@/lib/roof-care-plan.functions";
import {
  makePlanInvoice,
  planInvoiceDescription,
  renewalCreditLine,
} from "@/lib/roof-care-plan-invoice.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TECH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SITE = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const OLD = "33333333-3333-4333-8333-333333333331";
const NEW = "33333333-3333-4333-8333-333333333332";
const V1 = "44444444-4444-4444-8444-444444444441";
const V2 = "44444444-4444-4444-8444-444444444442";
const V3 = "44444444-4444-4444-8444-444444444443";

const visit = (over: Partial<PlanVisit> = {}): PlanVisit => ({
  id: V1,
  kind: "visit1",
  due_from: "2027-03-15",
  due_by: "2027-05-15",
  first_due_by: "2027-05-15",
  amount: 0,
  push_reason: null,
  pushed_by_name: null,
  customer_asked: false,
  lost_on: null,
  ticket: null,
  billed: null,
  ...over,
});
const done = { id: "j", number: 1, stage: "done", scheduled_date: null, completed_at: null };
const ticket = (stage: string) => ({ ...done, stage, invoice_id: null });

const OFFER: RenewalOffer = {
  renews_on: "2028-01-10",
  opens_on: "2027-11-11",
  open: true,
  price: 1840,
  price_was: 1840,
  owed: [{ kind: "visit2", due_by: "2027-12-20", push_reason: null, customer_asked: false }],
  default_choice: "half_off",
  credit_if_half_off: 920,
  carried_until: "2028-03-10",
  pay_method: "check",
  has_renewal: false,
};

beforeEach(() => {
  announced.mockClear();
  moved.mockClear();
});

describe("when a plan can be renewed", () => {
  it("is in the last 60 days of its year, and after it", () => {
    expect(RENEWAL_OPEN_DAYS).toBe(60);
    const p = { renews_on: "2028-01-10" };
    expect(renewalOpen(p, "2027-11-10")).toBe(false);
    expect(renewalOpen(p, "2027-11-11")).toBe(true);
    expect(renewalOpen(p, "2028-01-10")).toBe(true);
    expect(renewalOpen(p, "2028-02-01")).toBe(true);
  });

  it("says how far the renewal is, and when it has gone by", () => {
    const p = { renews_on: "2028-01-10" };
    expect(renewsWords(p, "2027-11-28")).toBe("Renews Jan 10, 2028, in 43 days.");
    expect(renewsWords(p, "2028-01-09")).toBe("Renews Jan 10, 2028, tomorrow.");
    expect(renewsWords(p, "2028-01-10")).toBe("Renews today, Jan 10, 2028.");
    expect(renewsWords(p, "2028-01-11")).toBe("Was due to renew Jan 10, 2028, 1 day ago.");
    expect(renewsWords(p, "2028-01-15")).toBe("Was due to renew Jan 10, 2028, 5 days ago.");
  });
});

describe("the database's answer for the Renew box", () => {
  const raw = {
    plan: "care",
    renews_on: "2028-01-10",
    opens_on: "2027-11-11",
    open: true,
    price: 1840,
    price_was: 1700,
    owed: [
      {
        kind: "visit2",
        due_by: "2027-12-20",
        push_reason: "Nov 2: The customer asked (Ann)",
        customer_asked: true,
      },
    ],
    owed_count: 1,
    default_choice: "full",
    credit_if_half_off: 920,
    carried_until: "2028-03-10",
    pay_method: "card",
    has_renewal: false,
  };

  it("is read strictly", () => {
    expect(readRenewalOffer(raw)).toEqual({
      renews_on: "2028-01-10",
      opens_on: "2027-11-11",
      open: true,
      price: 1840,
      price_was: 1700,
      owed: [
        {
          kind: "visit2",
          due_by: "2027-12-20",
          push_reason: "Nov 2: The customer asked (Ann)",
          customer_asked: true,
        },
      ],
      default_choice: "full",
      credit_if_half_off: 920,
      carried_until: "2028-03-10",
      pay_method: "card",
      has_renewal: false,
    });
  });

  it("is nothing when a part of it is missing or odd", () => {
    expect(readRenewalOffer(null)).toBeNull();
    expect(readRenewalOffer({ ...raw, price: "a lot" })).toBeNull();
    expect(readRenewalOffer({ ...raw, renews_on: "soon" })).toBeNull();
    expect(readRenewalOffer({ ...raw, owed: "one" })).toBeNull();
    expect(readRenewalOffer({ ...raw, owed: [{ kind: "roof", due_by: "2027-12-20" }] })).toBeNull();
  });

  it("leans no way when nothing is owed", () => {
    expect(
      readRenewalOffer({ ...raw, owed: [], default_choice: "full" })!.default_choice,
    ).toBeNull();
    expect(asRenewalChoice("half_off")).toBe("half_off");
    expect(asRenewalChoice("free")).toBeNull();
  });
});

describe("the office's call on an inspection still owed", () => {
  it("says how many are owed", () => {
    expect(owedWords(0)).toBe("");
    expect(owedWords(1)).toBe("1 inspection is still owed");
    expect(owedWords(2)).toBe("Both inspections are still owed");
  });

  it("half off: says what comes off and what the customer pays", () => {
    expect(renewalChoiceWords("half_off", OFFER)).toBe(
      "We did not get there. Take $920.00 off the renewal: the customer pays $920.00. The inspection is dropped.",
    );
  });

  it("half off with neither inspection done is a year at no charge, a manager's", () => {
    const both = {
      ...OFFER,
      credit_if_half_off: 1840,
      owed: [OFFER.owed[0]!, { ...OFFER.owed[0]!, kind: "visit1" as const }],
    };
    expect(renewalChoiceWords("half_off", both)).toBe(
      "We did not get there. The renewal is at no charge, and a manager makes it. The inspections are dropped.",
    );
  });

  it("charged in full: says the last day the inspection stays owed", () => {
    expect(CARRY_DAYS).toBe(60);
    expect(renewalChoiceWords("full", OFFER)).toBe(
      "The customer kept us off the roof. Charge the renewal in full. The inspection stays owed until Mar 10, 2028, then it is lost.",
    );
  });

  it("says why it leans the way it does (owner: half off unless a reason says the customer asked)", () => {
    expect(renewalDefaultWords({ default_choice: "half_off" })).toBe(
      "No push-back says the customer asked, so half off is picked.",
    );
    expect(renewalDefaultWords({ default_choice: "full" })).toBe(
      "A push-back of it was marked as the customer asking, so charging in full is picked.",
    );
    expect(renewalDefaultWords({ default_choice: null })).toBe("");
  });

  it("says the price for the year, and when it has moved", () => {
    expect(renewalPriceWords({ price: 1840, price_was: 1840 })).toBe(
      "Price for the year: $1,840, the same as this year.",
    );
    expect(renewalPriceWords({ price: 1840, price_was: 1700 })).toBe(
      "Price for the year: $1,840. This year was $1,700: the prices have changed since.",
    );
  });

  it("says on the waiting renewal what was decided", () => {
    expect(renewalDecisionWords({ renewal_choice: "half_off", renewal_credit: 920 })).toBe(
      "$920.00 is taken off for the inspection not done. That inspection is dropped when the renewal is paid.",
    );
    expect(renewalDecisionWords({ renewal_choice: "full", renewal_credit: 0 })).toBe(
      "Charged in full. The inspection still owed comes into the new year for 60 days.",
    );
    expect(renewalDecisionWords({ renewal_choice: null, renewal_credit: 0 })).toBe("");
  });
});

describe("an inspection carried into the renewed year", () => {
  it("is its own kind, with its own words", () => {
    expect([...VISIT_KINDS]).toEqual(["visit1", "visit2", "storm", "carried"]);
    expect(VISIT_LABEL.carried).toBe("Inspection owed from last plan year");
    expect(carePlanLineWords("guard", "carried", true)).toBe(
      "Roof Guard plan: inspection owed from last plan year (included in the plan)",
    );
  });

  it("is not one of the new year's two", () => {
    const plan = {
      visits: [
        visit({ id: V3, kind: "carried", ticket: ticket("done") }),
        visit({ id: V1, kind: "visit1" }),
        visit({ id: V2, kind: "visit2" }),
      ],
    };
    expect(visitsDone(plan, "2028-02-01")).toEqual({ visits: 0, storm: 0 });
    expect(visitsDoneWords(plan, "2028-02-01")).toBe("0 of 2 inspections done");
  });

  it("is lost once its 60 days ran out, unless it was done", () => {
    const lost = visit({ kind: "carried", due_by: "2028-03-10", lost_on: "2028-03-11" });
    expect(visitState(lost, "2028-03-20")).toBe("lost");
    expect(visitState({ ...lost, ticket: ticket("authorized") }, "2028-03-20")).toBe("done");
    expect(visitState(visit({ kind: "carried", due_by: "2028-03-10" }), "2028-03-01")).toBe(
      "waiting",
    );
    expect(lostWords("2028-03-11")).toBe("Lost Mar 11, 2028: not done in its 60 days");
  });

  it("its ticket is not announced again when the renewal is paid", async () => {
    const env = fakeSupabase({
      roof_care_visits: [
        { id: V1, plan_id: NEW, kind: "visit1" },
        { id: V3, plan_id: NEW, kind: "carried" },
      ],
      service_jobs: [
        { id: "new-ticket", roof_care_visit_id: V1, deleted_at: null },
        { id: "old-ticket", roof_care_visit_id: V3, deleted_at: null },
      ],
    });
    expect(await ticketIdsOfPlan(env.db, NEW)).toEqual(["new-ticket"]);
  });
});

describe("the renewal's invoice", () => {
  it("carries a second line that takes the credit off", () => {
    expect(renewalCreditLine(NEW, 920, 1)).toMatchObject({
      sort: 2,
      description: "One inspection of last plan year was not done: half off this renewal",
      qty: 1,
      rate: -920,
      total: -920,
      cost_total: 0,
      source: `roof-care-renewal:${NEW}`,
      taxable: false,
      show_on_invoice: true,
    });
    expect(renewalCreditSource(NEW)).toBe(`roof-care-renewal:${NEW}`);
    expect(renewalCreditWords(2)).toBe("Both inspections of last plan year were not done");
  });

  it("has no such line when nothing is taken off", () => {
    expect(renewalCreditLine(NEW, 0, 1)).toBeNull();
    expect(renewalCreditLine(NEW, -5, 1)).toBeNull();
  });

  it("says when the new plan year starts", () => {
    expect(
      planInvoiceDescription({
        plan: "care",
        plan_number: 1002,
        roof_sqft: 22_400,
        renews_from: "2028-01-10",
      }),
    ).toBe(
      "Roof Care plan RC-1002, renewed for one year, on about 22,400 sq ft of roof. The new plan year starts Jan 10, 2028, or the day this invoice is paid when that is later.",
    );
  });

  const world = (renewal: Record<string, unknown>) =>
    fakeSupabase({
      roof_care_plans: [
        { id: OLD, plan: "care", status: "active", renews_on: "2028-01-10" },
        {
          id: NEW,
          plan: "care",
          status: "awaiting_payment",
          pay_first: true,
          plan_number: 1002,
          price: 1840,
          roof_sqft: 20_000,
          account_id: ACCOUNT,
          site_id: SITE,
          renewed_from: OLD,
          renewal_credit: 0,
          renewal_owed: 0,
          ...renewal,
        },
      ],
      crm_accounts: [
        {
          id: ACCOUNT,
          name: "Made Up Storage Co",
          address1: "1 Billing Rd",
          address2: null,
          city: "Sometown",
          state: "KY",
          zip: "40000",
          billing_instructions: null,
          external_id: "C-77",
        },
      ],
      crm_sites: [
        {
          id: SITE,
          name: "Unit 2",
          address1: "12 Example St",
          address2: null,
          city: "Sometown",
          state: "KY",
          zip: "40000",
        },
      ],
      service_settings: [{ id: 1, payment_terms: "Net 30" }],
      invoices: [],
      invoice_lines: [],
    });
  const WHO = { id: ADMIN, name: "Ann Admin" };

  it("half off: two lines, and the total is what is left to pay", async () => {
    const env = world({ renewal_credit: 920, renewal_owed: 1 });
    const r = await makePlanInvoice(env.db, NEW, WHO);
    expect(r.made).toBe(true);
    const inv = env.tables["invoices"]![0]!;
    expect(inv).toMatchObject({
      roof_care_plan_id: NEW,
      display_number: "RC-1002",
      status: "draft",
      subtotal: 920,
      total: 920,
    });
    expect(String(inv["description"])).toContain("renewed for one year");
    expect(String(inv["description"])).toContain("Jan 10, 2028");
    const lines = env.tables["invoice_lines"]!;
    expect(lines.map((l) => l["total"])).toEqual([1840, -920]);
    expect(lines[1]).toMatchObject({ source: `roof-care-renewal:${NEW}`, invoice_id: inv["id"] });
    // Rows written in one request name the same columns.
    expect(Object.keys(lines[0]!).sort()).toEqual(Object.keys(lines[1]!).sort());
  });

  it("charged in full: one line at the price", async () => {
    const env = world({ renewal_credit: 0, renewal_owed: 1 });
    await makePlanInvoice(env.db, NEW, WHO);
    expect(env.tables["invoices"]![0]).toMatchObject({ total: 1840 });
    expect(env.tables["invoice_lines"]).toHaveLength(1);
  });
});

describe("renewing, on the server", () => {
  const world = (
    profile: Record<string, unknown>,
    rpcs: Record<string, (a: Record<string, unknown>) => unknown>,
    plans: Record<string, unknown>[] = [],
  ) =>
    fakeSupabase(
      {
        profiles: [
          { id: ADMIN, role: "admin", access: [], full_name: "Ann Admin", email: "a@x" },
          { id: TECH, role: "user", access: ["service"], full_name: "Tom Tech", email: "t@x" },
          profile,
        ].filter((p) => p["id"]),
        roof_care_plans: plans,
        roof_care_visits: [],
        service_jobs: [],
        crm_accounts: [{ id: ACCOUNT, name: "Made Up Storage Co" }],
        crm_sites: [{ id: SITE, name: "Unit 2" }],
        service_settings: [{ id: 1, payment_terms: "Net 30" }],
        invoices: [],
        invoice_lines: [],
      },
      { rpcs },
    );
  const call = <T>(
    fn: unknown,
    env: ReturnType<typeof world>,
    data: unknown,
    userId = ADMIN,
  ): Promise<T> =>
    (fn as (a: { data: unknown; context: unknown }) => Promise<T>)({
      data,
      context: { supabase: env.db, userId },
    });
  const awaiting = {
    id: NEW,
    plan: "care",
    status: "awaiting_payment",
    pay_first: true,
    plan_number: 1002,
    price: 1840,
    roof_sqft: 20_000,
    account_id: ACCOUNT,
    site_id: SITE,
    renewed_from: OLD,
    renewal_credit: 920,
    renewal_owed: 1,
  };

  it("the Renew box asks the database, and refuses an answer it cannot read", async () => {
    const env = world({}, { roof_care_renewal_offer: () => ({ ...OFFER, owed_count: 1 }) });
    const o = await call<RenewalOffer>(roofCareRenewalOffer, env, { plan_id: OLD });
    expect(env.rpcCalls[0]).toEqual({ fn: "roof_care_renewal_offer", args: { p_plan: OLD } });
    expect(o.credit_if_half_off).toBe(920);
    const bad = world({}, { roof_care_renewal_offer: () => ({ price: 1 }) });
    await expect(call(roofCareRenewalOffer, bad, { plan_id: OLD })).rejects.toThrow(
      "The renewal could not be worked out",
    );
  });

  it("sends the choice, how they pay and the price shown, then makes the invoice", async () => {
    const env = world({}, { roof_care_renew: () => NEW }, [
      { id: OLD, plan: "care", status: "active", renews_on: "2028-01-10" },
      awaiting,
    ]);
    const r = await call<{ plan_id: string; invoice_id: string | null; started: boolean }>(
      renewRoofCarePlan,
      env,
      {
        plan_id: OLD,
        choice: "half_off",
        pay_method: "check",
        pay_note: " 2001 ",
        shown_price: 1840,
      },
    );
    expect(env.rpcCalls[0]).toEqual({
      fn: "roof_care_renew",
      args: {
        p_plan: OLD,
        p_choice: "half_off",
        p_pay_method: "check",
        p_pay_note: "2001",
        p_shown_price: 1840,
      },
    });
    expect(r.started).toBe(false);
    expect(r.invoice_id).toBe(env.tables["invoices"]![0]!["id"]);
    expect(env.tables["invoice_lines"]!.map((l) => l["total"])).toEqual([1840, -920]);
    expect(announced).not.toHaveBeenCalled();
  });

  it("leaves the choice out when nothing is owed, so the database's default stands", async () => {
    const env = world({}, { roof_care_renew: () => NEW }, [
      { ...awaiting, renewal_credit: 0, renewal_owed: 0 },
    ]);
    await call(renewRoofCarePlan, env, { plan_id: OLD, pay_method: "card", shown_price: 1840 });
    expect(env.rpcCalls[0]!.args).toEqual({
      p_plan: OLD,
      p_pay_method: "card",
      p_pay_note: "",
      p_shown_price: 1840,
    });
  });

  it("a renewal at no charge has started by itself: no invoice, and its tickets are announced", async () => {
    const env = world({}, { roof_care_renew: () => NEW }, [
      { ...awaiting, status: "active", renewal_credit: 1840, renewal_owed: 2 },
    ]);
    const r = await call<{ invoice_id: string | null; started: boolean }>(renewRoofCarePlan, env, {
      plan_id: OLD,
      choice: "half_off",
      pay_method: "check",
      shown_price: 1840,
    });
    expect(r).toMatchObject({ invoice_id: null, started: true });
    expect(env.tables["invoices"]).toHaveLength(0);
    expect(announced).toHaveBeenCalledTimes(1);
  });

  it("someone who does not make invoices leaves the renewal waiting for the office", async () => {
    const env = world({}, { roof_care_renew: () => NEW }, [awaiting]);
    const r = await call<{ invoice_id: string | null; started: boolean }>(
      renewRoofCarePlan,
      env,
      { plan_id: OLD, choice: "full", pay_method: "check", shown_price: 1840 },
      TECH,
    );
    expect(r).toMatchObject({ invoice_id: null, started: false });
    expect(env.tables["invoices"]).toHaveLength(0);
  });

  it("refuses a way of paying that is neither, and a choice that is neither", () => {
    const env = world({}, { roof_care_renew: () => NEW });
    expect(() =>
      call(renewRoofCarePlan, env, { plan_id: OLD, pay_method: "cash", shown_price: 1840 }),
    ).toThrow("Pick how they are paying");
    expect(() =>
      call(renewRoofCarePlan, env, {
        plan_id: OLD,
        choice: "free",
        pay_method: "check",
        shown_price: 1840,
      }),
    ).toThrow(RENEWAL_CHOICE_NEEDED);
    expect(env.rpcCalls).toHaveLength(0);
  });

  it("says the database's refusal as it is", async () => {
    const env = world(
      {},
      {
        roof_care_renew: () => {
          throw new Error("This plan already has a renewal");
        },
      },
    );
    await expect(
      call(renewRoofCarePlan, env, { plan_id: OLD, pay_method: "check", shown_price: 1840 }),
    ).rejects.toThrow("This plan already has a renewal");
  });

  it('push back sends "the customer asked" only when it is ticked', async () => {
    const answer = { job_id: null, date_to: null, due_by: "2027-12-23", days_past_first: 3 };
    const env = world({}, { roof_care_push_back: () => answer });
    await call(pushBackRoofCareVisit, env, { visit_id: V2, days: 3, customer: true });
    await call(pushBackRoofCareVisit, env, { visit_id: V2, days: 3 });
    expect(env.rpcCalls[0]!.args).toEqual({
      p_visit: V2,
      p_days: 3,
      p_reason: "",
      p_customer: true,
    });
    expect(env.rpcCalls[1]!.args).toEqual({ p_visit: V2, p_days: 3, p_reason: "" });
  });
});

describe("Needs attention", () => {
  const base = {
    today: "2027-11-28",
    now: "2027-11-28T15:00:00Z",
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
  };
  const TITLE = "Roof Care · Unit 2 (Made Up Storage Co)";
  const renewal = (over: Record<string, unknown> = {}) => ({
    plan_id: OLD,
    site_id: SITE,
    title: TITLE,
    renews_on: "2028-01-10",
    owed: 1,
    renewed: false,
    price: 1840,
    ...over,
  });

  it("lists a plan 60 days before its renewal, with the inspection still owed (owner's rule 1)", () => {
    const rows = attentionList({ ...base, careRenewals: [renewal()] }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: `care_plan_renewal:${OLD}`,
      group: "office",
      kind: "care_plan_renewal",
      tag: "Roof Care",
      title: TITLE,
      why: "Renews Mon, Jan 10, in 43 days. 1 inspection is still owed. Get it done. No renewal has been made. Open the property and press Renew for another year.",
      ageText: "43 days left",
      tone: "amber",
      amount: 1840,
      href: `/properties/${SITE}`,
    });
  });

  it("not before the 60 days", () => {
    const rows = attentionList({ ...base, today: "2027-11-10", careRenewals: [renewal()] }).rows;
    expect(rows).toHaveLength(0);
  });

  it("turns red in the last two weeks, and says when the date has gone by", () => {
    const soon = attentionList({ ...base, today: "2028-01-02", careRenewals: [renewal()] })
      .rows[0]!;
    expect(soon.tone).toBe("red");
    const past = attentionList({
      ...base,
      today: "2028-01-15",
      careRenewals: [renewal({ owed: 0 })],
    }).rows[0]!;
    expect(past.why).toBe(
      "Was due to renew Mon, Jan 10. No renewal has been made. Open the property and press Renew for another year.",
    );
    expect(past.ageText).toBe("5 days late");
  });

  it("a renewal that is made leaves only an inspection charged in full on the list", () => {
    const made = attentionList({
      ...base,
      careRenewals: [renewal({ renewed: true, owed: 0 })],
    }).rows;
    expect(made).toHaveLength(0);
    const owed = attentionList({
      ...base,
      careRenewals: [renewal({ renewed: true, owed: 1 })],
    }).rows[0]!;
    expect(owed.why).toBe(
      "Renews Mon, Jan 10, in 43 days. 1 inspection is still owed, and the renewal was charged in full. Get it done.",
    );
    expect(owed.amount).toBeNull();
  });

  it("lists an inspection carried into the new year, with the day it is lost", () => {
    const rows = attentionList({
      ...base,
      today: "2028-02-28",
      careCarried: [{ visit_id: V3, site_id: SITE, title: TITLE, due_by: "2028-03-10" }],
    }).rows;
    expect(rows[0]).toMatchObject({
      key: `care_plan_carried:${V3}`,
      kind: "care_plan_carried",
      why: "An inspection owed from last plan year is not done. It is lost after Fri, Mar 10.",
      ageText: "11 days left",
      tone: "red",
    });
  });

  it("says a waiting renewal is a renewal, not a sign-up", () => {
    const row = attentionList({
      ...base,
      careUnpaid: [
        {
          plan_id: NEW,
          site_id: SITE,
          title: TITLE,
          signed_on: "2027-11-20",
          price: 1840,
          invoice: null,
          pay: "",
          renewal: true,
        },
      ],
    }).rows[0]!;
    expect(row.why).toContain(
      "The renewal was made Sat, Nov 20 and is not paid, so the new plan year has not started.",
    );
  });
});

describe("the database change and the screens (pinned)", () => {
  const SQL = flat("supabase/migrations/20261119800000_roof_care_renewal.sql");

  it("a property has one plan in force and one waiting, and a year is renewed once", () => {
    expect(SQL).toContain("drop index if exists public.roof_care_plans_one_live;");
    expect(SQL).toContain(
      "create unique index if not exists roof_care_plans_one_in_force on public.roof_care_plans (site_id) where status = 'active';",
    );
    expect(SQL).toContain(
      "create unique index if not exists roof_care_plans_one_awaiting on public.roof_care_plans (site_id) where status = 'awaiting_payment';",
    );
    expect(SQL).toContain(
      "on public.roof_care_plans (renewed_from) where renewed_from is not null and status <> 'ended';",
    );
  });

  it("arguments a page may leave out have a default, so the function is found", () => {
    expect(SQL).toContain(
      "roof_care_push_back( p_visit uuid, p_days integer, p_reason text, p_customer boolean default false)",
    );
    expect(SQL).toContain(
      "drop function if exists public.roof_care_push_back(uuid, integer, text);",
    );
    expect(SQL).toContain(
      "roof_care_renew( p_plan uuid, p_choice text default null, p_pay_method text default null, p_pay_note text default null, p_shown_price numeric default null)",
    );
  });

  it("the rules are the database's", () => {
    expect(SQL).toContain("if v_today < p.renews_on - 60 then");
    expect(SQL).toContain(
      "raise exception 'Pick what happens with the inspection that is still owed';",
    );
    expect(SQL).toContain("v_credit := round(v_amount * least(v_n, 2) / 2.0, 2);");
    expect(SQL).toContain(
      "'default_choice', case when v_n = 0 then null when v_asked then 'full' else 'half_off' end",
    );
    expect(SQL).toContain("raise exception 'Only the office renews a Roof Care plan'");
    expect(SQL).toContain("A manager makes it.");
    // Paid ahead, the new year starts when the old one is over; paid late, on the payment.
    expect(SQL).toContain("v_start := greatest(v_paid, v_old.renews_on);");
    expect(SQL).toContain(
      "set plan_id = p_plan, kind = 'carried', carried_from = v_old.id, due_from = least(v.due_from, v_start + 60), due_by = v_start + 60",
    );
    expect(SQL).toContain("ended_reason = 'Renewed'");
    expect(SQL).toContain("This plan has a renewal waiting to be paid. End the renewal first.");
    expect(SQL).toContain("It cannot be pushed past %.");
    expect(SQL).toContain("where v.kind = 'carried' and v.lost_on is null and v.due_by < v_today");
    expect(SQL).toContain("customer_asked = customer_asked or coalesce(p_customer, false),");
  });

  it("the functions that people do not call are closed to them", () => {
    expect(SQL).toContain(
      "revoke all on function public.roof_care_start(uuid, date) from public, anon, authenticated;",
    );
    expect(SQL).toContain(
      "revoke all on function public.roof_care_lapse_carried() from public, anon, authenticated;",
    );
    expect(SQL).toContain(
      "revoke all on function public.roof_care_owed(uuid) from public, anon, authenticated;",
    );
  });

  it("the database types know the new columns and functions", () => {
    const t = flat("src/integrations/supabase/types.ts");
    expect(t).toContain("roof_care_renewal_offer: { Args: { p_plan: string }; Returns: Json }");
    expect(t).toContain("p_shown_price?: number");
    expect(t).toContain("p_customer?: boolean");
    expect(t).toContain("renewed_from: string | null");
    expect(t).toContain("lost_on: string | null");
  });

  it("the plan card offers the renewal, shows the waiting one, and asks who asked", () => {
    const card = flat("src/components/roof-care/plan-card.tsx");
    expect(card).toContain("!short && office && !renewal && renewalOpen(active, today)");
    expect(card).toContain('data-action="roof-care-renew"');
    expect(card).toContain("data-roof-care-renew-dialog");
    expect(card).toContain("data-renew-choice={c}");
    expect(card).toContain('data-action="roof-care-renew-confirm"');
    expect(card).toContain('data-roof-care-awaiting={renewalOf ? "renewal" : "new"}');
    expect(card).toContain('{renewalOf ? "Cancel the renewal" : "End plan"}');
    expect(card).toContain("data-push-customer");
    // A carried inspection has no Push back button.
    expect(card).toContain('{office && state !== "done" && visit.kind !== "carried" && (');
    // The choice starts on the rule's own answer, and a person's pick wins.
    expect(card).toContain(
      "const choice = o && o.owed.length ? (picked ?? o.default_choice) : null;",
    );
  });

  it("a renewed year says so, and one paid ahead has not started (found in the browser run)", () => {
    const card = flat("src/components/roof-care/plan-card.tsx");
    expect(card).toContain(
      "? `Renewed ${longDay(active.signed_on)}. First agreed by ${active.agreed_by}`",
    );
    expect(card).toContain(
      "active.starts_on > today ? ` Paid. The plan year starts ${longDay(active.starts_on)}.`",
    );
  });

  it("Needs attention shows what is left to pay on a renewal, not the full price", () => {
    expect(flat("src/lib/owner-attention.functions.ts")).toContain(
      "price: Math.max(0, p.price - p.renewal_credit),",
    );
  });
});

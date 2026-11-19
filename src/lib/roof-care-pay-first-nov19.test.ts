/**
 * Roof Care: the plan is paid for the year before it starts (owner, Nov 19;
 * docs/roof-care-plans.md, docs/qa/roof-care-pay-first-2026-11-19.md).
 *
 * The owner: "i think we are going to do payment up front rather than at time of service via
 * something like stripe so we dont have to fight apathy", then "they can pay up front by check".
 *
 * Before this a plan was in force the moment it was signed, and each inspection billed half the
 * yearly price. Now a signed plan waits for its payment; one invoice for the year belongs to the
 * plan; the day it is marked paid in full the plan starts and its inspections are dated. An
 * inspection of such a plan bills nothing.
 *
 * THE NUMBERS HERE ARE MADE UP. The flow was proven on the live database, in transactions that
 * were rolled back, and in a browser on temporary rows: see the record.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { ATTENTION_DEFAULTS, attentionList } from "@/lib/owner-attention";
import { billsItself, carePlanOwnLine } from "@/lib/roof-care-invoice";
import {
  asPlanStatus,
  AWAITING_PAYMENT_WORDS,
  carePlanLineWords,
  firstVisitWords,
  isPlanInvoiceNumber,
  PLAN_INVOICE_NOT_AWAITING,
  planBadge,
  planInvoiceLineWords,
  planNumberLabel,
  ROOF_CARE_TERMS,
  ROOF_CARE_TERMS_VERSION,
  runsLate,
} from "@/lib/roof-care-plan";
import {
  makePlanInvoice,
  planInvoiceDescription,
  planInvoiceLine,
} from "@/lib/roof-care-plan-invoice.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

const PLAN = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const WHO = { id: "44444444-4444-4444-8444-444444444444", name: "Olive Office" };

describe("a plan that is signed and not yet paid", () => {
  it("has its own status, and anything unknown reads as in force as before", () => {
    expect(asPlanStatus("awaiting_payment")).toBe("awaiting_payment");
    expect(asPlanStatus("ended")).toBe("ended");
    expect(asPlanStatus("active")).toBe("active");
    expect(asPlanStatus(null)).toBe("active");
  });

  it("says so on its badge", () => {
    expect(planBadge({ plan: "guard", status: "awaiting_payment" })).toBe(
      "Roof Guard (awaiting payment)",
    );
    expect(planBadge({ plan: "guard", status: "active" })).toBe("Roof Guard");
    expect(planBadge({ plan: "guard", status: "ended" })).toBe("Roof Guard (ended)");
    expect(AWAITING_PAYMENT_WORDS).toBe("Awaiting payment");
  });

  it("is numbered, and its invoice carries the same number", () => {
    expect(planNumberLabel(1001)).toBe("RC-1001");
    expect(isPlanInvoiceNumber("RC-1001")).toBe(true);
    expect(isPlanInvoiceNumber("T-1001.2")).toBe(false);
    expect(isPlanInvoiceNumber("6075")).toBe(false);
    expect(isPlanInvoiceNumber(null)).toBe(false);
  });

  it("says when the first inspection will be, counted from the payment", () => {
    expect(firstVisitWords("now", null)).toBe(
      "First inspection: as soon as the payment is received.",
    );
    expect(firstVisitWords("days", 10)).toBe(
      "First inspection: 10 days after the payment is received.",
    );
    expect(firstVisitWords("days", 1)).toBe(
      "First inspection: 1 day after the payment is received.",
    );
    expect(firstVisitWords("window", null)).toBe(
      "First inspection: in the next inspection window after the payment is received.",
    );
  });

  it("has a plan year that starts at the payment, not at the sign-up", () => {
    // Signed Nov 2, paid Nov 20: renewing Nov 20 a year on is on time, not running late.
    const paid = { signed_on: "2026-11-02", starts_on: "2026-11-20", renews_on: "2027-11-20" };
    expect(runsLate(paid)).toBe(false);
    expect(runsLate({ ...paid, renews_on: "2027-12-05" })).toBe(true);
    // An older plan, with no payment day: from the sign-up, as it was.
    expect(runsLate({ signed_on: "2026-11-02", renews_on: "2027-11-02" })).toBe(false);
    expect(runsLate({ signed_on: "2026-11-02", starts_on: null, renews_on: "2027-11-20" })).toBe(
      true,
    );
  });
});

describe("the terms the customer agrees to", () => {
  it("say the year is paid first, when it starts, and what is refunded", () => {
    expect(ROOF_CARE_TERMS_VERSION).toBe("2026-11-19");
    expect(ROOF_CARE_TERMS).toHaveLength(10);
    expect(ROOF_CARE_TERMS[1]).toBe(
      "The yearly price is paid in full before the plan starts. We send one invoice for the year.",
    );
    expect(ROOF_CARE_TERMS[2]).toBe(
      "The plan runs for twelve months from the day we receive your payment.",
    );
    // The owner: "a share for inspections not done, if we did one half is refunded", and "i like
    // the repairs coming off a refund rule, we may need to note that on the agreement".
    expect(ROOF_CARE_TERMS[8]).toBe(
      "Either of us can end the plan in writing. We refund the share for inspections not yet done, less any minor repairs the plan has already covered.",
    );
    expect(ROOF_CARE_TERMS.join(" ")).not.toMatch(/two halves|half of the yearly/);
    expect(ROOF_CARE_TERMS.join(" ")).not.toMatch(/\$\s?\d/);
  });
});

describe("the plan year's invoice", () => {
  it("is one line at the plan's price, not taxed, in its own words on the customer's copy", () => {
    const line = planInvoiceLine("guard", 3210);
    expect(line).toMatchObject({
      description: "Roof Guard plan, one year: two inspections with a photo report after each",
      qty: 1,
      rate: 3210,
      total: 3210,
      cost_total: 0,
      taxable: false,
      show_on_invoice: true,
      source: null,
    });
    expect(planInvoiceLineWords("watch")).toContain("Roof Watch plan, one year");
    expect(planInvoiceLine("care", -5).total).toBe(0);
  });

  it("says which plan, the roof it is for, and when the year starts", () => {
    expect(planInvoiceDescription({ plan: "care", plan_number: 1001, roof_sqft: 22_400 })).toBe(
      "Roof Care plan RC-1001, for one year, on about 22,400 sq ft of roof. The plan year starts the day this invoice is paid.",
    );
  });

  const world = (plan: Record<string, unknown>, invoices: Record<string, unknown>[] = []) =>
    fakeSupabase({
      roof_care_plans: [
        {
          id: PLAN,
          plan: "care",
          status: "awaiting_payment",
          pay_first: true,
          plan_number: 1001,
          price: 1840,
          roof_sqft: 20_000,
          account_id: ACCOUNT,
          site_id: SITE,
          ...plan,
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
      invoices,
      invoice_lines: [],
    });

  it("is made as a draft that belongs to the plan, numbered after it", async () => {
    const env = world({});
    const r = await makePlanInvoice(env.db, PLAN, WHO);
    expect(r.made).toBe(true);
    const inv = env.tables["invoices"]![0]!;
    expect(inv).toMatchObject({
      id: r.id,
      roof_care_plan_id: PLAN,
      service_job_id: null,
      bid_id: null,
      number: null,
      display_number: "RC-1001",
      status: "draft",
      subtotal: 1840,
      tax_amount: 0,
      total: 1840,
      payment_terms: "Net 30",
      created_by: WHO.id,
      updated_by_name: "Olive Office",
    });
    expect(inv["bill_to"]).toMatchObject({ name: "Made Up Storage Co", external_id: "C-77" });
    expect(inv["property"]).toEqual({
      name: "Unit 2",
      address: "12 Example St, Sometown, KY 40000",
    });
    expect(env.tables["invoice_lines"]).toHaveLength(1);
    expect(env.tables["invoice_lines"]![0]).toMatchObject({
      invoice_id: r.id,
      total: 1840,
      taxable: false,
    });
  });

  it("is made once: asked again, the one it has is the answer", async () => {
    const env = world({});
    const first = await makePlanInvoice(env.db, PLAN, WHO);
    const again = await makePlanInvoice(env.db, PLAN, WHO);
    expect(again).toEqual({ id: first.id, made: false });
    expect(env.tables["invoices"]).toHaveLength(1);
    expect(env.tables["invoice_lines"]).toHaveLength(1);
  });

  it("is made again after the first one was voided", async () => {
    const env = world({}, [{ id: "old", roof_care_plan_id: PLAN, status: "void" }]);
    const r = await makePlanInvoice(env.db, PLAN, WHO);
    expect(r.made).toBe(true);
    expect(env.tables["invoices"]).toHaveLength(2);
  });

  it("is not made for a plan in force, one that ended, or one signed the older way", async () => {
    for (const plan of [
      { status: "active" },
      { status: "ended" },
      { pay_first: false },
      { plan_number: null },
    ]) {
      const env = world(plan);
      await expect(makePlanInvoice(env.db, PLAN, WHO)).rejects.toThrow(PLAN_INVOICE_NOT_AWAITING);
      expect(env.tables["invoices"]).toHaveLength(0);
    }
  });

  it("only someone who makes invoices can ask for it", () => {
    const f = flat("src/lib/roof-care-plan-invoice.functions.ts");
    expect(f).toContain("const p = await office(context);");
  });
});

describe("an inspection of a plan paid first", () => {
  const visit = { id: "v1", kind: "visit1", amount: 0, plan: "guard", paid_first: true };

  it("bills nothing, and says it is included", () => {
    expect(carePlanLineWords("guard", "visit1", true)).toBe(
      "Roof Guard plan: inspection 1 of 2 (included in the plan)",
    );
    expect(carePlanLineWords("guard", "visit2", true)).toBe(
      "Roof Guard plan: inspection 2 of 2 (included in the plan)",
    );
    const line = carePlanOwnLine(visit);
    expect(line.total).toBe(0);
    expect(line.description).toBe("Roof Guard plan: inspection 1 of 2 (included in the plan)");
  });

  it("still makes its invoice by itself, so what the visit cost is counted", () => {
    expect(billsItself(visit)).toBe(true);
    // Never for a plan that has ended.
    expect(billsItself({ ...visit, ended: true })).toBe(false);
  });

  it("leaves a plan signed the older way as it was: half at each inspection", () => {
    expect(carePlanLineWords("guard", "visit1")).toBe(
      "Roof Guard plan: inspection 1 of 2 (half of the yearly price)",
    );
    expect(billsItself({ id: "v", kind: "visit1", amount: 500, plan: "guard" })).toBe(true);
    expect(billsItself({ id: "v", kind: "visit1", amount: 0, plan: "guard" })).toBe(false);
    expect(carePlanLineWords("guard", "storm", true)).toBe(
      "Roof Guard plan: storm inspection (included in the plan)",
    );
  });

  it("is told to the invoice builder from the plan itself", () => {
    const f = flat("src/lib/invoices.server.ts");
    expect(f).toContain('.select("plan, status, pay_first")');
    expect(f).toContain("paid_first: !!p?.pay_first,");
  });
});

describe("the sign-up", () => {
  const f = flat("src/lib/roof-care-plan.functions.ts");
  const card = flat("src/components/roof-care/plan-card.tsx");

  it("leaves the plan waiting for its payment", () => {
    expect(f).toContain('await sb.rpc("roof_care_sign_up_await_payment", {');
    expect(f).not.toContain('sb.rpc("roof_care_sign_up", {');
  });

  it("makes the invoice at once for someone who makes invoices, and never fails over it", () => {
    expect(f).toContain(
      'const money = seesInvoices(p); if (money) { try { const { makePlanInvoice } = await import("@/lib/roof-care-plan-invoice.functions"); await makePlanInvoice(sb, planId, { id: context.userId, name: nameOf(p) }); } catch {',
    );
  });

  it("announces no ticket: none exists until the plan is paid", () => {
    const fn = f.slice(
      f.indexOf("export const signUpRoofCare"),
      f.indexOf("export interface PushBackResult"),
    );
    expect(fn).not.toContain("announceCarePlanTickets");
  });

  it("says the year is paid first, and shows no halves", () => {
    expect(card).toContain(
      "The plan is paid for the year first, and starts the day the payment is received.",
    );
    expect(card).toContain("Paid in full before the plan starts");
    expect(card).not.toContain("at the first inspection, {money0(o.visit2)} at the second");
    expect(card).toContain("{DATES_FROM_PAYMENT}");
    expect(card).toContain("Sign the plan </Button>");
    expect(card).not.toContain("Start the plan </Button>");
  });

  it("offers the first inspection counted from the payment", () => {
    expect(card).toContain('now: "As soon as the payment is received",');
    expect(card).toContain('days: "This many days after the payment",');
    expect(card).toContain('window: "In the next window after the payment",');
    expect(card).not.toContain("Do the first inspection today");
  });
});

describe("the plan on the property's page while it waits", () => {
  const card = flat("src/components/roof-care/plan-card.tsx");

  it("is the plan shown, and Care Plan opens it, never a second sign-up", () => {
    expect(card).toContain(
      'plans.find((p) => p.status === "active") ?? plans.find((p) => p.status === "awaiting_payment") ?? plans[0] ?? null;',
    );
    expect(card).toContain('{open === "plan" && (active || waiting ? (');
    expect(card).toContain('data-care-plan-chip="awaiting"');
  });

  it("shows the invoice and what to do next to those who see invoices, and nobody else", () => {
    expect(card).toContain("const money = seesInvoices(profile);");
    expect(card).toContain("{money && (inv ? (");
    expect(card).toContain("is a draft. Finalise it and send it to the customer.");
    expect(card).toContain("is waiting to be paid. Mark it paid when the payment arrives.");
    expect(card).toContain('data-action="roof-care-make-invoice"');
    expect(card).toContain("{PLAN_NO_INVOICE}");
  });

  it("lets a manager end it, and says its unpaid invoice goes with it", () => {
    expect(card).toContain("{!short && manager && (");
    expect(card).toContain(
      "The plan was never paid, so it never started. Its unpaid invoice is removed with it.",
    );
  });

  it("is read with its invoice only for a reader who sees invoices", () => {
    const f = flat("src/lib/roof-care-plan.functions.ts");
    expect(f).toContain("invoice: money ? (money.own.get(p.id) ?? null) : null,");
    expect(f).toContain("status: asPlanStatus(p.status),");
  });
});

describe("Needs attention: signed and not paid", () => {
  const base = {
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
  };
  const plan = {
    plan_id: PLAN,
    site_id: SITE,
    title: "Roof Care · Unit 2 (Made Up Storage Co)",
    signed_on: "2026-11-20",
    price: 1840,
  };

  it("is listed from the first day, with what the office does next", () => {
    const none = attentionList({ ...base, careUnpaid: [{ ...plan, invoice: null }] }).rows;
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({
      key: `care_plan_unpaid:${PLAN}`,
      group: "office",
      kind: "care_plan_unpaid",
      tag: "Roof Care",
      title: "Roof Care · Unit 2 (Made Up Storage Co)",
      why: "Signed Fri, Nov 20 and not paid, so the plan has not started. No invoice has been made. Open the property and press Make the invoice.",
      age: 3,
      ageText: "3 days",
      tone: "amber",
      amount: 1840,
      href: `/properties/${SITE}`,
    });
    const inv = (status: string, paid_amount = 0) => ({
      id: "inv-1",
      number: "RC-1001",
      status,
      paid_amount,
    });
    const why = (i: ReturnType<typeof inv>) =>
      attentionList({ ...base, careUnpaid: [{ ...plan, invoice: i }] }).rows[0]!;
    expect(why(inv("draft")).why).toContain(
      "Invoice #RC-1001 is a draft. Finalise it and send it.",
    );
    expect(why(inv("draft")).href).toBe("/service/invoices?id=inv-1");
    expect(why(inv("final")).why).toContain(
      "Invoice #RC-1001 is waiting to be paid. Mark it paid when the payment arrives.",
    );
    expect(why(inv("final", 500)).why).toContain(
      "Invoice #RC-1001 is part paid. The plan starts when it is paid in full.",
    );
  });

  it("turns red after two weeks, and is gone when there is none", () => {
    const old = attentionList({
      ...base,
      careUnpaid: [{ ...plan, signed_on: "2026-11-01", invoice: null }],
    }).rows[0]!;
    expect(old.tone).toBe("red");
    expect(attentionList({ ...base, careUnpaid: [] }).rows).toEqual([]);
  });

  it("is read from the plans that are waiting, with the invoice each has", () => {
    const f = flat("src/lib/owner-attention.functions.ts");
    expect(f).toContain('.in("status", ["active", "awaiting_payment"]);');
    expect(f).toContain('.filter((p) => p.status === "awaiting_payment")');
    expect(f).toContain("careUnpaid: care.unpaid,");
  });
});

describe("the invoice code knows a plan year's invoice", () => {
  const f = flat("src/lib/invoices.functions.ts");

  it("opens it with the plan's number and the property to go back to", () => {
    expect(f).toContain(
      "if (inv.roof_care_plan_id) return invoicePlanRef(sb, inv, inv.roof_care_plan_id);",
    );
    expect(f).toContain("plan: { site_id: plan.site_id },");
    const page = flat("src/components/service/invoice-editor.tsx");
    expect(page).toContain("const bidId = data.invoice.bid_id ?? data.invoice.roof_care_plan_id;");
    expect(page).toContain('to="/properties/$id" params={{ id: bid.plan.site_id }}');
    // A plan year is billed once: no "Another invoice".
    expect(page).toContain("{!(bid && bid.plan) && ( <Button");
  });

  it("starts nothing itself when it is paid: the database does, and the tickets are announced", () => {
    const paid = f.slice(
      f.indexOf("export const markInvoicePaid"),
      f.indexOf("export const listInvoices"),
    );
    expect(paid).toContain(
      'if (inv.roof_care_plan_id && inv.status === "paid" && cur.status !== "paid") {',
    );
    expect(paid).toContain(
      "await announceCarePlanTickets(sb, await ticketIdsOfPlan(sb, inv.roof_care_plan_id), {",
    );
    expect(paid).not.toContain("roof_care_start");
  });

  it("looks its customer up by the plan in the Sage export, never as a ticket", () => {
    expect(f).toContain('const SAGE_PLAN_KEY = "plan:";');
    expect(f).toContain(
      "toCustomer.filter((i) => !i.bid_id && !i.roof_care_plan_id).map((i) => i.service_job_id),",
    );
    expect(f).toContain('sb.from("roof_care_plans").select("id, account_id").in("id", planIds)');
  });

  it("is counted as Roof Care on the Owner page", () => {
    const m = flat("src/lib/margin-report.functions.ts");
    expect(m).toContain("service_job_id, bid_id, roof_care_plan_id");
    expect(m).toContain(
      "...(ticket?.roof_care_visit_id || i.roof_care_plan_id ? { carePlan: true } : {}),",
    );
  });
});

describe("the database's side", () => {
  const sql = flat("supabase/migrations/20261119600000_roof_care_pay_first.sql");

  it("gives a plan the waiting status, and a property one plan that is live", () => {
    expect(sql).toContain("check (status in ('awaiting_payment', 'active', 'ended'));");
    expect(sql).toContain(
      "create unique index if not exists roof_care_plans_one_live on public.roof_care_plans (site_id) where status in ('active', 'awaiting_payment');",
    );
  });

  it("lets an invoice belong to a plan, to exactly one thing, and a plan to one live invoice", () => {
    expect(sql).toContain("check (num_nonnulls(service_job_id, bid_id, roof_care_plan_id) = 1);");
    expect(sql).toContain(
      "create unique index if not exists invoices_one_live_per_plan on public.invoices (roof_care_plan_id) where roof_care_plan_id is not null and status <> 'void';",
    );
  });

  it("signs a plan with no inspection and no ticket", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.roof_care_sign_up_await_payment("),
      sql.indexOf("create or replace function public.roof_care_start("),
    );
    expect(fn).toContain("v_site.account_id, p_site, p_plan, 'awaiting_payment', true,");
    expect(fn).not.toContain("insert into public.roof_care_visits");
    expect(fn).not.toContain("roof_care_make_tickets");
    expect(fn).toContain(
      "raise exception 'This property already has a Roof Care plan waiting to be paid';",
    );
    expect(fn).toContain("to authenticated;");
    expect(fn).toContain("from public, anon;");
  });

  it("starts the plan from the payment, with inspections that bill nothing", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.roof_care_start("),
      sql.indexOf("create or replace function public.invoices_plan_paid()"),
    );
    expect(fn).toContain("if not found or v_p.status <> 'awaiting_payment' then return; end if;");
    expect(fn).toContain("v_start := least(coalesce(p_paid, v_today), v_today);");
    expect(fn).toContain("v_renews := (v_start + interval '1 year')::date;");
    expect(fn).toContain(
      "values (p_plan, 'visit1', v_from, v_by, v_by, 0), (p_plan, 'visit2', v2_from, v2_by, v2_by, 0);",
    );
    expect(fn).toContain("perform public.roof_care_make_tickets(p_plan);");
    // People do not call it: the invoice's rule does.
    expect(fn).toContain(
      "revoke all on function public.roof_care_start(uuid, date) from public, anon, authenticated;",
    );
  });

  it("starts it when the plan's invoice becomes paid, whoever marks it and however", () => {
    expect(sql).toContain(
      "if new.roof_care_plan_id is not null and new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then perform public.roof_care_start(new.roof_care_plan_id, new.paid_on);",
    );
    expect(sql).toContain(
      "create trigger invoices_plan_paid after insert or update of status on public.invoices",
    );
  });

  it("ends a plan that was never paid, and takes its unpaid invoice with it", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.roof_care_end("));
    expect(fn).toContain("where id = p_plan and status in ('active', 'awaiting_payment');");
    expect(fn).toContain(
      "delete from public.invoices where roof_care_plan_id = p_plan and status = 'draft';",
    );
    expect(fn).toContain(
      "where roof_care_plan_id = p_plan and status = 'final' and coalesce(paid_amount, 0) = 0;",
    );
    expect(fn).toContain("raise exception 'Only a manager ends a Roof Care plan'");
  });

  it("is in the database types, added by hand", () => {
    const types = flat("src/integrations/supabase/types.ts");
    expect(types).toContain("roof_care_sign_up_await_payment: { Args: {");
    expect(types).toContain(
      // (Later on Nov 19: how they pay sits between them.)
      "paid_on: string | null pay_first: boolean pay_method: string | null pay_note: string | null plan: string plan_number: number | null",
    );
    expect(types).toContain("property: Json roof_care_plan_id: string | null");
  });
});

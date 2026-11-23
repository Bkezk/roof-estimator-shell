/**
 * Roof Care: the owner's go-aheads on the audit of Nov 23 (docs/qa/roof-care-audit-go-aheads-
 * 2026-11-23.md). He wrote: "on issues 1 go with A, 2 start the new year the day after, 3 go,
 * 4 go, ... 6 go", and "when signing up and selecting a set number of days after our payment it
 * needs to say we will accommodate the best we can but we cannot guarantee that date".
 *
 *  1. A plan inspection's ticket with no day is on the Needs attention list.
 *  2. A renewal's plan year starts the day after the old year's last day.
 *  3. Mark paid on a plan's invoice no longer talks of a ticket.
 *  4. A final or void plan invoice no longer points at a button it does not have.
 *  6. The Invoices list marks a plan's invoice "Roof Care" and has a chip for them.
 *  9. A set number of days is not a promise: the sign-up and the agreement say so.
 *
 * Before this: the list had no such row, the two years shared a day, the two sentences were the
 * ticket's, the list had no badge and no chip, and nothing said the day was not promised.
 *
 * THE NUMBERS HERE ARE MADE UP.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  INVOICE_KINDS,
  invoiceKindMatches,
  invoiceListSearch,
  invoiceSearch,
  isCarePlanInvoice,
  ROOF_CARE_INVOICE_BADGE,
} from "@/lib/invoice-search";
import { ATTENTION_DEFAULTS, attentionList, type AttCareNoDay } from "@/lib/owner-attention";
import { agreementEmail, receiptEmail, type PlanEmailFacts } from "@/lib/roof-care-email";
import {
  FIRST_DAYS_NOT_PROMISED,
  firstVisitWords,
  PLAN_INVOICE_PAID_NOTE,
  PLAN_INVOICE_REMAKE,
  PLAN_MAKE_INVOICE,
  renewalStartsOn,
} from "@/lib/roof-care-plan";
import { planInvoiceDescription } from "@/lib/roof-care-plan-invoice.functions";
import { ROOF_CARE_TERMS_VERSION } from "@/lib/roof-care-plan";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

// ── 1. A plan inspection's ticket with no day ───────────────────────────────────────────────

describe("1. a plan inspection whose ticket has no day is on the Needs attention list", () => {
  const JOB = "11111111-1111-4111-8111-111111111111";
  const VISIT = "22222222-2222-4222-8222-222222222222";
  const SITE = "33333333-3333-4333-8333-333333333333";
  const TITLE = "Roof Watch · Unit 2 (Made Up Storage Co)";
  const ticket = (over: Record<string, unknown> = {}) => ({
    id: JOB,
    number: 7031,
    customer_name: "Made Up Storage Co",
    service_type: "inspection",
    stage: "open",
    stage_changed_at: null,
    updated_at: "2027-03-01T14:00:00Z",
    created_at: "2027-03-01T14:00:00Z",
    scheduled_date: null,
    technician_id: null,
    ...over,
  });
  const noDay = (over: Partial<AttCareNoDay> = {}): AttCareNoDay => ({
    visit_id: VISIT,
    job_id: JOB,
    number: 7031,
    site_id: SITE,
    title: TITLE,
    label: "Inspection 1",
    due_from: "2027-03-15",
    due_by: "2027-05-15",
    ...over,
  });
  const base = {
    today: "2027-03-04",
    now: "2027-03-04T15:00:00Z",
    limits: ATTENTION_DEFAULTS,
    tickets: [ticket()],
    untouched: [],
    opps: [],
    bids: [],
    invoices: [],
    followups: [],
    repairFrom: [],
    bidFrom: [],
    names: {},
  };

  it("one row, for the office, that opens the ticket and says what to do", () => {
    const rows = attentionList({ ...base, careNoDay: [noDay()] }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: `care_plan_no_day:${VISIT}`,
      group: "office",
      kind: "care_plan_no_day",
      tag: "Roof Care",
      title: TITLE,
      why: "Inspection 1 is due between Mon, Mar 15 and Sat, May 15. Ticket #7031 has no day and nobody on it. Open the ticket and set its day.",
      who: "Office",
      age: 3,
      ageText: "3 days",
      tone: "amber",
      amount: null,
      href: `/service?id=${JOB}`,
    });
  });

  it("the same ticket is not also listed as an undated ticket nobody is on", () => {
    const without = attentionList(base).rows;
    expect(without.map((r) => r.kind)).toEqual(["ticket_nobody"]);
    const withRow = attentionList({ ...base, careNoDay: [noDay()] }).rows;
    expect(withRow.map((r) => r.kind)).toEqual(["care_plan_no_day"]);
  });

  it("red once the window has opened; and it names only what is missing", () => {
    const opened = attentionList({ ...base, today: "2027-03-20", careNoDay: [noDay()] }).rows[0]!;
    expect(opened.tone).toBe("red");
    expect(opened.why).toContain("is due by Sat, May 15.");
    const assigned = attentionList({
      ...base,
      tickets: [ticket({ technician_id: "44444444-4444-4444-8444-444444444444" })],
      careNoDay: [noDay()],
    }).rows[0]!;
    expect(assigned.why).toContain("Ticket #7031 has no day. Open the ticket");
    const oneDay = attentionList({
      ...base,
      careNoDay: [noDay({ due_from: "2027-03-10", due_by: "2027-03-10" })],
    }).rows[0]!;
    expect(oneDay.why).toContain("is due on Wed, Mar 10.");
  });

  it("past its last day it is left to the row that says it is late", () => {
    const rows = attentionList({
      ...base,
      today: "2027-05-20",
      tickets: [],
      careNoDay: [noDay()],
    }).rows;
    expect(rows.filter((r) => r.kind === "care_plan_no_day")).toHaveLength(0);
  });

  it("the server lists a visit whose ticket is out, not started, and has no day", () => {
    const src = flat(read("src/lib/owner-attention.functions.ts"));
    expect(src).toContain(
      '!v.ticket.scheduled_date && (v.ticket.stage === "open" || v.ticket.stage === "scheduled")',
    );
    expect(src).toContain("careNoDay: care.noDay,");
  });
});

// ── 2. The renewal year starts the day after ────────────────────────────────────────────────

describe("2. a renewal's plan year starts the day after the old year's last day", () => {
  it("the day after, across a month end and a leap day", () => {
    expect(renewalStartsOn("2027-11-23")).toBe("2027-11-24");
    expect(renewalStartsOn("2027-12-31")).toBe("2028-01-01");
    expect(renewalStartsOn("2028-02-28")).toBe("2028-02-29");
  });

  it("the database starts it there, and keeps the renewal date the same every year", () => {
    const sql = read(
      "supabase/migrations/20261124200000_roof_care_renewal_starts_the_day_after.sql",
    );
    expect(sql).toContain("v_start := greatest(v_paid, v_old.renews_on + 1);");
    expect(sql).not.toContain("v_start := greatest(v_paid, v_old.renews_on);");
    expect(flat(sql)).toContain(
      "if v_paid <= v_old.renews_on then v_renews := (v_old.renews_on + interval '1 year')::date; end if;",
    );
    expect(sql).toContain("v_renews := coalesce(v_renews, (v_start + interval '1 year')::date);");
    // An inspection carried into the new year is owed 60 days from that first day.
    expect(sql).toContain("'carried_until', greatest(p.renews_on + 1, v_today) + 60,");
  });

  it("the renewal's invoice names that first day", () => {
    const words = planInvoiceDescription({
      plan: "watch",
      plan_number: 1234,
      roof_sqft: 9100,
      renews_from: renewalStartsOn("2027-11-23"),
    });
    expect(words).toContain("The new plan year starts Nov 24, 2027, or the day this invoice");
    expect(flat(read("src/lib/roof-care-plan-invoice.functions.ts"))).toContain(
      "renewsFrom = old?.renews_on ? renewalStartsOn(old.renews_on) : null;",
    );
  });

  it("the receipt of a renewal paid ahead says the day after", () => {
    const m = receiptEmail({
      ...facts,
      paid: 4321,
      paid_on: "2027-11-01",
      starts_on: "2027-11-24",
      renews_on: "2028-11-23",
      invoice_number: "RC-1234",
    });
    expect(m.text).toContain(
      "Your new plan year starts Nov 24, 2027, the day after your current plan year ends, and runs until Nov 23, 2028.",
    );
  });
});

// ── 3 and 4. A plan invoice's own sentences ─────────────────────────────────────────────────

describe("3 and 4. a plan's invoice does not talk of a ticket or of a button it lacks", () => {
  const editor = flat(read("src/components/service/invoice-editor.tsx"));

  it("Mark paid says the payment starts the plan year", () => {
    expect(PLAN_INVOICE_PAID_NOTE).toBe(
      "Records the payment here (Sage stays the ledger). A payment that covers the total starts the plan year.",
    );
    expect(PLAN_INVOICE_PAID_NOTE).not.toMatch(/ticket|stage/i);
    expect(editor).toContain(
      "{inv.roof_care_plan_id ? ( PLAN_INVOICE_PAID_NOTE ) : inv.bid_id ? (",
    );
  });

  it("a final or void one says where it is made again", () => {
    expect(PLAN_INVOICE_REMAKE).toBe(
      `To bill the plan again, open the plan on its property and choose ${PLAN_MAKE_INVOICE}.`,
    );
    expect(editor).toContain(
      "so it can't be edited. To change it, Void it below. {PLAN_INVOICE_REMAKE}",
    );
    expect(editor).toContain("left out of the Sage export. {PLAN_INVOICE_REMAKE}");
    // The plan's branch comes before the trade bid's words, which name Another invoice.
    expect(editor.match(/\) : bid\?\.plan \? \(/g)).toHaveLength(2);
  });
});

// ── 6. The Invoices list ────────────────────────────────────────────────────────────────────

describe("6. the Invoices list marks a plan's invoice and can show them alone", () => {
  it("the chip is in the address, so Back returns to it", () => {
    expect(INVOICE_KINDS).toEqual(["care"]);
    expect(invoiceSearch({ kind: "care", status: "draft" })).toEqual({
      kind: "care",
      status: "draft",
    });
    expect(invoiceSearch({ kind: "anything" })).toEqual({});
    expect(invoiceListSearch({ id: "x", kind: "care" })).toEqual({ kind: "care" });
  });

  it("the chip keeps the plan invoices and drops the rest", () => {
    const plan = { roof_care_plan_id: "p1" };
    const ticket = { roof_care_plan_id: null };
    expect(isCarePlanInvoice(plan)).toBe(true);
    expect(isCarePlanInvoice(ticket)).toBe(false);
    expect([plan, ticket].filter((r) => invoiceKindMatches(r, "care"))).toEqual([plan]);
    expect([plan, ticket].filter((r) => invoiceKindMatches(r, undefined))).toHaveLength(2);
  });

  it("the page shows the badge, the chip, and opens the groups the chip narrowed", () => {
    const page = flat(read("src/components/service/invoices-page.tsx"));
    expect(ROOF_CARE_INVOICE_BADGE).toBe("Roof Care");
    expect(page).toContain('{isCarePlanInvoice(r) && ( <Badge variant="secondary"');
    expect(page).toContain(
      'onClick={() => patchFilters({ kind: kind === "care" ? undefined : "care" })}',
    );
    expect(page).toContain("(r) => invoiceKindMatches(r, kind) && invoiceMatches(r, q)");
    expect(page).toContain('isGroupOpen(openGroups, g.status, status !== "all" || !!kind)');
    // Tickets waiting for an invoice are not plan invoices.
    expect(page).toContain("const waiting = kind ? []");
  });
});

// ── 9. A set number of days is not a promise ────────────────────────────────────────────────

const facts: PlanEmailFacts = {
  plan: "watch",
  plan_number: 1234,
  site: "Main Plant",
  address: "1 Mill St, Corbin, KY 40701",
  agreed_by: "Pat Smith",
  signed_on: "2027-01-05",
  price: 4321,
  pay_method: "check",
  first_visit: "days",
  first_days: 21,
  terms_version: ROOF_CARE_TERMS_VERSION,
  benefits: { allowance: 0, leak_calls: 0, storm: 0 },
  company: "JBK Test Roofing",
  contact: "555-0100 or office@example.com",
};

describe("9. a set number of days after the payment is not a promise", () => {
  it("the words", () => {
    expect(FIRST_DAYS_NOT_PROMISED).toBe(
      "We will do our best to come on that day, but we cannot guarantee the date.",
    );
  });

  it("they follow that choice, and no other", () => {
    expect(firstVisitWords("days", 21)).toBe(
      `First inspection: 21 days after the payment is received. ${FIRST_DAYS_NOT_PROMISED}`,
    );
    expect(firstVisitWords("now", null)).not.toContain("guarantee");
    expect(firstVisitWords("window", null)).not.toContain("guarantee");
  });

  it("the customer reads them on the sign-up as soon as that choice is picked", () => {
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain(
      '{first === "days" && ( <p className="text-sm font-medium" data-sign-line="days-not-promised"> {FIRST_DAYS_NOT_PROMISED} </p> )}',
    );
  });

  it("and in their copy of the agreement", () => {
    expect(agreementEmail(facts)!.text).toContain(
      `First inspection: 21 days after the payment is received. ${FIRST_DAYS_NOT_PROMISED}`,
    );
    expect(
      agreementEmail({ ...facts, first_visit: "window", first_days: null })!.text,
    ).not.toContain(FIRST_DAYS_NOT_PROMISED);
  });
});

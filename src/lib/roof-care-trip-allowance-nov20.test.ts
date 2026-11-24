/**
 * Roof Care: a charged return trip takes what is left of the plan's minor repairs first (owner,
 * Nov 20, of the trip charge after a visit we could not do: "it comes out of the allocation if
 * there is allocation left correct?"; docs/qa/roof-care-trip-allowance-2026-11-20.md).
 *
 * Before this the minor repairs went toward a billed storm inspection only, and a return trip on
 * the plan's own inspection's invoice was the customer's in full.
 *
 * THE NUMBERS HERE ARE MADE UP: they match no plan price and no rate of the office.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  allowanceAutoNote,
  allowanceLineSource,
  allowanceLineWords,
  allowanceToward,
  invoiceAllowance,
} from "@/lib/roof-care-allowance";
import { invoiceAllowanceOf, syncAllowance } from "@/lib/roof-care-allowance.functions";
import { agreementEmail } from "@/lib/roof-care-email";
import {
  noAccessBefore,
  noAccessLine,
  readNoAccessPreview,
  tripAllowanceLines,
  tripLineSource,
} from "@/lib/roof-care-no-access";
import {
  carePlanLineSource,
  ROOF_CARE_TERMS,
  ROOF_CARE_TERMS_VERSION,
  type PlanNoAccess,
} from "@/lib/roof-care-plan";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const SQL = flat(read("supabase/migrations/20261120200000_roof_care_trip_from_allowance.sql"));

const PLAN = "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e11";
const VISIT = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const JOB = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const SITE = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c";
const NA = "6b7c8d9e-0f1a-4b2c-9d4e-5f6a7b8c9d0e";
const INV = "7c8d9e0f-1a2b-4c3d-8e5f-6a7b8c9d0e1f";

describe("the agreement", () => {
  it("term 7 says the minor repairs go toward the return trip first", () => {
    // (Nov 23: version 2026-11-23.1. Term 3 adds that what the plan includes applies to work
    // done in its twelve months, and that work done before the plan starts is not covered.)
    // (Nov 24: version 2026-11-24.1. The last term says what an inspection is and that we are
    // not responsible for a leak or for a condition we did not find; owner: "the shorter
    // version looks fine".)
    expect(ROOF_CARE_TERMS_VERSION).toBe("2026-11-24.1");
    expect(ROOF_CARE_TERMS[6]).toBe(
      "You give us access to the roof on the agreed day. The first visit in a plan year that we cannot do because we could not get on the roof is rescheduled at no charge. After that, the return trip is charged at our trip rate, and what is left of the plan's minor repairs amount is used toward it first.",
    );
  });
  it("the emailed agreement carries it", () => {
    const email = agreementEmail({
      plan: "care",
      plan_number: 1001,
      site: "Made-up Plaza",
      address: "",
      agreed_by: "Pat Example",
      signed_on: "2027-01-08",
      price: 777,
      pay_method: "check",
      first_visit: "window",
      first_days: null,
      terms_version: ROOF_CARE_TERMS_VERSION,
      benefits: null,
      company: "The Company",
      contact: "",
    });
    expect(email?.text).toContain(
      "what is left of the plan's minor repairs amount is used toward it first",
    );
  });
});

describe("what the No access box says before it is pressed", () => {
  const preview = (over: Record<string, unknown> = {}) =>
    readNoAccessPreview({
      plan_id: PLAN,
      visit_id: VISIT,
      count: 1,
      free: 1,
      charged: true,
      amount: 140,
      amount_known: true,
      has_allowance: true,
      allowance_left: 80,
      ...over,
    })!;

  it("the owner's rule in three cases: some left, enough left, none left", () => {
    // The trip is 140 and 80 of repairs is left: the plan pays 80, the customer 60.
    expect(tripAllowanceLines(140, true, 80)).toEqual([
      "$80.00 of the plan's minor repairs is left today. $80.00 of it goes toward the trip.",
      "The customer pays $60.00.",
    ]);
    // 300 left: the plan pays all 140, the customer nothing.
    expect(tripAllowanceLines(140, true, 300)).toEqual([
      "$300.00 of the plan's minor repairs is left today. $140.00 of it goes toward the trip.",
      "The customer pays nothing more.",
    ]);
    // None left: the customer pays 140.
    expect(tripAllowanceLines(140, true, 0)).toEqual([
      "Nothing is left of the plan's minor repairs this plan year. The customer pays $140.00.",
    ]);
  });
  it("a plan with no minor repairs says nothing of them", () => {
    expect(tripAllowanceLines(140, false, null)).toEqual([]);
    const lines = noAccessBefore(preview({ has_allowance: false, allowance_left: null }), true);
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).not.toContain("minor repairs");
  });
  it("the office reads the amounts", () => {
    expect(noAccessBefore(preview(), true)).toEqual([
      "This is the second time this plan year we could not get on the roof.",
      "The return trip is charged $140.00. It goes on this inspection's invoice.",
      "$80.00 of the plan's minor repairs is left today. $80.00 of it goes toward the trip.",
      "The customer pays $60.00.",
    ]);
    // What is left could not be read: the rule is still said, with no amount guessed.
    expect(noAccessBefore(preview({ allowance_left: null }), true)[2]).toBe(
      "What is left of the plan's minor repairs is used toward it first.",
    );
  });
  it("a technician is told the rule and no amount", () => {
    const lines = noAccessBefore(preview({ amount: null, allowance_left: null }), false);
    expect(lines[1]).toBe(
      "The return trip is charged at our trip rate. What is left of the plan's minor repairs is used toward it first. The customer can call the office for the amount.",
    );
    expect(lines.join(" ")).not.toContain("$");
    // Without minor repairs in the plan, the words are as they were.
    expect(
      noAccessBefore(
        preview({ amount: null, has_allowance: false, allowance_left: null }),
        false,
      )[1],
    ).toBe(
      "The return trip is charged at our trip rate. The customer can call the office for the amount.",
    );
  });
  it("the answer is read strictly", () => {
    expect(preview({ has_allowance: "yes" }).has_allowance).toBe(false);
    expect(preview({ allowance_left: -5 }).allowance_left).toBeNull();
    expect(preview({ allowance_left: "80" }).allowance_left).toBeNull();
    // An answer from before this change has neither: nothing is promised.
    const old = readNoAccessPreview({
      plan_id: PLAN,
      visit_id: VISIT,
      count: 1,
      free: 1,
      charged: true,
      amount: 140,
      amount_known: true,
    })!;
    expect(old).toMatchObject({ has_allowance: false, allowance_left: null });
  });
  it("a free one says nothing of the minor repairs", () => {
    const lines = noAccessBefore(preview({ count: 0, charged: false, amount: null }), true);
    expect(lines.join(" ")).not.toContain("minor repairs");
  });
  it("the database tells everyone the plan has minor repairs, and only the office what is left", () => {
    expect(SQL).toContain("jsonb_build_object('has_allowance', coalesce(v_allow, 0) > 0)");
    expect(SQL).toMatch(
      /if public\.is_technician\(\) then s := s \|\| jsonb_build_object\('amount', null\); elsif coalesce\(v_allow, 0\) > 0 and v_known then/,
    );
    expect(SQL).toContain("i.status <> 'void'");
    // No amount is typed into the repository.
    expect(SQL).not.toMatch(/allowance_left', \d/);
  });
});

describe("the plan's line for a charged return trip", () => {
  it('an invoice with no number yet reads as a draft, never as "invoice #" and nothing', () => {
    const line = (number: string) =>
      noAccessLine(
        {
          id: NA,
          visit_id: VISIT,
          on: "2027-04-06",
          note: "Gate locked.",
          by_name: "Tom Tech",
          charged: true,
          amount: 140,
          invoice: { id: INV, number },
          billed: true,
        } as PlanNoAccess,
        true,
      );
    expect(line("7004")).toBe(
      "No access Apr 6, 2027: Gate locked (Tom Tech). Return trip charged $140.00, on invoice #7004.",
    );
    expect(line("")).toBe(
      "No access Apr 6, 2027: Gate locked (Tom Tech). Return trip charged $140.00, on a draft invoice.",
    );
  });
});

describe("the inspection's invoice", () => {
  const trip = { source: tripLineSource(NA), total: 140 };
  const share = { source: carePlanLineSource(VISIT), total: 0 };
  const repair = { source: null, total: 55 };

  it("the minor repairs go toward the return trip and nothing else on the invoice", () => {
    const a = invoiceAllowance({
      plan_id: PLAN,
      plan: "care",
      allowance: 300,
      usedElsewhere: 220,
      lines: [share, trip, repair],
      choice: null,
      tripSources: [trip.source],
    });
    expect(a).toMatchObject({ left: 80, billable: 140, cap: 80, trip: true });
    expect(a.storm).toBeUndefined();
    // With nothing named, the whole invoice is the repair, as before.
    const whole = invoiceAllowance({
      plan_id: PLAN,
      plan: "care",
      allowance: 300,
      usedElsewhere: 0,
      lines: [repair],
      choice: null,
    });
    expect(whole).toMatchObject({ billable: 55, cap: 55 });
    expect(whole.trip).toBeUndefined();
  });
  it("the words on the line and in the box say what it went toward", () => {
    expect(allowanceToward({ trip: true })).toBe("trip");
    expect(allowanceToward({ storm: true, trip: true })).toBe("both");
    expect(allowanceToward({ storm: true })).toBe("inspection");
    expect(allowanceToward({})).toBe(false);
    expect(allowanceLineWords("care", "trip")).toBe(
      "Roof Care plan: your minor repairs amount used toward the return trip",
    );
    expect(allowanceLineWords("guard", "both")).toBe(
      "Roof Guard plan: your minor repairs amount used toward this inspection and the return trip",
    );
    // As they were.
    expect(allowanceLineWords("guard", true)).toBe(
      "Roof Guard plan: your minor repairs amount used toward this inspection",
    );
    expect(allowanceLineWords("care")).toBe("Roof Care plan: minor repairs included in your plan");
    expect(allowanceAutoNote({ trip: true })).toBe(
      "It goes toward the return trip, as the agreement says.",
    );
    expect(allowanceAutoNote({})).toBe(
      "If this is not a minor repair, press Does not use the plan.",
    );
    expect(flat(read("src/components/service/invoice-editor.tsx"))).toContain(
      "{allowanceAutoNote(a)}",
    );
  });

  // The plan's spring inspection, with one charged return trip of 140. Allowance 300.
  const tables = (used: number, over: { plan?: Record<string, unknown>; trip?: boolean } = {}) => ({
    service_jobs: [{ id: JOB, site_id: SITE, roof_care_visit_id: VISIT }],
    roof_care_visits: [{ id: VISIT, kind: "visit1", amount: 0, plan_id: PLAN }],
    roof_care_plans: [
      {
        id: PLAN,
        plan: "care",
        status: "active",
        site_id: SITE,
        // Nov 23: a plan pays only toward work done from its first day, so the plan here has
        // the day it was signed, as every real plan does. It had none before.
        signed_on: "2026-01-05",
        repair_allowance: 300,
        ...over.plan,
      },
    ],
    invoices: [
      {
        id: INV,
        status: "draft",
        service_job_id: JOB,
        bill_to_vendor_id: null,
        care_allowance_choice: null,
        tax_rate: 0,
      },
      { id: "other", status: "final" },
    ],
    invoice_lines: [
      {
        id: 1,
        invoice_id: INV,
        sort: 0,
        source: carePlanLineSource(VISIT),
        total: 0,
        rate: 0,
        taxable: false,
        cost_total: 0,
      },
      ...(over.trip === false
        ? []
        : [
            {
              id: 2,
              invoice_id: INV,
              sort: 1,
              source: tripLineSource(NA),
              total: 140,
              rate: 140,
              taxable: false,
              cost_total: 0,
            },
          ]),
      ...(used > 0
        ? [
            {
              id: 3,
              invoice_id: "other",
              sort: 0,
              source: allowanceLineSource(PLAN),
              total: -used,
              rate: -used,
            },
          ]
        : []),
    ],
  });
  type Sb = Parameters<typeof invoiceAllowanceOf>[0];
  type Inv = Parameters<typeof invoiceAllowanceOf>[1];
  type Lines = Parameters<typeof invoiceAllowanceOf>[2];
  const where = async (t: ReturnType<typeof tables>) => {
    const env = fakeSupabase(t);
    return invoiceAllowanceOf(
      env.db as unknown as Sb,
      t.invoices[0] as unknown as Inv,
      t.invoice_lines.filter((l) => l["invoice_id"] === INV) as unknown as Lines,
    );
  };

  it("some left, enough left, none left", async () => {
    // 220 used on a repair: 80 left, the plan pays 80 of the trip and the customer 60.
    expect(await where(tables(220))).toMatchObject({
      left: 80,
      billable: 140,
      cap: 80,
      trip: true,
    });
    // Nothing used: the plan pays all 140, and 160 is left.
    expect(await where(tables(0))).toMatchObject({ left: 300, cap: 140 });
    // All used: the customer pays 140.
    expect(await where(tables(300))).toMatchObject({ left: 0, cap: 0 });
  });
  it("an inspection with no return trip takes nothing, as before", async () => {
    expect(await where(tables(0, { trip: false }))).toBeNull();
  });
  it("a plan with no minor repairs, or one that has ended, pays nothing toward it", async () => {
    expect(await where(tables(0, { plan: { repair_allowance: 0 } }))).toBeNull();
    expect(await where(tables(0, { plan: { status: "ended" } }))).toBeNull();
  });
  it("the line is put on by itself and the customer is billed the rest", async () => {
    const t = tables(220);
    const env = fakeSupabase(t);
    const changed = await syncAllowance(
      env.db as unknown as Parameters<typeof syncAllowance>[0],
      t.invoices[0] as unknown as Parameters<typeof syncAllowance>[1],
      t.invoice_lines.filter((l) => l["invoice_id"] === INV) as unknown as Parameters<
        typeof syncAllowance
      >[2],
    );
    expect(changed).toBe(true);
    const line = env.tables["invoice_lines"]!.find(
      (l) => l["invoice_id"] === INV && l["source"] === allowanceLineSource(PLAN),
    );
    expect(line).toMatchObject({
      total: -80,
      description: "Roof Care plan: your minor repairs amount used toward the return trip",
    });
    expect(env.tables["invoices"]![0]).toMatchObject({ total: 60, care_allowance_choice: "auto" });
  });
});

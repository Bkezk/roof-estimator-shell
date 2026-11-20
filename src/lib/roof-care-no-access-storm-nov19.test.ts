/**
 * Roof Care: a visit we could not do, and a storm inspection beyond the one the plan includes
 * (owner, Nov 19, late; docs/qa/roof-care-no-access-storm-2026-11-19.md).
 *
 *  - "10. Go.": the first visit in a plan year that we cannot do because we could not get on the
 *    roof is rescheduled at no charge. After that the return trip is charged at the trip rate.
 *    Before this the site kept no record of such a visit, and term 7 said every one was free.
 *  - "11. Second inspection billed at inspection price and their repair allocation contributes
 *    to the price if they have any left": before this a manager added a further storm inspection
 *    and it was free.
 *
 * THE NUMBERS HERE ARE MADE UP: they match no plan price and no rate of the office.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const told: unknown[][] = [];
vi.mock("@/lib/notify.server", () => ({
  notify: async (...a: unknown[]) => {
    told.push(a);
    return 1;
  },
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => true,
  appUrl: () => "",
  emailConfigured: () => false,
  sendEmail: async () => ({ ok: false, error: "none here" }),
}));

import { carePlanVisit } from "@/lib/invoices.server";
import { ATTENTION_DEFAULTS, attentionList, type AttentionIn } from "@/lib/owner-attention";
import {
  allowanceLineSource,
  allowanceLineWords,
  isAllowanceLine,
} from "@/lib/roof-care-allowance";
import { invoiceAllowanceOf, syncAllowance } from "@/lib/roof-care-allowance.functions";
import { benefitsUsed } from "@/lib/roof-care-benefits";
import { agreementEmail, TERMS_BY_VERSION } from "@/lib/roof-care-email";
import { billsItself, carePlanInvoiceLines, carePlanOwnLine } from "@/lib/roof-care-invoice";
import {
  isTripLine,
  NO_ACCESS_NOTE_NEEDED,
  noAccessAfter,
  noAccessBefore,
  noAccessLine,
  noAccessTally,
  readNoAccessPreview,
  tripLine,
  tripLineSource,
  tripUnbilled,
} from "@/lib/roof-care-no-access";
import {
  noAccessNotice,
  readTicketNoAccess,
  recordRoofCareNoAccess,
  removeRoofCareNoAccess,
} from "@/lib/roof-care-no-access.functions";
import {
  carePlanLineSource,
  carePlanLineWords,
  ROOF_CARE_TERMS,
  ROOF_CARE_TERMS_VERSION,
  type PlanNoAccess,
  type RoofCarePlan,
} from "@/lib/roof-care-plan";
import { addRoofCareStorm, plansOfSites, roofCareStormOffer } from "@/lib/roof-care-plan.functions";
import { readStormOffer, stormCanAdd, stormOfferLines } from "@/lib/roof-care-storm";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const SQL = flat(read("supabase/migrations/20261119990000_roof_care_no_access_paid_storm.sql"));
const CARD = flat(read("src/components/roof-care/plan-card.tsx"));
const BOX = flat(read("src/components/roof-care/no-access.tsx"));
const CLOSEOUT = flat(read("src/components/service/closeout.tsx"));
const run = <T>(fn: unknown, db: unknown, data: unknown, userId = "u1") =>
  (fn as (a: unknown) => Promise<T>)({ data, context: { supabase: db, userId } });

const PLAN = "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e11";
const VISIT = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const STORM = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const JOB = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const SITE = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c";
const NA1 = "5a6b7c8d-9e0f-4a1b-8c3d-4e5f6a7b8c9d";
const NA2 = "6b7c8d9e-0f1a-4b2c-9d4e-5f6a7b8c9d0e";
const INV = "7c8d9e0f-1a2b-4c3d-8e5f-6a7b8c9d0e1f";

const preview = (over: Record<string, unknown> = {}) =>
  readNoAccessPreview({
    plan_id: PLAN,
    visit_id: VISIT,
    site_id: SITE,
    count: 0,
    free: 1,
    charged: false,
    amount: null,
    amount_known: false,
    ...over,
  })!;
const missed = (over: Partial<PlanNoAccess> = {}): PlanNoAccess => ({
  id: NA1,
  visit_id: VISIT,
  on: "2027-04-06",
  note: "Gate locked.",
  by_name: "Tom Tech",
  charged: false,
  amount: null,
  invoice: null,
  billed: null,
  ...over,
});

beforeEach(() => {
  told.length = 0;
});

// ── 10. A visit we could not do ─────────────────────────────────────────────────────────────

describe("10. no access: the first in a plan year is free, each one after it is charged", () => {
  it("the agreement says so, in a new version that can still be emailed", () => {
    // (Nov 20: version 2026-11-20.1. Term 7 adds that what is left of the minor repairs amount
    // goes toward a charged return trip first.)
    expect(ROOF_CARE_TERMS_VERSION).toBe("2026-11-20.1");
    expect(ROOF_CARE_TERMS).toHaveLength(11);
    expect(ROOF_CARE_TERMS[6]).toBe(
      "You give us access to the roof on the agreed day. The first visit in a plan year that we cannot do because we could not get on the roof is rescheduled at no charge. After that, the return trip is charged at our trip rate, and what is left of the plan's minor repairs amount is used toward it first.",
    );
    expect(ROOF_CARE_TERMS.join(" ")).not.toMatch(/\$\s?\d/);
    expect(TERMS_BY_VERSION[ROOF_CARE_TERMS_VERSION]).toBe(ROOF_CARE_TERMS);
    const email = agreementEmail({
      plan: "guard",
      plan_number: 1001,
      site: "Plant 2",
      address: "",
      agreed_by: "Pat Smith",
      signed_on: "2027-01-08",
      price: 4321,
      pay_method: "check",
      first_visit: "window",
      first_days: null,
      terms_version: ROOF_CARE_TERMS_VERSION,
      benefits: null,
      company: "JBK",
      contact: "",
    });
    expect(email?.text).toContain("After that, the return trip is charged at our trip rate, and");
  });
  it("the database's answer is read strictly", () => {
    expect(preview()).toEqual({
      plan_id: PLAN,
      visit_id: VISIT,
      count: 0,
      free: 1,
      charged: false,
      amount: null,
      amount_known: false,
      // (Nov 20: whether the plan has minor repairs, and what is left of them for the office.)
      has_allowance: false,
      allowance_left: null,
    });
    expect(readNoAccessPreview(null)).toBeNull();
    expect(readNoAccessPreview({ count: 0, free: 1 })).toBeNull();
    expect(readNoAccessPreview({ ...preview(), count: -1 })).toBeNull();
    // An amount of nothing is "not known", never a charge of nothing.
    expect(preview({ charged: true, amount: 0, amount_known: true }).amount).toBeNull();
  });
  it("before it is pressed the box says whether this one is free", () => {
    expect(noAccessBefore(preview(), true)).toEqual([
      "This is the first time this plan year we could not get on the roof.",
      "The return trip is at no charge.",
      "The next one is charged at our trip rate.",
    ]);
    // The same for a technician: nothing about money to hide.
    expect(noAccessBefore(preview(), false)).toEqual(noAccessBefore(preview(), true));
  });
  it("or charged: the office reads the amount, a technician is told to send them to the office", () => {
    const second = preview({ count: 1, charged: true, amount: 137.5, amount_known: true });
    expect(noAccessBefore(second, true)).toEqual([
      "This is the second time this plan year we could not get on the roof.",
      "The return trip is charged $137.50. It goes on this inspection's invoice.",
    ]);
    const tech = preview({ count: 1, charged: true, amount: null, amount_known: true });
    expect(noAccessBefore(tech, false)).toEqual([
      "This is the second time this plan year we could not get on the roof.",
      "The return trip is charged at our trip rate. The customer can call the office for the amount.",
    ]);
    expect(noAccessBefore(tech, false).join(" ")).not.toMatch(/\$/);
  });
  it("a charge that cannot be worked out is said plainly, never shown as nothing", () => {
    const lines = noAccessBefore(
      preview({ count: 2, charged: true, amount: null, amount_known: false }),
      true,
    );
    expect(lines).toEqual([
      "This is the third time this plan year we could not get on the roof.",
      "The return trip is charged, but the amount could not be worked out: the travel rates on the Service rates page are blank, or the plan has no drive time.",
      "Record it, then add the charge to this inspection's invoice by hand.",
    ]);
    expect(lines.join(" ")).not.toMatch(/\$0|\$ 0/);
  });
  it("what the person is told after, and what the plan lists for the office", () => {
    expect(noAccessAfter({ charged: false })).toBe(
      "No access recorded. The inspection stays open for a new day. The return trip is at no charge.",
    );
    expect(noAccessAfter({ charged: true })).toContain("The return trip is charged.");
    expect(noAccessLine(missed(), true)).toBe(
      "No access Apr 6, 2027: Gate locked (Tom Tech). No charge.",
    );
    const charged = missed({ id: NA2, charged: true, amount: 137.5, billed: false });
    expect(noAccessLine(charged, true)).toBe(
      "No access Apr 6, 2027: Gate locked (Tom Tech). Return trip charged $137.50, not invoiced yet. It goes on this inspection's invoice.",
    );
    expect(
      noAccessLine({ ...charged, billed: true, invoice: { id: INV, number: "7004" } }, true),
    ).toBe(
      "No access Apr 6, 2027: Gate locked (Tom Tech). Return trip charged $137.50, on invoice #7004.",
    );
    expect(noAccessLine({ ...charged, amount: null }, true)).toContain(
      "the amount could not be worked out. Add it to the inspection's invoice by hand.",
    );
    expect(noAccessTally([missed(), charged])).toEqual({
      count: 2,
      charged: 1,
      words: "2 this plan year, 1 charged",
    });
    expect(noAccessTally([missed()]).words).toBe("1 this plan year, no charge");
  });
  it("the record goes to the database with what happened, and the office is told", async () => {
    const calls: Record<string, unknown>[] = [];
    const env = fakeSupabase(
      {
        profiles: [
          { id: "u1", role: "user", full_name: "Tom Tech", email: "t@x" },
          { id: "a1", role: "admin", full_name: "Ann Admin", email: "a@x" },
          { id: "m1", role: "manager", full_name: "Max Manager", email: "m@x" },
        ],
        service_jobs: [{ id: JOB, number: 7001, site_name: "Plant 2", roof_care_visit_id: VISIT }],
        roof_care_plans: [{ id: PLAN, plan: "guard" }],
      },
      {
        rpcs: {
          roof_care_no_access: (a: Record<string, unknown>) => {
            calls.push(a);
            return {
              id: NA2,
              plan_id: PLAN,
              visit_id: VISIT,
              site_id: SITE,
              count: 1,
              free: 1,
              charged: true,
              amount: null,
              amount_known: true,
            };
          },
        },
      },
    );
    const r = await run(recordRoofCareNoAccess, env.db, { job_id: JOB, note: "  Gate locked  " });
    expect(r).toEqual({ charged: true, amount_known: true });
    expect(calls).toEqual([{ p_job: JOB, p_note: "Gate locked" }]);
    expect(told).toHaveLength(1);
    expect((told[0]![0] as string[]).sort()).toEqual(["a1", "m1"]);
    expect(told[0]![1]).toEqual({
      kind: "care_no_access",
      title: "No access for a Roof Guard inspection: Plant 2",
      body: "Tom Tech: Gate locked. The return trip is charged: it goes on this inspection's invoice. Ticket #7001 needs a new day.",
      url: `/service?id=${JOB}`,
    });
    // Blank: refused before the database is asked.
    expect(() => run(recordRoofCareNoAccess, env.db, { job_id: JOB, note: "   " })).toThrow(
      NO_ACCESS_NOTE_NEEDED,
    );
    expect(calls).toHaveLength(1);
    expect(
      noAccessNotice({
        plan: "care",
        job_id: JOB,
        number: null,
        site: null,
        note: "Nobody on site.",
        by_name: null,
        charged: false,
      }).body,
    ).toBe("Nobody on site. The return trip is at no charge. Ticket needs a new day.");
  });
  it("the ticket's box shows nothing to press once the inspection is done, and says a real failure", async () => {
    const rows = [
      {
        id: NA1,
        visit_id: VISIT,
        on_date: "2027-04-06",
        note: "Gate locked",
        by_name: "Tom Tech",
        charged: false,
        at: "2027-04-06T14:00:00Z",
      },
    ];
    const world = (answer: () => unknown, job: Record<string, unknown> = {}) =>
      fakeSupabase(
        {
          service_jobs: [{ id: JOB, roof_care_visit_id: VISIT, ...job }],
          roof_care_no_access: rows,
        },
        { rpcs: { roof_care_no_access_preview: answer } },
      );
    type Sb = Parameters<typeof readTicketNoAccess>[0];
    const open = await readTicketNoAccess(
      world(() => ({ ...preview(), site_id: SITE, count: 1, charged: true, amount_known: true }))
        .db as unknown as Sb,
      JOB,
    );
    expect(open.preview).toMatchObject({ count: 1, charged: true });
    expect(open.records).toEqual([
      { id: NA1, on: "2027-04-06", note: "Gate locked", by_name: "Tom Tech", charged: false },
    ]);
    const done = await readTicketNoAccess(
      world(() => {
        throw new Error("This inspection is already done");
      }).db as unknown as Sb,
      JOB,
    );
    expect(done.preview).toBeNull();
    expect(done.records).toHaveLength(1);
    await expect(
      readTicketNoAccess(
        world(() => {
          throw new Error("That inspection is not yours to record");
        }).db as unknown as Sb,
        JOB,
      ),
    ).rejects.toThrow("not yours to record");
    // Not a plan's inspection: nothing is asked of the database.
    let asked = 0;
    const plain = await readTicketNoAccess(
      world(
        () => {
          asked++;
          return null;
        },
        { roof_care_visit_id: null },
      ).db as unknown as Sb,
      JOB,
    );
    expect(plain).toEqual({ preview: null, records: [] });
    expect(asked).toBe(0);
  });
  it("a manager takes one off through the database", async () => {
    const calls: unknown[] = [];
    const env = fakeSupabase(
      {},
      {
        rpcs: {
          roof_care_no_access_remove: (a: Record<string, unknown>) => {
            calls.push(a);
            return null;
          },
        },
      },
    );
    await run(removeRoofCareNoAccess, env.db, { id: NA1 });
    expect(calls).toEqual([{ p_id: NA1 }]);
    expect(SQL).toContain(
      "raise exception 'Only a manager takes a no access record off' using errcode = '42501';",
    );
    expect(SQL).toContain(
      "raise exception 'Its return trip is on invoice #%. Take it off that invoice first.', v_other;",
    );
  });
  it("the charge is a line of its own on that inspection's invoice, after the plan's", () => {
    const lines = carePlanInvoiceLines(
      [{ description: "Tom Tech — Labor", total: 170, rate: 85 }],
      {
        id: VISIT,
        kind: "visit2",
        amount: 0,
        plan: "care",
        paid_first: true,
        trips: [
          { id: NA2, on: "2027-04-06", amount: 137.5 },
          // One whose amount is nothing is never a line.
          { id: NA1, on: "2027-04-01", amount: 0 },
        ],
      },
    );
    expect(lines.map((l) => [l.sort, l.description, l.total])).toEqual([
      [0, "Roof Care plan: inspection 2 of 2 (included in the plan)", 0],
      [1, "Return trip: we could not get on the roof on Apr 6, 2027", 137.5],
      [2, "Tom Tech — Labor", 0],
    ]);
    const trip = tripLine({ id: NA2, on: "2027-04-06", amount: 137.5 }, 1);
    expect(trip).toMatchObject({
      source: tripLineSource(NA2),
      rate: 137.5,
      taxable: false,
      show_on_invoice: true,
      cost_total: 0,
    });
    expect(isTripLine(trip)).toBe(true);
    expect(isAllowanceLine(trip)).toBe(false);
    expect(tripLineSource(NA2)).not.toBe(carePlanLineSource(NA2));
  });
  it("the invoice builder reads the charged ones of the inspection, with an amount", async () => {
    const env = fakeSupabase({
      roof_care_visits: [{ id: VISIT, kind: "visit1", amount: 0, plan_id: PLAN }],
      roof_care_plans: [{ id: PLAN, plan: "care", status: "active", pay_first: true }],
      roof_care_no_access: [
        { id: NA1, visit_id: VISIT, on_date: "2027-04-01", amount: null, charged: false, at: "1" },
        { id: NA2, visit_id: VISIT, on_date: "2027-04-06", amount: 137.5, charged: true, at: "2" },
        // Charged, the amount not worked out: left for the office to add by hand.
        { id: "x", visit_id: VISIT, on_date: "2027-04-09", amount: null, charged: true, at: "3" },
        { id: "y", visit_id: "other", on_date: "2027-04-09", amount: 50, charged: true, at: "4" },
      ],
    });
    const v = await carePlanVisit(env.db as unknown as Parameters<typeof carePlanVisit>[0], VISIT);
    expect(v?.trips).toEqual([{ id: NA2, on: "2027-04-06", amount: 137.5 }]);
    expect(billsItself(v)).toBe(true);
  });
  it("a charge on no invoice after the inspection is signed off is listed for the office", () => {
    const n = missed({ charged: true, amount: 137.5, billed: false });
    expect(tripUnbilled(n, "authorized")).toBe(true);
    expect(tripUnbilled(n, "closed")).toBe(true);
    // Not while the inspection is still to be done: the charge goes on its invoice then.
    expect(tripUnbilled(n, "scheduled")).toBe(false);
    expect(tripUnbilled(n, null)).toBe(false);
    expect(tripUnbilled({ ...n, billed: true }, "authorized")).toBe(false);
    expect(tripUnbilled(missed(), "authorized")).toBe(false);
    const base: AttentionIn = {
      today: "2027-04-23",
      now: "2027-04-23T15:00:00Z",
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
          visit_id: `trip:${NA2}`,
          job_id: JOB,
          number: 7001,
          title: "Roof Care · Plant 2 (Acme)",
          label: "Return trip after no access",
          amount: 137.5,
          since: "2027-04-20T15:00:00Z",
          trip: true,
        },
      ],
    };
    expect(attentionList(base).rows[0]).toMatchObject({
      key: `care_plan_unbilled:trip:${NA2}`,
      group: "office",
      why: "A return trip was charged after a visit with no access, and it is on no invoice. Open ticket #7001: press Invoice this care plan inspection, or use Rebuild from ticket on its draft invoice.",
      amount: 137.5,
    });
    expect(flat(read("src/lib/owner-attention.functions.ts"))).toContain(
      "if (ticket && tripUnbilled(n, ticket.stage))",
    );
  });
  it("the plan carries them for the office, each with the invoice its charge is on", async () => {
    const tables = {
      roof_care_plans: [
        {
          id: PLAN,
          account_id: "acct",
          site_id: SITE,
          plan: "care",
          status: "active",
          signed_on: "2027-01-08",
          renews_on: "2028-01-08",
          roof_sqft: 20000,
          price: 2000,
          repair_allowance: 300,
        },
      ],
      roof_care_visits: [
        {
          id: VISIT,
          plan_id: PLAN,
          kind: "visit1",
          due_from: "2027-03-15",
          due_by: "2027-05-15",
          first_due_by: "2027-05-15",
          amount: 0,
          customer_asked: true,
        },
      ],
      service_jobs: [],
      roof_care_no_access: [
        {
          id: NA1,
          plan_id: PLAN,
          visit_id: VISIT,
          on_date: "2027-04-01",
          note: "Gate locked",
          by_name: "Tom Tech",
          charged: false,
          amount: null,
          at: "2027-04-01T14:00:00Z",
        },
        {
          id: NA2,
          plan_id: PLAN,
          visit_id: VISIT,
          on_date: "2027-04-06",
          note: "No key",
          by_name: "Tom Tech",
          charged: true,
          amount: 137.5,
          at: "2027-04-06T14:00:00Z",
        },
      ],
      invoices: [{ id: INV, status: "final", display_number: "7004", roof_care_plan_id: null }],
      invoice_lines: [{ id: 1, invoice_id: INV, source: tripLineSource(NA2), total: 137.5 }],
    };
    type Sb = Parameters<typeof plansOfSites>[0];
    const [office] = await plansOfSites(fakeSupabase(tables).db as unknown as Sb, [SITE], {
      money: true,
      noAccess: true,
    });
    expect(office!.no_access).toEqual([
      {
        id: NA1,
        visit_id: VISIT,
        on: "2027-04-01",
        note: "Gate locked",
        by_name: "Tom Tech",
        charged: false,
        amount: null,
        invoice: null,
        billed: null,
      },
      {
        id: NA2,
        visit_id: VISIT,
        on: "2027-04-06",
        note: "No key",
        by_name: "Tom Tech",
        charged: true,
        amount: 137.5,
        invoice: { id: INV, number: "7004" },
        billed: true,
      },
    ]);
    // The return trip's line is not mistaken for the inspection's own share of the plan.
    expect(office!.visits[0]!.billed).toBe(false);
    // A void invoice gives the charge back: it is on no invoice again.
    const voided = { ...tables, invoices: [{ ...tables.invoices[0]!, status: "void" }] };
    const [after] = await plansOfSites(fakeSupabase(voided).db as unknown as Sb, [SITE], {
      money: true,
      noAccess: true,
    });
    expect(after!.no_access![1]).toMatchObject({ billed: false, invoice: null });
    // A technician reads only their own, so no list is given to one.
    const [tech] = await plansOfSites(fakeSupabase(tables).db as unknown as Sb, [SITE]);
    expect(tech!.no_access).toBeNull();
    const row = benefitsUsed(office!, "2027-04-10", 0).find((r) => r.key === "no_access");
    expect(row).toMatchObject({
      label: "Visits with no access",
      words: "2 this plan year, 1 charged",
    });
    expect(benefitsUsed(tech!, "2027-04-10", 0).some((r) => r.key === "no_access")).toBe(false);
  });
  it("the database: one free a plan year in one named place, the charge worked as travel is", () => {
    expect(SQL).toContain("c_free constant integer := 1;");
    expect(SQL.match(/c_free constant integer/g)).toHaveLength(1);
    expect(SQL).toContain(
      "select count(*) into v_count from public.roof_care_no_access n where n.plan_id = j.plan_id; v_charged := v_count >= c_free;",
    );
    // The travel rates of the Service rates page, for the plan's own drive and the crew.
    expect(SQL).toContain(
      "where r.rate_kind = 'standard' and r.role = 'tech' and r.time_kind = 'travel';",
    );
    expect(SQL).toContain(
      "where r.rate_kind = 'standard' and r.role = 'helper' and r.time_kind = 'travel';",
    );
    expect(SQL).toContain(
      "return round(v_hours * (v_tech + (v_size - 1) * coalesce(v_helper, 0)), 2);",
    );
    // Blank rates or no drive: no amount, never nothing charged.
    expect(SQL).toContain(
      "if coalesce(v_hours, 0) <= 0 or coalesce(v_tech, 0) <= 0 or (v_size > 1 and coalesce(v_helper, 0) <= 0) then return null; end if;",
    );
    // No rate is typed into the repository.
    expect(SQL).not.toMatch(/bill_rate\s*(=|:=)\s*\d/);
  });
  it("the database: who may record, what it marks, and that a trip is billed once", () => {
    expect(SQL).toContain("(not public.is_technician() or public.tech_sees_site(j.site_id))))");
    expect(SQL).toContain(
      "raise exception 'That inspection is not yours to record' using errcode = '42501';",
    );
    expect(SQL).toContain("raise exception 'This inspection is already done';");
    expect(SQL).toContain("raise exception 'Type what happened';");
    expect(SQL).toContain("raise exception 'No access is already recorded on this ticket today';");
    // The renewal then treats the inspection as kept off by the customer.
    expect(SQL).toContain(
      "update public.roof_care_visits set customer_asked = true where id = (s->>'visit_id')::uuid;",
    );
    // The amount is the office's to read.
    expect(SQL).toContain(
      "if public.is_technician() then s := s || jsonb_build_object('amount', null); end if;",
    );
    expect(SQL).toContain(
      "raise exception 'This return trip is already on invoice #%. It is billed once.', v_other;",
    );
    expect(SQL).toContain("revoke all on public.roof_care_no_access from anon, authenticated;");
    expect(SQL).toContain("grant select on public.roof_care_no_access to authenticated;");
    expect(SQL).toContain("by_user uuid references public.profiles (id) on delete set null,");
  });
  it("the box is in the technician's workflow and on the office's ticket", () => {
    expect(CLOSEOUT).toContain("{job.roof_care_visit_id && <NoAccessBox jobId={job.id} big />}");
    expect(CARD).toContain("{showsOffered && visitId && jobId && ( <NoAccessBox jobId={jobId}");
    expect(BOX).toContain("const lines = noAccessBefore(preview, office);");
    expect(BOX).toContain("if (!note.trim()) return setProblem(NO_ACCESS_NOTE_NEEDED);");
    expect(BOX).toContain('data-action="roof-care-no-access-confirm"');
    // The plan lists each one for the office, and a manager can take one off.
    expect(CARD).toContain("{noAccessLine(n, office)}");
    expect(CARD).toContain("{manager && !n.invoice && (");
  });
});

// ── 11. A storm inspection beyond the one the plan includes ─────────────────────────────────

describe("11. a further storm inspection is billed, the minor repairs left go toward it first", () => {
  const offer = (over: Record<string, unknown> = {}) =>
    readStormOffer({
      billed: true,
      included: 1,
      used: 1,
      billed_so_far: 0,
      price: 600,
      allowance_left: 400,
      plan_pays: 400,
      customer_pays: 200,
      ...over,
    })!;
  it("the agreement says so", () => {
    expect(ROOF_CARE_TERMS[7]).toBe(
      "A storm inspection, where the plan includes one, is done when you ask for it after a storm. A further storm inspection in the same plan year is billed at the price of one inspection, and what is left of the plan's minor repairs amount is used toward it first.",
    );
  });
  it("one the plan includes is still free, and the box says so", () => {
    const o = readStormOffer({ billed: false, included: 1, used: 0, billed_so_far: 0 })!;
    expect(o).toMatchObject({ billed: false, price: null, customer_pays: 0 });
    expect(stormOfferLines(o)).toEqual([
      "This is storm inspection 1 of the 1 the plan includes this plan year.",
      "It is not billed.",
    ]);
    expect(stormCanAdd(o)).toBe(true);
  });
  it("the owner's three cases, as the box says them before it is pressed", () => {
    // 600 the inspection, 400 of repairs left: the plan pays 400, the customer 200, 0 is left.
    expect(stormOfferLines(offer())).toEqual([
      "The storm inspection this plan includes is used for this plan year.",
      "This one is billed at the price of one inspection: $600.00.",
      "$400.00 of the plan's minor repairs goes toward it, which leaves $0.00 of minor repairs.",
      "The customer pays $200.00.",
      "Its invoice is made when the inspection is authorized.",
    ]);
    // 1,000 left: the plan pays all 600, the customer nothing, 400 is left.
    expect(
      stormOfferLines(offer({ allowance_left: 1000, plan_pays: 600, customer_pays: 0 })).slice(
        2,
        4,
      ),
    ).toEqual([
      "$600.00 of the plan's minor repairs goes toward it, which leaves $400.00 of minor repairs.",
      "The customer pays nothing more.",
    ]);
    // None left: the customer pays 600.
    expect(
      stormOfferLines(offer({ allowance_left: 0, plan_pays: 0, customer_pays: 600 })).slice(2, 4),
    ).toEqual([
      "Nothing is left of the plan's minor repairs this plan year.",
      "The customer pays $600.00.",
    ]);
  });
  it("a price that cannot be worked out stops it, and is never read as free", () => {
    const o = offer({ price: null });
    expect(o.price).toBeNull();
    expect(stormCanAdd(o)).toBe(false);
    expect(stormOfferLines(o)[1]).toContain("could not be worked out");
    expect(stormCanAdd(offer({ price: 0 }))).toBe(false);
    expect(readStormOffer({ billed: "yes" })).toBeNull();
  });
  it("a billed one is added only with the screen's confirmation", async () => {
    const calls: Record<string, unknown>[] = [];
    const env = fakeSupabase(
      {
        profiles: [
          { id: "u1", role: "user", access: ["service"], full_name: "Olive Office", email: "o@x" },
        ],
      },
      {
        rpcs: {
          roof_care_storm_offer: () => ({
            billed: true,
            included: 1,
            used: 1,
            billed_so_far: 0,
            price: 600,
            allowance_left: 400,
            plan_pays: 400,
            customer_pays: 200,
          }),
          roof_care_add_storm: (a: Record<string, unknown>) => {
            calls.push(a);
            return null;
          },
        },
      },
    );
    expect(await run(roofCareStormOffer, env.db, { plan_id: PLAN })).toMatchObject({
      billed: true,
      price: 600,
      customer_pays: 200,
    });
    await run(addRoofCareStorm, env.db, { plan_id: PLAN });
    await run(addRoofCareStorm, env.db, { plan_id: PLAN, billed_ok: true });
    expect(calls).toEqual([
      { p_plan: PLAN, p_billed_ok: false },
      { p_plan: PLAN, p_billed_ok: true },
    ]);
    // The screen: the button opens the box, and only the box's button adds anything.
    expect(CARD).toContain('onClick={() => setStorming(true)} data-action="roof-care-storm"');
    expect(CARD).not.toContain("storm.mutate(active.id)");
    expect(CARD).toContain(
      "mutationFn: (billed: boolean) => addFn({ data: { plan_id: plan.id, billed_ok: billed } })",
    );
    expect(CARD).toContain("disabled={!o || !stormCanAdd(o) || add.isPending}");
  });
  it("the database: included ones free, a further one at the price of one inspection, anyone in the office", () => {
    expect(SQL).toContain("drop function if exists public.roof_care_add_storm(uuid);");
    expect(SQL).toContain(
      "select count(*) filter (where v.amount = 0), count(*) filter (where v.amount > 0) into v_included, v_billed",
    );
    // Half of Roof Watch for this roof and drive: the same amount a renewal takes off.
    expect(SQL).toContain(
      "v_price := public.roof_care_price(p.roof_sqft, p.drive_hours, p.drive_miles);",
    );
    expect(SQL).toContain("v_one := round(v_watch / 2.0, 2);");
    expect(SQL).toContain(
      "'plan_pays', least(v_left, v_one), 'customer_pays', greatest(v_one - v_left, 0));",
    );
    // Never without the confirmation, and never at no price.
    expect(SQL).toContain("if not coalesce(p_billed_ok, false) then raise exception");
    expect(SQL).toContain("if v_amount is null or v_amount <= 0 then raise exception");
    // No manager needed any more: it is paid for.
    expect(SQL).not.toContain("A manager can add another");
    const add = SQL.slice(SQL.indexOf("create or replace function public.roof_care_add_storm"));
    expect(add.slice(0, add.indexOf("$function$;"))).not.toMatch(/is_admin|is_manager/);
    // No price is typed into the repository.
    expect(SQL).not.toMatch(/v_one := \d|v_amount := [1-9]/);
  });
  it("its invoice opens with the inspection at its price, in words that say it is a further one", () => {
    const own = carePlanOwnLine({
      id: STORM,
      kind: "storm",
      amount: 600,
      plan: "guard",
      paid_first: true,
    });
    expect(own).toMatchObject({
      description: "Roof Guard plan: further storm inspection this plan year",
      rate: 600,
      total: 600,
      source: carePlanLineSource(STORM),
    });
    // One the plan includes reads as before.
    expect(carePlanLineWords("guard", "storm", true)).toBe(
      "Roof Guard plan: storm inspection (included in the plan)",
    );
    expect(
      billsItself({ id: STORM, kind: "storm", amount: 600, plan: "guard", paid_first: true }),
    ).toBe(true);
  });

  // The allowance on the storm inspection's invoice: allowance 300, the inspection 220.
  const tables = (
    used: number,
    extra: Record<string, unknown>[] = [],
    visit: Record<string, unknown> = {},
  ) => ({
    service_jobs: [{ id: JOB, site_id: SITE, roof_care_visit_id: STORM }],
    roof_care_visits: [{ id: STORM, kind: "storm", amount: 220, plan_id: PLAN, ...visit }],
    roof_care_plans: [
      { id: PLAN, plan: "guard", status: "active", site_id: SITE, repair_allowance: 300 },
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
        source: carePlanLineSource(STORM),
        total: 220,
        rate: 220,
        taxable: false,
        cost_total: 0,
      },
      ...(used > 0
        ? [
            {
              id: 2,
              invoice_id: "other",
              sort: 0,
              source: allowanceLineSource(PLAN),
              total: -used,
              rate: -used,
            },
          ]
        : []),
      ...extra,
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
  it("what is left of the minor repairs goes toward it: some left, all of it covered, none left", async () => {
    // 120 used elsewhere: 180 left, the plan pays 180 and the customer 40.
    expect(await where(tables(120))).toMatchObject({
      left: 180,
      billable: 220,
      cap: 180,
      storm: true,
    });
    // Nothing used: the plan pays all 220, and 80 is left.
    expect(await where(tables(0))).toMatchObject({ left: 300, cap: 220 });
    // All used: the customer pays 220.
    expect(await where(tables(300))).toMatchObject({ left: 0, cap: 0 });
  });
  // (Nov 20, the owner: "it comes out of the allocation if there is allocation left". Until then
  // this read "toward the inspection only: never a return trip on the same invoice", with
  // billable 220. A charged return trip now takes what is left too:
  // roof-care-trip-allowance-nov20.test.ts.)
  it("toward the inspection and a return trip on the same invoice", async () => {
    const trip = {
      id: 3,
      invoice_id: INV,
      sort: 1,
      source: tripLineSource(NA2),
      total: 137.5,
      rate: 137.5,
      taxable: false,
      cost_total: 0,
    };
    expect(await where(tables(0, [trip]))).toMatchObject({
      billable: 357.5,
      cap: 300,
      storm: true,
      trip: true,
    });
  });
  it("a storm inspection the plan includes, and the plan's two inspections, take nothing", async () => {
    expect(await where(tables(0, [], { amount: 0 }))).toBeNull();
    expect(await where(tables(0, [], { kind: "visit1" }))).toBeNull();
  });
  it("the line is put on by itself, in words the customer can read, and the tally counts it", async () => {
    const t = tables(120);
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
      total: -180,
      description: "Roof Guard plan: your minor repairs amount used toward this inspection",
    });
    expect(env.tables["invoices"]![0]).toMatchObject({ total: 40, care_allowance_choice: "auto" });
    expect(allowanceLineWords("guard")).toBe(
      "Roof Guard plan: minor repairs included in your plan",
    );
  });
  it("the plan's tally tells the included one from the billed one", () => {
    const plan = {
      plan: "guard",
      visits: [
        { kind: "storm", amount: 0, lost_on: null, ticket: null, due_by: "2027-06-01" },
        { kind: "storm", amount: 600, lost_on: null, ticket: null, due_by: "2027-08-01" },
      ],
      repair_allowance: 0,
      allowance_used: null,
      free_travel_calls: 0,
      free_travel_used: null,
    } as unknown as RoofCarePlan;
    const row = (p: RoofCarePlan) =>
      benefitsUsed(p, "2027-05-01", 1).find((r) => r.key === "storm");
    expect(row(plan)).toMatchObject({
      label: "Storm inspections",
      used: 1,
      of: 1,
      words: "1 of 1 used, and 1 more billed",
    });
    expect(row({ ...plan, visits: plan.visits.slice(0, 1) })).toMatchObject({
      label: "Storm inspection",
      words: "1 of 1 used",
    });
  });
  it("a refund counts only a storm inspection the plan included as an inspection done", () => {
    expect(SQL).toContain("count(*) filter (where v.kind = 'storm' and v.amount = 0)");
  });
});

/**
 * Roof Care, Nov 23: three go-aheads from the owner ("for new issues go on 1, 2(credit only
 * applies to work done after plans starts) ... 5 30 days is good").
 *
 *  1. Every ended plan of a property whose refund is owed and not yet marked sent has its own
 *     refund line on the card, named. Before, only the property's current plan's could be
 *     reached.
 *  2. A plan gives its minor repairs credit and Roof Guard's leak call only to work dated from
 *     the first day of its year to the last. Before, a plan in force also covered work dated
 *     before it started. A plan that ended because it was renewed runs to its year's last day,
 *     so the days between an early renewal and the new year are still the old year's.
 *  3. A plan that renews by itself may charge a new price only when the customer was told it at
 *     least 30 days before the renewal day.
 *
 * Every dollar figure here is made up and matches no plan price or allowance.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PLAN_ENDED_RENEWED,
  PLAN_WORK_OUTSIDE,
  ownInspectionDay,
  planCoversDay,
  planFirstDay,
  planForWork,
  planHoldsDay,
  planLastDay,
  planLinesChangeWords,
  type PlanYear,
} from "@/lib/roof-care-allowance";
import {
  AUTO_RENEW_NOTICE_DAYS,
  autoRenewCharge,
  autoRenewTellBy,
  autoRenewToldInTime,
  otherRefundsOwed,
  refundPlanWords,
  type PlanRefund,
} from "@/lib/roof-care-plan";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const MIGRATION = "supabase/migrations/20261123100000_roof_care_credit_from_the_first_day.sql";

// ── 2. Credit only for work done from the day the plan starts ───────────────────────────────

describe("2. a plan pays only toward work done from its first day to its last", () => {
  const plan: PlanYear & { id: string } = {
    id: "p",
    status: "active",
    starts_on: "2027-03-10",
    signed_on: "2027-03-01",
    renews_on: "2028-03-10",
  };
  it("the owner's example: a repair on Mar 3, the plan starts Mar 10, invoiced Mar 12", () => {
    // The invoice's own day does not matter: the work's day does.
    expect(planCoversDay(plan, "2027-03-03")).toBe(false);
    expect(planForWork([plan], "2027-03-03")).toBeNull();
  });
  it("the first day, any day inside, and the last day are covered; the day after is not", () => {
    for (const day of ["2027-03-10", "2027-07-04", "2028-03-10"]) {
      expect(planCoversDay(plan, day)).toBe(true);
      expect(planForWork([plan], day)).toBe(plan);
    }
    expect(planCoversDay(plan, "2028-03-11")).toBe(false);
  });
  it("the day it was signed counts only for an older plan with no start on record", () => {
    // Signed Mar 1, paid and started Mar 10: the days between are not the plan's.
    expect(planCoversDay(plan, "2027-03-05")).toBe(false);
    const older = { ...plan, starts_on: null };
    expect(planFirstDay(older)).toBe("2027-03-01");
    expect(planCoversDay(older, "2027-03-05")).toBe(true);
    expect(planCoversDay(older, "2027-02-28")).toBe(false);
  });
  it("an older plan in force with no last day covers from its first day on", () => {
    const open = { ...plan, renews_on: null };
    expect(planCoversDay(open, "2031-01-01")).toBe(true);
    expect(planCoversDay(open, "2027-03-09")).toBe(false);
  });
  it("a plan waiting for its payment covers nothing; an ended one only its own year", () => {
    expect(planCoversDay({ ...plan, status: "awaiting_payment" }, "2027-07-04")).toBe(false);
    const ended = { ...plan, status: "ended", ended_on: "2027-09-01", ended_reason: "Sold" };
    expect(planLastDay(ended)).toBe("2027-09-01");
    expect(planCoversDay(ended, "2027-08-31")).toBe(true);
    expect(planCoversDay(ended, "2027-09-02")).toBe(false);
    expect(planCoversDay(ended, "2027-03-09")).toBe(false);
  });

  describe("a renewal paid early: the days in between are still the old year's", () => {
    // Last year ran Dec 20, 2026 to Dec 20, 2027. The renewal was paid Nov 20, 2027: it is in
    // force at once, and its year is dated from the old year's last day.
    const old: PlanYear & { id: string } = {
      id: "old",
      status: "ended",
      starts_on: "2026-12-20",
      signed_on: "2026-12-20",
      renews_on: "2027-12-20",
      ended_on: "2027-11-20",
      ended_reason: PLAN_ENDED_RENEWED,
    };
    const next: PlanYear & { id: string } = {
      id: "new",
      status: "active",
      starts_on: "2027-12-20",
      signed_on: "2027-11-20",
      renews_on: "2028-12-20",
    };
    it("a plan that ended because it was renewed runs to its year's last day", () => {
      expect(planLastDay(old)).toBe("2027-12-20");
      expect(planHoldsDay(old, "2027-12-05")).toBe(true);
      // One ended for any other reason stops the day it ended.
      expect(planLastDay({ ...old, ended_reason: "Sold the building" })).toBe("2027-11-20");
      expect(planLastDay({ ...old, ended_reason: null })).toBe("2027-11-20");
    });
    it("work in the gap is the OLD plan's, never the new one's and never nobody's", () => {
      expect(planCoversDay(next, "2027-12-05")).toBe(false);
      expect(planForWork([next, old], "2027-12-05")?.id).toBe("old");
      expect(planForWork([old, next], "2027-11-21")?.id).toBe("old");
    });
    it("the shared day is the new year's, and so is every day after", () => {
      expect(planForWork([old, next], "2027-12-20")?.id).toBe("new");
      expect(planForWork([old, next], "2028-06-01")?.id).toBe("new");
      expect(planForWork([old, next], "2028-12-21")).toBeNull();
    });
    it("work dated before the old plan started gets nothing of either", () => {
      expect(planForWork([old, next], "2026-12-19")).toBeNull();
    });
  });

  describe("a plan inspection's own ticket is that plan's work", () => {
    const next: PlanYear = {
      status: "active",
      starts_on: "2027-12-20",
      signed_on: "2027-11-20",
      renews_on: "2028-12-20",
    };
    it("done a few days ahead of the year, it is counted as the year's first day", () => {
      expect(ownInspectionDay(next, "2027-12-05")).toBe("2027-12-20");
      expect(planCoversDay(next, ownInspectionDay(next, "2027-12-05"))).toBe(true);
    });
    it("a day inside the year is left as it is, and one after the last day still is not covered", () => {
      expect(ownInspectionDay(next, "2028-04-01")).toBe("2028-04-01");
      expect(planCoversDay(next, ownInspectionDay(next, "2028-12-21"))).toBe(false);
    });
    it("the server asks it so for the plan's own inspection, and only there", () => {
      const fn = flat(read("src/lib/roof-care-allowance.functions.ts"));
      expect(fn).toContain(
        "if (ownPlan) return planForWork(list, list[0] ? ownInspectionDay(list[0], day) : day);",
      );
      expect(fn).toContain("return planForWork(list, day);");
      expect(fn).toContain(
        "return !planCoversDay(plan, job.roof_care_visit_id ? ownInspectionDay(plan, day) : day);",
      );
      // The reason a plan ended is read with it: "Renewed" decides the last day.
      expect(fn).toContain("renews_on, ended_on, ended_reason, refund_due,");
    });
  });

  describe("a draft that carried credit for work now outside the plan's year", () => {
    it("is told why in plain words when the credit comes off", () => {
      expect(
        planLinesChangeWords(
          { credit: 120, travel: 0, total: 180 },
          { credit: 0, travel: 0, total: 300 },
          { outside: true },
        ),
      ).toContain(PLAN_WORK_OUTSIDE);
      expect(PLAN_WORK_OUTSIDE).toBe(
        "This ticket's work is dated outside the plan's year, before its first day or after its last. A plan pays only toward work done from the day it starts to its last day.",
      );
    });
    it("the travel is charged again with the same reason, said once", () => {
      const both = planLinesChangeWords(
        { credit: 120, travel: 45, total: 135 },
        { credit: 0, travel: 0, total: 300 },
        { outside: true },
      )!;
      expect(both.split(PLAN_WORK_OUTSIDE)).toHaveLength(2);
      expect(both).toContain("The travel on this invoice, $45.00, is charged again.");
      const travelOnly = planLinesChangeWords(
        { credit: 0, travel: 45, total: 255 },
        { credit: 0, travel: 0, total: 300 },
        { outside: true },
      )!;
      expect(travelOnly).toContain(PLAN_WORK_OUTSIDE);
    });
    it("a credit that only shrank keeps its own reason", () => {
      expect(
        planLinesChangeWords(
          { credit: 120, travel: 0, total: 180 },
          { credit: 80, travel: 0, total: 220 },
          { left: 80, outside: false },
        ),
      ).toContain("Another invoice of this plan used part of the minor repairs amount first.");
    });
    it("the re-work says the work is outside when no plan covers its day", () => {
      expect(flat(read("src/lib/roof-care-allowance.functions.ts"))).toContain("outside: !where,");
    });
  });

  describe("the database holds the same rule", () => {
    const sql = read(MIGRATION);
    const covers = flat(
      sql.slice(
        sql.indexOf("create or replace function public.roof_care_plan_covers("),
        sql.indexOf("revoke all on function public.roof_care_plan_covers("),
      ),
    );
    const rule = flat(
      sql.slice(sql.indexOf("create or replace function public.invoice_lines_care_rule()")),
    );
    it("no plan covers a day before its first day, in force or ended", () => {
      expect(covers).toContain("when p.status not in ('active', 'ended') then false");
      expect(covers).toContain("when p_day < coalesce(p.starts_on, p.signed_on) then false");
      expect(
        covers.indexOf("when p_day < coalesce(p.starts_on, p.signed_on) then false"),
      ).toBeLessThan(covers.indexOf("when p.status = 'active' then"));
    });
    it("a plan ended as Renewed runs to its year's last day; any other to the day it ended", () => {
      expect(covers).toContain(
        "when p.ended_reason = 'Renewed' then p.renews_on is not null and p_day <= p.renews_on",
      );
      expect(covers).toContain(
        "else p.renews_on is not null and p_day <= least(coalesce(p.ended_on, p.renews_on), p.renews_on)",
      );
    });
    it("the plan's own inspection is never counted as before its year", () => {
      expect(rule).toContain(
        "if v_visit is not null and v_first is not null and v_day < v_first then v_day := v_first; end if;",
      );
    });
    it("the refusal says the work is before the plan started, with both days", () => {
      expect(rule).toContain(
        "raise exception 'This ticket''s work is dated %, before the Roof Care plan started (%). A plan pays only toward work done from the day it starts. Nothing of the plan can come off this invoice.',",
      );
      // The two refusals for work after the last day are kept.
      expect(rule).toContain("outside the plan''s year (it ran to %)");
      expect(rule).toContain("after the Roof Care plan''s last day (%)");
    });
    it("neither function can be called by a signed-in person", () => {
      expect(sql).toContain(
        "revoke all on function public.roof_care_plan_covers(uuid, date) from public, anon, authenticated;",
      );
      expect(sql).toContain(
        "revoke all on function public.invoice_lines_care_rule() from public, anon, authenticated;",
      );
    });
  });
});

// ── 1. The refund line of every ended plan with a refund owed ────────────────────────────────

describe("1. every ended plan with a refund owed has its own line on the card", () => {
  const refund = (due: number, sent: string | null = null): PlanRefund => ({
    due,
    sent_on: sent,
    ref: sent ? "check 2001" : null,
  });
  const plans = [
    { id: "now", status: "active" as const, refund: null, ended_on: null },
    { id: "b", status: "ended" as const, refund: refund(310), ended_on: "2027-06-02" },
    { id: "a", status: "ended" as const, refund: refund(95.5), ended_on: "2026-09-14" },
    {
      id: "sent",
      status: "ended" as const,
      refund: refund(240, "2027-01-05"),
      ended_on: "2026-12-01",
    },
    { id: "zero", status: "ended" as const, refund: refund(0), ended_on: "2026-11-01" },
    { id: "none", status: "ended" as const, refund: null, ended_on: "2026-10-01" },
  ];
  it("lists the owed ones of the other plans, oldest first", () => {
    expect(otherRefundsOwed(plans, "now").map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("one already sent, changed to nothing, or never owed is not listed", () => {
    const ids = otherRefundsOwed(plans, "now").map((p) => p.id);
    for (const id of ["sent", "zero", "none", "now"]) expect(ids).not.toContain(id);
  });
  it("the current plan's own refund is not listed twice", () => {
    expect(otherRefundsOwed(plans, "b").map((p) => p.id)).toEqual(["a"]);
    expect(otherRefundsOwed([], "b")).toEqual([]);
  });
  it("each line says which plan and year it is for", () => {
    expect(
      refundPlanWords({
        plan: "care",
        plan_number: 1004,
        starts_on: "2026-03-10",
        signed_on: "2026-03-02",
        renews_on: "2027-03-10",
        ended_on: "2026-06-02",
      }),
    ).toBe("Roof Care plan RC-1004, Mar 10, 2026 to Mar 10, 2027, ended Jun 2, 2026");
    // An older plan with no number and no start on record.
    expect(
      refundPlanWords({
        plan: "guard",
        plan_number: null,
        starts_on: null,
        signed_on: "2026-01-15",
        renews_on: "2027-01-15",
        ended_on: null,
      }),
    ).toBe("Roof Guard plan, Jan 15, 2026 to Jan 15, 2027");
  });
  it("the card draws one named line per older plan, with the same buttons", () => {
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain(
      "{otherRefundsOwed(q.data, plan.id).map((p) => ( <RefundOwed key={p.id} siteId={siteId} plan={p} manager={manager} label={refundPlanWords(p)} /> ))}",
    );
    expect(card).toContain("data-refund-plan={plan.id}");
    expect(card).toContain(
      '{label && ( <p className="font-medium" data-refund-for> {label} </p> )}',
    );
    // The same component: "Mark the refund sent" and a manager's "Change refund" act on the
    // plan the line is for.
    expect(card).toContain(
      "sentFn({ data: { plan_id: plan.id, on: easternYmd(), ref: ref.trim() } })",
    );
    expect(card).toContain('data-action="roof-care-refund-change"');
  });
  it("the Needs attention row for a refund owed opens the property, where the line is", () => {
    const rows = flat(read("src/lib/owner-attention.ts"));
    const at = rows.indexOf('kind: "care_plan_refund"');
    expect(at).toBeGreaterThan(-1);
    expect(rows.slice(at, at + 700)).toContain("href: `/properties/${v.site_id}`");
  });
});

// ── 3. Auto renew: told at least 30 days before ─────────────────────────────────────────────

describe("3. a new price counts only when told at least 30 days before the renewal day", () => {
  const renews = "2027-11-20";
  it("30 days is the rule", () => {
    expect(AUTO_RENEW_NOTICE_DAYS).toBe(30);
    expect(autoRenewTellBy(renews)).toBe("2027-10-21");
  });
  it("told exactly 30 days before: the new price is charged", () => {
    expect(autoRenewToldInTime("2027-10-21", renews)).toBe(true);
    expect(autoRenewCharge(2040, 2310, { price: 2310, on: "2027-10-21" }, renews)).toEqual({
      charge: 2310,
      held: false,
    });
  });
  it("told 29 days before: the price they last agreed to is charged", () => {
    expect(autoRenewToldInTime("2027-10-22", renews)).toBe(false);
    expect(autoRenewCharge(2040, 2310, { price: 2310, on: "2027-10-22" }, renews)).toEqual({
      charge: 2040,
      held: true,
    });
  });
  it("told the day before, on the day or after: not in time", () => {
    for (const on of ["2027-11-19", "2027-11-20", "2027-11-24"])
      expect(autoRenewCharge(2040, 2310, { price: 2310, on }, renews)).toEqual({
        charge: 2040,
        held: true,
      });
  });
  it("told in time, and never more than the price they were told", () => {
    expect(autoRenewCharge(2040, 2500, { price: 2310, on: "2027-09-01" }, renews)).toEqual({
      charge: 2310,
      held: true,
    });
  });
  it("a price that did not go up needs no telling", () => {
    expect(autoRenewCharge(2040, 1980, null, renews)).toEqual({ charge: 1980, held: false });
  });
  it("the plan notes carry the rule with the owner's words", () => {
    const doc = read("docs/roof-care-plans.md");
    expect(doc).toContain("## Decided on Nov 23");
    expect(doc).toContain("30 days is good");
    expect(doc).toContain("credit only applies to work done after plans starts");
  });
});

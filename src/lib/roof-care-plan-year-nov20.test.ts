/**
 * Roof Care, the break test's numbers 3, 5 and 6 (owner, Nov 20: "go with 3, 5, 6";
 * docs/qa/roof-care-draft-credit-2026-11-20.md).
 *
 * 3. One rule for what a plan gives on an invoice, the minor repairs credit and Roof Guard's
 *    leak call alike: work dated inside the plan's year gets it, whenever the invoice is made,
 *    also after the plan has ended; work dated after the plan's last day gets nothing; the
 *    office can always untick. A refund is never handed back twice.
 * 5. A return trip's line stays the office's to price. The plan's credit pays toward the trip
 *    no more than the trip was worked out at.
 * 6. Every invoice of a plan inspection's ticket leaves the covered visit at no charge.
 *
 * THE NUMBERS HERE ARE MADE UP: they match no plan price, allowance or rate of the office.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  ALLOWANCE_NOT_HERE,
  allowanceLineSource,
  invoiceAllowance,
  officeDay,
  planAllowanceNow,
  planCoversDay,
  planForWork,
  planHoldsDay,
  planLastDay,
  planRefundSent,
  planTravelAtRefund,
  tripWorkedOutWords,
  workDay,
  type PlanYear,
} from "@/lib/roof-care-allowance";
import {
  getInvoiceTripCharges,
  invoiceAllowanceOf,
  planLineOutside,
  setInvoiceAllowance,
  syncAllowance,
} from "@/lib/roof-care-allowance.functions";
import { carePlanCovered, carePlanFurtherLines } from "@/lib/roof-care-invoice";
import { tripLineSource } from "@/lib/roof-care-no-access";
import { carePlanLineSource } from "@/lib/roof-care-plan";
import { travelLineSource } from "@/lib/roof-care-travel";
import { invoiceTravelOf, syncPlanLines } from "@/lib/roof-care-travel.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");
const SQL = flat("supabase/migrations/20261120800000_roof_care_plan_year_and_trip_cover.sql");

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAN = "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e11";
const NEXT = "8c2f0a1f-7a1d-4b4f-8e6a-3a7d2c0b5f22";
const JOB = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const SITE = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c";
const INV = "7c8d9e0f-1a2b-4c3d-8e5f-6a7b8c9d0e1f";
const OTHER = "8d9e0f1a-2b3c-4d4e-9f6a-7b8c9d0e1f2a";
const VISIT = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const NA = "6b7c8d9e-0f1a-4b2c-9d4e-5f6a7b8c9d0e";

type Row = Record<string, unknown>;

/** The owner's example: a plan that ran Jan 1 to Dec 31, 2026 and has ended. */
const year2026 = (over: Row = {}): Row => ({
  id: PLAN,
  plan: "guard",
  site_id: SITE,
  status: "ended",
  starts_on: "2026-01-01",
  signed_on: "2025-12-28",
  renews_on: "2026-12-31",
  ended_on: "2026-12-31",
  repair_allowance: 740,
  free_travel_calls: 2,
  refund_due: null,
  refund_sent_on: null,
  refund_worked: null,
  ...over,
});

/** The same plan, as the pure rules read it. */
const py = (over: Row = {}) => year2026(over) as unknown as PlanYear & { id: string };

/** A repair at the plan's property: 60 of travel and 700 of work, done on `done`. */
function world(
  o: {
    done?: string | null;
    plans?: Row[];
    credit?: number;
    waived?: number;
    choice?: string | null;
    otherCredit?: number;
  } = {},
) {
  const credit = o.credit ?? 0;
  const waived = o.waived ?? 0;
  const lines: Row[] = [
    { id: 1, invoice_id: INV, sort: 0, kind: "travel", source: "time:t1", total: 60 },
    { id: 2, invoice_id: INV, sort: 1, kind: "labor", source: "time:t2", total: 700 },
  ];
  if (waived > 0)
    lines.push({
      id: 3,
      invoice_id: INV,
      sort: 2,
      kind: "other",
      source: travelLineSource(PLAN),
      total: -waived,
    });
  if (credit > 0)
    lines.push({
      id: 4,
      invoice_id: INV,
      sort: 3,
      kind: "other",
      source: allowanceLineSource(PLAN),
      total: -credit,
    });
  const invoices: Row[] = [
    {
      id: INV,
      service_job_id: JOB,
      bill_to_vendor_id: null,
      status: "draft",
      tax_rate: 0,
      total: 760 - waived - credit,
      care_allowance_choice: o.choice === undefined ? (credit > 0 ? "auto" : null) : o.choice,
      care_allowance_plan_id: credit > 0 ? PLAN : null,
      care_travel_choice: waived > 0 ? "auto" : null,
    },
  ];
  if ((o.otherCredit ?? 0) > 0) {
    invoices.push({ id: OTHER, status: "final", service_job_id: "other-job" });
    lines.push({
      id: 50,
      invoice_id: OTHER,
      sort: 0,
      kind: "other",
      source: allowanceLineSource(PLAN),
      total: -(o.otherCredit ?? 0),
    });
  }
  return fakeSupabase({
    profiles: [{ id: ME, role: "manager", access: [], technician: false, full_name: "Mo" }],
    service_jobs: [
      {
        id: JOB,
        site_id: SITE,
        roof_care_visit_id: null,
        completed_at: o.done === undefined ? "2026-12-10T17:00:00Z" : o.done,
        on_site_at: null,
        scheduled_date: null,
      },
    ],
    roof_care_plans: o.plans ?? [year2026()],
    invoices,
    invoice_lines: lines,
  });
}
type Env = ReturnType<typeof world>;
const invOf = (env: Env) => env.tables["invoices"]!.find((i) => i["id"] === INV)!;
const mine = (env: Env) => env.tables["invoice_lines"]!.filter((l) => l["invoice_id"] === INV);
const creditOf = (env: Env) =>
  mine(env)
    .filter((l) => l["source"] === allowanceLineSource(PLAN))
    .map((l) => Number(l["total"]));
const waivedOf = (env: Env) =>
  mine(env)
    .filter((l) => l["source"] === travelLineSource(PLAN))
    .map((l) => Number(l["total"]));
const where = (env: Env) => invoiceAllowanceOf(env.db, invOf(env) as never, mine(env) as never);
const travel = (env: Env) => invoiceTravelOf(env.db, invOf(env) as never, mine(env) as never);
const sync = (env: Env) => syncPlanLines(env.db, invOf(env) as never, mine(env) as never);
const call = <T>(fn: unknown, env: Env, data: unknown) =>
  (fn as (a: { data: unknown; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId: ME },
  });

describe("3. the work's date, and the plan it belongs to", () => {
  it("the work's date is the ticket's: completed, else on site, else scheduled, else today", () => {
    const today = "2027-01-05";
    expect(workDay({ completed_at: "2026-12-10T17:00:00Z" }, today)).toEqual({
      day: "2026-12-10",
      from: "completed",
    });
    expect(
      workDay({ on_site_at: "2026-12-09T15:00:00Z", scheduled_date: "2026-12-08" }, today),
    ).toEqual({ day: "2026-12-09", from: "on_site" });
    expect(workDay({ scheduled_date: "2026-12-08" }, today)).toEqual({
      day: "2026-12-08",
      from: "scheduled",
    });
    expect(workDay({}, today)).toEqual({ day: today, from: "today" });
    // The office's day, not the clock in London: 2 AM UTC on Jan 1 is still Dec 31 here.
    expect(officeDay("2027-01-01T02:00:00Z")).toBe("2026-12-31");
  });

  it("a plan that has ended covers work dated inside its year and nothing else", () => {
    const p = py();
    expect(planHoldsDay(p, "2026-01-01")).toBe(true);
    expect(planCoversDay(p, "2026-12-10")).toBe(true);
    expect(planCoversDay(p, "2026-12-31")).toBe(true);
    expect(planCoversDay(p, "2027-01-01")).toBe(false);
    expect(planCoversDay(p, "2025-12-31")).toBe(false);
    // Ended early: its last day is the day it ended.
    const early = py({ ended_on: "2026-06-30" });
    expect(planLastDay(early)).toBe("2026-06-30");
    expect(planCoversDay(early, "2026-06-30")).toBe(true);
    expect(planCoversDay(early, "2026-07-01")).toBe(false);
  });

  it("a plan in force covers work up to its last day; one not yet paid covers nothing", () => {
    const p = py({ status: "active", ended_on: null });
    expect(planCoversDay(p, "2026-12-31")).toBe(true);
    expect(planCoversDay(p, "2027-01-01")).toBe(false);
    // Nov 23 (owner: "credit only applies to work done after plans starts"): work dated before
    // the plan started is no longer covered while it is in force. This line said true before.
    expect(planCoversDay(p, "2025-12-20")).toBe(false);
    expect(planCoversDay(py({ status: "awaiting_payment" }), "2026-06-01")).toBe(false);
  });

  it("after a renewal, last year's work belongs to last year's plan", () => {
    const old = py();
    const next = py({
      id: NEXT,
      status: "active",
      starts_on: "2027-01-01",
      renews_on: "2027-12-31",
      ended_on: null,
    });
    expect(planForWork([next, old], "2026-12-10")?.id).toBe(PLAN);
    expect(planForWork([next, old], "2027-01-05")?.id).toBe(NEXT);
    expect(planForWork([old], "2027-01-05")).toBeNull();
  });
});

describe("3. the owner's example: plan Jan 1 to Dec 31, repair done Dec 10, invoiced after", () => {
  it("the credit applies, though the plan has ended", async () => {
    const a = await where(world());
    expect(a).toMatchObject({ plan_id: PLAN, allowance: 740, left: 740, billable: 760, cap: 740 });
  });

  it("the leak call's travel comes off by the same rule", async () => {
    expect(await travel(world())).toMatchObject({ plan_id: PLAN, calls: 2, travel: 60 });
    const env = world();
    expect(await sync(env)).toBe(true);
    expect(waivedOf(env)).toEqual([-60]);
    // The credit then covers the 700 still charged.
    expect(creditOf(env)).toEqual([-700]);
    expect(invOf(env)).toMatchObject({ total: 0, care_allowance_choice: "auto" });
  });

  it("the office can untick the credit, as on any invoice", async () => {
    const env = world({ credit: 740 });
    await call(setInvoiceAllowance, env, { id: INV, choice: "declined" });
    expect(creditOf(env)).toEqual([]);
    expect(invOf(env)).toMatchObject({ care_allowance_choice: "declined", total: 760 });
    // And it stays off when the plan's lines are worked out again.
    await sync(env);
    expect(creditOf(env)).toEqual([]);
  });

  it("work dated after the plan's last day gets nothing of it: neither line", async () => {
    const env = world({ done: "2027-01-04T17:00:00Z" });
    expect(await where(env)).toBeNull();
    expect(await travel(env)).toBeNull();
    expect(await sync(env)).toBe(false);
    expect(env.writes).toEqual([]);
  });

  it("a line left on an invoice for work outside the year comes off, both of them", async () => {
    const env = world({ done: "2027-01-04T17:00:00Z", credit: 700, waived: 60 });
    expect(await planLineOutside(env.db, JOB, PLAN)).toBe(true);
    expect(await sync(env)).toBe(true);
    expect(creditOf(env)).toEqual([]);
    expect(waivedOf(env)).toEqual([]);
    expect(invOf(env)).toMatchObject({
      total: 760,
      care_allowance_choice: null,
      care_travel_choice: null,
    });
  });

  it("a plan this person cannot read takes nothing away on a guess", async () => {
    const env = world({ done: "2027-01-04T17:00:00Z", credit: 700, plans: [] });
    expect(await planLineOutside(env.db, JOB, PLAN)).toBe(false);
    expect(await syncAllowance(env.db, invOf(env) as never, mine(env) as never)).toBe(false);
    expect(creditOf(env)).toEqual([-700]);
    // "Does not use the plan" is still the office's to say on it, and it comes off.
    await call(setInvoiceAllowance, env, { id: INV, choice: "declined" });
    expect(creditOf(env)).toEqual([]);
    expect(invOf(env)["care_allowance_choice"]).toBe("declined");
    // Using a plan that does not cover the work is refused, as it was.
    await expect(call(setInvoiceAllowance, env, { id: INV, choice: "applied" })).rejects.toThrow(
      ALLOWANCE_NOT_HERE,
    );
  });

  it("a rebuild carries the credit by the same rule, and the leak call follows it", () => {
    const f = flat("src/lib/invoices.functions.ts");
    expect(f).toContain(
      "if (where) allowanceKept = Math.min(allowanceAfterChange(taken, where.billable), where.left); else if (!(await planLineOutside(sb, inv.service_job_id, allowancePlanOf(allowanceOld[0]!)))) allowanceKept = allowanceAfterChange(taken, billableBefore(lines));",
    );
    // The leak call's line is put back after the rebuild by the rule the credit asks.
    const t = flat("src/lib/roof-care-travel.functions.ts");
    expect(t).toContain("const plan = await planOfWork(sb, job);");
    expect(t).not.toContain('.eq("status", "active")');
    expect(flat("src/lib/roof-care-allowance.functions.ts")).not.toContain(
      '.eq("status", "active")',
    );
  });
});

describe("3. a refund is never handed back twice", () => {
  // The plan was ended early on Jun 30 with a refund worked: it counted 150 of minor repairs.
  const early = (over: Row = {}) =>
    year2026({
      ended_on: "2026-06-30",
      refund_due: 200,
      refund_worked: { repairs: 150, travel: 0, confirmed: 200 },
      ...over,
    });

  it("once the refund is sent, the plan gives no more than the refund counted", async () => {
    const sent = early({ refund_sent_on: "2026-07-10" });
    expect(planRefundSent(sent as never)).toBe(true);
    expect(planAllowanceNow(sent as never)).toBe(150);
    expect(planTravelAtRefund(sent as never)).toBe(0);
    // An invoice for work of June 10, made after: the 150 is on another invoice, so nothing.
    const env = world({ done: "2026-06-10T17:00:00Z", plans: [sent], otherCredit: 150 });
    expect(await where(env)).toMatchObject({ allowance: 150, left: 0, cap: 0 });
    expect(await travel(env)).toBeNull();
    expect(await sync(env)).toBe(false);
    expect(creditOf(env)).toEqual([]);
    // The invoice that held the 150 when the refund was worked keeps it.
    const held = world({ done: "2026-06-10T17:00:00Z", plans: [sent], credit: 150 });
    expect(await where(held)).toMatchObject({ left: 150, applied: 150 });
    expect(await sync(held)).toBe(false);
    expect(creditOf(held)).toEqual([-150]);
  });

  it("while it is not sent, the credit is given and the database lowers the refund owed", async () => {
    const env = world({ done: "2026-06-10T17:00:00Z", plans: [early()], otherCredit: 150 });
    expect(planRefundSent(early() as never)).toBe(false);
    expect(await where(env)).toMatchObject({ allowance: 740, left: 590, cap: 590 });
    // The refund owed is what it would be with nothing given after, less what was given after,
    // and never under nothing. Worked from what stands now, so taking a credit off puts it back.
    expect(SQL).toContain("v_after := greatest(round(v_now - v_then, 2), 0);");
    expect(SQL).toContain(
      "v_lowered := coalesce((p.refund_worked->>'lowered')::numeric, 0); v_base := p.refund_due + v_lowered; v_new := least(v_after, v_base);",
    );
    expect(SQL).toContain("set refund_due = round(v_base - v_new, 2),");
    // A refund that is sent is never moved: the line is refused instead.
    expect(SQL).toContain(
      "if not found or p.status <> 'ended' or p.refund_sent_on is not null or p.refund_due is null or p.refund_worked is null then return; end if;",
    );
    expect(SQL).toContain(
      "create trigger invoice_lines_refund_step after insert or update or delete on public.invoice_lines for each row execute function public.invoice_lines_refund_step();",
    );
    expect(SQL).toContain(
      "create trigger invoices_refund_step after update of status on public.invoices for each row execute function public.invoices_refund_step();",
    );
  });
});

describe("3. what the database lets through, and what it still refuses", () => {
  it("the work's date and the plan's year are the same rule as the site's", () => {
    expect(SQL).toContain(
      "select coalesce( (j.completed_at at time zone 'America/New_York')::date, (j.on_site_at at time zone 'America/New_York')::date, j.scheduled_date, (now() at time zone 'America/New_York')::date) from public.service_jobs j where j.id = p_job;",
    );
    expect(SQL).toContain(
      "when p.status = 'active' then p.renews_on is null or p_day <= p.renews_on when p.status = 'ended' then coalesce(p.starts_on, p.signed_on) is not null and p.renews_on is not null and p_day >= coalesce(p.starts_on, p.signed_on) and p_day <= least(coalesce(p.ended_on, p.renews_on), p.renews_on) else false end",
    );
  });

  it("an ended plan's line is let through only for work dated inside its year", () => {
    expect(SQL).toContain(
      "v_day := public.roof_care_work_day(v_job); if not public.roof_care_plan_covers(v_plan, v_day) then",
    );
    expect(SQL).toContain(
      "raise exception 'This Roof Care plan has ended, and this ticket''s work is dated %, outside the plan''s year (it ran to %). Nothing of the plan can come off this invoice.',",
    );
    // What was refused before still is.
    expect(SQL).toContain(
      "raise exception 'This Roof Care plan is at another property. Nothing of it can come off this invoice.';",
    );
    expect(SQL).toContain(
      "raise exception 'This invoice is for a Roof Care plan''s own inspection. Only that plan''s lines can go on it.';",
    );
    expect(SQL).toContain(
      "raise exception 'This Roof Care plan is waiting for its payment, so it has not started. Nothing of it can come off an invoice yet.';",
    );
    expect(SQL).toContain(
      "raise exception 'Only $% of this plan''s minor repairs allowance is left.',",
    );
    expect(SQL).not.toContain("if v_plan_status <> 'active' then");
  });

  it("a sent refund closes the plan at what the refund counted", () => {
    expect(SQL).toContain(
      "v_closed := v_plan_status = 'ended' and v_sent is not null and v_due > 0; if v_closed then v_allow := least(v_allow, greatest(coalesce((v_worked->>'repairs')::numeric, 0), 0)); end if;",
    );
    expect(SQL).toContain(
      "raise exception 'This Roof Care plan ended and its refund was sent on %. No more of its leak calls can come off an invoice.',",
    );
  });
});

describe("5. a return trip's line stays editable; the credit pays the worked-out charge at most", () => {
  const TRIP = tripLineSource(NA);
  // The trip was worked out at 140. 300 of minor repairs is left.
  const stand = (typed: number) =>
    invoiceAllowance({
      plan_id: PLAN,
      plan: "care",
      allowance: 300,
      usedElsewhere: 0,
      lines: [
        { source: carePlanLineSource(VISIT), total: 0 },
        { source: TRIP, total: typed },
      ],
      choice: null,
      tripSources: [TRIP],
      tripCaps: { [TRIP]: 140 },
    });

  it("typed as worked out: the plan pays it all", () => {
    expect(stand(140)).toMatchObject({ billable: 140, cap: 140, trip: true });
  });
  it("typed higher: the plan still pays 140, and the rest is the customer's", () => {
    expect(stand(600)).toMatchObject({ billable: 140, cap: 140 });
  });
  it("typed lower: the plan pays the lower amount, as before", () => {
    expect(stand(90)).toMatchObject({ billable: 90, cap: 90 });
  });
  it("a trip with nothing worked out is not held, as before", () => {
    const a = invoiceAllowance({
      plan_id: PLAN,
      plan: "care",
      allowance: 300,
      usedElsewhere: 0,
      lines: [{ source: TRIP, total: 250 }],
      choice: null,
      tripSources: [TRIP],
      tripCaps: {},
    });
    expect(a.cap).toBe(250);
  });

  const tripWorld = (typed: number, credit = 0) =>
    fakeSupabase({
      profiles: [{ id: ME, role: "manager", access: [], technician: false, full_name: "Mo" }],
      service_jobs: [
        {
          id: JOB,
          site_id: SITE,
          roof_care_visit_id: VISIT,
          completed_at: "2026-06-10T17:00:00Z",
        },
      ],
      roof_care_visits: [{ id: VISIT, kind: "visit1", amount: 0, plan_id: PLAN }],
      roof_care_plans: [year2026({ status: "active", ended_on: null, plan: "care" })],
      roof_care_no_access: [{ id: NA, visit_id: VISIT, charged: true, amount: 140 }],
      invoices: [
        {
          id: INV,
          service_job_id: JOB,
          bill_to_vendor_id: null,
          status: "draft",
          tax_rate: 0,
          total: typed - credit,
          care_allowance_choice: credit > 0 ? "auto" : null,
          care_travel_choice: null,
        },
      ],
      invoice_lines: [
        {
          id: 1,
          invoice_id: INV,
          sort: 0,
          kind: "other",
          source: carePlanLineSource(VISIT),
          total: 0,
        },
        { id: 2, invoice_id: INV, sort: 1, kind: "other", source: TRIP, total: typed },
        ...(credit > 0
          ? [
              {
                id: 3,
                invoice_id: INV,
                sort: 2,
                kind: "other",
                source: allowanceLineSource(PLAN),
                total: -credit,
              },
            ]
          : []),
      ],
    });

  it("on the server: a trip typed up to 600 takes 140 of credit, and the customer is billed 460", async () => {
    const env = tripWorld(600);
    expect(await sync(env)).toBe(true);
    expect(creditOf(env)).toEqual([-140]);
    expect(invOf(env)["total"]).toBe(460);
  });

  it("a draft that held more than the trip is worth is put right", async () => {
    // As it could stand before: the trip typed to 600 and 300 of credit taken toward it.
    const env = tripWorld(600, 300);
    expect(await sync(env)).toBe(true);
    expect(creditOf(env)).toEqual([-140]);
    expect(invOf(env)["total"]).toBe(460);
  });

  it("the page reads what each trip was worked out at, and says it when the price differs", async () => {
    const env = tripWorld(600);
    expect(await call(getInvoiceTripCharges, env, { id: INV })).toEqual({ [TRIP]: 140 });
    expect(tripWorkedOutWords(140, 140)).toBeNull();
    expect(tripWorkedOutWords(600, 140)).toBe(
      "Worked out: $140.00. The plan's minor repairs pay toward the trip up to that; the rest is the customer's.",
    );
    expect(tripWorkedOutWords(90, 140)).toBe("Worked out: $140.00.");
    expect(tripWorkedOutWords(600, null)).toBeNull();
    const page = flat("src/components/service/invoice-editor.tsx");
    expect(page).toContain(
      "? tripWorkedOutWords(r2((l.qty ?? 0) * (l.rate ?? 0)), tripChargesQ.data?.[l.source]) : null;",
    );
    expect(page).toContain("data-trip-worked-out");
    // The line is still typed like any other: only the plan's own two lines are read-only.
    expect(flat("src/lib/roof-care-travel.ts")).toContain(
      "export const isPlanLine = (l: { source?: string | null | undefined }): boolean => isAllowanceLine(l) || isTravelWaiverLine(l);",
    );
  });

  it("the database holds it too, when the credit is written and at Finalise", () => {
    expect(SQL).toContain(
      "when l.source like 'roof-care-trip:%' then least(l.total, coalesce( (select n.amount from public.roof_care_no_access n where n.id::text = substring(l.source from 16)), l.total))",
    );
    expect(SQL).toContain(
      "when coalesce(v_storm, false) and l.source = 'roof-care:' || v_visit::text then l.total else 0 end",
    );
    // Asked by the line rule and by Finalise.
    expect(SQL.match(/v_rest := public\.roof_care_credit_cover\(r\.invoice_id\);/g)).toHaveLength(
      2,
    );
    expect(SQL).toContain("v_other := public.roof_care_credit_cover(new.id);");
    // A repair's invoice is as it was: everything else on it.
    expect(SQL).toContain(
      "where l.invoice_id = p_invoice and coalesce(l.source, '') not like 'roof-care-allowance:%'; return greatest(v_cover, 0);",
    );
  });
});

describe("6. every invoice of a plan inspection's ticket leaves the covered visit at no charge", () => {
  const built = [
    {
      kind: "travel",
      source: "time:t1",
      qty: 2,
      rate: 55,
      total: 110,
      cost_rate: 40,
      cost_total: 80,
      taxable: false,
    },
    {
      kind: "labor",
      source: "time:t2",
      qty: 6,
      rate: 85,
      total: 510,
      cost_rate: 40,
      cost_total: 240,
      taxable: false,
    },
    {
      kind: "material",
      source: "mat:m1",
      qty: 1,
      rate: 70,
      total: 70,
      cost_rate: 40,
      cost_total: 40,
      taxable: true,
    },
    {
      kind: "other",
      source: "po:p1",
      qty: 1,
      rate: 70,
      total: 70,
      cost_rate: 40,
      cost_total: 40,
      taxable: true,
    },
  ];

  it("a further invoice lists the visit at nothing, with what it cost kept", () => {
    const lines = carePlanFurtherLines(built);
    expect(lines.map((l) => [l.kind, l.rate, l.total, l.cost_total, l.taxable])).toEqual([
      ["travel", 0, 0, 80, false],
      ["labor", 0, 0, 240, false],
      ["material", 0, 0, 40, false],
      ["other", 0, 0, 40, false],
    ]);
    // Shown as a typed 0, so the office can type a price on what is beyond the plan.
    expect(lines.every((l) => l.rate_overridden === true)).toBe(true);
    expect(lines.map((l) => l.sort)).toEqual([0, 1, 2, 3]);
    // No second share of the plan and no return trip: both are billed once, on the first.
    expect(lines.some((l) => String(l.source).startsWith("roof-care"))).toBe(false);
  });

  it("each line is exactly the covered line the first invoice has", () => {
    expect(carePlanFurtherLines(built)[1]).toEqual(carePlanCovered(built[1]!, 1));
  });

  it("a purchase order is covered at nothing as well, as on the first invoice", () => {
    expect(carePlanFurtherLines(built)[3]).toMatchObject({
      source: "po:p1",
      total: 0,
      cost_total: 40,
    });
  });

  it("Another invoice and Rebuild both come this way", () => {
    const s = flat("src/lib/invoices.server.ts");
    expect(s).toContain(
      "if (visit) return (await planLineElsewhere(sb, jobId, visit.id, opts.invoiceId ?? null)) ? carePlanFurtherLines(lines) : carePlanInvoiceLines(lines, visit);",
    );
    // One builder for a new invoice and for a rebuilt one.
    const f = flat("src/lib/invoices.functions.ts");
    expect(f.match(/buildLinesFromJob\(sb, /g)!.length).toBeGreaterThanOrEqual(2);
  });
});

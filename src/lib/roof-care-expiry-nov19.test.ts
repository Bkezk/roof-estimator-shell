/**
 * Roof Care: a plan is one year of coverage, and then it is over (owner, Nov 19, evening;
 * docs/roof-care-plans.md, docs/qa/roof-care-expiry-2026-11-19.md).
 *
 *  - "the agreement is for one year of coverage …, and the benefits dont roll over, if we push
 *    it back we can follow the owed inspection rule".
 *  - "we need to be notified … when a plan expires so we can reach out to renew".
 *  - "the refund should take if off of roof cares income".
 *
 * Before this a plan stayed in force past its renewal date until someone renewed or ended it,
 * pushing an inspection past the plan year moved the renewal date, nobody was told when a year
 * ran out, and a refund was nowhere in the income report.
 *
 * THE NUMBERS HERE ARE MADE UP.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const sent = vi.fn<(...a: unknown[]) => Promise<number>>(async () => 1);
vi.mock("@/lib/notify.server", () => ({
  notify: (...a: unknown[]) => sent(...a),
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => true,
}));

import { toMarginInvoiceRow } from "@/lib/margin-report";
import { readCareRefunds } from "@/lib/margin-report.functions";
import { ATTENTION_DEFAULTS, attentionList } from "@/lib/owner-attention";
import {
  EXPIRED_LISTED_DAYS,
  expiredWords,
  isExpired,
  planBadge,
  planDates,
} from "@/lib/roof-care-plan";
import {
  dispatchPlanExpiredNotices,
  PLAN_EXPIRED_TELL_DAYS,
  planExpiredNotice,
} from "@/lib/roof-care-notify.server";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TECH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SITE = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333331";
const OLD = "33333333-3333-4333-8333-333333333332";

beforeEach(() => {
  sent.mockClear();
  sent.mockResolvedValue(1);
});

describe("the plan year is twelve months and no longer", () => {
  it("an inspection that ends after the year does not move the renewal", () => {
    // Signed Jan 20, first inspection 300 days on: the second cannot fit the year.
    const d = planDates("2027-01-20", "days", 300)!;
    expect(d.second.to > d.renews).toBe(true);
    expect(d.renews).toBe("2028-01-20");
    expect(planDates("2027-10-15", "window", null)!.renews).toBe("2028-10-15");
  });

  it("the database does the same: push back and the payment leave the renewal date alone", () => {
    const sql = flat("supabase/migrations/20261119900000_roof_care_expiry.sql");
    expect(sql).toContain(
      "a1 text := ' set renews_on = greatest(renews_on, v_last), updated_at = now()'; b1 text := ' set updated_at = now()';",
    );
    expect(sql).toContain("a2 text := ' v_renews := greatest(v_renews, v2_by);';");
    // A function that is not as expected stops the change, not a silent no-op.
    expect(sql).toContain("raise exception '%roof_care_push_back', procedure_missing;");
    expect(sql).toContain("raise exception '%roof_care_start', procedure_missing;");
  });
});

describe("a plan whose year is over", () => {
  it("is ended as Expired by the morning run, which people cannot call", () => {
    const sql = flat("supabase/migrations/20261119900000_roof_care_expiry.sql");
    expect(sql).toContain(
      "set status = 'ended', ended_on = v_today, ended_reason = 'Expired', ended_by_name = 'Roof Care plans', updated_at = now() where status = 'active' and renews_on <= v_today;",
    );
    expect(sql).toContain(
      "b7 text := ' perform public.roof_care_expire(); perform public.roof_care_lapse_carried();';",
    );
    expect(sql).toContain(
      "revoke all on function public.roof_care_expire() from public, anon, authenticated;",
    );
  });

  it("can still be renewed, unless the property has a newer plan", () => {
    const sql = flat("supabase/migrations/20261119900000_roof_care_expiry.sql");
    expect(sql).toContain("(p.status = ''ended'' and p.ended_reason = ''Expired'')) then");
    expect(sql).toContain("raise exception ''This property has a newer Roof Care plan'';");
    // The payment renews an expired plan as one in force, and keeps the day it expired.
    expect(sql).toContain("(v_old.status = ''ended'' and v_old.ended_reason = ''Expired''));");
    expect(sql).toContain("ended_on = coalesce(ended_on, v_today), ended_reason = ''Renewed'',");
  });

  it("says so on the property", () => {
    const expired = { status: "ended" as const, ended_reason: "Expired", plan: "guard" as const };
    expect(isExpired(expired)).toBe(true);
    expect(isExpired({ status: "ended", ended_reason: "Renewed" })).toBe(false);
    expect(isExpired({ status: "active", ended_reason: null })).toBe(false);
    expect(planBadge(expired)).toBe("Roof Guard (expired)");
    expect(planBadge({ status: "ended", ended_reason: "Sold the building", plan: "guard" })).toBe(
      "Roof Guard (ended)",
    );
    expect(expiredWords({ ended_on: "2027-12-19", renews_on: "2027-12-19" })).toBe(
      "Expired Dec 19, 2027. What the plan included has stopped. It can be renewed: the new plan year starts the day the renewal is paid.",
    );
    const card = flat("src/components/roof-care/plan-card.tsx");
    expect(card).toContain("const expired = isExpired(plan) ? plan : null;");
    expect(card).toContain("data-roof-care-expired");
    expect(card).toContain("{renewing && (active ?? expired) && (");
    // A renewal waiting on an expired plan is shown as a renewal, not a new sign-up.
    expect(card).toContain("{...(waitingRenews ? { renewalOf: waitingRenews } : {})}");
  });
});

describe("the office is told when a plan expires", () => {
  const world = (plans: Record<string, unknown>[]) =>
    fakeSupabase({
      roof_care_plans: plans,
      profiles: [
        { id: ADMIN, role: "admin" },
        { id: MANAGER, role: "manager" },
        { id: TECH, role: "user" },
      ],
      crm_sites: [{ id: SITE, name: "Unit 2" }],
      crm_accounts: [{ id: ACCOUNT, name: "Made Up Storage Co" }],
    });
  const expired = (over: Record<string, unknown> = {}) => ({
    id: PLAN,
    plan: "guard",
    status: "ended",
    ended_reason: "Expired",
    ended_on: "2027-12-18",
    expiry_notified_at: null,
    site_id: SITE,
    account_id: ACCOUNT,
    ...over,
  });
  // Monday Dec 20, 2027, 10:00 in the office.
  const MONDAY = new Date("2027-12-20T15:00:00Z");

  it("in these words, with a link to the property", () => {
    expect(
      planExpiredNotice({
        plan: "guard",
        site_id: SITE,
        ended_on: "2027-12-18",
        site: "Unit 2",
        account: "Made Up Storage Co",
      }),
    ).toEqual({
      kind: "plan_expired",
      title: "Roof Guard plan expired: Unit 2 (Made Up Storage Co)",
      body: "Its plan year ended Sat, Dec 18. The minor repairs and leak calls it included have stopped. Reach out to renew it: open the property and press Renew for another year.",
      url: `/properties/${SITE}`,
    });
  });

  it("the admins and the managers, once", async () => {
    const env = world([expired()]);
    const first = await dispatchPlanExpiredNotices(env.db, MONDAY);
    expect(first).toMatchObject({ plans_checked: 1, plans_notified: 1, plans_errors: 0 });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]![0]).toEqual([ADMIN, MANAGER]);
    expect(env.tables["roof_care_plans"]![0]!["expiry_notified_at"]).toBe(MONDAY.toISOString());
    const again = await dispatchPlanExpiredNotices(env.db, MONDAY);
    expect(again.plans_checked).toBe(0);
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("not before 8:00 in the office, and not on a weekend: it waits for Monday", async () => {
    const env = world([expired()]);
    // Monday 6:30 in the office.
    await dispatchPlanExpiredNotices(env.db, new Date("2027-12-20T11:30:00Z"));
    // Saturday 10:00 in the office.
    await dispatchPlanExpiredNotices(env.db, new Date("2027-12-18T15:00:00Z"));
    expect(sent).not.toHaveBeenCalled();
    expect(env.tables["roof_care_plans"]![0]!["expiry_notified_at"]).toBeNull();
  });

  it("only a plan that expired: not one ended by a manager, renewed, or long gone", async () => {
    expect(PLAN_EXPIRED_TELL_DAYS).toBe(14);
    const env = world([
      expired({ id: "p-ended", ended_reason: "Sold the building" }),
      expired({ id: "p-renewed", ended_reason: "Renewed" }),
      expired({ id: "p-old", ended_on: "2027-11-01" }),
      expired({ id: "p-active", status: "active", ended_reason: null, ended_on: null }),
    ]);
    const r = await dispatchPlanExpiredNotices(env.db, MONDAY);
    expect(r.plans_checked).toBe(0);
    expect(sent).not.toHaveBeenCalled();
  });

  it("a notice that fails is put back for the next pass", async () => {
    sent.mockRejectedValueOnce(new Error("push service down"));
    const env = world([expired()]);
    const r = await dispatchPlanExpiredNotices(env.db, MONDAY);
    expect(r).toMatchObject({ plans_notified: 0, plans_errors: 1 });
    expect(env.tables["roof_care_plans"]![0]!["expiry_notified_at"]).toBeNull();
    const next = await dispatchPlanExpiredNotices(env.db, MONDAY);
    expect(next.plans_notified).toBe(1);
  });

  it("runs with the scheduled reminders and with the app's own pass", () => {
    const cron = flat("src/routes/api.cron.reminders.ts");
    expect(cron).toContain(
      'const { dispatchPlanExpiredNotices } = await import("@/lib/roof-care-notify.server"); const p = await dispatchPlanExpiredNotices(supabaseAdmin);',
    );
    expect(flat("src/lib/followups.functions.ts")).toContain(
      "out.failed += (await dispatchPlanExpiredNotices(await adminClient())).plans_errors;",
    );
  });
});

describe("Needs attention", () => {
  const base = {
    today: "2027-12-28",
    now: "2027-12-28T15:00:00Z",
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
  const row = (over: Record<string, unknown> = {}) => ({
    plan_id: PLAN,
    site_id: SITE,
    title: "Roof Guard · Unit 2 (Made Up Storage Co)",
    expired_on: "2027-12-18",
    owed: 0,
    price: 1840,
    ...over,
  });

  it("lists an expired plan so the office reaches out", () => {
    const rows = attentionList({ ...base, careExpired: [row()] }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: `care_plan_expired:${PLAN}`,
      group: "office",
      kind: "care_plan_expired",
      tag: "Roof Care",
      why: "The plan year ended Sat, Dec 18 and the plan was not renewed. What it included has stopped. Reach out to renew it: open the property and press Renew for another year.",
      age: 10,
      tone: "amber",
      amount: 1840,
      href: `/properties/${SITE}`,
    });
  });

  it("says what is still owed", () => {
    const one = attentionList({ ...base, careExpired: [row({ owed: 1 })] }).rows[0]!;
    expect(one.why).toMatch(/ 1 inspection was not done and is still owed\.$/);
    const two = attentionList({ ...base, careExpired: [row({ owed: 2 })] }).rows[0]!;
    expect(two.why).toMatch(/ Both inspections were not done and are still owed\.$/);
  });

  it("for 60 days, and red after two weeks", () => {
    expect(EXPIRED_LISTED_DAYS).toBe(60);
    expect(
      attentionList({ ...base, today: "2028-01-10", careExpired: [row()] }).rows[0]!.tone,
    ).toBe("red");
    expect(attentionList({ ...base, today: "2028-02-16", careExpired: [row()] }).rows).toHaveLength(
      1,
    );
    expect(attentionList({ ...base, today: "2028-02-17", careExpired: [row()] }).rows).toHaveLength(
      0,
    );
  });

  it("only while the property has no plan in force or waiting", () => {
    const fn = flat("src/lib/owner-attention.functions.ts");
    expect(fn).toContain("(p) => isExpired(p) && !live.some((x) => x.site_id === p.site_id)");
    expect(fn).toContain('.gte("ended_on", plusDays(today, -EXPIRED_LISTED_DAYS));');
  });
});

describe("a refund comes off Roof Care's income", () => {
  it("is a row of the report with its revenue below nothing", () => {
    const r = toMarginInvoiceRow({
      id: `refund:${PLAN}`,
      kind: "service",
      carePlan: true,
      refundSite: SITE,
      number: "RC-1001 refund",
      day: "2027-06-10",
      status: "final",
      subtotal: -520,
      customer: "Made Up Storage Co",
      technician: null,
      technicianId: null,
      ticket: true,
      hours: 0,
      material: 0,
      labor: 0,
      other: 0,
      purchaseOrders: 0,
    });
    expect(r).toMatchObject({
      carePlan: true,
      refundSite: SITE,
      revenue: -520,
      cost: 0,
      margin: -520,
      // Found in the browser run: it read 100%.
      marginPct: null,
    });
  });

  it("is read from the plans ended with a refund in the period, sent or not", async () => {
    const env = fakeSupabase({
      roof_care_plans: [
        {
          id: PLAN,
          plan_number: 1001,
          account_id: ACCOUNT,
          site_id: SITE,
          ended_on: "2027-06-10",
          refund_due: 520,
          refund_sent_on: null,
        },
        {
          id: OLD,
          plan_number: 1002,
          account_id: ACCOUNT,
          site_id: SITE,
          ended_on: "2027-06-20",
          refund_due: 300,
          refund_sent_on: "2027-06-25",
        },
        // Not in the period, and one with nothing to refund.
        {
          id: "p3",
          plan_number: 1003,
          account_id: ACCOUNT,
          site_id: SITE,
          ended_on: "2027-08-01",
          refund_due: 100,
          refund_sent_on: null,
        },
        {
          id: "p4",
          plan_number: 1004,
          account_id: ACCOUNT,
          site_id: SITE,
          ended_on: "2027-06-11",
          refund_due: 0,
          refund_sent_on: null,
        },
      ],
      crm_accounts: [{ id: ACCOUNT, name: "Made Up Storage Co" }],
    });
    const rows = await readCareRefunds(env.db, "2027-06-01", "2027-06-30");
    expect(rows.map((r) => [r.number, r.day, r.status, r.revenue, r.customer])).toEqual([
      ["RC-1001 refund", "2027-06-10", "final", -520, "Made Up Storage Co"],
      ["RC-1002 refund", "2027-06-20", "paid", -300, "Made Up Storage Co"],
    ]);
    expect(rows.every((r) => r.carePlan && r.refundSite === SITE)).toBe(true);
  });

  it("is counted with the invoices, and opens the property", () => {
    const fn = flat("src/lib/margin-report.functions.ts");
    expect(fn).toContain('source !== "bids" ? readCareRefunds(sb, from, to) : [],');
    expect(fn).toContain("rows: [...invoices, ...refunds, ...bids.rows],");
    const page = flat("src/components/margin-report.tsx");
    expect(page).toContain(") : i.refundSite ? (");
    expect(page).toContain('to="/properties/$id" params={{ id: i.refundSite }}');
  });
});

describe("the database types", () => {
  it("know the new column", () => {
    expect(flat("src/integrations/supabase/types.ts")).toContain(
      "expiry_notified_at: string | null",
    );
  });
});

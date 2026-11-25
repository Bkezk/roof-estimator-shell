/**
 * "A Roof Care plan is signed and not paid" (owner, Nov 24: "will they get an notification when
 * there is a sign up but no payement? they should and then it should remind after 2 days if no
 * movement").
 *
 * The words, who is told and when, what happens when a send fails, where it is called from, and
 * the text of the database change. Every test of the sending fails on the code of that morning:
 * there was no such notice. Names and places are made up.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.fn<(...a: unknown[]) => Promise<number>>(async () => 1);
vi.mock("@/lib/notify.server", () => ({
  notify: (...a: unknown[]) => sent(...a),
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => true,
}));

import { NOTICE_TYPES, takesNotice } from "@/lib/notice-types";
import { noticeCategory } from "@/lib/notice-categories";
import {
  PLAN_CARD_WAIT_MINUTES,
  PLAN_NEEDS_PAYMENT_KIND,
  PLAN_PAY_REMIND_DAYS,
  planNeedsPaymentNotice,
  type PlanWaitingForPayment,
} from "@/lib/roof-care-pay-notice";
import { dispatchPlanPayNotices, tellPlanSignedNotPaid } from "@/lib/roof-care-notify.server";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

const ADMIN = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const TECH = "33333333-3333-4333-8333-333333333333";
const PLAN = "44444444-4444-4444-8444-444444444444";
const SITE = "55555555-5555-4555-8555-555555555555";

const waiting = (over: Partial<PlanWaitingForPayment> = {}): PlanWaitingForPayment => ({
  plan_id: PLAN,
  plan: "care",
  plan_number: 7,
  site_id: SITE,
  site: "Unit 2",
  account: "Made Up Storage Co",
  signed_on: "2027-12-16",
  pay_method: "check",
  sold_by_name: "Tom Tech",
  renewal: false,
  first: true,
  was: null,
  days_waiting: 0,
  ...over,
});

/** A database whose claim hands back `plans`; `release` is recorded with the rest. */
const world = (plans: PlanWaitingForPayment[], claimError?: string) =>
  fakeSupabase(
    {
      profiles: [
        { id: ADMIN, role: "admin", notify_own: false },
        { id: MANAGER, role: "manager", notify_own: false },
        { id: TECH, role: "user", notify_own: false },
      ],
    },
    {
      rpcs: {
        roof_care_pay_notice_claim: () => {
          if (claimError) throw new Error(claimError);
          return plans;
        },
        roof_care_pay_notice_release: () => null,
      },
    },
  );

// Monday Dec 20, 2027, 10:00 in the office.
const MONDAY = new Date("2027-12-20T15:00:00Z");

beforeEach(() => {
  sent.mockReset();
  sent.mockResolvedValue(1);
});

describe("the words", () => {
  it("at the sign-up: who signed it, how they pay, and what to do", () => {
    expect(planNeedsPaymentNotice(waiting())).toEqual({
      kind: "plan_needs_payment",
      title: "Roof Care plan signed, not paid: Unit 2 (Made Up Storage Co)",
      body: "Signed up by Tom Tech. Paying by check. The plan starts when it is paid. Open the property to send the payment link or record the payment.",
      url: `/properties/${SITE}`,
    });
    expect(PLAN_NEEDS_PAYMENT_KIND).toBe("plan_needs_payment");
  });
  it("a card plan, a renewal, and a plan with no names on it", () => {
    const card = planNeedsPaymentNotice(waiting({ pay_method: "card", plan: "guard" }));
    expect(card.title).toBe("Roof Guard plan signed, not paid: Unit 2 (Made Up Storage Co)");
    // A card plan is told only once the card screen was left with no payment (the same night:
    // "only drop that if they actually pay by card not if they open the menu then leave").
    expect(card.body).toBe(
      "Signed up by Tom Tech. Paying by card, and no card payment has come through. The plan starts when it is paid. Open the property to send the payment link or record the payment.",
    );
    const renewal = planNeedsPaymentNotice(waiting({ renewal: true, plan: "watch" }));
    expect(renewal.title).toBe("Roof Watch plan renewed, not paid: Unit 2 (Made Up Storage Co)");
    expect(renewal.body).toContain("Renewed by Tom Tech. Paying by check.");
    const bare = planNeedsPaymentNotice(
      waiting({ site: " ", account: null, sold_by_name: null, pay_method: null }),
    );
    expect(bare.title).toBe("Roof Care plan signed, not paid: a property");
    expect(bare.body).toBe(
      "Signed up. The plan starts when it is paid. Open the property to send the payment link or record the payment.",
    );
  });
  it("the reminder: since when, and what to do about it", () => {
    expect(planNeedsPaymentNotice(waiting({ first: false, days_waiting: 4 }))).toEqual({
      kind: "plan_needs_payment",
      title: "Roof Care plan still not paid: Unit 2 (Made Up Storage Co)",
      body: "Signed Thu, Dec 16, 4 days ago, and no payment is recorded, so it has not started. Paying by check. Reach out to the customer, record the payment, or end the plan on the property.",
      url: `/properties/${SITE}`,
    });
    expect(planNeedsPaymentNotice(waiting({ first: false, days_waiting: 1 })).body).toContain(
      "Signed Thu, Dec 16, 1 day ago, and",
    );
  });
  it("no price is in any of them", () => {
    for (const p of [waiting(), waiting({ first: false, days_waiting: 2 })]) {
      const n = planNeedsPaymentNotice(p);
      expect(`${n.title} ${n.body}`).not.toMatch(/\$|\d{3,}/);
    }
  });
});

describe("at the sign-up", () => {
  it("the admins and the managers are told at once, whatever the hour or the day", async () => {
    const env = world([waiting()]);
    // Saturday 21:00 in the office.
    const out = await dispatchPlanPayNotices(env.db, {
      planId: PLAN,
      actorId: TECH,
      now: new Date("2027-12-19T02:00:00Z"),
    });
    expect(out).toEqual({ plans_notified: 1, plans_errors: 0 });
    expect(env.rpcCalls).toEqual([
      {
        fn: "roof_care_pay_notice_claim",
        args: { p_plan: PLAN, p_days: 2, p_reminders: false, p_card_wait: 30 },
      },
    ]);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]![0]).toEqual([ADMIN, MANAGER]);
    expect(sent.mock.calls[0]![1]).toMatchObject({
      kind: "plan_needs_payment",
      title: "Roof Care plan signed, not paid: Unit 2 (Made Up Storage Co)",
    });
  });
  it("an admin who signed it up is not told about their own sign-up", async () => {
    const env = world([waiting({ sold_by_name: "Ann Admin" })]);
    await dispatchPlanPayNotices(env.db, { planId: PLAN, actorId: ADMIN, now: MONDAY });
    expect(sent.mock.calls[0]![0]).toEqual([MANAGER]);
  });
  it("a plan the database does not hand back (paid already, told already) tells nobody", async () => {
    const env = world([]);
    const out = await dispatchPlanPayNotices(env.db, { planId: PLAN, actorId: TECH, now: MONDAY });
    expect(out).toEqual({ plans_notified: 0, plans_errors: 0 });
    expect(sent).not.toHaveBeenCalled();
  });
  it("never fails the sign-up: a database that refuses is logged, not thrown", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = world([], "permission denied for function roof_care_pay_notice_claim");
    await expect(tellPlanSignedNotPaid(env.db, PLAN, TECH)).resolves.toBeUndefined();
    expect(sent).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("the reminder every two days", () => {
  it("goes with the morning run, to everyone, the signer too", async () => {
    expect(PLAN_PAY_REMIND_DAYS).toBe(2);
    const env = world([waiting({ first: false, days_waiting: 2, was: "2027-12-18T15:00:00Z" })]);
    const out = await dispatchPlanPayNotices(env.db, { actorId: ADMIN, now: MONDAY });
    expect(out).toEqual({ plans_notified: 1, plans_errors: 0 });
    expect(env.rpcCalls[0]).toEqual({
      fn: "roof_care_pay_notice_claim",
      args: { p_plan: null, p_days: 2, p_reminders: true, p_card_wait: 30 },
    });
    expect(sent.mock.calls[0]![0]).toEqual([ADMIN, MANAGER]);
    expect(sent.mock.calls[0]![1]).toMatchObject({
      title: "Roof Care plan still not paid: Unit 2 (Made Up Storage Co)",
    });
  });
  it("not before 8:00 in the office and not on a weekend: the database is told to hold them", async () => {
    const env = world([]);
    // Monday 6:30 in the office, then Saturday 10:00, then Monday 10:00.
    await dispatchPlanPayNotices(env.db, { now: new Date("2027-12-20T11:30:00Z") });
    await dispatchPlanPayNotices(env.db, { now: new Date("2027-12-18T15:00:00Z") });
    await dispatchPlanPayNotices(env.db, { now: MONDAY });
    expect(env.rpcCalls.map((c) => c.args["p_reminders"])).toEqual([false, false, true]);
    expect(sent).not.toHaveBeenCalled();
  });
  it("a send that fails puts the plan back as it was, and the others still go", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const was = "2027-12-18T15:00:00Z";
    const env = world([
      waiting({ first: false, days_waiting: 2, was }),
      waiting({ plan_id: "p-2", site: "Unit 9", first: false, days_waiting: 5, was: null }),
    ]);
    sent.mockRejectedValueOnce(new Error("the push service is down"));
    const out = await dispatchPlanPayNotices(env.db, { now: MONDAY });
    expect(out).toEqual({ plans_notified: 1, plans_errors: 1 });
    expect(env.rpcCalls.filter((c) => c.fn === "roof_care_pay_notice_release")).toEqual([
      { fn: "roof_care_pay_notice_release", args: { p_plan: PLAN, p_was: was } },
    ]);
    expect(sent).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});

describe("a plan paid by card", () => {
  // The owner, the same night: "if someone pays by card we just need the notification they paid
  // by card", then "only drop that if they actually pay by card not if they open the menu then
  // leave".
  const sql = flat("supabase/migrations/20261124970000_roof_care_pay_notice_card.sql");
  it("is not told at its sign-up: the database hands nothing back, so nothing is sent", async () => {
    const env = world([]);
    const out = await dispatchPlanPayNotices(env.db, { planId: PLAN, actorId: TECH, now: MONDAY });
    expect(out).toEqual({ plans_notified: 0, plans_errors: 0 });
    expect(sent).not.toHaveBeenCalled();
    // The rule itself is the database's: never told, by card, and asked for by its sign-up.
    expect(sql).toContain(
      "(p.pay_notified_at is null and (p.pay_method is distinct from 'card' or (p_plan is null and p.created_at <= now() - make_interval(mins => greatest(coalesce(p_card_wait, 30), 1)))))",
    );
  });
  it("is told half an hour later when no payment came, at any hour, as the sign-up's notice", async () => {
    expect(PLAN_CARD_WAIT_MINUTES).toBe(30);
    const env = world([waiting({ pay_method: "card" })]);
    // Saturday 21:00 in the office: the reminders are held, this is not one.
    const out = await dispatchPlanPayNotices(env.db, { now: new Date("2027-12-19T02:00:00Z") });
    expect(out).toEqual({ plans_notified: 1, plans_errors: 0 });
    expect(env.rpcCalls[0]!.args).toEqual({
      p_plan: null,
      p_days: 2,
      p_reminders: false,
      p_card_wait: 30,
    });
    expect(sent.mock.calls[0]![0]).toEqual([ADMIN, MANAGER]);
    expect(sent.mock.calls[0]![1]).toMatchObject({
      title: "Roof Care plan signed, not paid: Unit 2 (Made Up Storage Co)",
      body: expect.stringContaining("Paying by card, and no card payment has come through."),
    });
  });
  it("a plan that was paid is not waiting, so it is never claimed", () => {
    expect(sql).toContain("where p.status = 'awaiting_payment'");
  });
  it("the reminder is claimed only when the server says it is the morning of a working day", () => {
    expect(sql).toContain(
      "or (p_plan is null and coalesce(p_reminders, false) and p.pay_notified_at is not null and greatest(p.pay_notified_at, coalesce(p.pay_link_sent_at, p.pay_notified_at)) <= now() - make_interval(days => greatest(coalesce(p_days, 2), 1)))",
    );
  });
  it("the older function is dropped, so a call cannot fit two; the server alone may call the new one", () => {
    expect(sql).toContain(
      "drop function if exists public.roof_care_pay_notice_claim(uuid, integer);",
    );
    const fn = "roof_care_pay_notice_claim(uuid, integer, boolean, integer)";
    expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
    expect(sql).toContain(`grant execute on function public.${fn} to service_role;`);
    expect(sql).not.toMatch(/\b(delete from|truncate|drop table|insert into|alter table)\b/i);
  });
});

describe("where it is called from", () => {
  const plans = flat("src/lib/roof-care-plan.functions.ts");
  it("the sign-up and a renewal that waits for its payment", () => {
    expect(plans.match(/await tellSignedNotPaid\(sb, planId, context\.userId\);/g)).toHaveLength(2);
    // After the agreement email, before the plan is read back.
    // Nov 26, 2026: the read back is in a try now (a plan that is signed and cannot be read
    // back is said as that), so a few lines stand between the notice and the read.
    expect(plans).toMatch(
      /if \(email\) await sendPlanEmailsNow\(sb, planId\);.{0,400}await tellSignedNotPaid\(sb, planId, context\.userId\);.{0,300}made = \(await plansOfSites\(/,
    );
    // A renewal at no charge started by itself: it returned before this line.
    expect(plans).toMatch(
      /return \{ plan_id: planId, invoice_id: null, started: true \};.{0,700}await tellSignedNotPaid\(sb, planId, context\.userId\); return \{ plan_id: planId, invoice_id: invoiceId, started: false \};/,
    );
  });
  it("the scheduled run and the run a signed-in page starts", () => {
    const cron = flat("src/routes/api.cron.reminders.ts");
    expect(cron).toContain("const p = await dispatchPlanPayNotices(supabaseAdmin);");
    expect(cron).toContain("plan_pay: planPay,");
    expect(flat("src/lib/followups.functions.ts")).toContain(
      "out.failed += (await dispatchPlanPayNotices(await adminClient())).plans_errors;",
    );
  });
});

describe("under the Roof Care plan tick", () => {
  it("an Opportunity notice, turned off with the tick or the switch", () => {
    expect(noticeCategory("plan_needs_payment", null)).toBe("opportunities");
    const type = NOTICE_TYPES.find((t) => t.key === "opportunities_care_plan")!;
    expect(type.match).toEqual([
      { kinds: ["plan_needs_payment", "plan_card_paid", "plan_expired"] },
    ]);
    // Nov 26, 2026: money to send back is an alarm now, under no tick (the audit of Nov 25,
    // number 26), so it is no longer in this tick's words. The kinds are as they were.
    expect(type.help).toBe(
      "A plan is signed and not paid, was paid by card or from a bank account, or expired.",
    );
    const on = {
      notify_leads: false,
      notify_opportunities: true,
      notify_service: true,
      notify_bids: true,
      notify_storms: false,
    };
    const notice = { kind: "plan_needs_payment", title: "Roof Care plan signed, not paid: x" };
    expect(takesNotice({ ...on, notify_off: [] }, notice)).toBe(true);
    expect(takesNotice({ ...on, notify_off: ["opportunities_care_plan"] }, notice)).toBe(false);
    expect(takesNotice({ ...on, notify_opportunities: false, notify_off: [] }, notice)).toBe(false);
  });
});

describe("the database change", () => {
  const sql = flat("supabase/migrations/20261124960000_roof_care_pay_notice.sql");
  it("one new column, and no row changed by the file", () => {
    expect(sql).toContain(
      "alter table public.roof_care_plans add column if not exists pay_notified_at timestamptz;",
    );
    expect(sql).not.toMatch(/\b(delete from|truncate|drop table|insert into)\b/i);
  });
  it("only a waiting plan is claimed, and it is stamped in the same statement", () => {
    expect(sql).toContain("where p.status = 'awaiting_payment'");
    expect(sql).toContain("for update of p skip locked");
    expect(sql).toContain("update public.roof_care_plans p set pay_notified_at = now() from due");
  });
  it("sending the payment link again starts the days over", () => {
    // The rule was rewritten the same night for card plans: its tests are above.
    expect(sql).toContain(
      "greatest(p.pay_notified_at, coalesce(p.pay_link_sent_at, p.pay_notified_at)) <= now() - make_interval(days => greatest(coalesce(p_days, 2), 1))",
    );
  });
  it("the site's server alone may call the two functions", () => {
    for (const fn of [
      "roof_care_pay_notice_claim(uuid, integer)",
      "roof_care_pay_notice_release(uuid, timestamptz)",
    ]) {
      expect(sql).toContain(
        `revoke all on function public.${fn} from public, anon, authenticated;`,
      );
      expect(sql).toContain(`grant execute on function public.${fn} to service_role;`);
    }
  });
});

/**
 * A Roof Care plan paid from a bank account (owner, Nov 24, on the review of the Stripe set-up:
 * "can you handle the rest of the solutions you brought up").
 *
 * With bank payments turned on in Stripe a customer can pay from a bank account on the same
 * payment page. The checkout is finished at once; the money clears days later, or fails. Until
 * this, a bank payment that failed told nobody, and one on its way was followed half an hour
 * later by "no card payment has come through". Every test of the handler fails on the code of
 * that morning. Amounts and names are made up.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const told: unknown[][] = [];
const hold = { admin: null as unknown };
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
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: new Proxy(
    {},
    { get: (_t, k) => (hold.admin as Record<string | symbol, unknown>)[k] },
  ),
}));
vi.mock("@/lib/roof-care-email.server", () => ({
  dispatchPlanEmails: async () => ({
    agreements_sent: 0,
    receipts_sent: 0,
    email_errors: 0,
    held: null,
  }),
}));
vi.mock("@/lib/roof-care-plan-invoice.functions", () => ({
  makePlanInvoice: async () => ({ id: "inv-made", made: true }),
}));

import {
  bankPaymentNotice,
  bankPlanEvent,
  cardPaidNotice,
  paidPlanEvent,
} from "@/lib/roof-care-checkout";
import { Route } from "@/routes/api.stripe.webhook";
import { fakeSupabase } from "@/test/fake-supabase";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
const PLAN = "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e11";
const SECRET = "whsec_made_up_for_tests";
const sign = (body: string) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${body}`, "utf8").digest("hex")}`;
};

/** A Roof Care checkout as Stripe sends it, at one of its steps. */
const event = (type: string, payment_status: string, over: Record<string, unknown> = {}) => ({
  type,
  livemode: false,
  data: {
    object: {
      id: "cs_1",
      payment_status,
      currency: "usd",
      amount_total: 84000,
      payment_intent: "pi_9",
      metadata: { kind: "roof_care_plan", plan_id: PLAN },
      ...over,
    },
  },
});
const STARTED = event("checkout.session.completed", "unpaid");
const FAILED = event("checkout.session.async_payment_failed", "unpaid");
const CLEARED = event("checkout.session.async_payment_succeeded", "paid");
const CARD = event("checkout.session.completed", "paid");

const post = (e: unknown) => {
  const body = JSON.stringify(e);
  return (
    Route as unknown as {
      options: { server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } } };
    }
  ).options.server.handlers.POST({
    request: new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      body,
      headers: { "stripe-signature": sign(body) },
    }),
  });
};

const world = (status = "awaiting_payment") => {
  const env = fakeSupabase(
    {
      roof_care_plans: [
        { id: PLAN, plan: "care", site_id: "s1", customer_email: null, status, sold_by: "t1" },
      ],
      crm_sites: [{ id: "s1", name: "Main Plant" }],
      profiles: [
        { id: "a1", role: "admin" },
        { id: "m1", role: "manager" },
        { id: "t1", role: "user" },
      ],
      roof_care_card_payments: [],
      notifications: [],
    },
    {
      rpcs: {
        roof_care_card_paid: () => "started",
        roof_care_pay_notice_release: () => null,
        // Nov 26, 2026: the database follows a bank payment on the plan and says whether the
        // plan was waiting (the audit of Nov 25, number 3). This stands in for it.
        roof_care_bank_pending: (a) =>
          a["p_step"] === "failed"
            ? "none"
            : status === "awaiting_payment"
              ? "started"
              : "not_waiting",
        roof_care_card_sessions_closed: () => 0,
      },
    },
  );
  hold.admin = env.db;
  return env;
};

beforeEach(() => {
  told.length = 0;
  vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_made_up_for_tests");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe("reading Stripe's three steps of a bank payment", () => {
  it("started: the checkout is finished and the money has not cleared", () => {
    expect(bankPlanEvent(STARTED)).toEqual({
      step: "started",
      plan_id: PLAN,
      amount: 840,
      ref: "pi_9",
    });
    // Not a payment yet.
    expect(paidPlanEvent(STARTED)).toBeNull();
  });
  it("failed: it did not go through", () => {
    expect(bankPlanEvent(FAILED)).toEqual({
      step: "failed",
      plan_id: PLAN,
      amount: 840,
      ref: "pi_9",
    });
    expect(paidPlanEvent(FAILED)).toBeNull();
  });
  it("cleared: a payment, and known to be from a bank; a card payment is not", () => {
    expect(paidPlanEvent(CLEARED)).toMatchObject({ plan_id: PLAN, amount: 840, bank: true });
    expect(paidPlanEvent(CARD)).toMatchObject({ plan_id: PLAN, amount: 840, bank: false });
    expect(bankPlanEvent(CLEARED)).toBeNull();
    expect(bankPlanEvent(CARD)).toBeNull();
  });
  it("nothing for a checkout that is not a plan's, another currency, or no plan named", () => {
    expect(
      bankPlanEvent(event("checkout.session.completed", "unpaid", { metadata: {} })),
    ).toBeNull();
    expect(
      bankPlanEvent(event("checkout.session.completed", "unpaid", { currency: "cad" })),
    ).toBeNull();
    expect(
      bankPlanEvent(
        event("checkout.session.async_payment_failed", "unpaid", {
          metadata: { kind: "roof_care_plan", plan_id: "not-a-plan" },
        }),
      ),
    ).toBeNull();
    expect(bankPlanEvent(event("checkout.session.expired", "unpaid"))).toBeNull();
    expect(bankPlanEvent(null)).toBeNull();
  });
});

describe("the words", () => {
  const base = { plan: "care", site_id: "s1", site: "Main Plant", amount: 840, ref: "pi_9" };
  it("started", () => {
    expect(bankPaymentNotice({ ...base, step: "started" })).toEqual({
      kind: "plan_card_paid",
      title: "Bank payment started: Main Plant",
      body: "The customer paid $840.00 for the Roof Care plan from a bank account online. A bank payment takes up to 4 business days to clear. The plan starts when it clears, and you will be told then. Nothing to do until it does.",
      url: "/properties/s1",
    });
  });
  it("failed", () => {
    expect(bankPaymentNotice({ ...base, step: "failed" })).toEqual({
      // Nov 26, 2026: an alarm, which no tick turns off (the audit of Nov 25, number 26).
      kind: "plan_money_alarm",
      title: "Bank payment failed: Main Plant",
      body: "The customer's bank payment of $840.00 for the Roof Care plan did not go through, so the plan has not started. Reach out to the customer: the payment link on the plan still works, or take a check. Reference pi_9.",
      url: "/properties/s1",
    });
  });
  it("cleared: said as a bank payment, not as a card", () => {
    const n = cardPaidNotice({
      plan: "care",
      site_id: "s1",
      site: "Main Plant",
      result: "invoice_paid",
      bank: true,
    });
    expect(n.title).toBe("Roof Care plan paid by bank payment: Main Plant");
    expect(n.body).toBe(
      "The customer paid the year from a bank account online. Its invoice is marked paid and the plan has started.",
    );
    // A card payment reads as it always did.
    const card = cardPaidNotice({
      plan: "care",
      site_id: "s1",
      site: "Main Plant",
      result: "invoice_paid",
    });
    expect(card.title).toBe("Roof Care plan paid by card: Main Plant");
    expect(card.body).toContain("paid the year by card online.");
  });
});

describe("what the site does with each step", () => {
  it("started: the admins and managers are told, nothing is recorded as paid, and the plan is marked as told", async () => {
    const env = world();
    const res = await post(STARTED);
    expect(await res.json()).toEqual({ ok: true, handled: true, result: "bank_started" });
    expect(told).toHaveLength(1);
    expect(told[0]![0]).toEqual(["a1", "m1"]);
    expect(told[0]![1]).toMatchObject({ title: "Bank payment started: Main Plant" });
    const fns = env.rpcCalls.map((c) => c.fn);
    expect(fns).not.toContain("roof_care_card_paid");
    // So "signed, not paid: no card payment has come through" does not follow in half an hour.
    // Nov 26, 2026: one step in the database stamps the plan as told and as having a bank
    // payment on its way (roof_care_bank_pending sets pay_notified_at with the stamp), in
    // place of the call that only marked it as told.
    expect(fns).not.toContain("roof_care_pay_notice_release");
    const mark = env.rpcCalls.find((c) => c.fn === "roof_care_bank_pending")!;
    expect(mark.args).toEqual({ p_plan: PLAN, p_ref: "pi_9", p_amount: 840, p_step: "started" });
    expect(
      readFileSync("supabase/migrations/20261125100000_card_and_bank_payments.sql", "utf8"),
    ).toContain("pay_notified_at = now()");
    expect(env.writes).toEqual([]);
  });
  it("failed: they are told, nothing is recorded, and the plan's reminders go on as they were", async () => {
    const env = world();
    const res = await post(FAILED);
    expect(await res.json()).toEqual({ ok: true, handled: true, result: "bank_failed" });
    expect(told[0]![0]).toEqual(["a1", "m1"]);
    expect(told[0]![1]).toMatchObject({ title: "Bank payment failed: Main Plant" });
    // Nov 26, 2026: the "on its way" stamp of that payment is taken off, and nothing else.
    expect(env.rpcCalls).toEqual([
      {
        fn: "roof_care_bank_pending",
        args: { p_plan: PLAN, p_ref: "pi_9", p_amount: 840, p_step: "failed" },
      },
    ]);
    expect(env.writes).toEqual([]);
  });
  it("cleared: recorded as the payment, and told as a bank payment", async () => {
    const env = world();
    const res = await post(CLEARED);
    expect(await res.json()).toMatchObject({ ok: true, handled: true, result: "started" });
    expect(env.rpcCalls.map((c) => c.fn)).toContain("roof_care_card_paid");
    expect(told[0]![1]).toMatchObject({ title: "Roof Care plan paid by bank payment: Main Plant" });
  });
  it("started, for a plan that is not waiting any more: told, and its mark is left alone", async () => {
    const env = world("active");
    await post(STARTED);
    expect(told).toHaveLength(1);
    // Nov 26, 2026: told in other words. It used to say "The plan starts when it clears" of a
    // plan that could not start. The database is asked and stamps nothing for it.
    expect(told[0]![1]).toMatchObject({
      kind: "plan_money_alarm",
      title: "Bank payment started for a plan that is not waiting: Main Plant",
    });
    expect(env.rpcCalls.map((c) => c.fn)).toEqual(["roof_care_bank_pending"]);
  });
  it("a step for a plan that is not there is answered and tells nobody", async () => {
    world();
    const other = event("checkout.session.async_payment_failed", "unpaid", {
      metadata: { kind: "roof_care_plan", plan_id: "11111111-1111-4111-8111-111111111111" },
    });
    const res = await post(other);
    expect(await res.json()).toMatchObject({ ok: true, handled: false });
    expect(told).toEqual([]);
  });
  it("a live step while the site's key is a test key records nothing, as for a card", async () => {
    const env = world();
    const res = await post({ ...FAILED, livemode: true });
    expect(await res.json()).toMatchObject({ ok: false, handled: true });
    expect(env.rpcCalls).toEqual([]);
    expect(told[0]![1]).toMatchObject({ title: "A card payment notice was refused: Main Plant" });
  });
});

describe("what the owner sets in Stripe", () => {
  it("the keys page names a restricted key and the three events", () => {
    const keys = flat("docs/keys-and-secrets.md");
    expect(keys).toContain("checkout.session.async_payment_failed");
    expect(keys).toContain("restricted key");
  });
  it("the payment page lets Stripe offer what is turned on: no method is fixed in the code", () => {
    expect(flat("src/lib/roof-care-checkout.ts")).not.toContain("payment_method_types");
  });
});

/**
 * What the site answers Stripe, and who is told (the audit of Nov 25, numbers 2, 3, 4 and 26;
 * owner: "go on 1, 2, 3 (do you want to just go ahead and build bank payments too?), 4 ... 26").
 *
 *   2. A payment the database could not record was answered 200: Stripe never sent it again,
 *      and no row of it existed. Now 500, so Stripe sends it again, and the admins are told
 *      once for a payment, not at every try.
 *   3. A payment from a bank account was recorded as a card payment, and nothing followed it
 *      while it was on its way. Now it is stamped on the plan, recorded as a bank payment, and
 *      "started" is said only of a plan that is waiting.
 *   4. A paid checkout in another currency, and one for a plan that is gone, were answered and
 *      told to nobody. Now the admins are told money was taken and could not be matched.
 *  26. The alarms wore the kind of the ordinary "paid" notice, under the Roof Care plan tick.
 *      Now they have a kind of their own that no switch and no tick turns off.
 *
 * Every test of the route fails on the code of Nov 25. Amounts and names are made up.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const told: { ids: string[]; notice: { kind: string; title: string; body: string } }[] = [];
const closed: string[] = [];
const hold = { admin: null as unknown, notifyFails: false };
vi.mock("@/lib/notify.server", () => ({
  notify: async (ids: string[], notice: { kind: string; title: string; body: string }) => {
    if (hold.notifyFails) throw new Error("the notices could not be written");
    told.push({ ids, notice });
    // As the real one does: a row for each person told.
    const rows = (hold.admin as { __rows: Record<string, unknown>[] }).__rows;
    for (const id of ids) rows.push({ id: rows.length + 1, user_id: id, ...notice });
    return ids.length;
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
vi.mock("@/lib/roof-care-checkout.server", async (real) => ({
  ...(await real<typeof import("@/lib/roof-care-checkout.server")>()),
  expirePlanCardPages: async (_admin: unknown, planId: string) => {
    closed.push(planId);
    return { closed: 0, failed: [] };
  },
}));

import { KIND_CATEGORIES, noticeCategory } from "@/lib/notice-categories";
import {
  ALWAYS_SENT_KINDS,
  NOTICE_TYPES,
  NOTICE_TYPE_KEYS,
  PLAN_MONEY_ALARM_KIND,
  noticeFilters,
  noticeType,
  takesNotice,
} from "@/lib/notice-types";
import {
  bankPaymentNotice,
  cardModeNotice,
  cardNotRecordedNotice,
  cardPaidNotice,
  paidPlanEvent,
  unmatchedMoneyNotice,
  unmatchedPaidEvent,
} from "@/lib/roof-care-checkout";
import { Route } from "@/routes/api.stripe.webhook";
import { fakeSupabase } from "@/test/fake-supabase";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
const PLAN = "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e27";
const GONE = "11111111-1111-4111-8111-111111111127";
const SECRET = "whsec_made_up_for_tests";
const sign = (body: string) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${body}`, "utf8").digest("hex")}`;
};
const event = (type: string, payment_status: string, over: Record<string, unknown> = {}) => ({
  type,
  livemode: false,
  data: {
    object: {
      id: "cs_test_1",
      payment_status,
      currency: "usd",
      amount_total: 84000,
      payment_intent: "pi_27",
      metadata: { kind: "roof_care_plan", plan_id: PLAN },
      ...over,
    },
  },
});
const CARD = event("checkout.session.completed", "paid");
const BANK_STARTED = event("checkout.session.completed", "unpaid");
const BANK_FAILED = event("checkout.session.async_payment_failed", "unpaid");
const BANK_CLEARED = event("checkout.session.async_payment_succeeded", "paid");

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

type Paid = (args: Record<string, unknown>) => unknown;
const world = (
  o: {
    status?: string;
    paid?: Paid;
    bank?: (args: Record<string, unknown>) => unknown;
    payment?: Record<string, unknown> | null;
  } = {},
) => {
  const status = o.status ?? "awaiting_payment";
  const notifications: Record<string, unknown>[] = [];
  const env = fakeSupabase(
    {
      roof_care_plans: [
        { id: PLAN, plan: "care", site_id: "s1", customer_email: null, status, sold_by: null },
      ],
      crm_sites: [{ id: "s1", name: "Main Plant" }],
      profiles: [
        { id: "a1", role: "admin" },
        { id: "m1", role: "manager" },
        { id: "t1", role: "user" },
      ],
      roof_care_card_payments: o.payment ? [{ id: "c1", plan_id: PLAN, ...o.payment }] : [],
      notifications,
    },
    {
      rpcs: {
        roof_care_card_paid: (a) => (o.paid ? o.paid(a) : "started"),
        roof_care_bank_pending: (a) =>
          o.bank
            ? o.bank(a)
            : a["p_step"] === "failed"
              ? "cleared"
              : status === "awaiting_payment"
                ? "started"
                : "not_waiting",
      },
    },
  );
  hold.admin = Object.assign(env.db as object, { __rows: notifications });
  return env;
};
const fail =
  (message: string): Paid =>
  () => {
    throw new Error(message);
  };

let noisy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  told.length = 0;
  closed.length = 0;
  hold.notifyFails = false;
  vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_made_up_for_tests");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  noisy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  noisy.mockRestore();
});

describe("2. a payment that could not be recorded is sent again by Stripe", () => {
  it("is answered 500, not 200", async () => {
    world({ paid: fail("canceling statement due to lock timeout") });
    const res = await post(CARD);
    // On the code of Nov 25 this was 200 with { ok: false }: Stripe took it as delivered.
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "The payment could not be recorded" });
  });
  it("tells the admins and managers once for the payment, however often it is sent again", async () => {
    world({ paid: fail("could not reach the database") });
    for (let i = 0; i < 4; i += 1) expect((await post(CARD)).status).toBe(500);
    expect(told).toHaveLength(1);
    expect(told[0]!.ids).toEqual(["a1", "m1"]);
    expect(told[0]!.notice).toEqual({
      kind: "plan_money_alarm",
      title: "A card payment could not be recorded: Main Plant",
      body: "A payment of $840.00 came in online and the site could not record it just now, so the plan has not started. The payment company sends it again by itself for up to three days. If the plan still shows as not paid tomorrow, look the payment up in Stripe. Reference pi_27.",
      url: "/properties/s1",
    });
    // The database's own words are for the server log, never for the office.
    expect(told[0]!.notice.body).not.toContain("database");
  });
  it("another payment that fails the same way is told for itself", async () => {
    world({ paid: fail("could not reach the database") });
    await post(CARD);
    await post(event("checkout.session.completed", "paid", { payment_intent: "pi_28" }));
    expect(told.map((t) => t.notice.body.slice(-16))).toEqual([
      "Reference pi_27.",
      "Reference pi_28.",
    ]);
  });
  it("the try that gets through records it once and says so", async () => {
    let tries = 0;
    world({
      paid: () => {
        tries += 1;
        if (tries < 3) throw new Error("could not reach the database");
        return "started";
      },
    });
    expect((await post(CARD)).status).toBe(500);
    expect((await post(CARD)).status).toBe(500);
    const res = await post(CARD);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, handled: true, result: "started" });
    expect(told.map((t) => t.notice.title)).toEqual([
      "A card payment could not be recorded: Main Plant",
      "Roof Care plan paid by card: Main Plant",
    ]);
  });
  it("anything else that goes wrong after the signature is proven is a 500 too", async () => {
    world();
    hold.admin = new Proxy(hold.admin as object, {
      get: (t, k) => {
        if (k === "from")
          return () => {
            throw new Error("the client fell over");
          };
        return (t as Record<string | symbol, unknown>)[k];
      },
    });
    const res = await post(CARD);
    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBe(false);
  });
  it("a payment already recorded, and an event that is not ours, are still 200", async () => {
    world({ paid: () => "already" });
    const again = await post(CARD);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, handled: true, result: "already" });
    const other = await post({ type: "customer.created", livemode: false, data: { object: {} } });
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual({ ok: true, handled: false });
    expect(told).toEqual([]);
  });
  it("a bad signature is still a 400, and nothing is looked at", async () => {
    const env = world();
    const body = JSON.stringify(CARD);
    const res = await (
      Route as unknown as {
        options: { server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } } };
      }
    ).options.server.handlers.POST({
      request: new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        body,
        headers: { "stripe-signature": "t=1,v1=" + "0".repeat(64) },
      }),
    });
    expect(res.status).toBe(400);
    expect(env.rpcCalls).toEqual([]);
  });
});

describe("3. a payment from a bank account", () => {
  it("cleared: recorded as a bank payment, not as a card payment", async () => {
    const env = world();
    const res = await post(BANK_CLEARED);
    expect(await res.json()).toEqual({ ok: true, handled: true, result: "started" });
    const call = env.rpcCalls.find((c) => c.fn === "roof_care_card_paid")!;
    // On the code of Nov 25 the database was never told: p_bank was not passed.
    expect(call.args).toEqual({ p_plan: PLAN, p_amount: 840, p_ref: "pi_27", p_bank: true });
    expect(told[0]!.notice.title).toBe("Roof Care plan paid by bank payment: Main Plant");
    expect(told[0]!.notice.kind).toBe("plan_card_paid");
  });
  it("a card payment is told to the database as a card payment", async () => {
    const env = world();
    await post(CARD);
    expect(env.rpcCalls.find((c) => c.fn === "roof_care_card_paid")!.args["p_bank"]).toBe(false);
  });
  it("started: stamped on the plan, the other open pages closed, and the office told", async () => {
    const env = world();
    const res = await post(BANK_STARTED);
    expect(await res.json()).toEqual({ ok: true, handled: true, result: "bank_started" });
    expect(env.rpcCalls).toEqual([
      {
        fn: "roof_care_bank_pending",
        args: { p_plan: PLAN, p_ref: "pi_27", p_amount: 840, p_step: "started" },
      },
    ]);
    expect(closed).toEqual([PLAN]);
    expect(told).toHaveLength(1);
    expect(told[0]!.notice.title).toBe("Bank payment started: Main Plant");
    // News, not an alarm: it stays under the Roof Care plan tick.
    expect(told[0]!.notice.kind).toBe("plan_card_paid");
  });
  it("started, sent a second time: nothing is said twice", async () => {
    world({ bank: () => "already" });
    await post(BANK_STARTED);
    expect(told).toEqual([]);
    expect(closed).toEqual([]);
  });
  it("started, for a plan that is not waiting: it is not said to start when it clears", async () => {
    world({ status: "active" });
    await post(BANK_STARTED);
    expect(told).toHaveLength(1);
    expect(told[0]!.notice).toEqual({
      kind: "plan_money_alarm",
      title: "Bank payment started for a plan that is not waiting: Main Plant",
      body: "A customer started a bank payment of $840.00 for the Roof Care plan, and that plan is not waiting for a payment: it was paid another way, or it has ended. Nothing was recorded. If the payment clears in the next few business days, you will be told to send it back. Reference pi_27.",
      url: "/properties/s1",
    });
    // On the code of Nov 25: "The plan starts when it clears, and you will be told then."
    expect(told[0]!.notice.body).not.toContain("starts when it clears");
    // Told once, though Stripe may send it again.
    await post(BANK_STARTED);
    expect(told).toHaveLength(1);
  });
  it("failed: the stamp is taken off and the office is told once, as an alarm", async () => {
    const env = world();
    await post(BANK_FAILED);
    await post(BANK_FAILED);
    expect(env.rpcCalls.map((c) => [c.fn, c.args["p_step"]])).toEqual([
      ["roof_care_bank_pending", "failed"],
      ["roof_care_bank_pending", "failed"],
    ]);
    expect(told).toHaveLength(1);
    expect(told[0]!.notice.kind).toBe("plan_money_alarm");
    expect(told[0]!.notice.title).toBe("Bank payment failed: Main Plant");
  });
  it("a step the database could not follow is sent again by Stripe", async () => {
    world({
      bank: () => {
        throw new Error("could not reach the database");
      },
    });
    const res = await post(BANK_STARTED);
    expect(res.status).toBe(500);
    expect(told).toEqual([]);
  });
  it("a payment that is in closes the plan's other open pages, a short one's too", async () => {
    world();
    await post(CARD);
    expect(closed).toEqual([PLAN]);
    closed.length = 0;
    world({
      paid: () => "send_back",
      payment: {
        ref: "pi_27",
        amount: 800,
        outcome: "send_back",
        reason: "short",
        owed: 840,
        over: 0,
      },
    });
    await post(CARD);
    expect(closed).toEqual([PLAN]);
    closed.length = 0;
    // Nothing new was recorded: nothing to close.
    world({ paid: () => "already" });
    await post(CARD);
    expect(closed).toEqual([]);
  });
});

describe("4. money the site cannot match to a plan", () => {
  const CAD = event("checkout.session.completed", "paid", {
    currency: "cad",
    amount_total: 117500,
  });
  it("another currency is not a plan's payment, and is known as money that was taken", () => {
    expect(paidPlanEvent(CAD)).toBeNull();
    expect(unmatchedPaidEvent(CAD)).toEqual({
      plan_id: PLAN,
      amount_words: "1,175.00 CAD",
      ref: "pi_27",
      usd: false,
    });
    // Not for a payment that reads fine, one not paid yet, or a checkout that is not a plan's.
    expect(unmatchedPaidEvent(CARD)).toBeNull();
    expect(unmatchedPaidEvent(BANK_STARTED)).toBeNull();
    expect(
      unmatchedPaidEvent(event("checkout.session.completed", "paid", { metadata: {} })),
    ).toBeNull();
    expect(unmatchedPaidEvent(null)).toBeNull();
  });
  it("another currency: the admins and managers are told, and nothing is recorded", async () => {
    const env = world();
    const res = await post(CAD);
    expect(res.status).toBe(200);
    // On the code of Nov 25: { ok: true, handled: false }, and nobody was told.
    expect(await res.json()).toEqual({ ok: true, handled: true, result: "unmatched" });
    expect(env.rpcCalls).toEqual([]);
    expect(told).toHaveLength(1);
    expect(told[0]!.ids).toEqual(["a1", "m1"]);
    expect(told[0]!.notice).toEqual({
      kind: "plan_money_alarm",
      title: "Money was taken and could not be matched: Main Plant",
      body: "A payment of 1,175.00 CAD was taken online for a Roof Care plan, and it is not in US dollars, so the site cannot tell whether it covers the plan. Nothing was recorded and no plan was started. Look the payment up in Stripe by its reference, then send it back or record it by hand. Reference pi_27.",
      url: "/properties/s1",
    });
  });
  it("a plan that is gone: the admins and managers are told, with the reference", async () => {
    world();
    const res = await post(
      event("checkout.session.completed", "paid", {
        metadata: { kind: "roof_care_plan", plan_id: GONE },
      }),
    );
    expect(res.status).toBe(200);
    // On the code of Nov 25: { ok: true, handled: false, reason: "No such plan" }, told to nobody.
    expect(await res.json()).toEqual({ ok: true, handled: true, result: "unmatched" });
    expect(told).toHaveLength(1);
    expect(told[0]!.notice).toEqual({
      kind: "plan_money_alarm",
      title: "Money was taken and could not be matched",
      body: "A payment of $840.00 was taken online for a Roof Care plan, and the plan it was for is no longer on the site. Nothing was recorded and no plan was started. Look the payment up in Stripe by its reference, then send it back or record it by hand. Reference pi_27.",
      url: null,
    });
  });
  it("it is the only record, so when nobody could be told Stripe is asked to send it again", async () => {
    world();
    hold.notifyFails = true;
    expect((await post(CAD)).status).toBe(500);
    hold.notifyFails = false;
    expect((await post(CAD)).status).toBe(200);
    // And once it is said, it is not said again.
    expect((await post(CAD)).status).toBe(200);
    expect(told).toHaveLength(1);
  });
  it("a bank step for a plan that is gone has taken nothing: answered and left", async () => {
    world();
    const res = await post(
      event("checkout.session.async_payment_failed", "unpaid", {
        metadata: { kind: "roof_care_plan", plan_id: GONE },
      }),
    );
    expect(await res.json()).toMatchObject({ ok: true, handled: false });
    expect(told).toEqual([]);
  });
});

describe("26. the money alarms have a kind no switch and no tick turns off", () => {
  const base = { plan: "care", site_id: "s1", site: "Main Plant" };
  const row = { amount: 840, outcome: "send_back", owed: 0, over: 0, ref: "pi_9" };
  const hermit = {
    notify_leads: false,
    notify_opportunities: false,
    notify_service: false,
    notify_bids: false,
    notify_storms: false,
    notify_off: [...NOTICE_TYPE_KEYS],
  };
  const alarms = () => [
    cardPaidNotice({ ...base, result: "send_back", payment: { ...row, reason: "paid_already" } }),
    cardPaidNotice({ ...base, result: "send_back", payment: { ...row, reason: "short" } }),
    // Paid, and part of it has to go back.
    cardPaidNotice({
      ...base,
      result: "invoice_paid",
      payment: { ...row, outcome: "started", reason: null, amount: 940, owed: 840, over: 100 },
    }),
    bankPaymentNotice({ ...base, step: "failed", amount: 840, ref: "pi_9" }),
    bankPaymentNotice({ ...base, step: "started", amount: 840, ref: "pi_9", waiting: false }),
    cardNotRecordedNotice({ ...base, amount: 840, ref: "pi_9" }),
    unmatchedMoneyNotice({ ...base, amount_words: "$840.00", ref: "pi_9", why: "no_plan" }),
    cardModeNotice({ ...base, event: "test", key: "live", ref: "pi_9" }),
  ];
  it("every alarm wears it", () => {
    expect(PLAN_MONEY_ALARM_KIND).toBe("plan_money_alarm");
    // On the code of Nov 25 each of these was kind plan_card_paid.
    for (const n of alarms()) expect(n.kind, n.title).toBe(PLAN_MONEY_ALARM_KIND);
    expect(alarms().map((n) => n.title.split(":")[0])).toEqual([
      "Card payment to send back",
      "Card payment to send back",
      "Roof Care plan paid by card",
      "Bank payment failed",
      "Bank payment started for a plan that is not waiting",
      "A card payment could not be recorded",
      "Money was taken and could not be matched",
      "A card payment notice was refused",
    ]);
  });
  it("it is under no switch and no tick, so it reaches a person who turned everything off", () => {
    expect(ALWAYS_SENT_KINDS).toEqual([PLAN_MONEY_ALARM_KIND]);
    for (const kind of ALWAYS_SENT_KINDS) {
      expect(KIND_CATEGORIES[kind]).toBeUndefined();
      expect(noticeCategory(kind, "/properties/s1")).toBeNull();
      expect(NOTICE_TYPES.some((t) => t.match.some((m) => m.kinds.includes(kind)))).toBe(false);
      expect(noticeFilters(hermit).kinds).not.toContain(kind);
    }
    for (const n of alarms()) {
      expect(noticeType(n.kind, n.url, n.title)).toBeNull();
      expect(takesNotice(hermit, n), n.title).toBe(true);
    }
  });
  it("the manager who unticks Roof Care plan stops the reminder and the news, not the alarms", () => {
    const manager = { notify_opportunities: true, notify_off: ["opportunities_care_plan"] };
    const reminder = {
      kind: "plan_needs_payment",
      url: "/properties/s1",
      title: "Roof Care plan still not paid: Main Plant",
    };
    const paid = cardPaidNotice({ ...base, result: "invoice_paid" });
    const started = bankPaymentNotice({ ...base, step: "started", amount: 840, ref: "pi_9" });
    expect(paid.kind).toBe("plan_card_paid");
    expect(started.kind).toBe("plan_card_paid");
    expect(takesNotice(manager, reminder)).toBe(false);
    expect(takesNotice(manager, paid)).toBe(false);
    expect(takesNotice(manager, started)).toBe(false);
    // On the code of Nov 25 these went with the tick.
    for (const n of alarms()) expect(takesNotice(manager, n), n.title).toBe(true);
  });
  it("money to send back from a bank payment is said as one", () => {
    const n = cardPaidNotice({
      ...base,
      result: "send_back",
      payment: { ...row, reason: "paid_already" },
      bank: true,
    });
    expect(n.title).toBe("Bank payment to send back: Main Plant");
    expect(n.body).toBe(
      "A bank payment of $840.00 came in online for a Roof Care plan that was already paid. The plan is not changed. Send the $840.00 back to the customer. Reference pi_9.",
    );
  });
  it("the route writes no notice of its own any more: the words are in one place", () => {
    const route = flat("src/routes/api.stripe.webhook.ts");
    expect(route).not.toContain('kind: "plan_card_paid"');
    expect(route).toContain("cardNotRecordedNotice({");
    expect(route).toContain("unmatchedMoneyNotice({");
  });
  it("the tick's own words no longer promise the alarms", () => {
    expect(NOTICE_TYPES.find((t) => t.key === "opportunities_care_plan")!.help).toBe(
      "A plan is signed and not paid, was paid by card or from a bank account, or expired.",
    );
  });
});

/**
 * Roof Care: what the owner said "go" on, Nov 19, night
 * (docs/qa/roof-care-go-aheads-2026-11-19.md).
 *
 *  - "build the infrastructure for this and I'll add the stripe backend when I get that done":
 *    signing with Card goes on to a card payment page, and the payment starts the plan.
 *  - The cleaning a plan includes is answered at each inspection, and the budget forecast is
 *    marked sent. Until now the site kept neither.
 *  - An expired plan's Care Plan button opened a NEW sign-up, which dropped what the renewal
 *    owed the customer for an inspection that was not done.
 *  - A year paid by card and refunded in full left the card fee as a loss.
 *
 * THE NUMBERS HERE ARE MADE UP.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const told: unknown[][] = [];
const hold = { admin: null as unknown, service: true };
vi.mock("@/lib/notify.server", () => ({
  notify: async (...a: unknown[]) => {
    told.push(a);
    return 1;
  },
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => hold.service,
  appUrl: () => (process.env["APP_URL"] || "").replace(/\/+$/, ""),
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

import { benefitsUsed } from "@/lib/roof-care-benefits";
import {
  cardPaidNotice,
  cardPaidWords,
  CHECKOUT_NOT_SET_UP,
  CHECKOUT_NOT_WAITING,
  checkoutAmount,
  checkoutForm,
  paidPlanEvent,
  parseSignatureHeader,
  toCents,
} from "@/lib/roof-care-checkout";
import { startPlanCheckout } from "@/lib/roof-care-checkout.functions";
import { createCheckoutSession, verifyStripeSignature } from "@/lib/roof-care-checkout.server";
import {
  cleaningAnswerWords,
  cleaningAsked,
  cleaningOpen,
  cleaningProblem,
  cleaningTally,
  CLEANING_NEEDS_WHY,
} from "@/lib/roof-care-cleaning";
import { markRoofCareForecast, setRoofCareCleaning } from "@/lib/roof-care-cleaning.functions";
import {
  readRefundWorked,
  refundLines,
  ROOF_CARE_TERMS,
  ROOF_CARE_TERMS_VERSION,
  type RoofCarePlan,
} from "@/lib/roof-care-plan";
import { asRoofCareSettings, SETTING_LABELS, settingsProblems } from "@/lib/roof-care-price";
import { Route } from "@/routes/api.stripe.webhook";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const run = (fn: unknown, db: unknown, data: unknown, userId = "u1") =>
  (fn as (a: unknown) => Promise<unknown>)({ data, context: { supabase: db, userId } });
const SQL = flat(read("supabase/migrations/20261119980000_roof_care_cleaning_card_checkout.sql"));
const CARD = read("src/components/roof-care/plan-card.tsx");
const PLAN = "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e11";
const VISIT = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

// ── The card fee off a refund ───────────────────────────────────────────────────────────────

describe("a year paid by card is refunded less the card fee", () => {
  it("the fee is its own line, and the refund is what is left", () => {
    const w = readRefundWorked({
      paid: 1840,
      inspections_done: 0,
      share: 1840,
      repairs: 0,
      travel: 0,
      card_fee: 51.83,
      refund: 1788.17,
    })!;
    expect(w.card_fee).toBe(51.83);
    expect(refundLines(w)).toEqual([
      "Paid for the year: $1,840.00",
      "Inspections done: 0 of 2",
      "Share for the inspections not done: $1,840.00",
      "Card fee on the amount refunded: $51.83 off",
      "Refund: $1,788.17",
    ]);
    // An answer made before the fee existed reads as none, and says nothing of one.
    const old = readRefundWorked({
      paid: 100,
      inspections_done: 1,
      share: 50,
      repairs: 0,
      refund: 50,
    })!;
    expect(old.card_fee).toBe(0);
    expect(refundLines(old).join(" ")).not.toContain("Card fee");
  });
  it("the database takes it on what is refunded, at the rate in the plan settings, for a card payment only", () => {
    expect(SQL).toContain("v_before := greatest(v_share - v_repairs - v_travel, 0);");
    expect(SQL).toContain(
      "v_fee := least(v_before, round(v_before * coalesce(v_pct, 0) / 100.0 + coalesce(v_flat, 0), 2));",
    );
    expect(SQL).toContain("if v_card and v_before > 0 then");
    expect(SQL).toContain("'card_fee', v_fee, 'refund', v_before - v_fee);");
    // Card: paid online, or its invoice marked paid by card, or said at sign-up with no
    // invoice saying otherwise.
    expect(SQL).toContain("v_card := p.card_paid_on is not null");
    expect(SQL).toContain("lower(coalesce(i.paid_method, '')) like '%card%'");
    // No rate is typed into the code or the database change: it is two of the plan settings.
    expect(SQL).toContain("nullif(s.data->>'card_fee_pct', '')::numeric");
    expect(SQL).not.toMatch(/2\.9|0\.30?\b(?!\d)/);
  });
  it("the rate is two boxes on the plan setup, and blank takes nothing off or breaks no price", () => {
    expect(SETTING_LABELS.card_fee_pct).toBe("Card fee, % of a payment");
    expect(SETTING_LABELS.card_fee_flat).toBe("Card fee, flat sum per payment ($)");
    const page = flat(read("src/components/roof-care-settings.tsx"));
    expect(page).toContain('"min_price_sqft", "card_fee_pct", "card_fee_flat", ],');
    const s = asRoofCareSettings({ card_fee_pct: 3.5, card_fee_flat: 0.25 });
    expect([s.card_fee_pct, s.card_fee_flat]).toEqual([3.5, 0.25]);
    // Neither is asked for before a price can be given.
    expect(settingsProblems(asRoofCareSettings({})).join(" ")).not.toContain("Card fee");
  });
  it("the agreement says so, in a new version", () => {
    // (Nov 19, late: version 2026-11-19.4. Term 7 charges the return trip after the first visit
    // we could not do, and term 8 bills a further storm inspection.
    // roof-care-no-access-storm-nov19.test.ts.)
    // (Nov 20: version 2026-11-20.1. Term 7 adds that what is left of the minor repairs amount
    // goes toward a charged return trip first.)
    // (Nov 23: version 2026-11-23.1. Term 3 adds that what the plan includes applies to work
    // done in its twelve months, and that work done before the plan starts is not covered.)
    // (Nov 24: version 2026-11-24.1. The last term says what an inspection is and that we are
    // not responsible for a leak or for a condition we did not find; owner: "the shorter
    // version looks fine".)
    expect(ROOF_CARE_TERMS_VERSION).toBe("2026-11-24.1");
    expect(ROOF_CARE_TERMS[8]).toContain(
      "A year paid by card is refunded less the card processing fee on the amount refunded.",
    );
    expect(ROOF_CARE_TERMS).toHaveLength(11);
  });
});

// ── The cleaning and the forecast ───────────────────────────────────────────────────────────

describe("the cleaning a plan includes is answered at each inspection", () => {
  it("Roof Care is asked the drains, Roof Guard the gutters too, Roof Watch and a storm inspection nothing", () => {
    expect(cleaningAsked("watch", "visit1")).toEqual({ drains: false, gutters: false });
    expect(cleaningAsked("care", "visit2")).toEqual({ drains: true, gutters: false });
    expect(cleaningAsked("guard", "visit1")).toEqual({ drains: true, gutters: true });
    expect(cleaningAsked("guard", "carried")).toEqual({ drains: true, gutters: true });
    expect(cleaningAsked("guard", "storm")).toEqual({ drains: false, gutters: false });
  });
  it("what is still open, and a No needs its reason", () => {
    const asked = cleaningAsked("guard", "visit1");
    expect(cleaningOpen({ asked, drains: null, gutters: null })).toEqual(["drains", "gutters"]);
    expect(cleaningOpen({ asked, drains: true, gutters: null })).toEqual(["gutters"]);
    expect(cleaningOpen({ asked, drains: true, gutters: false })).toEqual([]);
    expect(
      cleaningOpen({ asked: cleaningAsked("care", "visit1"), drains: true, gutters: null }),
    ).toEqual([]);
    expect(cleaningProblem({ asked }, { gutters: false })).toBe(CLEANING_NEEDS_WHY);
    expect(cleaningProblem({ asked }, { gutters: false, note: "No lift on site" })).toBeNull();
    expect(cleaningProblem({ asked }, { drains: true, gutters: true })).toBeNull();
    expect(cleaningAnswerWords(false, "No lift on site")).toBe("No: No lift on site");
    expect(cleaningAnswerWords(null, null)).toBe("Not answered");
  });
  it("the server sends only what was answered, and refuses a No without why", async () => {
    const calls: Record<string, unknown>[] = [];
    const env = fakeSupabase(
      {
        roof_care_visits: [
          {
            id: VISIT,
            plan_id: PLAN,
            kind: "visit1",
            drains_cleaned: null,
            gutters_cleaned: null,
            cleaning_note: null,
            cleaning_by_name: null,
            cleaning_at: null,
          },
        ],
        roof_care_plans: [{ id: PLAN, plan: "guard" }],
      },
      {
        rpcs: {
          roof_care_set_cleaning: (a: Record<string, unknown>) => {
            calls.push(a);
            return null;
          },
        },
      },
    );
    await run(setRoofCareCleaning, env.db, { visit_id: VISIT, drains: true });
    expect(calls).toEqual([{ p_visit: VISIT, p_drains: true }]);
    await expect(
      run(setRoofCareCleaning, env.db, { visit_id: VISIT, gutters: false }),
    ).rejects.toThrow(CLEANING_NEEDS_WHY);
    await run(setRoofCareCleaning, env.db, { visit_id: VISIT, gutters: false, note: " No lift " });
    expect(calls[1]).toEqual({ p_visit: VISIT, p_gutters: false, p_note: "No lift" });
  });
  it("the database holds the same rules, for whoever may work the ticket", () => {
    expect(SQL).toContain("raise exception 'Roof Watch does not include cleaning the drains';");
    expect(SQL).toContain("raise exception 'Only Roof Guard includes cleaning the gutters';");
    expect(SQL).toContain("raise exception 'A storm inspection has no cleaning with it';");
    expect(SQL).toContain(
      "if (p_drains is false or p_gutters is false) and v_note is null then raise exception 'Type why it was not cleaned';",
    );
    expect(SQL).toContain("(not public.is_technician() or public.tech_sees_site(v.site_id))");
  });
  it("the plan year's tally counts what was answered Yes, and says whether the forecast went", () => {
    const visits = [
      { kind: "visit1" as const, drains_cleaned: true, gutters_cleaned: false },
      { kind: "visit2" as const, drains_cleaned: null, gutters_cleaned: null },
      // A storm inspection is not one of the two.
      { kind: "storm" as const, drains_cleaned: true, gutters_cleaned: true },
    ];
    expect(cleaningTally(visits, "drains").words).toBe("Done at 1 of 2 inspections");
    expect(cleaningTally(visits, "gutters").words).toBe("Done at 0 of 2 inspections");
    const plan = {
      plan: "guard",
      visits: [],
      repair_allowance: 0,
      allowance_used: null,
      free_travel_calls: 0,
      free_travel_used: null,
    } as unknown as RoofCarePlan;
    const keys = (p: RoofCarePlan) => benefitsUsed(p, "2027-04-01", 0).map((r) => r.key);
    expect(keys(plan)).toEqual(["inspections", "drains", "gutters", "forecast"]);
    expect(keys({ ...plan, plan: "care" })).toEqual(["inspections", "drains"]);
    expect(keys({ ...plan, plan: "watch" })).toEqual(["inspections"]);
    expect(benefitsUsed(plan, "2027-04-01", 0).at(-1)!.words).toBe("Not sent yet");
    expect(
      benefitsUsed({ ...plan, forecast_sent_on: "2027-03-02" }, "2027-04-01", 0).at(-1)!.words,
    ).toBe("Sent Mar 2, 2027");
  });
  it("the office marks the forecast sent, and can take the mark off", async () => {
    const calls: Record<string, unknown>[] = [];
    const env = fakeSupabase(
      {},
      {
        rpcs: {
          roof_care_forecast_sent: (a: Record<string, unknown>) => {
            calls.push(a);
            return null;
          },
        },
      },
    );
    await run(markRoofCareForecast, env.db, { plan_id: PLAN });
    await run(markRoofCareForecast, env.db, { plan_id: PLAN, sent: false });
    expect(calls).toEqual([
      { p_plan: PLAN, p_sent: true },
      { p_plan: PLAN, p_sent: false },
    ]);
    expect(SQL).toContain(
      "raise exception 'Only the office marks the budget forecast' using errcode = '42501';",
    );
    expect(SQL).toContain("where id = p_plan and plan = 'guard';");
    expect(flat(CARD)).toContain("{active.forecast_sent_on ? FORECAST_UNDO : FORECAST_MARK_SENT}");
  });
});

// ── An expired plan opens its renewal ───────────────────────────────────────────────────────

describe("Care Plan on a property whose plan expired", () => {
  const card = flat(CARD);
  it("opens that plan, for its renewal, and not a new sign-up", () => {
    expect(card).toContain(
      "const lapsed = !active && !waiting && last && isExpired(last) && !last.closed_out ? last : null;",
    );
    expect(card).toContain("(active || waiting || lapsed ? ( <PlanDialog");
    expect(card).toContain(
      'active ? active.plan : waiting ? "awaiting" : lapsed ? "expired" : "none"',
    );
  });
  it("a plan that was closed out is over: there a new sign-up is right", () => {
    // `lapsed` is null for a closed-out plan, so the sign-up opens.
    expect(card).toContain("!last.closed_out ? last : null");
  });
  it("a technician cannot renew, so the customer's wish goes to the office with their name on it", () => {
    expect(card).toContain("{!short && !office && !expired.closed_out && (");
    expect(card).toContain('data-action="roof-care-ask-renew"');
    expect(card).toContain("services: `Renew the ${planName(p.plan)} plan`,");
  });
});

// ── Paying by card online ───────────────────────────────────────────────────────────────────

const SECRET = "whsec_test_made_up";
const sign = (body: string, t: number, secret = SECRET) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
const paidEvent = (over: Record<string, unknown> = {}) => ({
  type: "checkout.session.completed",
  // Nov 24 (public pages audit): every message from Stripe says which side it is from, and the
  // route takes one only from the side of the site's own key. These tests use a test key, so
  // the event is a test one (roof-care-stripe-checks-nov24.test.ts).
  livemode: false,
  data: {
    object: {
      id: "cs_1",
      payment_status: "paid",
      currency: "usd",
      amount_total: 184000,
      payment_intent: "pi_1",
      metadata: { kind: "roof_care_plan", plan_id: PLAN },
      customer_details: { email: "pat@example.com" },
      ...over,
    },
  },
});

describe("the card payment page", () => {
  // Nov 20 (break test, number 26): the invoice decides the amount only when it is the plan's
  // own, for the plan's amount to the cent, draft or final. Until then a final invoice of any
  // amount decided it and a draft never did (roof-care-break-fixes-payments-nov20.test.ts).
  it("the amount is the plan's price less its credit, less what its own invoice holds", () => {
    expect(checkoutAmount({ price: 1840, renewal_credit: 0 }, null)).toBe(1840);
    expect(checkoutAmount({ price: 1840, renewal_credit: 460 }, null)).toBe(1380);
    expect(
      checkoutAmount(
        { price: 1840, renewal_credit: 0 },
        { status: "final", total: 1950.4, paid_amount: 0 },
      ),
    ).toBe(1840);
    expect(
      checkoutAmount(
        { price: 1840, renewal_credit: 0 },
        { status: "final", total: 1840, paid_amount: 360 },
      ),
    ).toBe(1480);
    // A draft for another amount does not decide anything.
    expect(
      checkoutAmount(
        { price: 1840, renewal_credit: 0 },
        { status: "draft", total: 1, paid_amount: 0 },
      ),
    ).toBe(1840);
    expect(toCents(1840)).toBe(184000);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(0)).toBeNull();
    expect(toCents(0.2)).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
  });
  it("one payment for the year, tied to the plan so the payment finds it again", () => {
    const f = checkoutForm({
      plan_id: PLAN,
      plan: "guard",
      plan_number: 1234,
      site_name: "Main Plant",
      cents: 184000,
      email: "pat@example.com",
      success_url: "https://site.example/properties/s1",
      cancel_url: "https://site.example/properties/s1",
    });
    expect(Object.fromEntries(f)).toEqual({
      mode: "payment",
      success_url: "https://site.example/properties/s1",
      cancel_url: "https://site.example/properties/s1",
      client_reference_id: PLAN,
      "metadata[kind]": "roof_care_plan",
      "metadata[plan_id]": PLAN,
      "payment_intent_data[metadata][plan_id]": PLAN,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": "184000",
      "line_items[0][price_data][product_data][name]":
        "Roof Guard plan, one year (RC-1234): Main Plant",
      customer_email: "pat@example.com",
    });
  });
  describe("made at Stripe", () => {
    beforeEach(() => {
      process.env["STRIPE_SECRET_KEY"] = "sk_test_made_up";
    });
    afterEach(() => {
      delete process.env["STRIPE_SECRET_KEY"];
    });
    const ask = {
      plan_id: PLAN,
      plan: "care",
      plan_number: null,
      site_name: "",
      cents: 5000,
      email: null,
      success_url: "https://s/x",
      cancel_url: "https://s/x",
    };
    it("with the secret key, as a form, and hands back the page's address", async () => {
      const seen: { url: string; init: RequestInit }[] = [];
      const fetcher = (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return new Response(
          JSON.stringify({ id: "cs_9", url: "https://checkout.stripe.example/c/9" }),
        );
      }) as unknown as typeof fetch;
      expect(await createCheckoutSession(ask, fetcher)).toEqual({
        id: "cs_9",
        url: "https://checkout.stripe.example/c/9",
      });
      expect(seen[0]!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
      const h = seen[0]!.init.headers as Record<string, string>;
      expect(h["Authorization"]).toBe("Bearer sk_test_made_up");
      expect(h["Content-Type"]).toBe("application/x-www-form-urlencoded");
      expect(String(seen[0]!.init.body)).toContain(
        "line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=5000",
      );
    });
    it("Stripe's own words come back when it refuses", async () => {
      const fetcher = (async () =>
        new Response(JSON.stringify({ error: { message: "Invalid API Key provided" } }), {
          status: 401,
        })) as unknown as typeof fetch;
      await expect(createCheckoutSession(ask, fetcher)).rejects.toThrow("Invalid API Key provided");
    });
  });
  it("until the secrets are in, Card is the office's, and nothing is asked of Stripe", async () => {
    delete process.env["STRIPE_SECRET_KEY"];
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    const env = fakeSupabase({ roof_care_plans: [] });
    expect(await run(startPlanCheckout, env.db, { plan_id: PLAN })).toEqual({
      url: null,
      reason: CHECKOUT_NOT_SET_UP,
    });
  });
  it("a plan that is not waiting for a payment gets no page", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_test_made_up";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
    process.env["APP_URL"] = "https://site.example";
    const tables = {
      roof_care_plans: [
        {
          id: PLAN,
          plan: "care",
          plan_number: 1,
          site_id: "s1",
          status: "active",
          price: 50,
          renewal_credit: 0,
          customer_email: null,
        },
      ],
    };
    // Nov 20: the database is asked whether the person sees the plan (a technician no longer
    // reads the plans table), and the plan is read with the server's own key.
    const env = fakeSupabase(tables, { rpcs: { roof_care_plan_seen: () => true } });
    expect(await run(startPlanCheckout, env.db, { plan_id: PLAN })).toEqual({
      url: null,
      reason: CHECKOUT_NOT_WAITING,
    });
    expect(env.rpcCalls).toEqual([{ fn: "roof_care_plan_seen", args: { p_plan: PLAN } }]);
    // A person the database says does not see it is told it was not found, whatever the table
    // would have answered.
    const other = fakeSupabase(tables, { rpcs: { roof_care_plan_seen: () => false } });
    await expect(run(startPlanCheckout, other.db, { plan_id: PLAN })).rejects.toThrow(
      "That plan was not found",
    );
    delete process.env["STRIPE_SECRET_KEY"];
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    delete process.env["APP_URL"];
  });
  it("signing with Card goes on to the page when there is one, and stays as before when there is not", () => {
    const card = flat(CARD);
    expect(card).toContain(
      // Nov 23: not for a plan signed from a public request. That customer is not at this
      // screen and pays from their own link (roof-care-pay-link-nov23.test.ts).
      'if (payMethod === "card" && !prefill) { try { pay = (await checkoutFn({ data: { plan_id: made.id } })).url; } catch { pay = null; } }',
    );
    expect(card).toContain("window.location.assign(pay); return;");
    expect(card).toContain("{cardOnline ? PAY_CARD_NOTE_ONLINE : PAY_CARD_NOTE_CUSTOMER}");
    expect(card).toContain('{plan.pay_method === "card" && cardOnline && (');
  });
});

describe("the signed message from Stripe", () => {
  const now = 1_800_000_000;
  const body = JSON.stringify(paidEvent());
  it("is Stripe's own only with the endpoint's secret, the exact body and a recent time", () => {
    expect(verifyStripeSignature(body, sign(body, now), SECRET, now)).toBe(true);
    expect(verifyStripeSignature(body, sign(body, now - 200), SECRET, now)).toBe(true);
    // another secret, a changed body, an old message, no header, a bad header
    expect(verifyStripeSignature(body, sign(body, now, "whsec_other"), SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body + " ", sign(body, now), SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now - 301), SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, null, SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, "t=abc,v1=zz", SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now), "", now)).toBe(false);
    expect(parseSignatureHeader("t=5,v1=" + "a".repeat(64) + ",v0=x")).toEqual({
      t: 5,
      v1: ["a".repeat(64)],
    });
  });
  it("only a paid Roof Care checkout in dollars is a payment", () => {
    expect(paidPlanEvent(paidEvent())).toEqual({
      plan_id: PLAN,
      amount: 1840,
      ref: "pi_1",
      email: "pat@example.com",
      // Nov 24: a card payment, not one from a bank account that cleared later.
      bank: false,
    });
    expect(paidPlanEvent(paidEvent({ payment_status: "unpaid" }))).toBeNull();
    expect(paidPlanEvent(paidEvent({ currency: "cad" }))).toBeNull();
    expect(
      paidPlanEvent(paidEvent({ metadata: { kind: "something_else", plan_id: PLAN } })),
    ).toBeNull();
    expect(
      paidPlanEvent(paidEvent({ metadata: { kind: "roof_care_plan", plan_id: "nope" } })),
    ).toBeNull();
    expect(paidPlanEvent(paidEvent({ amount_total: 0 }))).toBeNull();
    expect(paidPlanEvent({ type: "charge.succeeded", data: { object: {} } })).toBeNull();
    expect(paidPlanEvent(null)).toBeNull();
  });
});

describe("the route Stripe calls", () => {
  const post = (body: string, header: string | null) =>
    (
      Route as unknown as {
        options: { server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } } };
      }
    ).options.server.handlers.POST({
      request: new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        body,
        headers: header ? { "stripe-signature": header } : {},
      }),
    });
  const world = (answer: () => unknown) => {
    const calls: Record<string, unknown>[] = [];
    const env = fakeSupabase(
      {
        roof_care_plans: [{ id: PLAN, plan: "guard", site_id: "s1", customer_email: null }],
        crm_sites: [{ id: "s1", name: "Main Plant" }],
        profiles: [
          { id: "a1", role: "admin" },
          { id: "m1", role: "manager" },
          { id: "t1", role: "user" },
        ],
      },
      {
        rpcs: {
          roof_care_card_paid: (a: Record<string, unknown>) => {
            calls.push(a);
            return answer();
          },
        },
      },
    );
    hold.admin = env.db;
    return { env, calls };
  };
  const nowS = () => Math.floor(Date.now() / 1000);
  beforeEach(() => {
    told.length = 0;
    hold.service = true;
    process.env["STRIPE_SECRET_KEY"] = "sk_test_made_up";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
  });
  afterEach(() => {
    delete process.env["STRIPE_SECRET_KEY"];
    delete process.env["STRIPE_WEBHOOK_SECRET"];
  });

  it("does nothing at all until card payment is set up", async () => {
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    const { calls } = world(() => "started");
    const body = JSON.stringify(paidEvent());
    expect((await post(body, sign(body, nowS()))).status).toBe(503);
    expect(calls).toEqual([]);
  });
  it("refuses a message that is not signed by Stripe, and records nothing", async () => {
    const { calls } = world(() => "started");
    const body = JSON.stringify(paidEvent());
    expect((await post(body, null)).status).toBe(400);
    expect((await post(body, sign(body, nowS(), "whsec_someone_else"))).status).toBe(400);
    expect((await post(body.replace("184000", "1"), sign(body, nowS()))).status).toBe(400);
    expect(calls).toEqual([]);
    expect(told).toEqual([]);
  });
  it("records a signed payment once, with its amount and reference, and tells the admins and managers", async () => {
    const { env, calls } = world(() => "started");
    const body = JSON.stringify(paidEvent());
    const res = await post(body, sign(body, nowS()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, handled: true, result: "started" });
    expect(calls).toEqual([{ p_plan: PLAN, p_amount: 1840, p_ref: "pi_1" }]);
    expect(told).toHaveLength(1);
    expect(told[0]![0]).toEqual(["a1", "m1"]);
    expect((told[0]![1] as { title: string }).title).toBe(
      "Roof Guard plan paid by card: Main Plant",
    );
    // The email typed at Stripe is kept when the plan had none.
    expect(env.tables["roof_care_plans"]![0]!["customer_email"]).toBe("pat@example.com");
  });
  it("the same payment sent again changes nothing and tells nobody", async () => {
    world(() => "already");
    const body = JSON.stringify(paidEvent());
    expect(await (await post(body, sign(body, nowS()))).json()).toEqual({
      ok: true,
      handled: true,
      result: "already",
    });
    expect(told).toEqual([]);
  });
  it("another kind of event is acknowledged and left alone", async () => {
    const { calls } = world(() => "started");
    const body = JSON.stringify({ type: "invoice.paid", data: { object: {} } });
    expect(await (await post(body, sign(body, nowS()))).json()).toEqual({
      ok: true,
      handled: false,
    });
    expect(calls).toEqual([]);
  });
  it("the words the office gets", () => {
    expect(
      cardPaidNotice({ plan: "care", site_id: "s1", site: "Main Plant", result: "invoice_paid" })
        .body,
    ).toBe(
      "The customer paid the year by card online. Its invoice is marked paid and the plan has started.",
    );
    // Nov 20 (break test, number 26): the database no longer answers "not_waiting". A payment
    // for a plan that is not waiting is kept as money to send back, and said so.
    expect(
      cardPaidNotice({ plan: "care", site_id: "s1", site: null, result: "send_back" }).body,
    ).toBe(
      "A card payment came in online for a Roof Care plan that was already paid. The plan is not changed. Send it back to the customer.",
    );
    expect(cardPaidWords({ on: "2027-01-08", amount: 1840, ref: "pi_1" })).toBe(
      "Paid by card online Jan 8, 2027 ($1,840.00, ref pi_1).",
    );
    expect(cardPaidWords({ on: "2027-01-08", amount: null, ref: null })).toBe(
      "Paid by card online Jan 8, 2027.",
    );
  });
  it("only the server's own key can record a card payment, and too little is refused", () => {
    expect(SQL).toContain(
      "revoke all on function public.roof_care_card_paid(uuid, numeric, text, date) from public, anon, authenticated;",
    );
    expect(SQL).toContain(
      "grant execute on function public.roof_care_card_paid(uuid, numeric, text, date) to service_role;",
    );
    expect(SQL).toContain("if p.card_paid_ref = v_ref then return 'already'; end if;");
    expect(SQL).toContain(
      "if p.status = 'awaiting_payment' and coalesce(p_amount, 0) < v_expected - 0.005 then raise exception",
    );
    expect(SQL).toContain("if p.status <> 'awaiting_payment' then return 'not_waiting'; end if;");
  });
});

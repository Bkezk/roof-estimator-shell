/**
 * Nov 23, the owner: "1. A go". A Roof Care customer who signs up away from us (through the QR
 * page) pays by card from a link of their own: the office signs the plan, the customer gets the
 * link by email, opens it, and pays. The payment starts the plan as it does today.
 *
 *  - The link is /pay/<token>: a long random token that belongs to one plan. Only a path of
 *    exactly that shape opens without a sign-in.
 *  - The page tells a visitor about that one plan and nothing else. A made-up token and a plan
 *    that is over get the same answer. Every call is counted against the connection.
 *  - The amount is worked out in one place for the office's card page and the customer's link.
 *  - The link goes in the agreement email, and the office can copy it or email it again.
 *  - A plan signed from a public request does not open the card page on the office's screen.
 *
 * Names and figures are made up and match no plan price.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string; subject: string; text: string; html?: string }[] = [];
const site = { url: "https://portal.example.com", email: true, sendOk: true };
vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (sb: unknown) => sb,
  appUrl: () => site.url,
  emailConfigured: () => site.email,
  hasServiceRole: () => true,
  notify: async () => 0,
  sendEmail: async (m: { to: string; subject: string; text: string; html?: string }) => {
    sent.push(m);
    return site.sendOk ? { ok: true } : { ok: false, error: "the mail company said no" };
  },
}));

import { fakeSupabase } from "@/test/fake-supabase";
import { pageForPath } from "@/lib/access";
import { PUBLIC_NOT_READY, PUBLIC_TOO_MANY, isPublicFormPath } from "@/lib/public-forms";
import {
  CHECKOUT_NO_SITE_ADDRESS,
  CHECKOUT_NOT_SET_UP,
  CHECKOUT_NOT_WAITING,
  type CheckoutAsk,
} from "@/lib/roof-care-checkout";
import { createCheckoutSession, planOwedCents } from "@/lib/roof-care-checkout.server";
import { agreementEmail, payLinkEmail, type PlanEmailFacts } from "@/lib/roof-care-email";
import { EMAIL_NOT_SET_UP } from "@/lib/roof-care-email.server";
import {
  PAY_CLOSED,
  PAY_LINK_NO_EMAIL,
  PAY_OFFLINE,
  PAY_SAMPLE_START,
  SIGNED_PAY_BY_LINK,
  cleanPayToken,
  isPublicPayPath,
  payLinkFor,
  payLinkSentWords,
  payPageState,
  payThanksWords,
  payTokenFromPath,
} from "@/lib/roof-care-pay-link";
import {
  SAMPLE_PAY_FACTS,
  emailPlanPayLink,
  payPageFor,
  payStartFor,
  planPayLink,
  type PayDeps,
} from "@/lib/roof-care-pay-link.functions";
import { ROOF_CARE_TERMS_VERSION } from "@/lib/roof-care-plan";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const run = (fn: unknown, db: unknown, data: unknown, userId = "u1") =>
  (fn as (a: unknown) => Promise<unknown>)({ data, context: { supabase: db, userId } });

const TOKEN = "4f1c2a9e-7b3d-4c5e-9a1f-0b2c3d4e5f60";
const OTHER = "5a1c2a9e-7b3d-4c5e-9a1f-0b2c3d4e5f61";
const PLAN = "3d6a3c1e-1111-4222-8333-444455556666";
const SITE = "2b6a3c1e-1111-4222-8333-444455556666";

const plan = (over: Record<string, unknown> = {}) => ({
  id: PLAN,
  plan: "guard",
  plan_number: 1004,
  site_id: SITE,
  status: "awaiting_payment",
  price: 2222,
  renewal_credit: 0,
  customer_email: "pat@example.com",
  renews_on: "2027-11-22",
  pay_method: "card",
  pay_token: TOKEN,
  pay_link_sent_at: null,
  agreed_by: "Pat Smith",
  ...over,
});
const tables = (p = plan()) => ({
  roof_care_plans: [p],
  crm_sites: [
    {
      id: SITE,
      name: "Main plant",
      address1: "120 Mill St",
      city: "London",
      state: "KY",
      zip: "40741",
    },
  ],
  invoices: [] as Record<string, unknown>[],
  company_settings: [
    { company_name: "JBK Roofing", phone: "888-555-0100", email: "office@example.com" },
  ],
});

const made: CheckoutAsk[] = [];
const deps = (db: unknown, over: Partial<PayDeps> = {}): PayDeps => ({
  admin: db as never,
  key: "k".repeat(40),
  sample: false,
  base: "https://portal.example.com",
  stripe: true,
  owed: planOwedCents,
  makePage: async (ask) => {
    made.push(ask);
    return { id: "cs_test_1", url: "https://card.example.com/pay/cs_test_1" };
  },
  ...over,
});
const take = { rpcs: { public_form_take: () => true, roof_care_plan_seen: () => true } };

beforeEach(() => {
  sent.length = 0;
  made.length = 0;
  site.url = "https://portal.example.com";
  site.email = true;
  site.sendOk = true;
  process.env["STRIPE_SECRET_KEY"] = "sk_test_made_up";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_made_up";
  process.env["NOTIFY_FROM_EMAIL"] = "JBK <office@example.com>";
});
afterEach(() => {
  delete process.env["STRIPE_SECRET_KEY"];
  delete process.env["STRIPE_WEBHOOK_SECRET"];
  delete process.env["NOTIFY_FROM_EMAIL"];
});

describe("the link's address", () => {
  it("is the site's address, /pay/ and the plan's token", () => {
    expect(payLinkFor("https://portal.example.com", TOKEN)).toBe(
      `https://portal.example.com/pay/${TOKEN}`,
    );
    expect(payLinkFor("https://portal.example.com/", TOKEN)).toBe(
      `https://portal.example.com/pay/${TOKEN}`,
    );
  });
  it("only a path of exactly that shape opens without a sign-in", () => {
    expect(payTokenFromPath(`/pay/${TOKEN}`)).toBe(TOKEN);
    expect(payTokenFromPath(`/pay/${TOKEN}/`)).toBe(TOKEN);
    expect(payTokenFromPath(`/pay/${TOKEN.toUpperCase()}`)).toBe(TOKEN);
    for (const bad of [
      "/pay",
      "/pay/",
      "/pay/1",
      "/pay/R-4010",
      `/pay/${TOKEN}/more`,
      `/pay/${TOKEN}x`,
      `/payments/${TOKEN}`,
      `/service/pay/${TOKEN}`,
      "/service",
      "/",
    ])
      expect(isPublicPayPath(bad), bad).toBe(false);
    expect(isPublicPayPath(`/pay/${TOKEN}`)).toBe(true);
    // The QR pages' own rule is not widened by this.
    expect(isPublicFormPath(`/pay/${TOKEN}`)).toBe(false);
    expect(cleanPayToken(7)).toBeNull();
    expect(cleanPayToken("<script>")).toBeNull();
  });
  it("the sign-in gate lets it through beside the two QR pages, and nothing else", () => {
    const gate = flat(read("src/components/auth-gate.tsx"));
    expect(gate).toContain(
      "const isPublicForm = isPublicFormPath(pathname) || isPublicPayPath(pathname);",
    );
    // No page of the office's is behind this address.
    expect(pageForPath(`/pay/${TOKEN}`)).toBeNull();
    const route = read("src/routes/pay.$token.tsx");
    expect(route).toContain('createFileRoute("/pay/$token")');
    expect(route).toContain('{ name: "robots", content: "noindex, nofollow" }');
    // The address holds the token, so it is never handed on as where a visitor came from.
    expect(route).toContain('{ name: "referrer", content: "no-referrer" }');
  });
});

describe("what the page shows", () => {
  it("the button while the plan waits and card payment is set up; never a made-up state", () => {
    expect(payPageState("awaiting_payment", 222200, true)).toBe("pay");
    expect(payPageState("awaiting_payment", 222200, false)).toBe("offline");
    expect(payPageState("awaiting_payment", null, true)).toBe("closed");
    expect(payPageState("active", null, true)).toBe("paid");
    expect(payPageState("ended", null, true)).toBe("closed");
    expect(payPageState(null, 100, true)).toBe("closed");
  });
  it("this plan's name, property and amount, and nothing else of the customer", async () => {
    const env = fakeSupabase(tables(), take);
    const out = await payPageFor(TOKEN, deps(env.db));
    expect(out).toEqual({
      state: "pay",
      plan_name: "Roof Guard",
      plan_label: "RC-1004",
      site: "Main plant",
      amount: 2222,
      runs_until: null,
    });
    expect(JSON.stringify(out)).not.toContain("pat@example.com");
    expect(env.rpcCalls.filter((c) => c.fn === "public_form_take")).toEqual([
      { fn: "public_form_take", args: { p_kind: "pay", p_key: "k".repeat(40) } },
    ]);
    expect(env.writes).toEqual([]);
  });
  it("the amount is what the plan's own invoice still holds", async () => {
    const t = tables(plan({ price: 2222, renewal_credit: 222 }));
    t.invoices = [
      {
        roof_care_plan_id: PLAN,
        status: "final",
        total: 2000,
        paid_amount: 500,
        created_at: "2026-11-23",
      },
    ];
    const env = fakeSupabase(t, take);
    expect((await payPageFor(TOKEN, deps(env.db))).amount).toBe(1500);
    // The same rule the office's card page uses: one function for both.
    expect(
      await planOwedCents(env.db as never, { id: PLAN, price: 2222, renewal_credit: 222 }),
    ).toBe(150000);
    const fns = flat(read("src/lib/roof-care-checkout.functions.ts"));
    expect(fns).toContain("planOwedCents(admin, plan),");
    expect(fns).not.toContain("checkoutAmount(");
  });
  it("paid: thanks, and when the plan year runs to", async () => {
    const env = fakeSupabase(tables(plan({ status: "active" })), take);
    expect(await payPageFor(TOKEN, deps(env.db))).toMatchObject({
      state: "paid",
      amount: null,
      runs_until: "2027-11-22",
    });
    expect(payThanksWords("2027-11-22", () => "Monday, November 22, 2027")).toBe(
      "Your plan has started and runs until Monday, November 22, 2027. Your receipt is on its way by email. We will be in touch to set the day of each inspection.",
    );
  });
  it("a made-up token, another plan's token and a plan that is over all get the same answer", async () => {
    const closed = {
      state: "closed",
      plan_name: "",
      plan_label: "",
      site: "",
      amount: null,
      runs_until: null,
    };
    const env = fakeSupabase(tables(), take);
    expect(await payPageFor(OTHER, deps(env.db))).toEqual(closed);
    expect(await payPageFor("nonsense", deps(env.db))).toEqual(closed);
    expect(await payPageFor(undefined, deps(env.db))).toEqual(closed);
    const over = fakeSupabase(tables(plan({ status: "ended" })), take);
    expect(await payPageFor(TOKEN, deps(over.db))).toEqual(closed);
  });
  it("card payment not set up: says to call, and offers no button", async () => {
    const env = fakeSupabase(tables(), take);
    expect((await payPageFor(TOKEN, deps(env.db, { stripe: false }))).state).toBe("offline");
    expect((await payPageFor(TOKEN, deps(env.db, { base: "" }))).state).toBe("offline");
  });
  it("a connection over its limit is told to wait, and nothing is read", async () => {
    const env = fakeSupabase(tables(), { rpcs: { public_form_take: () => false } });
    await expect(payPageFor(TOKEN, deps(env.db))).rejects.toThrow(PUBLIC_TOO_MANY);
    await expect(payStartFor(TOKEN, deps(env.db))).rejects.toThrow(PUBLIC_TOO_MANY);
    expect(made).toEqual([]);
  });
  it("with no server key: a sample on the test server, a plain refusal anywhere else", async () => {
    expect(await payPageFor(TOKEN, deps(null, { admin: null, sample: true }))).toEqual(
      SAMPLE_PAY_FACTS,
    );
    await expect(payStartFor(TOKEN, deps(null, { admin: null, sample: true }))).rejects.toThrow(
      PAY_SAMPLE_START,
    );
    await expect(payPageFor(TOKEN, deps(null, { admin: null }))).rejects.toThrow(PUBLIC_NOT_READY);
  });
});

describe("the Pay button", () => {
  it("makes the card page for this plan and amount, and comes back to the same link", async () => {
    const env = fakeSupabase(tables(), take);
    expect(await payStartFor(TOKEN, deps(env.db))).toEqual({
      url: "https://card.example.com/pay/cs_test_1",
    });
    expect(made).toEqual([
      {
        plan_id: PLAN,
        plan: "guard",
        plan_number: 1004,
        site_name: "Main plant",
        cents: 222200,
        email: "pat@example.com",
        success_url: `https://portal.example.com/pay/${TOKEN}?paid=1`,
        cancel_url: `https://portal.example.com/pay/${TOKEN}`,
        via: "link",
      },
    ]);
  });
  it("is refused in plain words for a link that is over, and when card payment is off", async () => {
    const paid = fakeSupabase(tables(plan({ status: "active" })), take);
    await expect(payStartFor(TOKEN, deps(paid.db))).rejects.toThrow(PAY_CLOSED);
    const env = fakeSupabase(tables(), take);
    await expect(payStartFor(OTHER, deps(env.db))).rejects.toThrow(PAY_CLOSED);
    await expect(payStartFor(TOKEN, deps(env.db, { stripe: false }))).rejects.toThrow(PAY_OFFLINE);
    expect(made).toEqual([]);
  });
  it("the payment company's own words never reach the visitor", async () => {
    const env = fakeSupabase(tables(), take);
    const noisy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await payStartFor(
      TOKEN,
      deps(env.db, {
        makePage: async () => {
          throw new Error("Invalid API Key provided: sk_test_****");
        },
      }),
    ).catch((e: Error) => e.message);
    noisy.mockRestore();
    expect(out).toBe(PAY_OFFLINE);
  });
  it("the customer's page and the office's page are kept apart at the payment company", async () => {
    const keys: string[] = [];
    const fetcher = (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
      keys.push(init?.headers?.["Idempotency-Key"] ?? "");
      return { ok: true, json: async () => ({ id: "cs_1", url: "https://card.example.com/x" }) };
    }) as unknown as typeof fetch;
    const ask: CheckoutAsk = {
      plan_id: PLAN,
      plan: "guard",
      plan_number: 1004,
      site_name: "Main plant",
      cents: 222200,
      email: null,
      success_url: "https://portal.example.com/a",
      cancel_url: "https://portal.example.com/a",
    };
    await createCheckoutSession(ask, fetcher);
    await createCheckoutSession({ ...ask, via: "link" }, fetcher);
    expect(keys[0]).toMatch(new RegExp(`^roof-care-${PLAN}-222200-`));
    expect(keys[1]).toMatch(new RegExp(`^roof-care-link-${PLAN}-222200-`));
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe("the link in the customer's email", () => {
  const facts: PlanEmailFacts = {
    plan: "guard",
    plan_number: 1004,
    site: "Main plant",
    address: "120 Mill St, London, KY 40741",
    agreed_by: "Pat Smith",
    signed_on: "2026-11-23",
    price: 2222,
    pay_method: "card",
    first_visit: "window",
    first_days: null,
    terms_version: ROOF_CARE_TERMS_VERSION,
    benefits: null,
    company: "JBK Roofing",
    contact: "888-555-0100",
  };
  const link = `https://portal.example.com/pay/${TOKEN}`;
  it("the agreement carries it when there is one, and reads as before when there is none", () => {
    const withLink = agreementEmail({ ...facts, pay_link: link })!;
    expect(withLink.text).toContain("PAY BY CARD");
    expect(withLink.text).toContain(`Pay by card: ${link}`);
    expect(withLink.html).toContain(`<a href="${link}"`);
    const without = agreementEmail(facts)!;
    expect(without.text).not.toContain("PAY BY CARD");
    expect(without.html).not.toContain("/pay/");
    expect(agreementEmail({ ...facts, pay_link: null })!.text).toBe(without.text);
  });
  it("the link sent again by itself says the plan, the property and the amount", () => {
    const mail = payLinkEmail({
      plan: "guard",
      plan_number: 1004,
      site: "Main plant",
      address: "120 Mill St, London, KY 40741",
      agreed_by: "Pat Smith",
      owed: 2222,
      pay_link: link,
      company: "JBK Roofing",
      contact: "888-555-0100",
    });
    expect(mail.subject).toBe("Pay for your JBK Roofing Roof Guard plan (RC-1004)");
    expect(mail.text).toContain(
      "Here is the link to pay for the Roof Guard plan (RC-1004) at Main plant, 120 Mill St, London, KY 40741: $2,222 for the year.",
    );
    expect(mail.text).toContain(`Pay by card: ${link}`);
  });
  it("the scheduled send puts the link in a card plan's agreement only when card payment is set up", () => {
    const server = flat(read("src/lib/roof-care-email.server.ts"));
    expect(server).toContain('const payBase = stripeConfigured() ? appUrl() : "";');
    expect(server).toContain(
      'payBase && p.pay_method === "card" && p.status === "awaiting_payment" && p.pay_token ? payLinkFor(payBase, p.pay_token) : null,',
    );
    expect(server).toContain(
      'if (facts.pay_link) await admin.from("roof_care_plans").update({ pay_link_sent_at: stamp }).eq("id", p.id);',
    );
  });
});

describe("the office's Card payment link box", () => {
  it("hands out the link, and says whether the site can email it", async () => {
    const env = fakeSupabase(tables(), take);
    expect(await run(planPayLink, env.db, { plan_id: PLAN })).toEqual({
      url: `https://portal.example.com/pay/${TOKEN}`,
      reason: null,
      to: "pat@example.com",
      sent_at: null,
      email_reason: null,
    });
    expect(env.writes).toEqual([]);
  });
  it("says in plain words why there is no link yet", async () => {
    const paid = fakeSupabase(tables(plan({ status: "active" })), take);
    expect(await run(planPayLink, paid.db, { plan_id: PLAN })).toMatchObject({
      url: null,
      reason: CHECKOUT_NOT_WAITING,
    });
    const env = fakeSupabase(tables(), take);
    delete process.env["STRIPE_SECRET_KEY"];
    expect(await run(planPayLink, env.db, { plan_id: PLAN })).toMatchObject({
      url: null,
      reason: CHECKOUT_NOT_SET_UP,
    });
    process.env["STRIPE_SECRET_KEY"] = "sk_test_made_up";
    site.url = "";
    expect(await run(planPayLink, env.db, { plan_id: PLAN })).toMatchObject({
      url: null,
      reason: CHECKOUT_NO_SITE_ADDRESS,
    });
  });
  it("is only for someone the database says may see the plan", async () => {
    const env = fakeSupabase(tables(), {
      rpcs: { public_form_take: () => true, roof_care_plan_seen: () => false },
    });
    await expect(run(planPayLink, env.db, { plan_id: PLAN })).rejects.toThrow(
      "That plan was not found",
    );
    await expect(run(emailPlanPayLink, env.db, { plan_id: PLAN })).rejects.toThrow(
      "That plan was not found",
    );
    expect(sent).toEqual([]);
  });
  it("emails the link to the customer on the plan, once pressed, and the plan says when", async () => {
    const env = fakeSupabase(tables(), take);
    const out = (await run(emailPlanPayLink, env.db, { plan_id: PLAN })) as { to: string };
    expect(out.to).toBe("pat@example.com");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("pat@example.com");
    expect(sent[0]!.text).toContain(`https://portal.example.com/pay/${TOKEN}`);
    expect(sent[0]!.text).toContain("$2,222 for the year");
    expect(env.tables["roof_care_plans"]![0]!["pay_link_sent_at"]).toEqual(expect.any(String));
    expect(
      payLinkSentWords({ to: "pat@example.com", sent_at: "2026-11-23T15:00:00Z" }, () => "Nov 23"),
    ).toBe("Emailed to pat@example.com on Nov 23.");
    expect(payLinkSentWords({ to: null, sent_at: null }, () => "x")).toBe("");
  });
  it("is refused in plain words: no address, email not set up, or the send failing", async () => {
    const none = fakeSupabase(tables(plan({ customer_email: null })), take);
    await expect(run(emailPlanPayLink, none.db, { plan_id: PLAN })).rejects.toThrow(
      PAY_LINK_NO_EMAIL,
    );
    expect(await run(planPayLink, none.db, { plan_id: PLAN })).toMatchObject({
      to: null,
      email_reason: PAY_LINK_NO_EMAIL,
    });
    const env = fakeSupabase(tables(), take);
    site.email = false;
    await expect(run(emailPlanPayLink, env.db, { plan_id: PLAN })).rejects.toThrow(
      EMAIL_NOT_SET_UP,
    );
    // The link can still be copied while email is not set up.
    expect(await run(planPayLink, env.db, { plan_id: PLAN })).toMatchObject({
      url: `https://portal.example.com/pay/${TOKEN}`,
      email_reason: EMAIL_NOT_SET_UP,
    });
    site.email = true;
    site.sendOk = false;
    await expect(run(emailPlanPayLink, env.db, { plan_id: PLAN })).rejects.toThrow(
      "The email did not go: the mail company said no",
    );
    expect(env.tables["roof_care_plans"]![0]!["pay_link_sent_at"]).toBeNull();
    expect(sent.length).toBe(1);
  });
  it("is drawn on a plan that waits for a card payment; nothing is sent without a press", () => {
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain('{plan.pay_method === "card" && <PlanPayLinkBox planId={plan.id} />}');
    const box = flat(read("src/components/roof-care/pay-link.tsx"));
    expect(box).toContain("enabled: open,");
    expect(box).toContain("onClick={() => email.mutate()}");
    expect(box).not.toContain("useEffect");
  });
});

describe("a plan signed from a public request, paying by card", () => {
  it("does not open the card page on the office's screen: the customer is not there", () => {
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain('if (payMethod === "card" && !prefill) {');
    expect(card).toContain(
      'if (prefill && payMethod === "card") { toast.success(`${planName(made.plan)} plan signed. ${SIGNED_PAY_BY_LINK}`, {',
    );
    expect(SIGNED_PAY_BY_LINK).toBe(
      "The customer pays from their own card payment link. It is in the agreement emailed to them, and under Card payment link on the plan to copy or send again. The plan starts when the payment is received.",
    );
  });
});

describe("the database", () => {
  const sql = read("supabase/migrations/20261123300000_plan_pay_link_and_won_when_paid.sql");
  const one = flat(sql);
  it("every plan has a token of its own, and nothing is given to the anonymous role", () => {
    expect(one).toContain(
      "add column if not exists pay_token uuid not null default gen_random_uuid(),",
    );
    expect(one).toContain(
      "create unique index if not exists roof_care_plans_pay_token on public.roof_care_plans (pay_token);",
    );
    expect(sql).not.toMatch(/grant [^;]* to anon/);
    expect(sql).not.toMatch(/grant [^;]* to public/);
  });
  it("the payment page has a limit of its own, counted by the site's own server alone", () => {
    expect(one).toContain("elsif p_kind = 'pay' then");
    expect(one).toContain("v_one_cap := 30; v_all_cap := 2000;");
    expect(one).toContain("check (kind in ('quote', 'request', 'pay'));");
    expect(one).toContain(
      "revoke all on function public.public_form_take(text, text) from public, anon, authenticated; grant execute on function public.public_form_take(text, text) to service_role;",
    );
  });
});

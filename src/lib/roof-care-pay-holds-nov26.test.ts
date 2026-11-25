/**
 * When no payment is asked for, and who may ask (the audit of Nov 25, numbers 3, 18 and 28;
 * owner: "go on 1, 2, 3 ... 18 ... 28").
 *
 *  18b. The customer's own page /pay/<token> took a payment on a roof size nobody confirmed.
 *  18c. "On a ticket" was the browser's word (`on_site: true`): no ticket was checked.
 *  18d. A technician read the customer's email and the payment link, and could email it.
 *   3.  While a payment from a bank account is on its way the page still offered Pay for the
 *       whole amount, and a bank payment's receipt said Card.
 *  28a. ?paid=1 made the page say "your receipt is on its way" for good, whatever happened.
 *  28b. A call with no real token used up the day's count that every customer shares.
 *
 * The tests of the server's answers fail on the code of Nov 25. Names and amounts are made up.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string; subject: string; text: string }[] = [];
const pages: unknown[] = [];
const bank = { pending: null as null | { ref: string; amount: number | null; at: string } };
vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (sb: unknown) => sb,
  appUrl: () => "https://portal.example.com",
  emailConfigured: () => true,
  hasServiceRole: () => true,
  notify: async () => 0,
  sendEmail: async (m: { to: string; subject: string; text: string }) => {
    sent.push(m);
    return { ok: true };
  },
}));
vi.mock("@/lib/roof-care-checkout.server", () => ({
  stripeConfigured: () => true,
  planOwedCents: async () => 234500,
  openPlanCardPage: async (_admin: unknown, ask: unknown) => {
    pages.push(ask);
    return { id: "cs_test_1", url: "https://card.example.com/pay/cs_test_1" };
  },
  planCardState: async () => ({ sessions: [], bank_pending: bank.pending, paid_by_bank: false }),
}));

import {
  BANK_PENDING_MAX_DAYS,
  BANK_PENDING_OFFICE,
  bankPendingNow,
  cardPaidWords,
  CHECKOUT_FROM_TICKET,
} from "@/lib/roof-care-checkout";
import { startPlanCheckout } from "@/lib/roof-care-checkout.functions";
import { receiptEmail, type ReceiptFacts } from "@/lib/roof-care-email";
import {
  PAID_LATE_LOOKS_MS,
  PAID_LOOKS_MS,
  PAY_BANK_ON_ITS_WAY,
  PAY_CLOSED,
  PAY_HELD_SIZE,
  PAY_LINK_OFFICE_ONLY,
  PAY_NOT_CONFIRMED,
  PAY_SIZE_NOT_READY,
  payPageOffersPay,
  payPageState,
  payPageView,
  type PlanPayLink,
} from "@/lib/roof-care-pay-link";
import {
  emailPlanPayLink,
  payPageFor,
  payStartFor,
  planPayLink,
  type PayDeps,
} from "@/lib/roof-care-pay-link.functions";
import { ROOF_CARE_TERMS_VERSION } from "@/lib/roof-care-plan";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const sqlFlat = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const run = (fn: unknown, db: unknown, data: unknown, userId = "office") =>
  (fn as (a: unknown) => Promise<unknown>)({ data, context: { supabase: db, userId } });

const PLAN = "3d6a3c1e-1111-4222-8333-444455552626";
const SITE = "2b6a3c1e-1111-4222-8333-444455552626";
const ELSEWHERE = "2b6a3c1e-1111-4222-8333-44445555ffff";
const TOKEN = "4f1c2a9e-7b3d-4c5e-9a1f-0b2c3d4e2626";
const NOBODYS = "5a1c2a9e-7b3d-4c5e-9a1f-0b2c3d4e2627";
const JOB = "5e6a3c1e-1111-4222-8333-444455552626";
const JOB_CLOSED = "5e6a3c1e-1111-4222-8333-444455552627";
const JOB_DELETED = "5e6a3c1e-1111-4222-8333-444455552628";
const JOB_ELSEWHERE = "5e6a3c1e-1111-4222-8333-444455552629";
const SOON = () => new Date(Date.now() - 3_600_000).toISOString();

const world = (over: Record<string, unknown> = {}, take: () => unknown = () => true) =>
  fakeSupabase(
    {
      roof_care_plans: [
        {
          id: PLAN,
          plan: "care",
          plan_number: 1077,
          site_id: SITE,
          status: "awaiting_payment",
          price: 2345,
          renewal_credit: 0,
          customer_email: "pat@example.com",
          renews_on: "2027-11-25",
          pay_method: "card",
          pay_token: TOKEN,
          pay_link_sent_at: null,
          agreed_by: "Pat Smith",
          size_unchecked: false,
          ...over,
        },
      ],
      crm_sites: [{ id: SITE, name: "Main plant", address1: "120 Mill St", city: "London" }],
      company_settings: [{ company_name: "JBK Roofing", phone: "888-555-0100", email: null }],
      profiles: [
        { id: "office", role: "user", access: ["customers"], technician: false, email: "o@x.co" },
        { id: "boss", role: "manager", access: [], technician: false, email: "b@x.co" },
        { id: "tech", role: "user", access: ["service"], technician: true, email: "t@x.co" },
      ],
      service_jobs: [
        { id: JOB, site_id: SITE, stage: "scheduled", deleted_at: null },
        { id: JOB_CLOSED, site_id: SITE, stage: "closed", deleted_at: null },
        { id: JOB_DELETED, site_id: SITE, stage: "open", deleted_at: "2026-11-20T10:00:00Z" },
        { id: JOB_ELSEWHERE, site_id: ELSEWHERE, stage: "open", deleted_at: null },
      ],
    },
    { rpcs: { roof_care_plan_seen: () => true, public_form_take: take } },
  );

const deps = (db: unknown, over: Partial<PayDeps> = {}): PayDeps => ({
  admin: db as never,
  key: "k".repeat(40),
  sample: false,
  base: "https://portal.example.com",
  stripe: true,
  owed: async () => 234500,
  card: async () => ({ bank_pending: bank.pending }),
  makePage: async (ask) => {
    pages.push(ask);
    return { id: "cs_test_1", url: "https://card.example.com/pay/cs_test_1" };
  },
  ...over,
});
const counted = (env: ReturnType<typeof world>) =>
  env.rpcCalls.filter((c) => c.fn === "public_form_take").length;

beforeEach(() => {
  sent.length = 0;
  pages.length = 0;
  bank.pending = null;
  process.env["NOTIFY_FROM_EMAIL"] = "JBK <office@example.com>";
});

describe("18b. the customer's own page while the roof size is not confirmed", () => {
  it("says so, shows no amount, and offers no button", async () => {
    const env = world({ size_unchecked: true });
    const out = await payPageFor(TOKEN, deps(env.db));
    // On the code of Nov 25: state "pay" with the amount, on a size nobody had confirmed.
    expect(out).toEqual({
      state: "held",
      plan_name: "Roof Care",
      plan_label: "RC-1077",
      site: "Main plant",
      amount: null,
      runs_until: null,
    });
    expect(payPageOffersPay(payPageView("held", false, false))).toBe(false);
    expect(PAY_SIZE_NOT_READY).toBe(
      "We are confirming your roof's size. We will email you when your payment page is ready.",
    );
  });
  it("the Pay button behind it makes no card page either", async () => {
    const env = world({ size_unchecked: true });
    await expect(payStartFor(TOKEN, deps(env.db))).rejects.toThrow(PAY_SIZE_NOT_READY);
    expect(pages).toEqual([]);
  });
  it("is as before once the size is confirmed", async () => {
    const env = world();
    expect(await payPageFor(TOKEN, deps(env.db))).toMatchObject({ state: "pay", amount: 2345 });
    expect(await payStartFor(TOKEN, deps(env.db))).toEqual({
      url: "https://card.example.com/pay/cs_test_1",
    });
  });
  it("the page reads the size itself: it is in what the server asks the plan for", () => {
    expect(flat(read("src/lib/roof-care-pay-link.functions.ts"))).toContain(
      '"id, plan, plan_number, site_id, status, price, renewal_credit, customer_email, renews_on, pay_token, size_unchecked" as const;',
    );
  });
});

describe("18c. on a ticket is a ticket the server reads", () => {
  it("the browser's own word for it is not taken any more", async () => {
    const env = world({ size_unchecked: true });
    // On the code of Nov 25 this opened the card page: nothing checked that a ticket existed.
    expect(await run(startPlanCheckout, env.db, { plan_id: PLAN, on_site: true })).toEqual({
      url: null,
      reason: PAY_HELD_SIZE,
    });
    expect(pages).toEqual([]);
  });
  it("a live ticket at the plan's property opens the card page though the size is not confirmed", async () => {
    const env = world({ size_unchecked: true });
    expect(await run(startPlanCheckout, env.db, { plan_id: PLAN, job_id: JOB })).toEqual({
      url: "https://card.example.com/pay/cs_test_1",
      reason: null,
    });
    expect(pages).toHaveLength(1);
  });
  it("a closed ticket, a deleted one, one at another property and one that is not there do not", async () => {
    const env = world({ size_unchecked: true });
    for (const job_id of [JOB_CLOSED, JOB_DELETED, JOB_ELSEWHERE, NOBODYS])
      expect(await run(startPlanCheckout, env.db, { plan_id: PLAN, job_id }), job_id).toEqual({
        url: null,
        reason: PAY_HELD_SIZE,
      });
    expect(pages).toEqual([]);
  });
  it("the screen hands the ticket's own id to the server", () => {
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain("const OnTicket = createContext<string | null>(null);");
    expect(card).toContain("<OnTicket.Provider value={jobId ?? null}>");
    expect(card).toContain(
      "checkoutFn({ data: { plan_id: plan.id, ...(ticketId ? { job_id: ticketId } : {}) } }),",
    );
    expect(card).not.toContain("on_site: true");
    expect(flat(read("src/lib/roof-care-checkout.functions.ts"))).not.toContain("on_site");
  });
});

describe("18d. the link is the office's; a technician keeps the card page on a ticket", () => {
  it("a technician cannot read the link or the customer's email", async () => {
    const env = world();
    // On the code of Nov 25 this answered with the link and pat@example.com.
    await expect(run(planPayLink, env.db, { plan_id: PLAN }, "tech")).rejects.toThrow(
      PAY_LINK_OFFICE_ONLY,
    );
    expect(PAY_LINK_OFFICE_ONLY).toBe("The card payment link is not yours to read or send.");
  });
  it("a technician cannot email the customer", async () => {
    const env = world();
    await expect(run(emailPlanPayLink, env.db, { plan_id: PLAN }, "tech")).rejects.toThrow(
      PAY_LINK_OFFICE_ONLY,
    );
    expect(sent).toEqual([]);
    expect(env.tables["roof_care_plans"]![0]!["pay_link_sent_at"]).toBeNull();
  });
  it("somebody who is not signed in to a profile is refused the same way", async () => {
    const env = world();
    await expect(run(planPayLink, env.db, { plan_id: PLAN }, "nobody")).rejects.toThrow(
      PAY_LINK_OFFICE_ONLY,
    );
  });
  it("the office reads it and sends it as before", async () => {
    const env = world();
    for (const who of ["office", "boss"]) {
      const l = (await run(planPayLink, env.db, { plan_id: PLAN }, who)) as PlanPayLink;
      expect(l.url).toBe(`https://portal.example.com/pay/${TOKEN}`);
      expect(l.to).toBe("pat@example.com");
    }
    await run(emailPlanPayLink, env.db, { plan_id: PLAN }, "office");
    expect(sent).toHaveLength(1);
  });
  it("a technician opens the card page from a ticket of the property, and nowhere else", async () => {
    const env = world();
    await expect(run(startPlanCheckout, env.db, { plan_id: PLAN }, "tech")).rejects.toThrow(
      CHECKOUT_FROM_TICKET,
    );
    await expect(
      run(startPlanCheckout, env.db, { plan_id: PLAN, job_id: JOB_ELSEWHERE }, "tech"),
    ).rejects.toThrow(CHECKOUT_FROM_TICKET);
    expect(pages).toEqual([]);
    expect(await run(startPlanCheckout, env.db, { plan_id: PLAN, job_id: JOB }, "tech")).toEqual({
      url: "https://card.example.com/pay/cs_test_1",
      reason: null,
    });
    expect(CHECKOUT_FROM_TICKET).toBe(
      "The card payment page opens from a ticket at this property. Open the ticket, press Care Plan, and open it from there.",
    );
  });
  it("the box is drawn for the office only", () => {
    expect(flat(read("src/components/roof-care/plan-card.tsx"))).toContain(
      "{readsPlanTables(profile) && <PlanPayLinkBox planId={plan.id} />}",
    );
  });
});

describe("3. while a payment from the bank is on its way", () => {
  it("the stamp counts for ten days: Stripe answers within four business days", () => {
    const now = Date.parse("2026-11-26T15:00:00Z");
    expect(BANK_PENDING_MAX_DAYS).toBe(10);
    expect(bankPendingNow("2026-11-25T15:00:00Z", now)).toBe(true);
    expect(bankPendingNow("2026-11-16T15:00:01Z", now)).toBe(true);
    expect(bankPendingNow("2026-11-16T14:59:59Z", now)).toBe(false);
    for (const none of [null, undefined, "", "soon", 7])
      expect(bankPendingNow(none, now)).toBe(false);
  });
  it("the customer's page says so and offers no button", async () => {
    bank.pending = { ref: "pi_9", amount: 2345, at: SOON() };
    const env = world();
    const out = await payPageFor(TOKEN, deps(env.db));
    // On the code of Nov 25: state "pay", with the button for the whole amount again.
    expect(out).toMatchObject({ state: "bank", amount: null, plan_name: "Roof Care" });
    expect(payPageOffersPay(payPageView("bank", true, true))).toBe(false);
    expect(PAY_BANK_ON_ITS_WAY).toBe(
      "A payment from your bank account is on its way. It takes a few business days, and there is nothing more to do.",
    );
  });
  it("the Pay button behind it makes no second page", async () => {
    bank.pending = { ref: "pi_9", amount: 2345, at: SOON() };
    const env = world();
    await expect(payStartFor(TOKEN, deps(env.db))).rejects.toThrow(PAY_BANK_ON_ITS_WAY);
    expect(pages).toEqual([]);
  });
  it("it comes before the size: money on its way is never called 'confirming your roof'", () => {
    expect(
      payPageState("awaiting_payment", null, true, { bank_pending: true, size_unchecked: true }),
    ).toBe("bank");
    // A plan that is paid or over is still paid or over.
    expect(payPageState("active", null, true, { bank_pending: true })).toBe("paid");
    expect(payPageState("ended", null, true, { bank_pending: true })).toBe("closed");
  });
  it("a stamp that cannot be read is 'try again', never the Pay button", async () => {
    const env = world();
    const noisy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = deps(env.db, {
      card: async () => {
        throw new Error("could not reach the database");
      },
    });
    await expect(payPageFor(TOKEN, broken)).rejects.toThrow("try again");
    await expect(payStartFor(TOKEN, broken)).rejects.toThrow("try again");
    noisy.mockRestore();
    expect(pages).toEqual([]);
  });
  it("the office has no link to give, and is told why without opening the box", async () => {
    bank.pending = { ref: "pi_9", amount: 2345, at: SOON() };
    const env = world();
    const l = (await run(planPayLink, env.db, { plan_id: PLAN })) as PlanPayLink;
    expect(l.url).toBeNull();
    expect(l.bank_pending).toBe(true);
    expect(l.reason).toBe(BANK_PENDING_OFFICE);
    expect(BANK_PENDING_OFFICE).toBe(
      "A payment from the customer's bank account is on its way. It takes a few business days, and there is nothing more to do.",
    );
    await expect(run(emailPlanPayLink, env.db, { plan_id: PLAN })).rejects.toThrow(
      BANK_PENDING_OFFICE,
    );
    expect(sent).toEqual([]);
    const box = flat(read("src/components/roof-care/pay-link.tsx"));
    expect(box).toContain('if (l?.bank_pending) return ( <p className="font-medium" role="status"');
    // Read when it is on the screen, not only when it is opened.
    expect(box).not.toContain("enabled: open,");
  });
  it("the office's card page does not open either", async () => {
    bank.pending = { ref: "pi_9", amount: 2345, at: SOON() };
    const env = world();
    expect(await run(startPlanCheckout, env.db, { plan_id: PLAN, job_id: JOB })).toEqual({
      url: null,
      reason: BANK_PENDING_OFFICE,
    });
    expect(pages).toEqual([]);
  });
  it("a stamp from long ago holds nobody: the answer never came", async () => {
    bank.pending = { ref: "pi_9", amount: 2345, at: "2026-01-05T15:00:00Z" };
    const env = world();
    expect((await payPageFor(TOKEN, deps(env.db))).state).toBe("pay");
    expect(((await run(planPayLink, env.db, { plan_id: PLAN })) as PlanPayLink).bank_pending).toBe(
      false,
    );
  });
});

describe("3. a bank payment is said to be one", () => {
  const facts: ReceiptFacts = {
    plan: "care",
    plan_number: 1077,
    site: "Main plant",
    address: "120 Mill St, London, KY 40741",
    agreed_by: "Pat Smith",
    signed_on: "2026-11-24",
    price: 2345,
    pay_method: "card",
    first_visit: "window",
    first_days: null,
    terms_version: ROOF_CARE_TERMS_VERSION,
    benefits: null,
    company: "JBK Roofing",
    contact: "888-555-0100",
    paid: 2345,
    paid_on: "2026-11-26",
    starts_on: "2026-11-26",
    renews_on: "2027-11-25",
    invoice_number: "RC-1077",
  };
  it("on the receipt", () => {
    const m = receiptEmail({ ...facts, paid_by_bank: true });
    // On the code of Nov 25 a bank payment's receipt said "Paid by: card".
    expect(m.text).toContain("Paid by: bank payment");
    expect(m.text).not.toContain("Paid by: card");
    expect(m.html).toContain("Bank payment");
    // A card payment's receipt reads as it did.
    expect(receiptEmail(facts).text).toContain("Paid by: card");
    expect(receiptEmail({ ...facts, pay_method: "check" }).text).toContain("Paid by: check");
  });
  it("the receipt is told from the plan itself", () => {
    expect(flat(read("src/lib/roof-care-email.server.ts"))).toContain(
      "paid_by_bank: Number(p.card_paid_amount) > 0 ? await planPaidByBank(admin, p.id) : false,",
    );
  });
  it("on the plan's own line, for whoever wires the plan's read to it", () => {
    const day = { on: "2026-11-26", amount: 2345, ref: "pi_9" };
    expect(cardPaidWords({ ...day, bank: true })).toMatch(
      /^Paid from a bank account online .*\(\$2,345\.00, ref pi_9\)\.$/,
    );
    expect(cardPaidWords(day)).toMatch(/^Paid by card online /);
  });
});

describe("28a. back from the card page", () => {
  it("the thanks are said only while the page is still looking for the payment", () => {
    expect(payPageView("pay", true, false)).toBe("confirming");
    expect(payPageOffersPay("confirming")).toBe(false);
  });
  it("when its looks are done and the plan is still not paid, it says so and offers Pay again", () => {
    // On the code of Nov 25 the thanks stood for good and the button stayed hidden.
    expect(payPageView("pay", true, true)).toBe("unconfirmed");
    expect(payPageOffersPay("unconfirmed")).toBe(true);
    expect(PAY_NOT_CONFIRMED).toBe(
      "We have not confirmed your payment yet. If you paid, give it a few minutes; otherwise call us.",
    );
  });
  it("?paid=1 changes nothing of what the server says: paid, bank, held, offline, closed", () => {
    for (const state of ["paid", "bank", "held", "offline", "closed"] as const)
      for (const done of [false, true]) expect(payPageView(state, true, done)).toBe(state);
    // And without it the page is as the server says.
    expect(payPageView("pay", false, true)).toBe("pay");
  });
  it("the page draws from that one rule, and keeps looking slowly after it gives up", () => {
    const page = flat(read("src/components/public/pay-page.tsx"));
    expect(page).toContain("payPageView(facts.state, cameBackPaid(), looksDone)");
    expect(page).toContain("{view && payPageOffersPay(view) && (");
    expect(page).toContain('{view === "unconfirmed" && (');
    expect(page).toContain("{PAY_NOT_CONFIRMED}");
    expect(page).toContain('{view === "bank" && (');
    expect(page).toContain("{PAY_BANK_ON_ITS_WAY}");
    expect(page).toContain('{view === "held" && (');
    expect(page).toContain("{PAY_SIZE_NOT_READY}");
    expect(page).toContain("setLooksDone(true);");
    // Every look counts against the connection's hour (30): the whole run stays well under it.
    expect(1 + PAID_LOOKS_MS.length + PAID_LATE_LOOKS_MS.length).toBeLessThanOrEqual(15);
  });
});

describe("28b. a call with no real token does not use up the day's count", () => {
  it("a token of the wrong shape, and a token that is no plan's, are answered and not counted", async () => {
    const env = world();
    const closedFacts = { state: "closed", plan_name: "", plan_label: "", site: "", amount: null };
    expect(await payPageFor("nonsense", deps(env.db))).toMatchObject(closedFacts);
    expect(await payPageFor(undefined, deps(env.db))).toMatchObject(closedFacts);
    expect(await payPageFor(NOBODYS, deps(env.db))).toMatchObject(closedFacts);
    await expect(payStartFor("nonsense", deps(env.db))).rejects.toThrow(PAY_CLOSED);
    await expect(payStartFor(NOBODYS, deps(env.db))).rejects.toThrow(PAY_CLOSED);
    // On the code of Nov 25 each of these five took one of the day's 2,000.
    expect(counted(env)).toBe(0);
  });
  it("a real plan's page is counted, each time it is read and each time Pay is pressed", async () => {
    const env = world();
    await payPageFor(TOKEN, deps(env.db));
    await payStartFor(TOKEN, deps(env.db));
    expect(counted(env)).toBe(2);
    // A plan that is over is still a real plan's page.
    const over = world({ status: "ended" });
    await payPageFor(TOKEN, deps(over.db));
    await expect(payStartFor(TOKEN, deps(over.db))).rejects.toThrow(PAY_CLOSED);
    expect(counted(over)).toBe(2);
  });
  it("a connection over its limit is still told to wait, and no page is made", async () => {
    const env = world({}, () => false);
    await expect(payPageFor(TOKEN, deps(env.db))).rejects.toThrow();
    await expect(payStartFor(TOKEN, deps(env.db))).rejects.toThrow();
    expect(pages).toEqual([]);
  });
});

describe("the database", () => {
  const sql = sqlFlat("supabase/migrations/20261125100000_card_and_bank_payments.sql");
  it("the plan holds how it was paid and a bank payment that is on its way", () => {
    for (const col of [
      "add column if not exists paid_by_bank boolean not null default false,",
      "add column if not exists bank_pending_ref text,",
      "add column if not exists bank_pending_amount numeric,",
      "add column if not exists bank_pending_at timestamptz;",
    ])
      expect(sql).toContain(col);
  });
  it("started stamps a plan that waits, and marks it as told; failed takes the stamp off", () => {
    expect(sql).toContain(
      "create or replace function public.roof_care_bank_pending( p_plan uuid, p_ref text, p_amount numeric, p_step text) returns text",
    );
    expect(sql).toContain("if p.status <> 'awaiting_payment' then return 'not_waiting'; end if;");
    expect(sql).toContain(
      "set bank_pending_ref = v_ref, bank_pending_amount = case when p_amount > 0 then p_amount end, bank_pending_at = now(), pay_notified_at = now() where id = p_plan; return 'started';",
    );
    expect(sql).toContain(
      "if p_step = 'failed' then if p.bank_pending_ref = v_ref then update public.roof_care_plans set bank_pending_ref = null, bank_pending_amount = null, bank_pending_at = null where id = p_plan; return 'cleared'; end if; return 'none'; end if;",
    );
  });
  it("a payment is recorded as a bank payment when it is one", () => {
    // The older function is dropped, so a call with three settings fits one function only.
    expect(sql).toContain(
      "drop function if exists public.roof_care_card_paid(uuid, numeric, text, date);",
    );
    expect(sql).toContain(
      "create or replace function public.roof_care_card_paid( p_plan uuid, p_amount numeric, p_ref text, p_on date default null, p_bank boolean default false)",
    );
    expect(sql).toContain("pay_method = 'card', paid_by_bank = v_bank,");
    expect(sql).toContain("paid_method = case when v_bank then 'Bank payment' else 'Card' end,");
    // The plan is paid: nothing is waited for any more.
    expect(sql).toContain(
      "paid_by_bank = v_bank, bank_pending_ref = null, bank_pending_amount = null, bank_pending_at = null, updated_at = now() where id = p_plan;",
    );
  });
  it("everything else in it is the function of Nov 20, line for line", () => {
    const body = (s: string) =>
      s.slice(
        s.indexOf("create or replace function public.roof_care_card_paid("),
        s.indexOf("revoke all on function public.roof_care_card_paid("),
      );
    const was = body(sqlFlat("supabase/migrations/20261120620000_roof_care_card_payments.sql"));
    const now = body(sql)
      .replace(", p_bank boolean default false)", ")")
      .replace(" v_bank boolean := coalesce(p_bank, false);", "")
      .replace(
        " if p.bank_pending_ref = v_ref then update public.roof_care_plans set bank_pending_ref = null, bank_pending_amount = null, bank_pending_at = null where id = p_plan; end if;",
        "",
      )
      .replace(/, bank\)/g, ")")
      .replace(/, v_bank\);/g, ");")
      .replace(
        " paid_by_bank = v_bank, bank_pending_ref = null, bank_pending_amount = null, bank_pending_at = null,",
        "",
      )
      .replace(
        "paid_method = case when v_bank then 'Bank payment' else 'Card' end,",
        "paid_method = 'Card',",
      )
      .replace(
        "updated_by_name = case when v_bank then 'Bank payment' else 'Card payment' end",
        "updated_by_name = 'Card payment'",
      );
    expect(now).toBe(was);
  });
  it("only the site's own server runs them", () => {
    expect(sql).toContain(
      "revoke all on function public.roof_care_card_paid(uuid, numeric, text, date, boolean) from public, anon, authenticated; grant execute on function public.roof_care_card_paid(uuid, numeric, text, date, boolean) to service_role;",
    );
    expect(sql).toContain(
      "revoke all on function public.roof_care_bank_pending(uuid, text, numeric, text) from public, anon, authenticated; grant execute on function public.roof_care_bank_pending(uuid, text, numeric, text) to service_role;",
    );
  });
  it("it can be run twice: nothing is made that is not 'if not exists' or 'or replace'", () => {
    expect(sql).not.toMatch(/create function /);
    expect(sql).not.toMatch(/add column (?!if not exists)/);
  });
});

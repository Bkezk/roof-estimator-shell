/**
 * Correcting a plan's roof size (owner, Nov 24, of a "Correct the roof size" button: "1. yes but
 * then build the rest. 2. send it but can it be combined with the new price payment? 3. more
 * than once but recorded and remove that line"; asked which line, he chose to drop only the
 * word "once" from the terms).
 *
 * Until this a size could only be confirmed: a wrong one meant ending the plan and signing it
 * up again. The database's own rules were tried on the live database in a trial that was rolled
 * back (docs/qa/roof-care-correct-size-2026-11-24.md). Every test of the server's answers and of
 * the email fails on the code of that afternoon: there was no such function. Names and amounts
 * are made up.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string; subject: string; text: string; html?: string }[] = [];
const invoices: string[] = [];
const sizeInvoices: { planId: string; from: number | null }[] = [];
const cfg = { stripe: true, invoiceFails: false, sendOk: true };
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
  sendEmail: async (m: { to: string; subject: string; text: string; html?: string }) => {
    sent.push(m);
    return cfg.sendOk ? { ok: true } : { ok: false, error: "the mail company said no" };
  },
}));
vi.mock("@/lib/roof-care-checkout.server", () => ({
  stripeConfigured: () => cfg.stripe,
  planOwedCents: async (_a: unknown, p: { price: number }) => Math.round(Number(p.price) * 100),
  createCheckoutSession: async () => ({ id: "cs_test_1", url: "https://card.example.com/x" }),
}));
vi.mock("@/lib/roof-care-plan-invoice.functions", () => ({
  makePlanInvoice: async (_sb: unknown, planId: string) => {
    if (cfg.invoiceFails) throw new Error("the invoice was not made");
    invoices.push(planId);
    return { id: "inv-new", made: true };
  },
  makeSizeInvoice: async (_sb: unknown, planId: string, _who: unknown, from: number | null) => {
    if (cfg.invoiceFails) throw new Error("the invoice was not made");
    sizeInvoices.push({ planId, from });
    return { id: "inv-size", made: true };
  },
}));
vi.mock("@/lib/roof-care.functions", () => ({
  officeOrigin: async () => ({ line: "1 Office Rd, London, KY", state: "KY" }),
  driveTo: async () => null,
}));

import { PRICE_IS_ESTIMATE } from "@/lib/public-pages";
import { sizeCorrectedEmail, type SizeCorrectedFacts } from "@/lib/roof-care-email";
// Loaded here, as the other email tests do, so the stand-in for the mail module above is the
// one this module holds when the server function reaches it.
import { EMAIL_NOT_SET_UP } from "@/lib/roof-care-email.server";
import {
  ROOF_CARE_TERMS,
  ROOF_CARE_TERMS_VERSION,
  SIZE_CORRECT_LABEL,
  SIZE_CORRECT_MANAGERS,
  SIZE_CORRECT_SAME,
  SIZE_INVOICE_MAKE,
  SIZE_REFUND_RECORD,
  priceDifferenceWords,
  readSizeChange,
  readSizeChanges,
  sizeChangeWords,
  sizeCorrectEmailLabel,
  sizeOfferWords,
  sizeSavedWords,
  type PlanSizeChange,
} from "@/lib/roof-care-plan";
import {
  correctRoofCareSize,
  roofCareSizeOffer,
  recordRoofCareSizeRefund,
  type SizeCorrected,
  type SizeOffer,
} from "@/lib/roof-care-plan.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OFFICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac";
const SITE = "11111111-1111-4111-8111-111111111111";
const PLAN = "33333333-3333-4333-8333-333333333333";
const TOKEN = "4f1c2a9e-7b3d-4c5e-9a1f-0b2c3d4e5f78";

const change = (over: Partial<PlanSizeChange> = {}): PlanSizeChange => ({
  on: "2026-11-24",
  by_name: "Mo Manager",
  from_sqft: 20000,
  to_sqft: 26000,
  from_price: 410,
  to_price: 470,
  would_be: 470,
  repriced: true,
  note: null,
  ...over,
});
/** The database's own answer for one correction. */
const answer = (over: Record<string, unknown> = {}) => ({
  at: "2026-11-24T20:00:00Z",
  on: "2026-11-24",
  by_name: "Mo Manager",
  from_sqft: 20000,
  to_sqft: 26000,
  from_price: 410,
  to_price: 470,
  would_be: 470,
  repriced: true,
  note: null,
  plan_number: 1077,
  plan: "care",
  ...over,
});

describe("the record of a correction", () => {
  it("is read strictly from the database's answer", () => {
    expect(readSizeChange(answer({ note: "  measured on the roof " }))).toEqual(
      change({ note: "measured on the roof" }),
    );
    // Numbers that arrive as text are still numbers.
    expect(readSizeChange(answer({ from_price: "410.00", to_sqft: "26000" }))).toEqual(change());
    // Anything odd is not a record.
    expect(readSizeChange(answer({ to_price: null }))).toBeNull();
    expect(readSizeChange(answer({ on: "yesterday" }))).toBeNull();
    expect(readSizeChange(null)).toBeNull();
    expect(readSizeChange("x")).toBeNull();
  });
  it("a plan's list keeps every one, in order, and leaves out what cannot be read", () => {
    const list = readSizeChanges([
      answer(),
      { junk: true },
      answer({ from_sqft: 26000, to_sqft: 24000 }),
    ]);
    expect(list.map((c) => [c.from_sqft, c.to_sqft])).toEqual([
      [20000, 26000],
      [26000, 24000],
    ]);
    expect(readSizeChanges(null)).toEqual([]);
  });
  it("says who, when, from what to what; the price only to someone who sees prices", () => {
    expect(sizeChangeWords(change({ note: "measured on the roof" }), true)).toBe(
      "Roof size corrected from 20,000 to 26,000 sq ft by Mo Manager on Nov 24, 2026. The price went from $410 to $470 a year. Note: measured on the roof",
    );
    expect(sizeChangeWords(change(), false)).toBe(
      "Roof size corrected from 20,000 to 26,000 sq ft by Mo Manager on Nov 24, 2026.",
    );
  });
  it("a plan that was already paid: its price stayed, and what the size would cost is said", () => {
    expect(sizeChangeWords(change({ repriced: false, to_price: 410, would_be: 470 }), true)).toBe(
      "Roof size corrected from 20,000 to 26,000 sq ft by Mo Manager on Nov 24, 2026. The plan year was already paid, so its price stayed $410. At that size a year was $470.",
    );
  });
});

describe("the words before and after saving", () => {
  it("the difference, up, down and none", () => {
    expect(priceDifferenceWords(410, 470)).toBe("$60 more a year");
    expect(priceDifferenceWords(470, 410)).toBe("$60 less a year");
    expect(priceDifferenceWords(410, 410.4)).toBe("the same price");
  });
  it("before saving: a plan that waits follows the size, a paid one keeps its price", () => {
    const o = { from_sqft: 20000, to_sqft: 26000, from_price: 410, to_price: 470 };
    expect(sizeOfferWords({ ...o, repriced: true })).toBe(
      "From 20,000 sq ft to 26,000 sq ft. The price goes from $410 to $470 a year: $60 more a year.",
    );
    expect(sizeOfferWords({ ...o, repriced: false })).toBe(
      "From 20,000 sq ft to 26,000 sq ft. This plan year stays at the $410 it was paid at. At the corrected size a year is $470: $60 more a year.",
    );
  });
  it("after saving: what changed, and plainly what did not happen", () => {
    const base = { change: change(), invoice_made: true, emailed_to: null, email_reason: null };
    expect(sizeSavedWords(base)).toBe(
      "Roof size corrected to 26,000 sq ft. The plan is now $470 a year.",
    );
    expect(sizeSavedWords({ ...base, emailed_to: "pat@example.com" })).toBe(
      "Roof size corrected to 26,000 sq ft. The plan is now $470 a year. pat@example.com was emailed the new price.",
    );
    expect(
      sizeSavedWords({ ...base, invoice_made: false, email_reason: "Email is not set up yet" }),
    ).toBe(
      "Roof size corrected to 26,000 sq ft. The plan is now $470 a year. Its invoice was not made again: press Make the invoice on the plan. The customer was not emailed: Email is not set up yet",
    );
    expect(sizeSavedWords({ ...base, change: change({ repriced: false, to_price: 410 }) })).toBe(
      "Roof size corrected to 26,000 sq ft. This plan year's price is unchanged.",
    );
  });
  it("the email module is the one the other tests use", () => {
    expect(EMAIL_NOT_SET_UP).toContain("Email is not set up yet");
  });
  it("the tick names the payment link only for a card plan", () => {
    expect(sizeCorrectEmailLabel(true)).toBe(
      "Email the customer the new price, with the payment link",
    );
    expect(sizeCorrectEmailLabel(false)).toBe("Email the customer the new price");
  });
});

const priced = {
  ready: true,
  custom_quote: false,
  beyond_baseline: false,
  baseline_hours: 1,
  baseline_miles: 50,
  plans: [
    { plan: "watch", list: 100, travel: 10, price: 110, visit1: 55, visit2: 55, trips: 2 },
    { plan: "care", list: 460, travel: 10, price: 470, visit1: 235, visit2: 235, trips: 2 },
    { plan: "guard", list: 600, travel: 21, price: 621, visit1: 311, visit2: 310, trips: 4 },
  ],
};
type Rpcs = Record<string, (a: Record<string, unknown>) => unknown>;
const world = (plan: Record<string, unknown> = {}, rpcs: Rpcs = {}) =>
  fakeSupabase(
    {
      profiles: [
        { id: ADMIN, role: "admin", access: [], technician: false, full_name: "Ann Admin" },
        {
          id: OFFICE,
          role: "user",
          access: ["estimate", "customers", "service", "invoices"],
          technician: false,
          full_name: "Olive Office",
        },
      ],
      roof_care_plans: [
        {
          id: PLAN,
          plan: "care",
          plan_number: 1077,
          site_id: SITE,
          status: "awaiting_payment",
          roof_sqft: 20000,
          price: 410,
          renewal_credit: 0,
          drive_hours: 1,
          drive_miles: 50,
          customer_email: "pat@example.com",
          pay_method: "card",
          pay_token: TOKEN,
          pay_link_sent_at: null,
          agreed_by: "Pat Smith",
          size_unchecked: false,
          ...plan,
        },
      ],
      crm_sites: [{ id: SITE, name: "Main plant", address1: "120 Mill St", city: "London" }],
      company_settings: [{ company_name: "JBK Roofing", phone: "888-555-0100", email: null }],
    },
    {
      rpcs: {
        roof_care_price: () => priced,
        roof_care_correct_size: () => answer(),
        roof_care_plan_seen: () => true,
        ...rpcs,
      },
    },
  );
type Env = ReturnType<typeof world>;
const call = <T>(fn: unknown, env: Env, data: unknown, userId = ADMIN) =>
  (fn as (a: { data: unknown; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });

beforeEach(() => {
  sent.length = 0;
  invoices.length = 0;
  sizeInvoices.length = 0;
  cfg.stripe = true;
  cfg.invoiceFails = false;
  cfg.sendOk = true;
  process.env["NOTIFY_FROM_EMAIL"] = "JBK <office@example.com>";
});

describe("showing the new price", () => {
  it("is the plan's own drive at today's prices, and changes nothing", async () => {
    const env = world();
    const o = await call<SizeOffer>(roofCareSizeOffer, env, { plan_id: PLAN, sqft: 26000 });
    expect(o).toEqual({
      from_sqft: 20000,
      to_sqft: 26000,
      from_price: 410,
      to_price: 470,
      repriced: true,
      // Nov 24, the paid plans' step: a plan that waits owes nothing apart from its price.
      paid: false,
      owed: 0,
    });
    const price = env.rpcCalls.find((c) => c.fn === "roof_care_price")!;
    expect(price.args).toEqual({ p_sqft: 26000, p_hours: 1, p_miles: 50 });
    expect(env.writes).toEqual([]);
  });
  // Until the paid plans' step (Nov 24, "then build the rest") a plan in force was told its
  // price would stay. It now takes the price of the right size, and the difference is said.
  it("a plan in force is told the difference it will owe or be owed", async () => {
    const env = world({ status: "active" });
    const o = await call<SizeOffer>(roofCareSizeOffer, env, { plan_id: PLAN, sqft: 26000 });
    expect(o).toMatchObject({ paid: true, repriced: false, to_price: 470, owed: 60 });
    // An earlier correction not settled yet: owed from what the payments cover, not the price.
    const open = world({ status: "active", size_paid_price: 400 });
    expect(
      (await call<SizeOffer>(roofCareSizeOffer, open, { plan_id: PLAN, sqft: 26000 })).owed,
    ).toBe(70);
    // A smaller roof: owed back.
    const less = world({ status: "active", price: 500 });
    expect(
      (await call<SizeOffer>(roofCareSizeOffer, less, { plan_id: PLAN, sqft: 26000 })).owed,
    ).toBe(-30);
  });
  it("the size the plan already has is said before any price is shown, in the database's words", async () => {
    const env = world();
    await expect(call(roofCareSizeOffer, env, { plan_id: PLAN, sqft: 20000 })).rejects.toThrow(
      SIZE_CORRECT_SAME,
    );
    expect(env.rpcCalls.filter((c) => c.fn === "roof_care_price")).toEqual([]);
    expect(read("supabase/migrations/20261124980000_roof_care_correct_size.sql")).toContain(
      SIZE_CORRECT_SAME.replace(/'/g, "''"),
    );
  });
  it("is a manager's or an admin's, and is refused for an ended plan and a custom quote", async () => {
    await expect(
      call(roofCareSizeOffer, world(), { plan_id: PLAN, sqft: 26000 }, OFFICE),
    ).rejects.toThrow(SIZE_CORRECT_MANAGERS);
    await expect(
      call(roofCareSizeOffer, world({ status: "ended" }), { plan_id: PLAN, sqft: 26000 }),
    ).rejects.toThrow("This plan has ended");
    const custom = world({}, { roof_care_price: () => ({ ready: true, custom_quote: true }) });
    await expect(call(roofCareSizeOffer, custom, { plan_id: PLAN, sqft: 26000 })).rejects.toThrow(
      "A roof this size gets a custom quote",
    );
  });
});

const ASK = { plan_id: PLAN, sqft: 26000, shown_price: 470 };
describe("saving a corrected size", () => {
  it("hands the database the size, the price shown and the note, and makes the invoice again", async () => {
    const env = world();
    const out = await call<SizeCorrected>(correctRoofCareSize, env, { ...ASK, note: "tape" });
    const rpc = env.rpcCalls.find((c) => c.fn === "roof_care_correct_size")!;
    expect(rpc.args).toEqual({ p_plan: PLAN, p_sqft: 26000, p_shown_price: 470, p_note: "tape" });
    expect(out.change).toEqual(change());
    expect(out.invoice_made).toBe(true);
    expect(invoices).toEqual([PLAN]);
    // Nobody is emailed unless the manager ticked it.
    expect(out.emailed_to).toBeNull();
    expect(sent).toEqual([]);
  });
  it("ticked: one email with the new price and the payment link, and the plan is marked as sent the link", async () => {
    const env = world({ price: 470 });
    const out = await call<SizeCorrected>(correctRoofCareSize, env, { ...ASK, email: true });
    expect(out.emailed_to).toBe("pat@example.com");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("pat@example.com");
    expect(sent[0]!.text).toContain("It is 26,000 sq ft.");
    expect(sent[0]!.text).toContain("is now $470. It was $410.");
    expect(sent[0]!.text).toContain(`Pay by card: https://portal.example.com/pay/${TOKEN}`);
    expect(env.tables["roof_care_plans"]![0]!["pay_link_sent_at"]).toEqual(expect.any(String));
  });
  it("a check plan's email has the new price and no link", async () => {
    const env = world({ price: 470, pay_method: "check" });
    await call<SizeCorrected>(correctRoofCareSize, env, { ...ASK, email: true });
    expect(sent[0]!.text).toContain("We will send you the invoice for $470.");
    expect(sent[0]!.text).not.toContain("/pay/");
    expect(env.tables["roof_care_plans"]![0]!["pay_link_sent_at"]).toBeNull();
  });
  it("the size stands when the email or the invoice does not go, and the answer says which", async () => {
    cfg.sendOk = false;
    cfg.invoiceFails = true;
    const env = world({ price: 470 });
    const out = await call<SizeCorrected>(correctRoofCareSize, env, { ...ASK, email: true });
    expect(out.change.to_sqft).toBe(26000);
    expect(out.invoice_made).toBe(false);
    expect(out.emailed_to).toBeNull();
    expect(out.email_reason).toBe("The email did not go: the mail company said no");
    expect(env.tables["roof_care_plans"]![0]!["pay_link_sent_at"]).toBeNull();
  });
  // The database no longer writes this record (a paid plan that kept its price, the first
  // step of Nov 24): one that was written then is still read as it was.
  it("a record of the first step, a paid plan that kept its price: nothing made, nobody emailed", async () => {
    const env = world(
      { status: "active" },
      { roof_care_correct_size: () => answer({ repriced: false, to_price: 410 }) },
    );
    const out = await call<SizeCorrected>(correctRoofCareSize, env, { ...ASK, email: true });
    expect(out.change.repriced).toBe(false);
    expect(invoices).toEqual([]);
    expect(sent).toEqual([]);
  });
  it("is a manager's or an admin's, and the database's own refusal is passed on as it is", async () => {
    const env = world();
    await expect(call(correctRoofCareSize, env, ASK, OFFICE)).rejects.toThrow(
      SIZE_CORRECT_MANAGERS,
    );
    expect(env.rpcCalls.map((c) => c.fn)).not.toContain("roof_care_correct_size");
    const refused = world(
      {},
      {
        roof_care_correct_size: () => {
          throw new Error("A payment is already recorded on this plan's invoice.");
        },
      },
    );
    await expect(call(correctRoofCareSize, refused, ASK)).rejects.toThrow(
      "A payment is already recorded on this plan's invoice.",
    );
    expect(invoices).toEqual([]);
  });
});

describe("a plan year already paid", () => {
  const paidAnswer = (over: Record<string, unknown> = {}) =>
    answer({ paid: true, owed: 60, ...over });
  it("a bigger roof: the difference goes on an invoice of its own, not the plan year's", async () => {
    const env = world(
      { status: "active", pay_method: "check" },
      { roof_care_correct_size: () => paidAnswer() },
    );
    const out = await call<SizeCorrected>(correctRoofCareSize, env, ASK);
    expect(out.change).toMatchObject({ paid: true, owed: 60, repriced: true });
    expect(sizeInvoices).toEqual([{ planId: PLAN, from: 20000 }]);
    expect(invoices).toEqual([]);
    expect(out.invoice_made).toBe(true);
    expect(sent).toEqual([]);
    expect(sizeSavedWords(out)).toContain(
      "An invoice for the $60.00 difference was made as a draft",
    );
  });
  it("ticked: one email with the difference and no payment link, even for a card plan", async () => {
    const env = world({ status: "active" }, { roof_care_correct_size: () => paidAnswer() });
    const out = await call<SizeCorrected>(correctRoofCareSize, env, { ...ASK, email: true });
    expect(out.emailed_to).toBe("pat@example.com");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain(
      "Your plan year is already paid, and nothing is due today. We will send you an invoice for the difference of $60.00.",
    );
    expect(sent[0]!.text).not.toContain("Pay by card");
    expect(sent[0]!.text).not.toContain("/pay/");
    expect(env.tables["roof_care_plans"]![0]!["pay_link_sent_at"]).toBeNull();
  });
  it("a smaller roof: no invoice, the customer is told what comes back", async () => {
    const env = world(
      { status: "active" },
      { roof_care_correct_size: () => paidAnswer({ owed: -30, to_price: 380 }) },
    );
    const out = await call<SizeCorrected>(correctRoofCareSize, env, { ...ASK, email: true });
    expect(sizeInvoices).toEqual([]);
    expect(invoices).toEqual([]);
    expect(out.invoice_made).toBe(false);
    expect(sent[0]!.text).toContain("We are sending $30.00 back to you.");
    expect(sizeSavedWords(out)).toContain("$30.00 is owed back to the customer");
    expect(sizeSavedWords(out)).toContain(SIZE_REFUND_RECORD);
  });
  it("the size stands when the invoice is not made, and the office is told how to make it", async () => {
    cfg.invoiceFails = true;
    const env = world({ status: "active" }, { roof_care_correct_size: () => paidAnswer() });
    const out = await call<SizeCorrected>(correctRoofCareSize, env, ASK);
    expect(out.invoice_made).toBe(false);
    expect(sizeSavedWords(out)).toContain("was not made: press " + SIZE_INVOICE_MAKE);
  });
  it("the refund is recorded by a manager or an admin; the database works the amount", async () => {
    const env = world(
      { status: "active" },
      { roof_care_size_refund_sent: () => ({ amount: 30, on: "2026-11-24", ref: "check 9" }) },
    );
    await expect(
      call(recordRoofCareSizeRefund, env, { plan_id: PLAN, on: "2026-11-24" }, OFFICE),
    ).rejects.toThrow(SIZE_CORRECT_MANAGERS);
    const out = await call<{ amount: number }>(recordRoofCareSizeRefund, env, {
      plan_id: PLAN,
      on: "2026-11-24",
      ref: "check 9",
    });
    expect(out).toEqual({ amount: 30 });
    const sentCall = env.rpcCalls.find((c) => c.fn === "roof_care_size_refund_sent")!;
    // No amount is handed over: what is owed is the database's to work.
    expect(sentCall.args).toEqual({ p_plan: PLAN, p_on: "2026-11-24", p_ref: "check 9" });
  });
});

describe("the email", () => {
  const facts: SizeCorrectedFacts = {
    plan: "care",
    plan_number: 1077,
    site: "Main plant",
    address: "120 Mill St, London, KY 40741",
    agreed_by: "Pat Smith",
    from_sqft: 20000,
    to_sqft: 26000,
    from_price: 410,
    to_price: 470,
    owed: 470,
    pay_method: "card",
    pay_link: "https://portal.example.com/pay/abc",
    company: "JBK Roofing",
    contact: "888-555-0100",
  };
  it("says the measured size, the old and the new price, and asks for the payment in the same email", () => {
    const m = sizeCorrectedEmail(facts);
    // Nov 25 (owner: "i like number 3, 5"): a softer subject, and nothing says we were on
    // the roof. Before that day it read "We measured your roof: your …".
    expect(m.subject).toBe("Your roof measurement and your JBK Roofing Roof Care plan (RC-1077)");
    expect(m.text).not.toMatch(/on your roof|visited|came out/i);
    expect(m.text).toContain(
      "We measured the roof at Main plant, 120 Mill St, London, KY 40741. It is 26,000 sq ft. Your Roof Care plan (RC-1077) was signed at 20,000 sq ft.",
    );
    expect(m.text).toContain(
      "The yearly price of your plan is now $470. It was $410. As your agreement says, the price is an estimate until we measure the roof.",
    );
    expect(m.text).toContain("Use the button below to pay $470 for the year");
    expect(m.html).toContain('<a href="https://portal.example.com/pay/abc"');
    // The office's own note is never in it.
    expect(m.text).not.toContain("Note:");
  });
  it("says so when the price did not move", () => {
    const m = sizeCorrectedEmail({ ...facts, to_price: 410, owed: 410 });
    expect(m.text).toContain("The yearly price of your plan stays $410.");
    expect(m.text).not.toContain("It was");
  });
});

describe("the terms and the public page no longer say once", () => {
  it("the fourth term, in a new version", () => {
    expect(ROOF_CARE_TERMS_VERSION).toBe("2026-11-24.2");
    expect(ROOF_CARE_TERMS[3]).toBe(
      "The price is an estimate until we measure the roof. If the roof's size is different, the price is corrected.",
    );
    expect(ROOF_CARE_TERMS.join(" ")).not.toContain("corrected once");
  });
  it("the line under the prices on the public page", () => {
    expect(PRICE_IS_ESTIMATE).toBe(
      "These prices are an estimate until we measure your roof. If the roof's size is different, the price is corrected before you pay.",
    );
  });
});

describe("where it is on the screen", () => {
  const card = flat(read("src/components/roof-care/plan-card.tsx"));
  it("beside the roof size, for a manager, on a plan that waits or is in force", () => {
    expect(SIZE_CORRECT_LABEL).toBe("Correct the roof size");
    expect(card).toContain(
      'const canCorrect = manager && (plan.status === "awaiting_payment" || plan.status === "active");',
    );
    expect(card).toContain('data-action="roof-care-size-correct"');
  });
  it("the box starts blank, shows the price before Save, and saves at the price shown", () => {
    expect(card).toContain('const [text, setText] = useState("");');
    expect(card).toContain(
      "const shown = offer && sqft != null && offer.to_sqft === sqft ? offer : null;",
    );
    expect(card).toContain("disabled={!shown || save.isPending}");
    expect(card).toContain("shown_price: shown!.to_price,");
  });
  it("every correction is listed under the size", () => {
    expect(card).toContain("data-size-changes={changes.length}");
    expect(card).toContain("{sizeChangeWords(c, seesInvoices(profile))}");
  });
});

describe("the database", () => {
  const sql = flat(read("supabase/migrations/20261124980000_roof_care_correct_size.sql"));
  it("keeps every correction, and only a manager or an admin makes one", () => {
    expect(sql).toContain(
      "add column if not exists size_changes jsonb not null default '[]'::jsonb;",
    );
    expect(sql).toContain(
      "if auth.uid() is null or not (public.is_admin() or public.is_manager()) then",
    );
    expect(sql).toContain(
      "size_changes = coalesce(size_changes, '[]'::jsonb) || jsonb_build_array(v_change),",
    );
  });
  it("re-prices only a plan that waits, and never over a payment", () => {
    expect(sql).toContain("v_reprice := p.status = 'awaiting_payment';");
    expect(sql).toContain("price = case when v_reprice then v_new else price end,");
    expect(sql).toContain("and coalesce(i.paid_amount, 0) > 0) then");
    expect(sql).toContain(
      "delete from public.invoices where roof_care_plan_id = p_plan and status = 'draft';",
    );
  });
  it("is not open to a visitor", () => {
    expect(sql).toContain(
      "revoke all on function public.roof_care_correct_size(uuid, numeric, numeric, text) from public, anon;",
    );
  });
});

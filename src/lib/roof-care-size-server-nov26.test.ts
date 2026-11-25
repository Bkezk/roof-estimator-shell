/**
 * The server's side of the roof size fixes (owner, Nov 25, 2026: "go on ... 5, 6, 7, 8, 9, 10,
 * 11, 12, 13, 14"). The rules themselves are the database's
 * (20261125200000_roof_care_size_fixes.sql, read in roof-care-size-fixes-nov26.test.ts); here
 * the server functions are run against a stand-in database:
 *
 *  - "Show the new price" asks the database, and says what Save would refuse before Save.
 *  - Record the refund hands over the amount the screen showed.
 *  - The email of a second correction says what the payments cover.
 *  - A payment marked by mistake on the invoice of a size difference can be taken off.
 *
 * Names and amounts are made up.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string; subject: string; text: string; html?: string }[] = [];
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
    return { ok: true };
  },
}));
vi.mock("@/lib/roof-care-checkout.server", () => ({
  stripeConfigured: () => true,
  planOwedCents: async (_a: unknown, p: { price: number }) => Math.round(Number(p.price) * 100),
  createCheckoutSession: async () => ({ id: "cs_test_1", url: "https://card.example.com/x" }),
}));
vi.mock("@/lib/roof-care-plan-invoice.functions", () => ({
  makePlanInvoice: async () => ({ id: "inv-new", made: true }),
  makeSizeInvoice: async () => ({ id: "inv-size", made: true }),
}));
vi.mock("@/lib/roof-care.functions", () => ({
  officeOrigin: async () => ({ line: "1 Office Rd, London, KY", state: "KY" }),
  driveTo: async () => null,
}));

import { planRunsOnPayment } from "@/lib/invoice-payment";
import { markInvoicePaid } from "@/lib/invoices.functions";
// Loaded here, as the other email tests do, so the stand-in for the mail module above is the
// one this module holds when the server function reaches it.
import { EMAIL_NOT_SET_UP } from "@/lib/roof-care-email.server";
import {
  SIZE_CORRECT_MANAGERS,
  SIZE_CORRECT_RENEWAL_CREDIT,
  SIZE_CORRECT_RENEWAL_WAITS,
  SIZE_REFUND_RELOAD,
} from "@/lib/roof-care-plan";
import {
  correctRoofCareSize,
  recordRoofCareSizeRefund,
  roofCareSizeOffer,
  type SizeCorrected,
  type SizeOffer,
} from "@/lib/roof-care-plan.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OFFICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac";
const SITE = "11111111-1111-4111-8111-111111111111";
const PLAN = "33333333-3333-4333-8333-333333333333";
const MAIN = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";
const SIZE = "3b4c5d6e-7f8a-4b9c-8d0e-2f3a4b5c6d7e";

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
          status: "active",
          roof_sqft: 26000,
          price: 1040,
          renewal_credit: 0,
          refund_due: null,
          customer_email: "pat@example.com",
          pay_method: "check",
          pay_token: null,
          pay_link_sent_at: null,
          agreed_by: "Pat Smith",
          size_unchecked: false,
          ...plan,
        },
      ],
      crm_sites: [{ id: SITE, name: "Main plant", address1: "120 Mill St", city: "London" }],
      company_settings: [{ company_name: "JBK Roofing", phone: "888-555-0100", email: null }],
      invoices: [
        {
          id: MAIN,
          roof_care_plan_id: PLAN,
          plan_part: null,
          service_job_id: null,
          bid_id: null,
          number: null,
          display_number: "RC-1077",
          status: "paid",
          total: 840,
          paid_amount: 840,
          paid_on: "2026-11-20",
          paid_method: "Check",
        },
        {
          id: SIZE,
          roof_care_plan_id: PLAN,
          plan_part: "size",
          service_job_id: null,
          bid_id: null,
          number: null,
          display_number: "RC-1077-S1",
          status: "paid",
          total: 200,
          paid_amount: 200,
          paid_on: "2026-11-25",
          paid_method: "Check",
        },
      ],
      invoice_lines: [],
    },
    { rpcs: { roof_care_plan_seen: () => true, ...rpcs } },
  );
type Env = ReturnType<typeof world>;
const call = <T>(fn: unknown, env: Env, data: unknown, userId = ADMIN) =>
  (fn as (a: { data: unknown; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const refuses = (words: string) => () => {
  throw new Error(words);
};

beforeEach(() => {
  sent.length = 0;
  process.env["NOTIFY_FROM_EMAIL"] = "JBK <office@example.com>";
});

describe("Show the new price is the database's own answer", () => {
  it("asks the database for the plan and the size, and reads no price list itself", async () => {
    // Until now the server read today's whole price at the new size (roof_care_price) and
    // showed that. Paid $1,000 at 20,000 sq ft and a price list since raised 10%: a
    // correction to 20,100 sq ft was shown, and saved, at $1,104. The database's answer is
    // $1,004: only the $4 comes from the size.
    const env = world(
      { roof_sqft: 20000, price: 1000 },
      {
        roof_care_size_offer: () => ({
          plan: "care",
          plan_number: 1077,
          from_sqft: 20000,
          to_sqft: 20100,
          from_price: 1000,
          to_price: 1004,
          would_be: 1104,
          repriced: true,
          paid: true,
          covered: 1000,
          owed: 4,
          nth: 1,
        }),
        roof_care_price: () => {
          throw new Error("the price list is not read for this any more");
        },
      },
    );
    const o = await call<SizeOffer>(roofCareSizeOffer, env, { plan_id: PLAN, sqft: 20100 });
    expect(o).toEqual({
      from_sqft: 20000,
      to_sqft: 20100,
      from_price: 1000,
      to_price: 1004,
      repriced: false,
      paid: true,
      owed: 4,
    });
    expect(env.rpcCalls.map((c) => c.fn)).toEqual(["roof_care_size_offer"]);
    expect(env.rpcCalls[0]!.args).toEqual({ p_plan: PLAN, p_sqft: 20100 });
    expect(env.writes).toEqual([]);
  });
  it("what Save would refuse is said here, before Save, in the database's words", async () => {
    for (const words of [
      SIZE_CORRECT_RENEWAL_WAITS,
      SIZE_CORRECT_RENEWAL_CREDIT,
      "A payment from the customer's bank account is on its way. Wait until it clears or fails, then correct the size.",
    ]) {
      const env = world({}, { roof_care_size_offer: refuses(words) });
      await expect(call(roofCareSizeOffer, env, { plan_id: PLAN, sqft: 28500 })).rejects.toThrow(
        words,
      );
      expect(env.writes).toEqual([]);
    }
  });
  it("is a manager's or an admin's, and an answer that cannot be read is said plainly", async () => {
    const env = world({}, { roof_care_size_offer: () => ({ to_price: "soon" }) });
    await expect(
      call(roofCareSizeOffer, env, { plan_id: PLAN, sqft: 28500 }, OFFICE),
    ).rejects.toThrow(SIZE_CORRECT_MANAGERS);
    expect(env.rpcCalls).toEqual([]);
    await expect(call(roofCareSizeOffer, env, { plan_id: PLAN, sqft: 28500 })).rejects.toThrow(
      "The new price could not be read. Press Show the new price again.",
    );
  });
});

describe("Record the refund hands over what the screen showed", () => {
  it("the amount shown goes to the database, which records what is owed", async () => {
    const env = world(
      {},
      { roof_care_size_refund_sent: () => ({ amount: 80, on: "2026-11-25", ref: "check 9" }) },
    );
    const out = await call<{ amount: number }>(recordRoofCareSizeRefund, env, {
      plan_id: PLAN,
      on: "2026-11-25",
      ref: "check 9",
      shown: 80,
    });
    expect(out).toEqual({ amount: 80 });
    expect(env.rpcCalls.find((c) => c.fn === "roof_care_size_refund_sent")!.args).toEqual({
      p_plan: PLAN,
      p_on: "2026-11-25",
      p_ref: "check 9",
      p_shown_amount: 80,
    });
  });
  it("a screen left open after the size was corrected again is refused, and nothing is recorded", async () => {
    // $80 was mailed; the size was then corrected again and $40 is owed. The stale screen
    // still says $80.
    const words =
      "The amount owed back changed to $40.00. Check the plan and press Record the refund again.";
    const env = world({}, { roof_care_size_refund_sent: refuses(words) });
    await expect(
      call(recordRoofCareSizeRefund, env, { plan_id: PLAN, on: "2026-11-25", shown: 80 }),
    ).rejects.toThrow(words);
    expect(env.writes).toEqual([]);
  });
  it("is not pressed without an amount shown", async () => {
    const env = world({}, { roof_care_size_refund_sent: () => ({ amount: 80 }) });
    // A page left open from before this sends none: refused in plain words, nothing recorded.
    const press = async (data: unknown) => call(recordRoofCareSizeRefund, env, data);
    await expect(press({ plan_id: PLAN, on: "2026-11-25" })).rejects.toThrow(SIZE_REFUND_RELOAD);
    await expect(press({ plan_id: PLAN, on: "2026-11-25", shown: 0 })).rejects.toThrow(
      SIZE_REFUND_RELOAD,
    );
    expect(SIZE_REFUND_RELOAD).toBe(
      "The amount owed back did not come with the press. Reload the page, check the plan and press Record the refund again.",
    );
    expect(env.rpcCalls).toEqual([]);
  });
});

describe("the email of a second correction adds up", () => {
  const second = {
    at: "2026-11-25T20:00:00Z",
    on: "2026-11-25",
    by_name: "Mo Manager",
    from_sqft: 26000,
    to_sqft: 28500,
    from_price: 1040,
    to_price: 1140,
    would_be: 1140,
    repriced: true,
    paid: true,
    covered: 840,
    owed: 300,
    nth: 2,
    note: null,
    plan_number: 1077,
    plan: "care",
  };
  const ASK = { plan_id: PLAN, sqft: 28500, shown_price: 1140, email: true };
  it("the first is not settled: the customer is told what the payments cover, and that this replaces the earlier note", async () => {
    const env = world({ price: 1140 }, { roof_care_correct_size: () => second });
    const out = await call<SizeCorrected>(correctRoofCareSize, env, ASK);
    expect(out.emailed_to).toBe("pat@example.com");
    expect(out.change).toMatchObject({ covered: 840, nth: 2, owed: 300 });
    expect(sent).toHaveLength(1);
    const text = sent[0]!.text;
    expect(text).toContain("The yearly price of your plan is now $1,140. It was $1,040.");
    expect(text).toContain(
      "Your payments so far cover $840.00, so we will send you one invoice for the difference of $300.00. This takes the place of what we wrote to you before about the price.",
    );
    expect(text).toContain("Until now we had your Roof Care plan (RC-1077) at 26,000 sq ft.");
    // The sentence that did not add up: $1,140 less $1,040 is not $300.
    expect(text).not.toContain("We will send you an invoice for the difference of $300.00.");
  });
  it("the first was settled before the second: the email reads as a first one does", async () => {
    const env = world(
      { price: 1140 },
      { roof_care_correct_size: () => ({ ...second, covered: 1040, owed: 100 }) },
    );
    await call<SizeCorrected>(correctRoofCareSize, env, ASK);
    const text = sent[0]!.text;
    expect(text).toContain(
      "Your plan year is already paid, and nothing is due today. We will send you an invoice for the difference of $100.00.",
    );
    expect(text).not.toContain("payments so far");
    // It is still not the size the plan was signed at.
    expect(text).toContain("Until now we had your Roof Care plan (RC-1077) at 26,000 sq ft.");
  });
  it("the email module is the one the other tests use", () => {
    expect(EMAIL_NOT_SET_UP).toContain("Email is not set up yet");
  });
});

describe("a payment marked by mistake on a size invoice comes off", () => {
  it("the invoice of a size difference: the payment is taken off, though the plan is in force", async () => {
    // Until now: "Roof Care plan RC-1077 is running on this invoice's payment. End the plan
    // first", which is not true of this invoice.
    const env = world();
    await call(markInvoicePaid, env, { id: SIZE, paid_on: "2026-11-25", amount: 0 });
    const inv = env.tables["invoices"]!.find((i) => i["id"] === SIZE)!;
    expect(inv).toMatchObject({ status: "final", paid_amount: 0, paid_on: null });
  });
  it("the plan year's own invoice is held as before, in the words that are true of it", async () => {
    const env = world();
    await expect(
      call(markInvoicePaid, env, { id: MAIN, paid_on: "2026-11-25", amount: 0 }),
    ).rejects.toThrow(planRunsOnPayment(1077));
    expect(env.tables["invoices"]!.find((i) => i["id"] === MAIN)!["status"]).toBe("paid");
  });
});

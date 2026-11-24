/**
 * The agreement email holds no Pay by card button (owner, Nov 24, after his first test payment:
 * "i got this email prompting me to pay by card even though stripe opened and i paid by card
 * then. that would be confusing. also even if i didnt pay by card the office needs to review and
 * then send the payment request after theyre sure of the roof size so even then the pay by card
 * button isnt appropriate").
 *
 * Until this the agreement of a card plan went out at the sign-up with the customer's payment
 * link in it, a minute before he paid on the card page that had opened. Now the link reaches a
 * customer only when a person in the office presses Email under Card payment link on the plan.
 * The tests of the email and of the sending fail on the code of that afternoon. Names and
 * amounts are made up.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  notify: async () => 1,
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => true,
  emailConfigured: () => true,
  appUrl: () => "https://portal.example.com",
  sendEmail: async () => ({ ok: false, error: "the test passes its own sender" }),
}));

import { tallyShare } from "@/lib/roof-care-benefits";
import { AWAITS_CARD_WORDS, agreementEmail, type PlanEmailFacts } from "@/lib/roof-care-email";
import { dispatchPlanEmails } from "@/lib/roof-care-email.server";
import { PAY_LINK_NOT_SENT, SIGNED_PAY_BY_LINK } from "@/lib/roof-care-pay-link";
import { ROOF_CARE_TERMS_VERSION } from "@/lib/roof-care-plan";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const facts: PlanEmailFacts = {
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
};

describe("the agreement of a plan that pays by card", () => {
  it("has no payment link and no button, whether or not the payment has come", () => {
    for (const mail of [
      agreementEmail({ ...facts, awaits_card: true })!,
      agreementEmail({ ...facts, awaits_card: false })!,
      agreementEmail(facts)!,
    ]) {
      expect(mail.html).not.toContain("/pay/");
      expect(mail.text).not.toContain("/pay/");
      expect(mail.html).not.toContain(">Pay by card</a>");
      expect(mail.text).not.toContain("PAY BY CARD");
      expect(mail.text).not.toContain("Use the button below");
    }
  });
  it("says, while the payment has not come, that the link follows in an email of its own", () => {
    const waiting = agreementEmail({ ...facts, awaits_card: true })!;
    expect(AWAITS_CARD_WORDS).toBe(
      "You chose to pay by card. If you have not paid yet, we will email you a secure payment link after we review your sign-up. Your plan starts the day we receive your payment.",
    );
    expect(waiting.text).toContain(AWAITS_CARD_WORDS);
    // A plan paid by check, or already paid, reads as it always did.
    expect(agreementEmail(facts)!.text).not.toContain("secure payment link");
    expect(agreementEmail({ ...facts, pay_method: "check" })!.text).not.toContain(
      "secure payment link",
    );
  });
});

const NOW = new Date("2026-11-24T18:39:38Z");
const planRow = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  plan: "care",
  plan_number: 1077,
  site_id: "s1",
  agreed_by: "Pat Smith",
  signed_on: "2026-11-24",
  price: 2345,
  pay_method: "card",
  pay_token: "2a2f6dd4-4a7c-48d2-8708-1dd5d7dda999",
  pay_link_sent_at: null,
  first_visit: "window",
  first_days: null,
  terms_version: ROOF_CARE_TERMS_VERSION,
  status: "awaiting_payment",
  pay_first: true,
  paid_on: null,
  starts_on: null,
  renews_on: "2027-11-24",
  customer_email: "pat@example.com",
  agreement_sent_at: null,
  agreement_error: null,
  receipt_sent_at: null,
  receipt_error: null,
  ...over,
});
const world = (plans: Record<string, unknown>[]) =>
  fakeSupabase({
    roof_care_plans: plans,
    crm_sites: [
      { id: "s1", name: "Main plant", address1: "120 Mill St", city: "London", state: "KY" },
    ],
    company_settings: [{ company_name: "JBK Roofing", phone: "888-555-0100", email: null }],
    roof_care_settings: [],
    invoices: [],
  });

describe("the sending at the sign-up", () => {
  const send = vi.fn<
    (m: {
      to: string;
      subject: string;
      text: string;
      html?: string;
    }) => Promise<{ ok: true } | { ok: false; error: string }>
  >(async () => ({ ok: true }));
  beforeEach(() => {
    send.mockClear();
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_made_up_for_tests");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_made_up_for_tests");
    vi.stubEnv("NOTIFY_FROM_EMAIL", "JBK <plans@example.com>");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("a card plan's agreement goes with no link in it, and the plan is not marked as sent the link", async () => {
    const env = world([planRow()]);
    const r = await dispatchPlanEmails(env.db as never, {}, NOW, send);
    expect(r).toMatchObject({ agreements_sent: 1, email_errors: 0 });
    const m = send.mock.calls[0]![0];
    expect(m.to).toBe("pat@example.com");
    expect(m.text).not.toContain("/pay/");
    expect(m.html ?? "").not.toContain("/pay/");
    expect(m.text).not.toContain("2a2f6dd4");
    expect(m.text).toContain(AWAITS_CARD_WORDS);
    const row = env.tables["roof_care_plans"]![0]!;
    expect(row["agreement_sent_at"]).toBe(NOW.toISOString());
    // The office's box says "not emailed yet" until a person sends the link.
    expect(row["pay_link_sent_at"]).toBeNull();
  });
  it("a card plan already paid when its agreement goes says nothing about a link to come", async () => {
    const env = world([planRow({ status: "active", agreement_sent_at: null })]);
    await dispatchPlanEmails(env.db as never, {}, NOW, send);
    const m = send.mock.calls[0]![0];
    expect(m.text).not.toContain("secure payment link");
    expect(m.text).not.toContain("/pay/");
  });
  it("the sending no longer builds a link at all", () => {
    const server = flat(read("src/lib/roof-care-email.server.ts"));
    expect(server).not.toContain("payLinkFor");
    expect(server).not.toContain("pay_link");
    expect(server).toContain(
      'awaits_card: cardOnline && p.pay_method === "card" && p.status === "awaiting_payment",',
    );
  });
});

describe("the office's side", () => {
  it("the sign-up from a public request says the link has not gone, and where to send it", () => {
    expect(SIGNED_PAY_BY_LINK).toBe(
      "The customer has not been sent a payment link. Check the roof size, then send it from Card payment link on the plan. The plan starts when the payment is received.",
    );
  });
  it("the Card payment link box says so until a person has emailed it", () => {
    expect(PAY_LINK_NOT_SENT).toBe(
      "Not emailed to the customer yet. The agreement does not hold this link: send it when the roof size is right.",
    );
    const box = flat(read("src/components/roof-care/pay-link.tsx"));
    expect(box).toContain("data-pay-link-unsent");
    expect(box).toContain("{PAY_LINK_NOT_SENT}");
  });
});

describe("the plan card's new layout (owner, Nov 24: 'very visually unappealing and difficult to read')", () => {
  const card = flat(read("src/components/roof-care/plan-card.tsx"));
  it("each tile's bar is the share used, and there is none when the reader may not see it", () => {
    expect(tallyShare(0, 2)).toBe(0);
    expect(tallyShare(1, 2)).toBe(50);
    expect(tallyShare(2, 2)).toBe(100);
    expect(tallyShare(123, 410)).toBe(30);
    // Over the allowance is a full bar, never more.
    expect(tallyShare(999, 410)).toBe(100);
    expect(tallyShare(-5, 410)).toBe(0);
    expect(tallyShare(null, 410)).toBeNull();
    expect(tallyShare(1, 0)).toBeNull();
  });
  it("the plan sits in a box of its own, with renews and price on the top line", () => {
    expect(card).toContain("const framed = !short && !includesOpen;");
    expect(card).toContain("data-roof-care-framed={framed}");
    expect(card).toContain("data-roof-care-renews");
  });
  it("what waits for somebody stays in sight; the settled record is under Plan details", () => {
    expect(card).toContain("data-roof-care-details");
    expect(card).toContain("{PLAN_DETAILS_LABEL}");
    // A roof size that waits to be confirmed is not folded away.
    expect(card).toContain(
      "{!short && office && sizeWaits && ( <PlanSizeLine siteId={siteId} plan={active} manager={manager} /> )}",
    );
    expect(card).toContain(
      "{office && !sizeWaits && ( <PlanSizeLine siteId={siteId} plan={active} manager={manager} /> )}",
    );
    // Nor is an email that has not gone, or a card payment whose invoice is still open.
    expect(card).toContain(
      "{!short && office && active.pay_first && active.email && emailWaits && (",
    );
    expect(card).toContain("{!short && office && active.card_paid && cardInvoiceOpen && (");
  });
  it("an inspection's buttons sit at the right of its own row", () => {
    expect(card).toContain("data-visit-actions");
  });
});

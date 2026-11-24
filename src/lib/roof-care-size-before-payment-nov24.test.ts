/**
 * No payment is asked for until the roof size is confirmed (owner, Nov 24, after his second test
 * payment: "ideally we arent requesting payment or taking payment until the roof size is
 * confirmed. the only reason we take card payment when care plan is selceted on a ticket
 * workflow is the tech can measure the roof there", and of holding the link until then: "yes
 * thats a good idea and on site sign up is ok").
 *
 * With it, from the same message: the plan on a property is shown in short ("does the plan need
 * to show on the property like that if the info is all available by clicking the care plan
 * button?"), a plan that waits for its payment is shown as steps ("the non paid plan probably
 * needs a rework as well its a bit messy", "how do you confirm payment was recieved if theyve
 * sent a check"), the receipt says what the plan includes and its terms (it "didnt show what
 * the roof plan included or the terms"), and the thanks after a payment are said at once.
 *
 * The tests of the server's answers and of the receipt fail on the code of that afternoon.
 * Names and amounts are made up.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string; subject: string; text: string }[] = [];
const pages: unknown[] = [];
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
  createCheckoutSession: async (ask: unknown) => {
    pages.push(ask);
    return { id: "cs_test_1", url: "https://card.example.com/pay/cs_test_1" };
  },
}));

import { startPlanCheckout } from "@/lib/roof-care-checkout.functions";
import { receiptEmail, type ReceiptFacts } from "@/lib/roof-care-email";
import {
  PAID_LOOKS_MS,
  PAY_HELD_SIZE,
  SIGNED_SIZE_FIRST,
  type PlanPayLink,
} from "@/lib/roof-care-pay-link";
import { emailPlanPayLink, planPayLink } from "@/lib/roof-care-pay-link.functions";
import {
  PLAN_BRIEF_HINT,
  ROOF_CARE_TERMS,
  ROOF_CARE_TERMS_VERSION,
  STEP_START_CARD,
  STEP_START_CHECK,
} from "@/lib/roof-care-plan";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const run = (fn: unknown, db: unknown, data: unknown, userId = "u1") =>
  (fn as (a: unknown) => Promise<unknown>)({ data, context: { supabase: db, userId } });

const PLAN = "3d6a3c1e-1111-4222-8333-444455556677";
const SITE = "2b6a3c1e-1111-4222-8333-444455556677";
const TOKEN = "4f1c2a9e-7b3d-4c5e-9a1f-0b2c3d4e5f77";
const world = (over: Record<string, unknown> = {}) =>
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
          pay_method: "card",
          pay_token: TOKEN,
          pay_link_sent_at: null,
          agreed_by: "Pat Smith",
          size_unchecked: true,
          ...over,
        },
      ],
      crm_sites: [{ id: SITE, name: "Main plant", address1: "120 Mill St", city: "London" }],
      company_settings: [{ company_name: "JBK Roofing", phone: "888-555-0100", email: null }],
    },
    { rpcs: { roof_care_plan_seen: () => true } },
  );

beforeEach(() => {
  sent.length = 0;
  pages.length = 0;
  process.env["NOTIFY_FROM_EMAIL"] = "JBK <office@example.com>";
});

describe("the payment link while the roof size is not confirmed", () => {
  it("is not handed out, and the box says why", async () => {
    const env = world();
    const l = (await run(planPayLink, env.db, { plan_id: PLAN })) as PlanPayLink;
    expect(l.url).toBeNull();
    expect(l.reason).toBe(PAY_HELD_SIZE);
    expect(PAY_HELD_SIZE).toBe(
      "The roof size is not confirmed yet, so no payment is asked for. A manager or an admin confirms it on the plan first.",
    );
  });
  it("is not emailed either: nothing goes, and the plan is not marked as sent", async () => {
    const env = world();
    await expect(run(emailPlanPayLink, env.db, { plan_id: PLAN })).rejects.toThrow(PAY_HELD_SIZE);
    expect(sent).toEqual([]);
    expect(env.tables["roof_care_plans"]![0]!["pay_link_sent_at"]).toBeNull();
  });
  it("is handed out and emailed as before once the size is confirmed", async () => {
    const env = world({ size_unchecked: false });
    const l = (await run(planPayLink, env.db, { plan_id: PLAN })) as PlanPayLink;
    expect(l.url).toBe(`https://portal.example.com/pay/${TOKEN}`);
    expect(l.reason).toBeNull();
    await run(emailPlanPayLink, env.db, { plan_id: PLAN });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain(`/pay/${TOKEN}`);
  });
});

describe("the card page from the office's side", () => {
  it("does not open off a ticket while the size is not confirmed", async () => {
    const env = world();
    expect(await run(startPlanCheckout, env.db, { plan_id: PLAN })).toEqual({
      url: null,
      reason: PAY_HELD_SIZE,
    });
    expect(pages).toEqual([]);
  });
  it("opens on a ticket: the technician can measure the roof there", async () => {
    const env = world();
    expect(await run(startPlanCheckout, env.db, { plan_id: PLAN, on_site: true })).toEqual({
      url: "https://card.example.com/pay/cs_test_1",
      reason: null,
    });
    expect(pages).toHaveLength(1);
  });
  it("opens anywhere once the size is confirmed", async () => {
    const env = world({ size_unchecked: false });
    expect(await run(startPlanCheckout, env.db, { plan_id: PLAN })).toMatchObject({
      url: "https://card.example.com/pay/cs_test_1",
    });
  });
});

describe("the sign-up", () => {
  const card = flat(read("src/components/roof-care/plan-card.tsx"));
  it("knows it is on a ticket from the two buttons, which are given the ticket", () => {
    expect(card).toContain("const OnTicket = createContext(false);");
    expect(card).toContain("<OnTicket.Provider value={!!jobId}>");
    expect(card).toContain("const onSite = useContext(OnTicket);");
  });
  it("asks for no card payment off a ticket while the size is not confirmed, and says so", () => {
    expect(card).toContain(
      'const sizeFirst = payMethod === "card" && !prefill && !onSite && !!made.size?.unchecked;',
    );
    expect(card).toContain(
      "if (sizeFirst) { toast.success(`${planName(made.plan)} plan signed. ${SIGNED_SIZE_FIRST}`, {",
    );
    expect(SIGNED_SIZE_FIRST).toBe(
      "No payment was asked for: the roof size is not confirmed yet. A manager or an admin confirms it on the plan, then sends the payment link.",
    );
  });
});

describe("a plan that waits for its payment is shown as steps", () => {
  const card = flat(read("src/components/roof-care/plan-card.tsx"));
  it("the roof size first, then asking for the payment, then recording it", () => {
    const size = card.indexOf('key: "size",');
    const pay = card.indexOf('key: "pay",');
    const start = card.indexOf('key: "start",');
    expect(size).toBeGreaterThan(0);
    expect(pay).toBeGreaterThan(size);
    expect(start).toBeGreaterThan(pay);
    expect(card).toContain("data-awaiting-step={st.key}");
  });
  it("holds the card page and the link while the size waits, except on a ticket", () => {
    expect(card).toContain("const held = sizeWaits && !onSite;");
    expect(card).toContain("{card && held && (");
    expect(card).toContain("{PAY_HELD_SIZE}");
    expect(card).toContain("{card && !held && (");
  });
  it("says how a check is recorded, and that a card records itself", () => {
    expect(STEP_START_CHECK).toBe(
      "When the check arrives, open the invoice and press Mark paid. The plan starts that day and its inspections are made.",
    );
    expect(STEP_START_CARD).toBe(
      "A card payment is recorded by itself, and the plan starts that minute. Nothing has to be marked.",
    );
    expect(card).toContain("{card ? STEP_START_CARD : STEP_START_CHECK}");
    // The invoice's own button is called that.
    expect(read("src/components/service/invoice-editor.tsx")).toContain("Mark paid");
  });
});

describe("the plan on a property is shown in short", () => {
  it("the property and the customer page ask for the short form", () => {
    expect(read("src/components/property-page.tsx")).toContain(
      "<RoofCareCard siteId={s.id} brief />",
    );
    expect(read("src/components/customers-page.tsx")).toContain(
      '<RoofCareCard siteId={s.id} brief className="mt-2" />',
    );
  });
  it("the Care Plan pop-up still shows all of it, and the short form says where the rest is", () => {
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain("<RoofCareCard siteId={siteId} visitId={visitId} includesOpen />");
    expect(card).toContain("{brief && (active || waiting) && (");
    expect(PLAN_BRIEF_HINT).toBe(
      "Care Plan opens the inspections, what the plan includes and its details.",
    );
    // What waits for somebody is in the short form too: the size, an email, the renewal.
    expect(card).toContain("{!short && office && sizeWaits && (");
    expect(card).toContain("!short && office && !renewal && renewalOpen(active, today)");
  });
});

describe("the receipt", () => {
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
    paid_on: "2026-11-24",
    starts_on: "2026-11-24",
    renews_on: "2027-11-24",
    invoice_number: "RC-1077",
  };
  it("says what the plan includes and the terms that were agreed to, as the agreement does", () => {
    const m = receiptEmail(facts);
    expect(m.text).toContain("Amount paid: $2,345");
    expect(m.text).toContain("WHAT ROOF CARE INCLUDES");
    expect(m.text).toContain("THE TERMS YOU AGREED TO");
    expect(m.text).toContain(`1. ${ROOF_CARE_TERMS[0]}`);
    expect(m.text).toContain(`${ROOF_CARE_TERMS.length}. ${ROOF_CARE_TERMS.at(-1)}`);
    expect(m.text).toContain(
      `Agreed by Pat Smith on Nov 24, 2026. Terms version ${ROOF_CARE_TERMS_VERSION}.`,
    );
    // The receipt itself still leads.
    expect(m.text.indexOf("Amount paid")).toBeLessThan(m.text.indexOf("WHAT ROOF CARE INCLUDES"));
  });
  it("leaves the terms out, and still goes, when the plan's set is not on file", () => {
    const m = receiptEmail({ ...facts, terms_version: "1999-01-01.1" });
    expect(m.text).toContain("WHAT ROOF CARE INCLUDES");
    expect(m.text).not.toContain("THE TERMS YOU AGREED TO");
  });
});

describe("back from the card page", () => {
  it("the thanks are said before anything is read, and the first looks come sooner", () => {
    const page = flat(read("src/components/public/pay-page.tsx"));
    expect(page).toContain('data-pay="confirming-first"');
    expect(page).toContain("{!facts && !problem && back && (");
    expect(PAID_LOOKS_MS[0]).toBeLessThan(4000);
    expect(PAID_LOOKS_MS.length).toBeGreaterThanOrEqual(6);
    expect(page).toContain("timer = setTimeout(load, PAID_LOOKS_MS[tries.current]);");
  });
});

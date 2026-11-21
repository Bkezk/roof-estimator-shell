/**
 * Roof Care: the sign-up the customer reads, the plan's benefits and their tally, and the
 * agreement and receipt by email (owner, Nov 19, late; docs/qa/roof-care-customer-facing-2026-11-19.md).
 *
 *  - "the care plan menu … will likely be customer facing so we need it to be visually
 *    appealing, explain the plans, and the verbiage should be as if a customer is reading it".
 *  - "one property doesnt get mulitple care plans so if there is a ticket there where a care
 *    plan is already present if they click care plan it pops up the plan they are currently on
 *    and its benefits".
 *  - "keeps track of what it should … tracking repair allocation and amount of free
 *    inspections/other benefits that have already been given".
 *  - "the terms need to be emailed to the customer at signup as well as a receipt ideally".
 *
 * Before this the sign-up was written for staff ("How they are paying for the year", "Who
 * agreed to the plan"), it showed a name and a price for each plan and nothing of what the plan
 * is, the plan kept no email address, and nothing was ever sent to the customer.
 *
 * THE NUMBERS HERE ARE MADE UP: the real allowances and prices are not in the repository.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const cfg = { key: true, service: true };
vi.mock("@/lib/notify.server", () => ({
  notify: async () => 1,
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => cfg.service,
  emailConfigured: () => cfg.key,
  sendEmail: async () => ({ ok: false, error: "the test passes its own sender" }),
}));
vi.mock("@/lib/profile-cache.server", () => ({
  readProfile: async () => ({
    id: "u1",
    role: "admin",
    access: [],
    technician: false,
    full_name: "Dana Office",
    email: "dana@example.com",
  }),
}));

import {
  AGREE_WORDS,
  benefitsOfPlan,
  benefitsUsed,
  everythingIncluded,
  looksLikeEmail,
  PAY_CARD_NOTE_CUSTOMER,
  PLAN_PITCH,
  planIncludes,
  readBenefits,
  SIGN_UP_BUTTON,
} from "@/lib/roof-care-benefits";
import { agreementEmail, receiptEmail, type PlanEmailFacts } from "@/lib/roof-care-email";
import {
  dispatchPlanEmails,
  EMAIL_NOT_SET_UP,
  PLAN_EMAIL_MAX_AGE_DAYS,
} from "@/lib/roof-care-email.server";
import {
  planEmailLines,
  ROOF_CARE_TERMS,
  ROOF_CARE_TERMS_VERSION,
  type PlanVisit,
  type RoofCarePlan,
} from "@/lib/roof-care-plan";
import { readPlanBenefits, setRoofCareEmail } from "@/lib/roof-care-plan.functions";
import { PLAN_KEYS } from "@/lib/roof-care-price";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

// Made up: no plan carries these.
const NUMBERS = {
  watch: { allowance: 0, leak_calls: 0, storm: 0 },
  care: { allowance: 310, leak_calls: 0, storm: 0 },
  guard: { allowance: 730, leak_calls: 3, storm: 2 },
};

describe("what each plan includes, as the customer reads it", () => {
  it("the numbers come from the plan settings: none is written in the wording", () => {
    const src = read("src/lib/roof-care-benefits.ts");
    // No dollar amount, and no count of calls or storm inspections, is typed into the module.
    expect(src).not.toMatch(/\$\d/);
    expect(planIncludes("care", NUMBERS.care)).toContain(
      "$310 of minor repairs included each year",
    );
    const guard = planIncludes("guard", NUMBERS.guard);
    expect(guard).toContain("$730 of minor repairs included each year");
    expect(guard).toContain(
      "Next-business-day leak response, with no trip charge on 3 calls a year",
    );
    expect(guard).toContain("2 storm inspections a year, after a major storm†");
    expect(planIncludes("guard", { allowance: 730, leak_calls: 1, storm: 1 })).toEqual(
      expect.arrayContaining([
        "Next-business-day leak response, with no trip charge on 1 call a year",
        "1 storm inspection a year, after a major storm†",
      ]),
    );
  });
  it("when the numbers cannot be read the lines say it without one, never a guess", () => {
    expect(planIncludes("care", null)).toContain("Minor repairs included each year");
    expect(planIncludes("guard", null).join(" ")).not.toMatch(/\d/);
    expect(readBenefits(null)).toBeNull();
    expect(readBenefits({ watch: {}, care: {}, guard: {} })).toBeNull();
    expect(
      readBenefits({ ...NUMBERS, guard: { allowance: -1, leak_calls: 1, storm: 1 } }),
    ).toBeNull();
    expect(readBenefits(NUMBERS)).toEqual(NUMBERS);
  });
  it("each plan has its one line, and a larger plan starts from the smaller one", () => {
    for (const k of PLAN_KEYS) expect(PLAN_PITCH[k].length).toBeGreaterThan(20);
    expect(planIncludes("watch", NUMBERS.watch)[0]).toBe("2 inspections a year, spring and fall");
    expect(planIncludes("care", NUMBERS.care)[0]).toBe("Everything in Roof Watch");
    expect(planIncludes("guard", NUMBERS.guard)[0]).toBe("Everything in Roof Care");
    // Spelled out in full for the plan pop-up and the email: one repairs line, the plan's own.
    const all = everythingIncluded("guard", NUMBERS.guard);
    expect(all.some((l) => l.startsWith("Everything in"))).toBe(false);
    expect(all.filter((l) => /minor repairs/i.test(l))).toEqual([
      "$730 of minor repairs included each year",
    ]);
    expect(all).toContain("Drains and scuppers cleaned at both inspections");
    expect(all).toContain("A photo report with a condition grade after each one");
  });
  it("the sign-up reads as the customer's own screen", () => {
    const whole = read("src/components/roof-care/plan-card.tsx");
    // The sign-up alone: the Renew box is the office's, and keeps its own words.
    const card = flat(
      whole.slice(whole.indexOf("const FIRST_WORDS"), whole.indexOf("// ── Push back")),
    );
    // The words that spoke about the customer are gone.
    expect(card).not.toContain("How they are paying for the year</legend>");
    expect(card).not.toContain("Who agreed to the plan (the customer’s name)");
    expect(card).not.toContain("The customer has read these terms and agrees to them.");
    expect(card).not.toContain("Sign the plan");
    expect(card).toContain('now: "As soon as your payment is received"');
    expect(card).toContain("<SignStep n={4} title={PAY_QUESTION}>");
    expect(card).toContain("<span>{AGREE_WORDS}</span>");
    expect(card).toContain("{SIGN_UP_BUTTON}");
    expect(AGREE_WORDS).toBe("I have read these terms and agree to them.");
    expect(SIGN_UP_BUTTON).toBe("Agree and sign up");
    // The three plans are explained before there is a price, and picked once there is.
    expect(card).toContain("{PLAN_KEYS.map((k) => { const o = offerOf(k);");
    // Nov 21: each plan is drawn by the flyer's own part (flyer-look.tsx FlyerPlan), which is
    // handed the same lines, the same words while there is no price, and the same tag.
    expect(card).toContain("lines={planIncludes(k, benefits?.[k] ?? null)}");
    expect(card).toContain("disabled={!o || stale}");
    expect(card).toContain("waiting={PRICE_AFTER_SIZE}");
    expect(card).toContain("recommended={k === PLAN_RECOMMENDED ? RECOMMENDED_WORDS : null}");
    // The office's part is set apart from what the customer reads.
    expect(card).toContain("data-sign-staff");
  });
  it("card says the office takes it, until Stripe's checkout is set up", () => {
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    // (Nov 19, night: and says the payment page is next once online payment is set up.)
    expect(card).toContain("{cardOnline ? PAY_CARD_NOTE_ONLINE : PAY_CARD_NOTE_CUSTOMER}");
    expect(PAY_CARD_NOTE_CUSTOMER).toContain(
      "Our office will contact you to take your card payment",
    );
    // The reminder that outlives the session.
    const agents = read("AGENTS.md");
    // (Nov 19, night: the site's side is built; the reminder now lists what turns it on.)
    expect(agents).toContain("is sent to Stripe checkout");
    expect(agents).toContain("`STRIPE_WEBHOOK_SECRET`");
    // Nov 20: the Google Routes key is proven (Try a building said "by road, from Google"), so
    // it came off the list. The two that are still waiting stay.
    expect(agents).not.toContain("`GOOGLE_MAPS_API_KEY` in Lovable Cloud");
    expect(agents).toContain("`RESEND_API_KEY`");
  });
});

// ── One plan to a property, and its pop-up ──────────────────────────────────────────────────

const visit = (
  kind: PlanVisit["kind"],
  stage: string | null,
  over: Partial<PlanVisit> = {},
): PlanVisit => ({
  id: `v-${kind}-${stage}`,
  kind,
  due_from: "2027-03-01",
  due_by: "2027-05-31",
  first_due_by: "2027-05-31",
  amount: 0,
  push_reason: null,
  pushed_by_name: null,
  customer_asked: false,
  lost_on: null,
  ticket: stage
    ? { id: "t", number: 1, stage, scheduled_date: null, completed_at: null, invoice_id: null }
    : null,
  billed: null,
  ...over,
});
const tallyPlan = (over: Partial<RoofCarePlan>) =>
  ({
    plan: "guard",
    visits: [],
    repair_allowance: 730,
    allowance_used: 120,
    free_travel_calls: 3,
    free_travel_used: 1,
    ...over,
  }) as RoofCarePlan;

describe("one plan to a property, and what it has given", () => {
  it("the database refuses a second plan, and Care Plan opens the one that is there", () => {
    const sql = flat(
      read("supabase/migrations/20261119700000_roof_care_refund_and_leak_calls.sql"),
    );
    expect(sql).toContain("raise exception 'This property already has a Roof Care plan';");
    expect(sql).toContain(
      "raise exception 'This property already has a Roof Care plan waiting to be paid';",
    );
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain(
      "(active || waiting || lapsed ? ( <PlanDialog siteId={siteId} visitId={visitId ?? null} onClose={() => setOpen(null)} /> ) : ( <SignUpDialog",
    );
    // The pop-up: what the plan includes, open, and the tally.
    expect(card).toContain("<RoofCareCard siteId={siteId} visitId={visitId} includesOpen />");
    expect(card).toContain(
      "{!short && <PlanBenefits plan={active} today={today} open={includesOpen} />}",
    );
    expect(card).toContain(
      '<summary className="cursor-pointer font-medium">What {planName(plan.plan)} includes</summary>',
    );
    expect(card).toContain('<p className="font-medium">Used this plan year</p>');
    // A plan that waits for its payment says what it includes too.
    expect(card).toContain(
      "{!short && !renewalOf && <PlanIncludes plan={plan} open={includesOpen} />}",
    );
  });
  it("the tally: inspections, minor repairs, leak calls and the storm inspection", () => {
    const rows = benefitsUsed(
      tallyPlan({
        visits: [visit("visit1", "done"), visit("visit2", "scheduled"), visit("storm", "open")],
      }),
      "2027-04-01",
      2,
    );
    // (Nov 19, night: the cleaning at each inspection and the budget forecast joined the
    // tally. roof-care-go-aheads-nov19.test.ts.)
    expect(rows.map((r) => `${r.label}: ${r.words}`)).toEqual([
      "Inspections: 1 of 2 done",
      "Drains and scuppers cleaned: Done at 0 of 2 inspections",
      "Gutters cleaned: Done at 0 of 2 inspections",
      "Minor repairs: $120 of $730 used, $610 left",
      "Leak calls with no trip charge: 1 of 3 used",
      "Storm inspection: 1 of 2 used",
      "Yearly budget forecast: Not sent yet",
    ]);
  });
  it("a reader who does not see invoices is told what is included, not what was billed", () => {
    const rows = benefitsUsed(
      tallyPlan({ allowance_used: null, free_travel_used: null }),
      "2027-04-01",
      1,
    );
    expect(
      rows
        .filter((r) => ["inspections", "repairs", "leak_calls", "storm"].includes(r.key))
        .map((r) => r.words),
    ).toEqual(["0 of 2 done", "$730 a year included", "3 a year included", "0 of 1 used"]);
  });
  it("only what the plan includes is listed, and a storm inspection past the plan's own shows", () => {
    const watch = benefitsUsed(
      tallyPlan({ plan: "watch", repair_allowance: 0, free_travel_calls: 0 }),
      "2027-04-01",
      0,
    );
    expect(watch.map((r) => r.key)).toEqual(["inspections"]);
    // A manager added a second storm inspection to a plan that includes one.
    const over = benefitsUsed(
      tallyPlan({ visits: [visit("storm", "done"), visit("storm", "open", { id: "s2" })] }),
      "2027-04-01",
      1,
    );
    expect(over.find((r) => r.key === "storm")!.words).toBe("2 used, 1 included");
    // More used than included never reads as a negative amount left.
    const spent = benefitsUsed(tallyPlan({ allowance_used: 800 }), "2027-04-01", 1);
    expect(spent.find((r) => r.key === "repairs")!.words).toBe("$800 of $730 used, $0 left");
    expect(benefitsOfPlan(tallyPlan({}), 2)).toEqual(
      NUMBERS.guard === null ? null : { allowance: 730, leak_calls: 3, storm: 2 },
    );
  });
  it("the storm inspections a plan includes come with the plan, from the settings", async () => {
    const env = fakeSupabase({}, { rpcs: { roof_care_benefits: () => NUMBERS } });
    expect(await readPlanBenefits(env.db as never)).toEqual(NUMBERS);
    const down = fakeSupabase({}, { rpcs: { roof_care_benefits: () => "nonsense" } });
    expect(await readPlanBenefits(down.db as never)).toBeNull();
    const f = flat(read("src/lib/roof-care-plan.functions.ts"));
    // Nov 20 (break test 31): the plan's own number as signed; the settings only for a plan
    // from before the number was kept.
    expect(f).toContain("storm_included: ownStormCount(p.storm_included, benefits?.[plan].storm),");
    const sql = flat(read("supabase/migrations/20261119960000_roof_care_agreement_email.sql"));
    // What the customer is told is for anyone signed in; the settings stay the admins'.
    expect(sql).toContain(
      "grant execute on function public.roof_care_benefits() to authenticated;",
    );
    expect(sql).toContain("revoke all on function public.roof_care_benefits() from public, anon;");
  });
});

// ── The agreement and the receipt ───────────────────────────────────────────────────────────

const facts: PlanEmailFacts = {
  plan: "guard",
  plan_number: 1234,
  site: "Main Plant",
  address: "1 Mill St, Corbin, KY 40701",
  agreed_by: "Pat <Smith>",
  signed_on: "2027-01-05",
  price: 4321,
  pay_method: "check",
  first_visit: "now",
  first_days: null,
  terms_version: ROOF_CARE_TERMS_VERSION,
  benefits: NUMBERS.guard,
  company: "JBK Test Roofing",
  contact: "555-0100 or office@example.com",
};

describe("the agreement and the receipt, in words", () => {
  it("the agreement carries the plan, the price, what it includes and every term, word for word", () => {
    const m = agreementEmail(facts)!;
    expect(m.subject).toBe("Your JBK Test Roofing Roof Guard plan agreement (RC-1234)");
    expect(m.text).toContain("Plan: Roof Guard (RC-1234)");
    expect(m.text).toContain("Property: Main Plant, 1 Mill St, Corbin, KY 40701");
    expect(m.text).toContain("Price: $4,321 for the year, paid before the plan starts");
    expect(m.text).toContain("Paying by: check");
    expect(m.text).toContain("- $730 of minor repairs included each year");
    ROOF_CARE_TERMS.forEach((t, i) => expect(m.text).toContain(`${i + 1}. ${t}`));
    expect(m.text).toContain(`Terms version ${ROOF_CARE_TERMS_VERSION}.`);
    expect(m.text).toContain("reach us at 555-0100 or office@example.com");
    // What the customer typed is never markup.
    expect(m.html).toContain("Hello Pat &lt;Smith&gt;,");
    expect(m.html).not.toContain("<Smith>");
    expect(m.html).toContain(`<li style="margin-bottom:4px">${ROOF_CARE_TERMS[0]}</li>`);
  });
  it("a plan that agreed to a set of terms not on file gets no agreement, never the wrong terms", () => {
    expect(agreementEmail({ ...facts, terms_version: "2026-01-01" })).toBeNull();
  });
  it("the receipt says what was paid, when, and the plan year it bought", () => {
    const m = receiptEmail({
      ...facts,
      paid: 4321,
      paid_on: "2027-01-08",
      starts_on: "2027-01-08",
      renews_on: "2028-01-08",
      invoice_number: "RC-1234",
    });
    expect(m.subject).toBe("Receipt: your JBK Test Roofing Roof Guard plan (RC-1234)");
    expect(m.text).toContain("Amount paid: $4,321");
    expect(m.text).toContain("Received: Jan 8, 2027");
    expect(m.text).toContain("Invoice: #RC-1234");
    expect(m.text).toContain("started Jan 8, 2027 and runs until Jan 8, 2028");
  });
  it("the plan says where each went, or plainly why it has not", () => {
    const day = (d: string) => d;
    expect(
      planEmailLines(
        {
          to: null,
          agreement_sent_at: null,
          agreement_error: null,
          receipt_sent_at: null,
          receipt_error: null,
        },
        { paid: true, day },
      ),
    ).toEqual(["No email address: the agreement and the receipt were not emailed."]);
    expect(
      planEmailLines(
        {
          to: "pat@example.com",
          agreement_sent_at: "2027-01-05T15:00:00Z",
          agreement_error: null,
          receipt_sent_at: null,
          receipt_error: EMAIL_NOT_SET_UP,
        },
        { paid: true, day },
      ),
    ).toEqual([
      "Agreement emailed to pat@example.com 2027-01-05.",
      "The receipt has not been emailed yet. Email is not set up on the site yet.",
    ]);
    // Nothing of a receipt before there is a payment.
    expect(
      planEmailLines(
        {
          to: "pat@example.com",
          agreement_sent_at: null,
          agreement_error: null,
          receipt_sent_at: null,
          receipt_error: null,
        },
        { paid: false, day },
      ),
    ).toEqual([
      "The agreement has not been emailed to pat@example.com yet. It goes out within the half hour.",
    ]);
  });
  it("an email address is checked the same way on the form and in the database", () => {
    expect(looksLikeEmail("pat@example.com")).toBe(true);
    for (const bad of ["pat", "pat@", "pat@example", "pat smith@example.com", "@example.com"])
      expect(looksLikeEmail(bad)).toBe(false);
    const sql = read("supabase/migrations/20261119960000_roof_care_agreement_email.sql");
    expect(sql).toContain("v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'");
    // A changed address gets both again; the same address changes nothing.
    expect(flat(sql)).toContain(
      "set customer_email = v_email, agreement_sent_at = null, agreement_error = null, receipt_sent_at = null, receipt_error = null,",
    );
    expect(flat(sql)).toContain(
      "if v_email is not distinct from p.customer_email then return; end if;",
    );
  });
});

const NOW = new Date("2027-01-10T15:00:00Z");
const planRow = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  plan: "guard",
  plan_number: 1234,
  site_id: "s1",
  agreed_by: "Pat Smith",
  signed_on: "2027-01-05",
  price: 4321,
  pay_method: "check",
  first_visit: "now",
  first_days: null,
  terms_version: ROOF_CARE_TERMS_VERSION,
  status: "awaiting_payment",
  pay_first: true,
  paid_on: null,
  starts_on: null,
  renews_on: "2028-01-05",
  customer_email: "pat@example.com",
  agreement_sent_at: null,
  agreement_error: null,
  receipt_sent_at: null,
  receipt_error: null,
  ...over,
});
const world = (plans: Record<string, unknown>[], invoices: Record<string, unknown>[] = []) =>
  fakeSupabase({
    roof_care_plans: plans,
    crm_sites: [
      {
        id: "s1",
        name: "Main Plant",
        address1: "1 Mill St",
        city: "Corbin",
        state: "KY",
        zip: "40701",
      },
    ],
    company_settings: [{ company_name: "JBK Test Roofing", phone: "555-0100", email: null }],
    roof_care_settings: [
      {
        updated_at: "2027-01-01",
        data: {
          guard_leak_calls: 3,
          guard_storm_inspections: 2,
          plans: { watch: {}, care: { allowance: 310 }, guard: { allowance: 730 } },
        },
      },
    ],
    invoices,
  });

describe("sending them", () => {
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
    send.mockImplementation(async () => ({ ok: true }));
    cfg.key = true;
    cfg.service = true;
    process.env["NOTIFY_FROM_EMAIL"] = "JBK <plans@example.com>";
  });

  it("the agreement goes once to the address on the plan, and is stamped", async () => {
    const env = world([planRow()]);
    const r = await dispatchPlanEmails(env.db as never, {}, NOW, send);
    expect(r).toEqual({ agreements_sent: 1, receipts_sent: 0, email_errors: 0, held: null });
    expect(send).toHaveBeenCalledTimes(1);
    const m = send.mock.calls[0]![0];
    expect(m.to).toBe("pat@example.com");
    expect(m.subject).toBe("Your JBK Test Roofing Roof Guard plan agreement (RC-1234)");
    expect(m.text).toContain("$730 of minor repairs included each year");
    expect(m.text).toContain("no trip charge on 3 calls a year");
    expect(env.tables["roof_care_plans"]![0]!["agreement_sent_at"]).toBe(NOW.toISOString());
    // The next run sends nothing more.
    await dispatchPlanEmails(env.db as never, {}, NOW, send);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("the receipt goes when the payment is in, with what was paid", async () => {
    const env = world(
      [
        planRow({
          status: "active",
          paid_on: "2027-01-08",
          starts_on: "2027-01-08",
          renews_on: "2028-01-08",
          agreement_sent_at: "2027-01-05T15:00:00Z",
        }),
      ],
      [
        {
          id: "i1",
          roof_care_plan_id: "p1",
          display_number: "RC-1234",
          paid_amount: 4321,
          status: "paid",
        },
        {
          id: "i0",
          roof_care_plan_id: "p1",
          display_number: "RC-1234",
          paid_amount: 99,
          status: "void",
        },
      ],
    );
    const r = await dispatchPlanEmails(env.db as never, {}, NOW, send);
    expect(r.receipts_sent).toBe(1);
    const m = send.mock.calls[0]![0];
    expect(m.subject).toBe("Receipt: your JBK Test Roofing Roof Guard plan (RC-1234)");
    expect(m.text).toContain("Amount paid: $4,321");
    expect(env.tables["roof_care_plans"]![0]!["receipt_sent_at"]).toBe(NOW.toISOString());
  });
  it("no receipt before a payment, none for a renewal at no charge, and none without an address", async () => {
    const env = world([
      planRow({ agreement_sent_at: "2027-01-05T15:00:00Z" }),
      planRow({
        id: "p2",
        status: "active",
        paid_on: "2027-01-08",
        starts_on: "2027-01-08",
        agreement_sent_at: "2027-01-05T15:00:00Z",
      }),
      planRow({ id: "p3", customer_email: null }),
    ]);
    const r = await dispatchPlanEmails(env.db as never, {}, NOW, send);
    expect(send).not.toHaveBeenCalled();
    expect(r).toEqual({ agreements_sent: 0, receipts_sent: 0, email_errors: 0, held: null });
  });
  it("a send that fails is put back with why, and goes with the next run", async () => {
    const env = world([planRow()]);
    send.mockImplementationOnce(async () => ({ ok: false, error: "Resend 500: down" }));
    const r = await dispatchPlanEmails(env.db as never, {}, NOW, send);
    expect(r.email_errors).toBe(1);
    const row = env.tables["roof_care_plans"]![0]!;
    expect(row["agreement_sent_at"]).toBeNull();
    expect(row["agreement_error"]).toBe("Resend 500: down");
    const again = await dispatchPlanEmails(env.db as never, {}, NOW, send);
    expect(again.agreements_sent).toBe(1);
    expect(row["agreement_error"]).toBeNull();
  });
  it("while email is not set up nothing is sent, and the plan says why", async () => {
    cfg.key = false;
    const env = world([planRow()]);
    const r = await dispatchPlanEmails(env.db as never, {}, NOW, send);
    expect(send).not.toHaveBeenCalled();
    expect(r.held).toBe(EMAIL_NOT_SET_UP);
    expect(env.tables["roof_care_plans"]![0]!["agreement_error"]).toBe(EMAIL_NOT_SET_UP);
    // Set up later: the agreement of a plan signed a few days ago still goes.
    cfg.key = true;
    expect((await dispatchPlanEmails(env.db as never, {}, NOW, send)).agreements_sent).toBe(1);
    // With no sender address of our own, mail would only reach the email account's owner.
    delete process.env["NOTIFY_FROM_EMAIL"];
    const other = world([planRow()]);
    expect((await dispatchPlanEmails(other.db as never, {}, NOW, send)).held).toContain(
      "NOTIFY_FROM_EMAIL",
    );
  });
  it("an agreement weeks late is not sent, nor one for a plan that has ended", async () => {
    expect(PLAN_EMAIL_MAX_AGE_DAYS).toBe(30);
    const env = world([
      planRow({ signed_on: "2026-11-30" }),
      planRow({ id: "p2", status: "ended" }),
    ]);
    await dispatchPlanEmails(env.db as never, {}, NOW, send);
    expect(send).not.toHaveBeenCalled();
  });
  it("one plan's can be sent alone, right after it is signed", async () => {
    const env = world([planRow(), planRow({ id: "p2" })]);
    await dispatchPlanEmails(env.db as never, { planId: "p2" }, NOW, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(env.tables["roof_care_plans"]![0]!["agreement_sent_at"]).toBeNull();
    expect(env.tables["roof_care_plans"]![1]!["agreement_sent_at"]).toBe(NOW.toISOString());
  });
  it("the scheduled run sends what is waiting, and the sign-up and the renewal send at once", () => {
    const cron = flat(read("src/routes/api.cron.reminders.ts"));
    expect(cron).toContain(
      'const { dispatchPlanEmails } = await import("@/lib/roof-care-email.server"); const e = await dispatchPlanEmails(supabaseAdmin);',
    );
    expect(cron).toContain("plan_emails: planEmails,");
    const f = flat(read("src/lib/roof-care-plan.functions.ts"));
    expect(f).toContain('await sb.rpc("roof_care_set_email", { p_plan: planId, p_email: email });');
    expect(f).toContain("if (email) await sendPlanEmailsNow(sb, planId);");
    // The renewal's go where last year's went.
    expect(f).toContain(
      'await sb.rpc("roof_care_set_email", { p_plan: planId, p_email: old.customer_email });',
    );
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain("email: email.trim(),");
    expect(card).toContain("!emailBad &&");
  });
  it("the office gives or corrects the address on the plan", async () => {
    const calls: Record<string, unknown>[] = [];
    const env = fakeSupabase(
      { roof_care_plans: [] },
      {
        rpcs: {
          roof_care_set_email: (a: Record<string, unknown>) => {
            calls.push(a);
            return null;
          },
        },
      },
    );
    const ctx = { context: { supabase: env.db, userId: "u1" } };
    const run = setRoofCareEmail as unknown as (a: unknown) => Promise<unknown>;
    await run({
      ...ctx,
      data: { plan_id: "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e11", email: " pat@example.com " },
    });
    expect(calls).toEqual([
      { p_plan: "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e11", p_email: "pat@example.com" },
    ]);
    expect(() =>
      run({ ...ctx, data: { plan_id: "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e11", email: "pat" } }),
    ).toThrow("That does not look like an email address");
  });
});

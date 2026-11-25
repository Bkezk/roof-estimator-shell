/**
 * A roof size corrected on a plan that is already paid (owner, Nov 24, 2026, of the "Correct
 * the roof size" button: "1. yes but then build the rest").
 *
 * The first step kept the price a paid plan was paid at. Now the plan takes the price of the
 * right size and the difference is settled: a bigger roof on an invoice of its own, a smaller
 * roof by a refund the office sends and records. The plan year's own invoice stays the only one
 * of its kind, and the refund worked when a plan ends counts both.
 *
 * Every amount here is made up and matches no plan price.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  SIZE_EMAIL_NOT_CHARGED,
  sizeCorrectedEmail,
  type SizeCorrectedFacts,
} from "@/lib/roof-care-email";
import {
  isSizeInvoice,
  planInvoicePaidNote,
  planInvoiceRemake,
  readSizeChange,
  readSizeRefunds,
  SIZE_CORRECT_LEAD_PAID,
  SIZE_INVOICE_MAKE,
  SIZE_REFUND_RECORD,
  sizeBalanceWords,
  sizeChangeWords,
  sizeOfferWords,
  sizeOwed,
  sizeRefundWords,
} from "@/lib/roof-care-plan";
import {
  makeSizeInvoice,
  SIZE_INVOICE_LINE,
  SIZE_INVOICE_NOTHING_OWED,
  SIZE_LINE_SOURCE,
  sizeInvoiceDescription,
  sizeInvoiceLine,
  sizeInvoiceNumber,
} from "@/lib/roof-care-plan-invoice.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const SITE = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";
const WHO = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Ann Admin" };

describe("what is owed", () => {
  it("is the price less what the payments cover, to the cent", () => {
    expect(sizeOwed(470, 410)).toBe(60);
    expect(sizeOwed(380.25, 410)).toBe(-29.75);
    expect(sizeOwed(410, 410)).toBe(0);
  });
  it("is nothing for a plan whose size was never corrected after it was paid", () => {
    expect(sizeOwed(470, null)).toBe(0);
    expect(sizeOwed(470, undefined)).toBe(0);
  });
  it("the refunds on record are read strictly", () => {
    expect(
      readSizeRefunds([
        { amount: 30, on: "2026-11-24", ref: " check 9 ", by_name: " Ann " },
        { amount: "12.5", on: "2026-11-25T10:00:00Z", ref: null, by_name: "" },
        { amount: 0, on: "2026-11-24" },
        { amount: 5, on: "soon" },
        "x",
      ]),
    ).toEqual([
      { amount: 30, on: "2026-11-24", ref: "check 9", by_name: "Ann" },
      { amount: 12.5, on: "2026-11-25", ref: null, by_name: "" },
    ]);
    expect(readSizeRefunds(null)).toEqual([]);
  });
  it("a correction of a paid plan carries what it left owed; another carries neither key", () => {
    const base = {
      on: "2026-11-24",
      by_name: "Mo",
      from_sqft: 20000,
      to_sqft: 26000,
      from_price: 410,
      to_price: 470,
      would_be: 470,
      repriced: true,
      note: null,
    };
    expect(readSizeChange({ ...base, paid: true, owed: 60 })).toMatchObject({
      paid: true,
      owed: 60,
    });
    const waiting = readSizeChange({ ...base, paid: false, owed: null })!;
    expect("paid" in waiting).toBe(false);
    expect("owed" in waiting).toBe(false);
  });
});

describe("the words", () => {
  const offer = {
    from_sqft: 20000,
    to_sqft: 26000,
    from_price: 410,
    to_price: 470,
    repriced: false,
    paid: true,
  };
  it("before saving: an invoice for a bigger roof, money back for a smaller one", () => {
    expect(sizeOfferWords({ ...offer, owed: 60 })).toBe(
      "From 20,000 sq ft to 26,000 sq ft. The price goes from $410 to $470 a year. The plan year is already paid, so an invoice for the $60.00 difference is made as a draft.",
    );
    expect(sizeOfferWords({ ...offer, to_price: 380, owed: -30 })).toBe(
      "From 20,000 sq ft to 26,000 sq ft. The price goes from $410 to $380 a year. The plan year is already paid, so $30.00 is owed back to the customer.",
    );
    expect(sizeOfferWords({ ...offer, to_price: 410, owed: 0 })).toContain(
      "Nothing more is owed either way.",
    );
  });
  it("the window no longer says nothing is billed and nothing is refunded", () => {
    expect(SIZE_CORRECT_LEAD_PAID).toContain("A bigger roof is billed the difference");
    expect(SIZE_CORRECT_LEAD_PAID).toContain("A smaller roof is owed the difference back");
    expect(SIZE_CORRECT_LEAD_PAID).not.toContain("nothing is billed");
  });
  it("the record says what was billed or owed back, only to someone who sees prices", () => {
    const c = readSizeChange({
      on: "2026-11-24",
      by_name: "Mo Manager",
      from_sqft: 20000,
      to_sqft: 26000,
      from_price: 410,
      to_price: 470,
      would_be: 470,
      repriced: true,
      paid: true,
      owed: 60,
      note: null,
    })!;
    expect(sizeChangeWords(c, true)).toBe(
      "Roof size corrected from 20,000 to 26,000 sq ft by Mo Manager on Nov 24, 2026. The price went from $410 to $470 a year. The plan year was already paid: $60.00 more was billed.",
    );
    expect(sizeChangeWords({ ...c, to_price: 380, owed: -30 }, true)).toContain(
      "The plan year was already paid: $30.00 was owed back.",
    );
    expect(sizeChangeWords(c, false)).not.toContain("$");
  });
  it("on the plan: what waits, and for whom", () => {
    expect(
      sizeBalanceWords({
        owed: 60,
        invoice: { id: "i1", number: "RC-1077-S1", status: "draft" },
        refunds: [],
      }),
    ).toBe(
      "The corrected roof size costs $60.00 more this plan year. Invoice #RC-1077-S1 for it is a draft: finalise it and send it.",
    );
    expect(
      sizeBalanceWords({
        owed: 60,
        invoice: { id: "i1", number: "RC-1077-S1", status: "final" },
        refunds: [],
      }),
    ).toContain("is sent and not paid yet");
    expect(sizeBalanceWords({ owed: 60, invoice: null, refunds: [] })).toContain(
      "The invoice for it is not made yet.",
    );
    expect(sizeBalanceWords({ owed: -30, invoice: null, refunds: [] })).toBe(
      "The corrected roof size costs $30.00 less this plan year. That is owed back to the customer.",
    );
    expect(sizeBalanceWords({ owed: 0, invoice: null, refunds: [] })).toBe("");
  });
  it("a refund on record", () => {
    expect(sizeRefundWords({ amount: 30, on: "2026-11-24", ref: "check 9", by_name: "Ann" })).toBe(
      "$30.00 sent back for the smaller roof on Nov 24, 2026 by Ann (check 9).",
    );
  });
});

describe("the size invoice", () => {
  const world = (plan: Record<string, unknown> = {}, invoices: Record<string, unknown>[] = []) =>
    fakeSupabase({
      roof_care_plans: [
        {
          id: PLAN,
          plan: "care",
          status: "active",
          plan_number: 1077,
          price: 470,
          size_paid_price: 410,
          roof_sqft: 26000,
          account_id: ACCOUNT,
          site_id: SITE,
          ...plan,
        },
      ],
      crm_accounts: [{ id: ACCOUNT, name: "Mill Co" }],
      crm_sites: [{ id: SITE, name: "Main plant", address1: "120 Mill St", city: "London" }],
      invoices,
      invoice_lines: [],
    });

  it("is numbered after the plan and says what it is for", () => {
    expect(sizeInvoiceNumber(1077, 1)).toBe("RC-1077-S1");
    expect(sizeInvoiceNumber(1077, 3)).toBe("RC-1077-S3");
    expect(
      sizeInvoiceDescription({ plan: "care", plan_number: 1077, from_sqft: 20000, to_sqft: 26000 }),
    ).toBe(
      "Roof Care plan RC-1077: the roof was measured and its size corrected from about 20,000 to about 26,000 sq ft. This invoice is the difference in the plan's price for this plan year.",
    );
    expect(sizeInvoiceLine(PLAN, 60)).toMatchObject({
      description: SIZE_INVOICE_LINE,
      total: 60,
      rate: 60,
      taxable: false,
      source: SIZE_LINE_SOURCE + PLAN,
    });
  });

  it("is a draft on the plan, marked as its size invoice, for exactly what is owed", async () => {
    const env = world({}, [
      { id: "main", roof_care_plan_id: PLAN, status: "paid", display_number: "RC-1077" },
    ]);
    const r = await makeSizeInvoice(env.db, PLAN, WHO, 20000);
    expect(r.made).toBe(true);
    const inv = env.tables["invoices"]!.find((i) => i["id"] === r.id)!;
    expect(inv).toMatchObject({
      roof_care_plan_id: PLAN,
      plan_part: "size",
      service_job_id: null,
      bid_id: null,
      display_number: "RC-1077-S1",
      status: "draft",
      tax_rate: 0,
      total: 60,
    });
    expect(String(inv["description"])).toContain("from about 20,000 to about 26,000 sq ft");
    expect(env.tables["invoice_lines"]).toHaveLength(1);
    expect(env.tables["invoice_lines"]![0]).toMatchObject({ invoice_id: r.id, total: 60 });
    // The plan year's own invoice is untouched.
    expect(env.tables["invoices"]!.find((i) => i["id"] === "main")!["status"]).toBe("paid");
  });

  it("one open at a time: asking again answers with the one that is there", async () => {
    const env = world();
    const first = await makeSizeInvoice(env.db, PLAN, WHO);
    const again = await makeSizeInvoice(env.db, PLAN, WHO);
    expect(again).toEqual({ id: first.id, made: false });
    expect(env.tables["invoices"]).toHaveLength(1);
  });

  it("the next one after a paid one is numbered on", async () => {
    const env = world({}, [
      {
        id: "s1",
        roof_care_plan_id: PLAN,
        plan_part: "size",
        status: "paid",
        display_number: "RC-1077-S1",
      },
    ]);
    const r = await makeSizeInvoice(env.db, PLAN, WHO);
    expect(env.tables["invoices"]!.find((i) => i["id"] === r.id)!["display_number"]).toBe(
      "RC-1077-S2",
    );
  });

  // Nov 26, 2026: a plan whose year is over can still owe a bigger roof's difference, and
  // its invoice is made then too (it was refused, so the difference could not be billed). A
  // plan that waits for its payment still gets none.
  it("is not made when nothing is owed to us, or the plan still waits for its payment", async () => {
    for (const plan of [
      { size_paid_price: null },
      { size_paid_price: 470 },
      { size_paid_price: 500 },
      { status: "ended", size_paid_price: 470 },
      { status: "awaiting_payment" },
    ]) {
      const env = world(plan);
      await expect(makeSizeInvoice(env.db, PLAN, WHO)).rejects.toThrow(SIZE_INVOICE_NOTHING_OWED);
      expect(env.tables["invoices"]).toHaveLength(0);
    }
  });

  it("the amount is the plan's own, never the caller's", () => {
    const f = flat(read("src/lib/roof-care-plan-invoice.functions.ts"));
    const fn = f.slice(f.indexOf("export async function makeSizeInvoice"));
    expect(fn).toContain('Math.round((Number(plan["price"]) - paidPrice) * 100) / 100');
    expect(fn.slice(0, fn.indexOf("{"))).not.toContain("amount");
  });
});

describe("the email for a plan year already paid", () => {
  const facts: SizeCorrectedFacts = {
    plan: "care",
    plan_number: 1077,
    site: "Main plant",
    address: "120 Mill St, London",
    agreed_by: "Pat Smith",
    from_sqft: 20000,
    to_sqft: 26000,
    from_price: 410,
    to_price: 470,
    owed: 0,
    pay_method: "card",
    pay_link: "https://portal.example.com/pay/x",
    company: "JBK Roofing",
    contact: "888-555-0100",
  };
  it("a bigger roof: the invoice follows, and there is no Pay by card button", () => {
    const m = sizeCorrectedEmail({ ...facts, settle: 60 });
    expect(m.text).toContain("The yearly price of your plan is now $470. It was $410.");
    expect(m.text).toContain(
      "Your plan year is already paid, and nothing is due today. We will send you an invoice for the difference of $60.00.",
    );
    expect(m.text).not.toContain("Pay by card");
    expect(m.text).not.toContain("/pay/");
    expect(m.html ?? "").not.toContain("/pay/");
  });
  it("a smaller roof: the money comes back", () => {
    const m = sizeCorrectedEmail({ ...facts, to_price: 380, settle: -30 });
    expect(m.text).toContain("Your plan year is already paid. We are sending $30.00 back to you.");
  });
  it("a plan that waits is as it was: the payment is asked for in the same email", () => {
    expect(sizeCorrectedEmail({ ...facts, owed: 470 }).text).toContain("Pay by card");
  });
  // The owner, Nov 25, of the two emails he was sent: it "comes across a bit abrupt, like
  // youve already paid … now were asking for … more or you anticipating a certain cost then
  // its quoted much higher". He picked two of the softenings offered.
  it("a plan not yet paid whose price went up is told it is not committed, before the payment", () => {
    const t = sizeCorrectedEmail({ ...facts, owed: 470 }).text;
    expect(t).toContain(SIZE_EMAIL_NOT_CHARGED);
    expect(SIZE_EMAIL_NOT_CHARGED).toBe(
      "You have not been charged. If you would rather not go ahead at this price, reply to this email and we will cancel the plan at no cost.",
    );
    expect(t.indexOf(SIZE_EMAIL_NOT_CHARGED)).toBeLessThan(t.indexOf("Pay by card"));
  });
  it("that line is left out when the price did not go up, and for a plan already paid", () => {
    expect(sizeCorrectedEmail({ ...facts, to_price: 380, owed: 380 }).text).not.toContain(
      SIZE_EMAIL_NOT_CHARGED,
    );
    expect(sizeCorrectedEmail({ ...facts, to_price: 410, owed: 410 }).text).not.toContain(
      SIZE_EMAIL_NOT_CHARGED,
    );
    expect(sizeCorrectedEmail({ ...facts, settle: 60 }).text).not.toContain(SIZE_EMAIL_NOT_CHARGED);
  });
  it("the subject and the heading name the measurement, not what we did", () => {
    const m = sizeCorrectedEmail({ ...facts, owed: 470 });
    expect(m.subject).toBe("Your roof measurement and your JBK Roofing Roof Care plan (RC-1077)");
    expect(m.html ?? "").toContain("Your roof measurement.");
    expect(m.html ?? "").not.toContain("We measured your roof.");
    expect(m.subject).not.toContain("We measured");
  });
});

describe("on the screen", () => {
  const card = flat(read("src/components/roof-care/plan-card.tsx"));
  it("what waits is shown under the roof size, and is not folded away", () => {
    expect(card).toContain(
      "const sizeWaits = !!active?.size?.unchecked || (active?.size?.balance?.owed ?? 0) !== 0;",
    );
    expect(card).toContain(
      "{seesInvoices(profile) && plan.size?.balance && ( <SizeBalance siteId={siteId} plan={plan} balance={plan.size.balance} manager={manager} /> )}",
    );
  });
  it("a bigger roof: the invoice is opened, or made when it is missing", () => {
    expect(card).toContain('data-action="roof-care-size-invoice-open"');
    expect(card).toContain('data-action="roof-care-size-invoice-make"');
    expect(SIZE_INVOICE_MAKE).toBe("Make the invoice for the difference");
  });
  it("a smaller roof: a manager records the refund, and no amount is typed", () => {
    expect(card).toContain("{balance.owed < 0 && manager && (");
    expect(card).toContain('data-action="roof-care-size-refund-sent"');
    expect(SIZE_REFUND_RECORD).toBe("Record the refund");
    const fn = card.slice(card.indexOf("const sentFn = useServerFn(recordRoofCareSizeRefund);"));
    // Nov 26, 2026: the screen hands over what it showed (`shown`), for the database to
    // check against what is owed. Nothing is typed, and the database still works the amount.
    expect(fn.slice(0, fn.indexOf("onSuccess"))).not.toContain("amount");
    expect(fn.slice(0, fn.indexOf("onSuccess"))).toContain("shown: -balance.owed,");
  });
  it("the customer of a paid plan can be emailed too, with no payment link in the label", () => {
    expect(card).toContain("const [emailIt, setEmailIt] = useState(!!to);");
    expect(card).toContain("{sizeCorrectEmailLabel(waiting && card)} ({to})");
  });
});

describe("the size invoice on the invoice page (Nov 25)", () => {
  // Found on the first real run of that page: Mark paid said the payment "starts the plan
  // year", and a final invoice said to choose "Make the invoice". Neither is true of it.
  const size = { roof_care_plan_id: "p", plan_part: "size" };
  it("is told apart by its mark, which the generated types do not know", () => {
    expect(isSizeInvoice(size)).toBe(true);
    expect(isSizeInvoice({ roof_care_plan_id: "p", plan_part: null })).toBe(false);
    expect(isSizeInvoice({ roof_care_plan_id: "p" })).toBe(false);
    expect(isSizeInvoice(null)).toBe(false);
  });
  it("its payment settles the difference and starts nothing", () => {
    expect(planInvoicePaidNote(size)).toBe(
      "Records the payment here (Sage stays the ledger). A payment that covers the total settles the difference for the corrected roof size.",
    );
    expect(planInvoicePaidNote(size)).not.toContain("starts the plan year");
  });
  it("a voided one is made again with its own button", () => {
    expect(planInvoiceRemake(size)).toBe(
      "To bill the difference again, open the plan on its property and choose Make the invoice for the difference.",
    );
  });
});

describe("the plan year's own invoice stays apart", () => {
  const f = flat(read("src/lib/roof-care-plan.functions.ts"));
  it("the plan's invoice shown on its card is never the size invoice", () => {
    expect(f).toContain(
      "if (!i.roof_care_plan_id || own.has(i.roof_care_plan_id) || sizeIds.has(i.id)) continue;",
    );
    expect(f).toContain(
      'if (i.plan_part !== "size" || !i.roof_care_plan_id || i.status === "void") continue;',
    );
  });
  it("the generated types are not edited: the new columns are read loose", () => {
    const types = read("src/integrations/supabase/types.ts");
    expect(types).not.toContain("plan_part");
    expect(types).not.toContain("size_paid_price");
    expect(read("src/lib/database-rpc.ts")).toContain("roof_care_size_refund_sent: {");
  });
});

describe("the database", () => {
  const sql = flat(read("supabase/migrations/20261124990000_roof_care_size_difference.sql"));
  it("marks the size invoice and keeps one plan year invoice and one open size invoice", () => {
    expect(sql).toContain(
      "check (plan_part is null or (plan_part = 'size' and roof_care_plan_id is not null))",
    );
    expect(sql).toContain(
      "create unique index invoices_one_live_per_plan on public.invoices (roof_care_plan_id) where roof_care_plan_id is not null and status <> 'void' and plan_part is null;",
    );
    expect(sql).toContain(
      "create unique index if not exists invoices_one_open_size_per_plan on public.invoices (roof_care_plan_id) where plan_part = 'size' and status in ('draft', 'final');",
    );
  });
  it("a paid plan takes the new price, and what is owed is from what the payments cover", () => {
    expect(sql).toContain("v_base := coalesce(p.size_paid_price, p.price);");
    expect(sql).toContain("v_owed := round(v_new - v_base, 2);");
    expect(sql).toContain("price = v_new,");
    expect(sql).toContain(
      "size_paid_price = case when v_waits then size_paid_price else v_base end,",
    );
    expect(sql).toContain(
      "Part of the invoice for the last correction is paid. Record the rest of that payment or take it off, then correct the size.",
    );
  });
  it("a size invoice paid in full settles the plan at its price", () => {
    expect(sql).toContain(
      "update public.roof_care_plans set size_paid_price = price, updated_at = now() where id = new.roof_care_plan_id and size_paid_price is not null;",
    );
    expect(sql).toContain(
      "create trigger invoices_size_paid after insert or update on public.invoices",
    );
  });
  it("the refund is a manager's or an admin's, for exactly what is owed back, never a visitor's", () => {
    expect(sql).toContain("raise exception 'Only a manager or an admin records a refund'");
    expect(sql).toContain("v_owed := round(coalesce(p.size_paid_price, p.price) - p.price, 2);");
    expect(sql).toContain("raise exception 'No refund is owed for this plan''s roof size.';");
    expect(sql).toContain(
      "revoke all on function public.roof_care_size_refund_sent(uuid, date, text) from public, anon;",
    );
  });
  it("the refund at a plan's end counts the size invoice, a refund sent, and what is still owed back", () => {
    expect(sql).toContain(
      "where i.roof_care_plan_id = p_plan and i.status <> 'void' and i.plan_part is null;",
    );
    expect(sql).toContain(
      "v_paid := greatest( v_paid + v_size_paid - v_size_back - greatest(coalesce(p.size_paid_price, p.price) - p.price, 0), 0);",
    );
    // In both: the sum worked at the end, and the check on a changed refund.
    expect(sql.split("v_paid + v_size_paid - v_size_back").length - 1).toBe(2);
  });
});

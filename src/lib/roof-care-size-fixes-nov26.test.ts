/**
 * The edges of "Correct the roof size" and of the refund at a plan's end (owner, Nov 25, 2026,
 * of the full audit's findings: "go on ... 5, 6, 7, 8, 9, 10, 11, 12, 13, 14").
 *
 * The lead ran the whole sequence on the live database that day and every amount was right.
 * These are the cases around it: a renewal that waits, a difference left open when the plan
 * year is over, an unpaid bigger roof at the end of a plan, a price list changed since the
 * sign-up, a year renewed with a credit, a size invoice paid at another amount or by mistake,
 * the income report, a stale Record the refund, the card fee, and the words.
 *
 * The database's rules are in 20261125200000_roof_care_size_fixes.sql. They were run on a
 * local stand-in database with these same made-up sums before this was written; here they are
 * read as text, as the other Roof Care tests read theirs. Every amount is made up and matches
 * no plan price.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

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
  sendEmail: async () => ({ ok: true }),
}));

import { planHoldsInvoice, planRunsOnPayment } from "@/lib/invoice-payment";
import { readCareSizeRefunds } from "@/lib/margin-report.functions";
import { ATTENTION_DEFAULTS, attentionList } from "@/lib/owner-attention";
import { sizeUnsettledSites } from "@/lib/owner-attention.functions";
import {
  SIZE_EMAIL_NOT_CHARGED,
  SIZE_EMAIL_REPLACES,
  sizeCorrectedEmail,
  type SizeCorrectedFacts,
} from "@/lib/roof-care-email";
import { planYearInvoices } from "@/lib/roof-care-email.server";
import {
  readRefundWorked,
  readSizeChange,
  readSizeOffer,
  refundLines,
  replacesEarlier,
  SIZE_CORRECT_RENEWAL_CREDIT,
  SIZE_CORRECT_RENEWAL_WAITS,
  SIZE_INVOICE_MAKE,
  SIZE_REFUND_RECORD,
  sizeBackLine,
  sizeBalancesOwed,
  sizeBalanceWords,
  sizeChangeWords,
  sizeCorrectHeld,
  type PlanSizeBalance,
} from "@/lib/roof-care-plan";
import {
  makePlanInvoice,
  makeSizeInvoice,
  planInvoiceNumber,
} from "@/lib/roof-care-plan-invoice.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const SQL = flat(read("supabase/migrations/20261125200000_roof_care_size_fixes.sql"));
const CARD = flat(read("src/components/roof-care/plan-card.tsx"));
/** One function of the migration, from its `create` to its closing `$function$;`. */
const fnOf = (name: string): string => {
  const from = SQL.indexOf(`create or replace function public.${name}(`);
  expect(from, name).toBeGreaterThan(-1);
  return SQL.slice(from, SQL.indexOf("$function$;", from));
};

const SITE = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";
const OLD = "44444444-4444-4444-8444-444444444444";
const WHO = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Ann Admin" };

// ── 5 ───────────────────────────────────────────────────────────────────────────────────────

describe("5. the year in force is not corrected while its renewal waits to be paid", () => {
  it("the database refuses it, in the window and on Save, from one place", () => {
    const worked = fnOf("roof_care_size_worked");
    expect(worked).toContain(
      "if not v_waits and exists (select 1 from public.roof_care_plans r where r.renewed_from = p_plan and r.status = 'awaiting_payment') then raise exception 'This plan has a renewal waiting to be paid. Cancel the renewal, correct the size here, then renew again.';",
    );
    // The window's price and Save both go through it.
    expect(fnOf("roof_care_size_offer")).toContain(
      "return public.roof_care_size_worked(p_plan, p_sqft);",
    );
    expect(fnOf("roof_care_correct_size")).toContain(
      "v := public.roof_care_size_worked(p_plan, p_sqft);",
    );
  });
  it("the window says so before a size is typed", () => {
    const active = { id: PLAN, status: "active" as const, renewal_credit: 0 };
    expect(sizeCorrectHeld(active, [])).toBeNull();
    expect(
      sizeCorrectHeld(active, [
        { status: "awaiting_payment", renewed_from: PLAN },
        { status: "ended", renewed_from: null },
      ]),
    ).toBe(SIZE_CORRECT_RENEWAL_WAITS);
    // Somebody else's renewal, and a renewal that was cancelled, hold nothing.
    expect(
      sizeCorrectHeld(active, [
        { status: "awaiting_payment", renewed_from: OLD },
        { status: "ended", renewed_from: PLAN },
      ]),
    ).toBeNull();
    // A plan that waits is not held by this rule.
    expect(
      sizeCorrectHeld({ ...active, status: "awaiting_payment" }, [
        { status: "awaiting_payment", renewed_from: PLAN },
      ]),
    ).toBeNull();
    expect(SIZE_CORRECT_RENEWAL_WAITS).toBe(
      "This plan has a renewal waiting to be paid. Cancel the renewal, correct the size here, then renew again.",
    );
    // The screen's words are the database's.
    expect(SQL).toContain(SIZE_CORRECT_RENEWAL_WAITS);
  });
  it("on the screen: the reason is shown, and the size box, the price and Save are off", () => {
    expect(CARD).toContain("const held = sizeCorrectHeld(plan, plans.data ?? []);");
    expect(CARD).toContain("{held && ( <p");
    expect(CARD).toContain("data-size-held");
    expect(CARD).toContain("disabled={!!held}");
    expect(CARD).toContain("disabled={!!held || !(sqft != null && sqft > 0) || show.isPending}");
    expect(CARD).toContain("disabled={!!held || !shown || save.isPending}");
  });
});

// ── 6 ───────────────────────────────────────────────────────────────────────────────────────

describe("6. a difference not settled outlives the plan year", () => {
  const balance = (owed: number, invoice: PlanSizeBalance["invoice"] = null): PlanSizeBalance => ({
    owed,
    invoice,
    refunds: [],
  });
  const plan = (id: string, status: string, owed: number, ended_on: string | null = null) => ({
    id,
    status: status as "active" | "ended" | "awaiting_payment",
    ended_on,
    size: { unchecked: false, map_sqft: null, confirmed: null, balance: balance(owed) },
  });
  it("the ended plans that still owe, or are still owed, are listed: oldest first", () => {
    const list = sizeBalancesOwed([
      plan("in-force", "active", 200),
      plan("renewed", "ended", 200, "2027-03-02"),
      plan("ended-early", "ended", -80, "2026-12-01"),
      plan("settled", "ended", 0, "2026-11-01"),
    ]);
    expect(list.map((p) => p.id)).toEqual(["ended-early", "renewed"]);
    // A plan whose size was never corrected after it was paid has no balance at all.
    expect(sizeBalancesOwed([{ id: "never", status: "ended" as const, ended_on: null }])).toEqual(
      [],
    );
  });
  it("the words say the year is over and it is still owed", () => {
    expect(sizeBalanceWords(balance(200), true)).toBe(
      "The corrected roof size cost $200.00 more for that plan year, and it is still owed. The invoice for it is not made yet.",
    );
    expect(
      sizeBalanceWords(balance(200, { id: "i", number: "RC-1077-S1", status: "final" }), true),
    ).toBe(
      "The corrected roof size cost $200.00 more for that plan year, and it is still owed. Invoice #RC-1077-S1 for it is sent and not paid yet.",
    );
    expect(sizeBalanceWords(balance(-80), true)).toBe(
      "The corrected roof size cost $80.00 less for that plan year. That is still owed back to the customer.",
    );
    // A plan in force reads as it did.
    expect(sizeBalanceWords(balance(-80))).toBe(
      "The corrected roof size costs $80.00 less this plan year. That is owed back to the customer.",
    );
  });
  it("on the screen: each has its own named line with the same buttons, never folded", () => {
    expect(CARD).toContain(
      "{!short && seesInvoices(profile) && sizeBalancesOwed(q.data).map((p) => (",
    );
    expect(CARD).toContain("data-size-balance-for");
    expect(CARD).toContain("{refundPlanWords(p)}");
    expect(CARD).toContain(
      "<SizeBalance siteId={siteId} plan={p} balance={p.size!.balance!} manager={manager} ended />",
    );
    expect(CARD).toContain("const words = sizeBalanceWords(balance, ended);");
  });

  const world = (plan: Record<string, unknown>, invoices: Record<string, unknown>[] = []) =>
    fakeSupabase({
      roof_care_plans: [
        {
          id: PLAN,
          plan: "care",
          status: "ended",
          plan_number: 1077,
          price: 1040,
          size_paid_price: 840,
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
  it("the invoice for a bigger roof is still made once the year is over", async () => {
    // Renewed, run out or ended: until now this was refused and the difference could not be billed.
    const env = world({});
    const r = await makeSizeInvoice(env.db, PLAN, WHO);
    expect(r.made).toBe(true);
    expect(env.tables["invoices"]![0]).toMatchObject({
      roof_care_plan_id: PLAN,
      plan_part: "size",
      status: "draft",
      total: 200,
      display_number: "RC-1077-S1",
    });
  });
  it("the refund for a smaller roof is recorded on an ended plan too", () => {
    // roof_care_size_refund_sent never asked for a plan in force, and still does not.
    expect(fnOf("roof_care_size_refund_sent")).not.toContain("p.status");
  });
  it("a plan that ends because it was renewed or ran out keeps the whole difference owed", () => {
    // roof_care_start and roof_care_expire touch neither the size invoice nor the settled price.
    const trigger = fnOf("roof_care_plans_size_at_end");
    expect(trigger).toContain(
      "and not (coalesce(new.ended_by_name, '') = 'Roof Care plans' and coalesce(new.ended_reason, '') in ('Renewed', 'Expired'))",
    );
    // A smaller roof's money owed back is never changed by the end of a plan.
    expect(trigger).toContain(
      "and old.size_paid_price is not null and old.price > old.size_paid_price",
    );
  });
  it("the End plan box says what is still owed back for a smaller roof", () => {
    // Paid $840 at a size that was corrected down to $760: $80 is owed back and Record the
    // refund was not pressed. One inspection done: half of $760 comes back, and the $80 too.
    const worked = readRefundWorked({
      paid: 760,
      inspections_done: 1,
      storm_counted: 0,
      share: 380,
      repairs: 0,
      travel: 0,
      size_unpaid: 0,
      size_off: 0,
      size_left: 0,
      size_back: 80,
      card_fee: 0,
      refund: 380,
    })!;
    expect(worked.size_back).toBe(80);
    expect(refundLines(worked)).toEqual([
      "Paid for the year: $760.00",
      "Inspections done: 1 of 2",
      "Share for the inspections not done: $380.00",
      "Refund: $380.00",
      "Plus $80.00 still owed back for the smaller roof, sent separately.",
    ]);
    expect(sizeBackLine(80)).toBe(
      "Plus $80.00 still owed back for the smaller roof, sent separately.",
    );
    // The database says it, from what the payments cover above the price.
    expect(fnOf("roof_care_refund_worked")).toContain(
      "v_owed_back := greatest(coalesce(p.size_paid_price, p.price) - p.price, 0);",
    );
    expect(fnOf("roof_care_refund_worked")).toContain("'size_back', v_owed_back,");
  });

  const none = {
    today: "2026-12-20",
    now: "2026-12-20T15:00:00Z",
    limits: ATTENTION_DEFAULTS,
    tickets: [],
    untouched: [],
    opps: [],
    bids: [],
    invoices: [],
    followups: [],
    repairFrom: [],
    bidFrom: [],
    names: {},
  };
  const row = {
    plan_id: PLAN,
    site_id: SITE,
    title: "Roof Care · Main plant (Mill Co)",
    since: "2026-12-01",
    invoice: null,
  };
  it("the Owner page lists a refund for a smaller roof that is not sent, on any plan", () => {
    const rows = attentionList({
      ...none,
      careSizeBalances: [{ ...row, owed: -80, ended: false }],
    }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: `care_plan_size_refund:${PLAN}`,
      kind: "care_plan_size_refund",
      group: "office",
      tag: "Roof Care",
      amount: 80,
      age: 19,
      tone: "red",
      href: `/properties/${SITE}`,
    });
    expect(rows[0]!.why).toBe(
      `The roof was found smaller after the plan was paid, and the difference is owed back to the customer. Send it, then open the property and press ${SIZE_REFUND_RECORD}.`,
    );
  });
  it("and a bigger roof's difference still owed once the plan year is over", () => {
    const list = (invoice: PlanSizeBalance["invoice"], ended = true) =>
      attentionList({
        ...none,
        careSizeBalances: [{ ...row, owed: 200, ended, invoice }],
      }).rows;
    const bare = list(null);
    expect(bare[0]).toMatchObject({
      key: `care_plan_size_owed:${PLAN}`,
      kind: "care_plan_size_owed",
      amount: 200,
      href: `/properties/${SITE}`,
    });
    expect(bare[0]!.why).toBe(
      `The plan year is over, and the difference for the bigger roof is still owed. No invoice is made for it: open the property and press ${SIZE_INVOICE_MAKE}.`,
    );
    const draft = list({ id: "inv-1", number: "RC-1077-S1", status: "draft" });
    expect(draft[0]!.why).toContain(
      "Invoice #RC-1077-S1 for it is a draft: finalise it and send it.",
    );
    expect(draft[0]!.href).toBe("/service/invoices?id=inv-1");
    expect(list({ id: "inv-1", number: "RC-1077-S1", status: "final" })[0]!.why).toContain(
      "Invoice #RC-1077-S1 for it is sent and not paid yet.",
    );
    // On a plan in force it is on the plan itself, and is not listed here.
    expect(list(null, false)).toEqual([]);
  });
  it("the plans read for it are found whatever became of them", async () => {
    const env = fakeSupabase({
      roof_care_plans: [
        { id: "a", site_id: "s-owed", status: "ended", price: 1040, size_paid_price: 840 },
        { id: "b", site_id: "s-back", status: "active", price: 760, size_paid_price: 840 },
        { id: "c", site_id: "s-settled", status: "ended", price: 1040, size_paid_price: 1040 },
        { id: "d", site_id: "s-never", status: "ended", price: 840, size_paid_price: null },
        { id: "e", site_id: "s-older-read", status: "ended", price: 840 },
      ],
    });
    expect((await sizeUnsettledSites(env.db)).sort()).toEqual(["s-back", "s-owed"]);
    const fn = flat(read("src/lib/owner-attention.functions.ts"));
    expect(fn).toContain("...unsettledSites,");
    expect(fn).toContain('return o < 0 || (o > 0 && p.status === "ended");');
    expect(fn).toContain("careSizeBalances: care.sizeBalances,");
  });
});

// ── 7 ───────────────────────────────────────────────────────────────────────────────────────

describe("7. ending a plan does not forgive an unpaid bigger roof for the inspections done", () => {
  const worked = fnOf("roof_care_refund_worked");
  it("half of the unpaid difference for each inspection done comes off the refund, never below nothing", () => {
    expect(worked).toContain(
      "v_size_unpaid := round( greatest(p.price - coalesce(p.size_paid_price, p.price) - v_size_part, 0) * v_done / 2.0, 2);",
    );
    expect(worked).toContain("v_size_off := least(v_size_unpaid, v_before);");
    expect(worked).toContain("v_before := v_before - v_size_off;");
    // After the minor repairs and the travel, before the card fee.
    expect(worked.indexOf("v_before := greatest(v_share - v_repairs - v_travel, 0);")).toBeLessThan(
      worked.indexOf("v_size_off := least(v_size_unpaid, v_before);"),
    );
    expect(worked.indexOf("v_before := v_before - v_size_off;")).toBeLessThan(
      worked.indexOf("if v_card and v_before > 0 then"),
    );
    // Its own keys in the answer.
    expect(worked).toContain(
      "'size_unpaid', v_size_unpaid, 'size_off', v_size_off, 'size_left', v_size_unpaid - v_size_off,",
    );
    // A part payment on the open size invoice is paid, so it is not also counted as unpaid.
    expect(worked).toContain(
      "coalesce(sum(i.paid_amount) filter (where i.status in ('draft', 'final')), 0) into v_size_paid, v_size_part",
    );
  });
  it("the End plan box shows it as its own line", () => {
    // Paid $840. Corrected bigger to $1,040: the $200 invoice is open. One inspection done.
    // The customer had one inspection of a $1,040 plan ($520) and paid $840: $320 comes back,
    // not the $420 worked from what was paid alone.
    const w = readRefundWorked({
      paid: 840,
      inspections_done: 1,
      storm_counted: 0,
      share: 420,
      repairs: 0,
      travel: 0,
      size_unpaid: 100,
      size_off: 100,
      size_left: 0,
      size_back: 0,
      card_fee: 0,
      refund: 320,
    })!;
    expect(refundLines(w)).toEqual([
      "Paid for the year: $840.00",
      "Inspections done: 1 of 2",
      "Share for the inspections not done: $420.00",
      "Less the part of the bigger roof not yet paid, for the inspections done: $100.00",
      "Refund: $320.00",
    ]);
    expect(w.share - (w.size_off ?? 0)).toBe(w.refund);
  });
  it("both inspections done: nothing comes back, and the difference stays owed on the plan", () => {
    const w = readRefundWorked({
      paid: 840,
      inspections_done: 2,
      share: 0,
      repairs: 0,
      size_unpaid: 200,
      size_off: 0,
      size_left: 200,
      size_back: 0,
      refund: 0,
    })!;
    expect(refundLines(w)).toEqual([
      "Paid for the year: $840.00",
      "Inspections done: 2 of 2",
      "Share for the inspections not done: $0.00",
      "Refund: $0.00",
      "Still owed for the bigger roof after this: $200.00. It stays on the plan, with the button that makes its invoice.",
    ]);
  });
  it("an answer from before these parts reads as before", () => {
    const w = readRefundWorked({
      paid: 840,
      inspections_done: 1,
      share: 420,
      repairs: 0,
      refund: 420,
    })!;
    expect(w).toMatchObject({ size_off: 0, size_left: 0, size_back: 0 });
    expect(refundLines(w)).toEqual([
      "Paid for the year: $840.00",
      "Inspections done: 1 of 2",
      "Share for the inspections not done: $420.00",
      "Refund: $420.00",
    ]);
  });
  it("the plan ended by hand is settled down to what the refund could not cover", () => {
    // roof_care_end is not replaced (it is patched in place on the live database): a trigger
    // beside it reads the same sum while the plan is still in force.
    const trigger = fnOf("roof_care_plans_size_at_end");
    expect(trigger).toContain("if old.status = 'active' and new.status = 'ended'");
    expect(trigger).toContain(
      "v_left := coalesce((public.roof_care_refund_worked(old.id)->>'size_left')::numeric, 0);",
    );
    expect(trigger).toContain(
      "new.size_paid_price := new.price - least(greatest(v_left, 0), old.price - old.size_paid_price);",
    );
    expect(SQL).toContain(
      "create trigger roof_care_plans_size_at_end before update of status on public.roof_care_plans for each row execute function public.roof_care_plans_size_at_end();",
    );
    expect(SQL).not.toContain("create or replace function public.roof_care_end(");
    expect(SQL).not.toContain("create or replace function public.roof_care_end_refund(");
  });
  it("the cap on a changed refund is still what was paid: that sum is the one of Nov 24", () => {
    // roof_care_change_refund is not replaced. Its "paid" and this function's are the same sum.
    expect(SQL).not.toContain("create or replace function public.roof_care_change_refund(");
    expect(worked).toContain(
      "v_paid := greatest(v_paid + v_size_paid - v_size_back - v_owed_back, 0);",
    );
    const before = flat(read("supabase/migrations/20261124990000_roof_care_size_difference.sql"));
    expect(before).toContain(
      "v_paid := greatest( v_paid + v_size_paid - v_size_back - greatest(coalesce(p.size_paid_price, p.price) - p.price, 0), 0);",
    );
  });
});

// ── 8 ───────────────────────────────────────────────────────────────────────────────────────

describe("8. a correction bills only the part that comes from the size", () => {
  const worked = fnOf("roof_care_size_worked");
  it("the new price is the price now, moved by today's price at the new size less today's at the old", () => {
    // Paid $1,000 at 20,000 sq ft. The owner raises prices 10%. A correction to 20,100 sq ft
    // is $1,104 today against $1,100 today: the plan goes to $1,004, not to $1,104.
    expect(worked).toContain(
      "v_at := public.roof_care_price(p_sqft, p.drive_hours, p.drive_miles);",
    );
    expect(worked).toContain(
      "v_was := public.roof_care_price(p.roof_sqft, p.drive_hours, p.drive_miles);",
    );
    expect(worked).toContain(
      "v_new := p.price + ((v_row->>'price')::numeric - (v_old->>'price')::numeric);",
    );
    // list_price and travel_price move with it, so price = list_price + travel_price still holds.
    expect(worked).toContain(
      "v_list := p.list_price + ((v_row->>'list')::numeric - (v_old->>'list')::numeric);",
    );
    expect(worked).toContain("'to_list', v_list, 'to_travel', v_new - v_list,");
    const save = fnOf("roof_care_correct_size");
    expect(save).toContain(
      "list_price = (v->>'to_list')::numeric, travel_price = (v->>'to_travel')::numeric, price = v_new,",
    );
    // The whole year at today's list is only said (`would_be`), never saved as the price.
    expect(save).not.toContain("roof_care_price(");
  });
  it("one rule for a plan that waits and for a paid plan", () => {
    // The arithmetic is before the fork on paid or not, and has no fork of its own.
    const sum = worked.slice(
      worked.indexOf("v_first :="),
      worked.indexOf("if not v_waits then -- What the payments cover"),
    );
    expect(sum).toContain("v_new := p.price +");
    expect(sum).not.toContain("v_waits");
  });
  it("typing the size the plan was signed at gives back the price it was signed at", () => {
    expect(worked).toContain("v_first := coalesce(p.size_changes, '[]'::jsonb)->0;");
    expect(worked).toContain("and round(p_sqft) = round((v_first->>'from_sqft')::numeric) then");
    expect(worked).toContain("v_new := (v_first->>'from_price')::numeric;");
    // Each record keeps the list price it started from, so the list price goes back too.
    expect(fnOf("roof_care_correct_size")).toContain(
      "'from_list', p.list_price, 'from_travel', p.travel_price,",
    );
  });
  it("the minimum priced size and the custom quote size work as they did", () => {
    // Both are roof_care_price's own, asked at the new size and at the old.
    expect(worked).toContain(
      "raise exception 'A roof this size gets a custom quote, so the plan cannot be priced at it here. End the plan and quote it by hand.';",
    );
    expect(worked).toContain(
      "raise exception 'The size on this plan now gets a custom quote, so the difference cannot be priced here. End the plan and quote it by hand.';",
    );
  });
  it("the window's price and Save's are one sum, and Save still refuses another price", () => {
    expect(fnOf("roof_care_correct_size")).toContain(
      "if p_shown_price is not null and round(p_shown_price) <> round(v_new) then raise exception 'The price changed: at this size the plan is now $%, not the $% shown. Press Show the new price again.',",
    );
    const fn = flat(read("src/lib/roof-care-plan.functions.ts"));
    const offer = fn.slice(
      fn.indexOf("export const roofCareSizeOffer"),
      fn.indexOf("/** What saving a corrected size answers. */"),
    );
    expect(offer).toContain('databaseRpc(context.supabase)("roof_care_size_offer", {');
    expect(offer).not.toContain("roof_care_price");
    expect(SQL).toContain(
      "grant execute on function public.roof_care_size_offer(uuid, numeric) to authenticated;",
    );
    expect(SQL).toContain(
      "revoke all on function public.roof_care_size_worked(uuid, numeric) from public, anon, authenticated;",
    );
  });
  it("the answer is read strictly", () => {
    const answer = {
      plan: "care",
      from_sqft: 20000,
      to_sqft: "20100",
      from_price: 1000,
      to_price: 1004,
      would_be: 1104,
      repriced: true,
      paid: true,
      covered: 1000,
      owed: 4,
      nth: 1,
    };
    expect(readSizeOffer(answer)).toEqual({
      from_sqft: 20000,
      to_sqft: 20100,
      from_price: 1000,
      to_price: 1004,
      repriced: false,
      paid: true,
      owed: 4,
    });
    // A plan that waits owes nothing apart from its price.
    expect(readSizeOffer({ ...answer, paid: false, covered: null, owed: null })).toMatchObject({
      repriced: true,
      paid: false,
      owed: 0,
    });
    expect(readSizeOffer({ ...answer, to_price: null })).toBeNull();
    expect(readSizeOffer({ ...answer, to_price: 0 })).toBeNull();
    expect(readSizeOffer(null)).toBeNull();
    expect(readSizeOffer("1004")).toBeNull();
  });
});

// ── 9 ───────────────────────────────────────────────────────────────────────────────────────

describe("9. a year renewed with a credit is not corrected", () => {
  it("refused in plain words that say what to do instead, in the window and on Save", () => {
    expect(fnOf("roof_care_size_worked")).toContain(
      "if not v_waits and coalesce(p.renewal_credit, 0) > 0 then raise exception 'This plan year was renewed with money taken off for an inspection we did not do, so its roof size is not corrected here. Correct the size on next year''s plan once its renewal is paid, or ask an admin if it cannot wait.';",
    );
    expect(SIZE_CORRECT_RENEWAL_CREDIT).toBe(
      "This plan year was renewed with money taken off for an inspection we did not do, so its roof size is not corrected here. Correct the size on next year's plan once its renewal is paid, or ask an admin if it cannot wait.",
    );
    expect(SQL).toContain(SIZE_CORRECT_RENEWAL_CREDIT.replace(/'/g, "''"));
  });
  it("the window says it before a size is typed", () => {
    expect(sizeCorrectHeld({ id: PLAN, status: "active", renewal_credit: 55 }, [])).toBe(
      SIZE_CORRECT_RENEWAL_CREDIT,
    );
    expect(sizeCorrectHeld({ id: PLAN, status: "active", renewal_credit: 0 }, [])).toBeNull();
  });
});

// ── 10 ──────────────────────────────────────────────────────────────────────────────────────

describe("10. a size invoice settles what it was paid, and a wrong payment comes off", () => {
  const paid = fnOf("invoices_size_paid");
  it("paid: up by the invoice's total, never above the plan's price, and the invoice keeps by how much", () => {
    // Until now any size invoice that became Paid set the plan settled at its price, whatever
    // the invoice's total: a $200 difference whose draft line was edited to $150 read as settled.
    expect(paid).toContain(
      "v_up := least(greatest(coalesce(new.total, 0), 0), greatest(v_price - v_covered, 0));",
    );
    expect(paid).toContain("set size_paid_price = v_covered + v_up, updated_at = now()");
    expect(paid).toContain("new.size_settled := v_up;");
    expect(paid).not.toContain("set size_paid_price = price");
    expect(SQL).toContain(
      "alter table public.invoices add column if not exists size_settled numeric;",
    );
  });
  it("no longer paid: back down by that same amount", () => {
    expect(paid).toContain(
      "elsif tg_op = 'UPDATE' and old.status = 'paid' and new.status <> 'paid' then update public.roof_care_plans set size_paid_price = size_paid_price - coalesce(old.size_settled, old.total, 0),",
    );
    expect(paid).toContain("new.size_settled := null;");
    // Before the row is written, so the invoice can keep what it settled.
    expect(SQL).toContain(
      "create trigger invoices_size_paid before insert or update or delete on public.invoices",
    );
  });
  it("a part payment moves nothing, as before", () => {
    // Only the step to Paid, and the step away from it, do anything.
    expect(paid).toContain(
      "if new.status = 'paid' and (tg_op = 'INSERT' or old.status <> 'paid') then",
    );
  });
  it("the plan does not run on a size invoice's payment: the database lets it be taken off", () => {
    const guard = fnOf("invoices_plan_guard");
    expect(guard).toContain(
      "if v_status = 'active' and old.status = 'paid' and old.plan_part is distinct from 'size' and (tg_op = 'DELETE'",
    );
    // The plan year's own invoice is held exactly as before.
    expect(guard).toContain(
      "raise exception 'Roof Care plan RC-% is running on this invoice''s payment. End the plan first: open the property, press Care Plan, then End plan. The refund is worked there.',",
    );
    const before = flat(
      read("supabase/migrations/20261120800000_roof_care_plan_year_and_trip_cover.sql"),
    );
    expect(before).not.toContain("old.plan_part");
  });
  it("and the server says the same before it tries", () => {
    const active = { status: "active", plan_number: 1077, refund_due: null };
    const was = { status: "paid", total: 200, paid_amount: 200 };
    const off = { status: "final", paid_amount: 0 };
    // The plan year's own invoice: held, in the words that are true of it.
    expect(planHoldsInvoice(active, was, off)).toBe(planRunsOnPayment(1077));
    expect(planHoldsInvoice(active, was, null)).toBe(planRunsOnPayment(1077));
    // The invoice of a size difference: the payment comes off.
    expect(planHoldsInvoice({ ...active, size_invoice: true }, was, off)).toBeNull();
    expect(planHoldsInvoice({ ...active, size_invoice: true }, was, null)).toBeNull();
    // A refund worked from it at a plan's end still holds it, whichever invoice it is.
    const ended = { status: "ended", plan_number: 1077, refund_due: 320, size_invoice: true };
    expect(planHoldsInvoice(ended, was, off)).toContain("ended with a refund of $320.00");
    const fn = flat(read("src/lib/invoices.functions.ts"));
    expect(fn).toContain("size_invoice = isSizeInvoice(rows?.[0]);");
    expect(fn).toContain("planOfInvoice(sb, cur.roof_care_plan_id, cur.id)");
    expect(fn).toContain("await planOfInvoice(sb, inv.roof_care_plan_id, inv.id),");
  });
});

// ── 11 ──────────────────────────────────────────────────────────────────────────────────────

describe("11. a refund for a smaller roof comes off Roof Care's income", () => {
  it("one row below nothing for each refund sent, on its day, paid", async () => {
    const env = fakeSupabase({
      roof_care_plans: [
        {
          id: PLAN,
          plan_number: 1077,
          account_id: ACCOUNT,
          site_id: SITE,
          // Settled: what the payments cover is the price again once the refund is recorded.
          size_paid_price: 760,
          size_refunds: [
            { amount: 80, on: "2027-06-10", ref: "check 9", by_name: "Ann" },
            { amount: 35.5, on: "2027-06-28", ref: null, by_name: "Ann" },
            // Another month.
            { amount: 20, on: "2027-07-02", ref: null, by_name: "Ann" },
          ],
        },
        // Corrected bigger, with nothing ever sent back; and one never corrected.
        {
          id: OLD,
          plan_number: 1002,
          account_id: ACCOUNT,
          site_id: SITE,
          size_paid_price: 840,
          size_refunds: [],
        },
        {
          id: "p3",
          plan_number: 1003,
          account_id: ACCOUNT,
          site_id: SITE,
          size_paid_price: null,
          size_refunds: [],
        },
      ],
      crm_accounts: [{ id: ACCOUNT, name: "Made Up Storage Co" }],
    });
    const rows = await readCareSizeRefunds(env.db, "2027-06-01", "2027-06-30");
    expect(rows.map((r) => [r.number, r.day, r.status, r.revenue, r.customer])).toEqual([
      ["RC-1077 roof size refund", "2027-06-10", "paid", -80, "Made Up Storage Co"],
      ["RC-1077 roof size refund", "2027-06-28", "paid", -35.5, "Made Up Storage Co"],
    ]);
    expect(rows.every((r) => r.carePlan && r.refundSite === SITE)).toBe(true);
    // Each has an id of its own, so two refunds of one plan are two rows.
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    expect(await readCareSizeRefunds(env.db, "2027-08-01", "2027-08-31")).toEqual([]);
  });
  it("is counted with the invoices and the refunds of plans ended early", () => {
    const fn = flat(read("src/lib/margin-report.functions.ts"));
    expect(fn).toContain('source !== "bids" ? readCareSizeRefunds(sb, from, to) : [],');
    expect(fn).toContain("rows: [...invoices, ...refunds, ...sizeRefunds, ...bids.rows],");
  });
});

// ── 12 ──────────────────────────────────────────────────────────────────────────────────────

describe("12. Record the refund records what the screen showed, or nothing", () => {
  it("the database is told the amount shown and refuses when what is owed has changed", () => {
    const fn = fnOf("roof_care_size_refund_sent");
    expect(fn).toContain("p_shown_amount numeric default null");
    expect(fn).toContain(
      "if p_shown_amount is not null and round(p_shown_amount, 2) <> v_owed then raise exception 'The amount owed back changed to $%. Check the plan and press Record the refund again.',",
    );
    // What is recorded is still what is owed, never the amount handed over.
    expect(fn).toContain("'amount', v_owed,");
    expect(SQL).toContain(
      "drop function if exists public.roof_care_size_refund_sent(uuid, date, text);",
    );
    expect(SQL).toContain(
      "revoke all on function public.roof_care_size_refund_sent(uuid, date, text, numeric) from public, anon;",
    );
    expect(SQL).toContain(
      "grant execute on function public.roof_care_size_refund_sent(uuid, date, text, numeric) to authenticated;",
    );
  });
  it("the screen sends what it showed, and reads the plan again when it is refused", () => {
    const fn = CARD.slice(CARD.indexOf("const sentFn = useServerFn(recordRoofCareSizeRefund);"));
    const press = fn.slice(0, fn.indexOf("const words ="));
    expect(press).toContain("shown: -balance.owed,");
    expect(press).toContain("refresh();");
    expect(read("src/lib/database-rpc.ts")).toContain("p_shown_amount?: number | null;");
  });
});

// ── 13 ──────────────────────────────────────────────────────────────────────────────────────

describe("13. the card fee on the end refund is the plan year's own invoice's", () => {
  const worked = fnOf("roof_care_refund_worked");
  it("a size invoice marked paid by card does not make a check plan a card plan", () => {
    const card = worked.slice(
      worked.indexOf("v_card :="),
      worked.indexOf("if v_card and v_before > 0"),
    );
    // Both tests of the plan's invoices leave the size invoice out.
    expect(card.split("and i.plan_part is null").length - 1).toBe(2);
    expect(card).toContain(
      "and i.plan_part is null and lower(coalesce(i.paid_method, '')) like '%card%')",
    );
    expect(card).toContain("and i.plan_part is null and coalesce(trim(i.paid_method), '') <> '')");
    // Before this, neither did.
    const before = flat(read("supabase/migrations/20261124990000_roof_care_size_difference.sql"));
    const old = before.slice(
      before.indexOf("v_card :="),
      before.indexOf("if v_card and v_before > 0"),
    );
    expect(old).not.toContain("plan_part");
  });
  it("a plan paid from a bank account has no card fee", () => {
    expect(worked).toContain(
      "v_card := not coalesce(p.paid_by_bank, false) and (p.card_paid_on is not null",
    );
    // The column is the card payments' own (20261125100000); this file adds it if it is not there.
    expect(SQL).toContain("add column if not exists paid_by_bank boolean not null default false,");
  });
});

// ── 14 ──────────────────────────────────────────────────────────────────────────────────────

describe("14. the words add up", () => {
  const facts: SizeCorrectedFacts = {
    plan: "care",
    plan_number: 1077,
    site: "Main plant",
    address: "120 Mill St, London",
    agreed_by: "Pat Smith",
    from_sqft: 26000,
    to_sqft: 28500,
    from_price: 1040,
    to_price: 1140,
    owed: 0,
    pay_method: "check",
    pay_link: null,
    company: "JBK Roofing",
    contact: "888-555-0100",
  };
  it("a second correction before the first is settled: the email says what the payments cover", () => {
    // Paid $840. First correction to $1,040 ("an invoice for the difference of $200.00").
    // Second to $1,140: until now "now $1,140. It was $1,040 ... the difference of $300.00".
    const m = sizeCorrectedEmail({ ...facts, settle: 300, covered: 840, again: true });
    expect(m.text).toContain("The yearly price of your plan is now $1,140. It was $1,040.");
    expect(m.text).toContain(
      "Your plan year is already paid, and nothing is due today. Your payments so far cover $840.00, so we will send you one invoice for the difference of $300.00. This takes the place of what we wrote to you before about the price.",
    );
    expect(SIZE_EMAIL_REPLACES).toBe(
      "This takes the place of what we wrote to you before about the price.",
    );
    // The size before this one is the one we had, not the one the plan was signed at.
    expect(m.text).toContain(
      "It is 28,500 sq ft. Until now we had your Roof Care plan (RC-1077) at 26,000 sq ft.",
    );
    expect(m.text).not.toContain("was signed at");
    // Never that anyone was on the roof, and the softer subject stays.
    expect(m.text).not.toMatch(/on your roof|visited|came out/i);
    expect(m.subject).toBe("Your roof measurement and your JBK Roofing Roof Care plan (RC-1077)");
  });
  it("the same when the second correction leaves money to send back, or nothing at all", () => {
    expect(
      sizeCorrectedEmail({ ...facts, to_price: 780, settle: -60, covered: 840, again: true }).text,
    ).toContain(
      "Your payments so far cover $840.00, so we are sending $60.00 back to you. This takes the place of what we wrote to you before about the price.",
    );
    expect(
      sizeCorrectedEmail({ ...facts, to_price: 840, settle: 0, covered: 840, again: true }).text,
    ).toContain(
      "Your payments so far cover $840.00, so nothing more is owed. This takes the place of what we wrote to you before about the price.",
    );
  });
  it("a first correction reads as it did, with the two softenings of Nov 25", () => {
    const first = sizeCorrectedEmail({ ...facts, from_sqft: 20000, from_price: 840, settle: 200 });
    expect(first.text).toContain(
      "Your plan year is already paid, and nothing is due today. We will send you an invoice for the difference of $200.00.",
    );
    expect(first.text).toContain("Your Roof Care plan (RC-1077) was signed at 20,000 sq ft.");
    expect(first.text).not.toContain("payments so far");
    expect(first.text).not.toContain(SIZE_EMAIL_REPLACES);
    // A plan not yet paid whose price went up is still told it has not been charged.
    expect(sizeCorrectedEmail({ ...facts, owed: 1140 }).text).toContain(SIZE_EMAIL_NOT_CHARGED);
  });
  it("the server hands the email what the payments covered, only when it differs from the price before", () => {
    const fn = flat(read("src/lib/roof-care-pay-link.functions.ts"));
    const mail = fn.slice(fn.indexOf("export async function emailSizeCorrected"));
    expect(mail).toContain(
      "...(settled && change.covered != null && Math.round((change.covered - change.from_price) * 100) !== 0 ? { covered: change.covered } : {}),",
    );
    expect(mail).toContain("...((change.nth ?? 1) > 1 ? { again: true } : {}),");
    // The database keeps both on the record of each correction.
    const save = fnOf("roof_care_correct_size");
    expect(save).toContain("'covered', v->'covered',");
    expect(save).toContain("'nth', (v->>'nth')::integer,");
    expect(fnOf("roof_care_size_worked")).toContain(
      "'nth', jsonb_array_length(coalesce(p.size_changes, '[]'::jsonb)) + 1);",
    );
  });
  it("the record reads correctly as a list", () => {
    const first = readSizeChange({
      on: "2026-11-24",
      by_name: "Mo Manager",
      from_sqft: 20000,
      to_sqft: 26000,
      from_price: 840,
      to_price: 1040,
      would_be: 1040,
      repriced: true,
      paid: true,
      covered: 840,
      owed: 200,
      nth: 1,
      note: null,
    })!;
    const second = readSizeChange({
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
    })!;
    expect(first).toMatchObject({ covered: 840, nth: 1 });
    expect(replacesEarlier(first)).toBe(false);
    expect(replacesEarlier(second)).toBe(true);
    // Until now: "$200.00 more was billed" then "$300.00 more was billed", which reads as $500.
    expect(sizeChangeWords(first, true)).toBe(
      "Roof size corrected from 20,000 to 26,000 sq ft by Mo Manager on Nov 24, 2026. The price went from $840 to $1,040 a year. The plan year was already paid: $200.00 more was billed.",
    );
    expect(sizeChangeWords(second, true)).toBe(
      "Roof size corrected from 26,000 to 28,500 sq ft by Mo Manager on Nov 25, 2026. The price went from $1,040 to $1,140 a year. The payments so far covered $840.00, so $300.00 was owed in all. This took the place of the amount before it.",
    );
    expect(sizeChangeWords(second, true)).not.toContain("more was billed");
    expect(sizeChangeWords({ ...second, to_price: 780, owed: -60 }, true)).toContain(
      "The payments so far covered $840.00, so $60.00 was owed back in all. This took the place of the amount before it.",
    );
    expect(sizeChangeWords({ ...second, to_price: 840, owed: 0 }, true)).toContain(
      "The payments so far covered $840.00, so nothing more was owed either way.",
    );
    // No money to someone who does not see prices.
    expect(sizeChangeWords(second, false)).not.toContain("$");
    // A record from before Nov 26 has neither key and reads as it did.
    const old = readSizeChange({ ...second, covered: undefined, nth: undefined })!;
    expect("covered" in old || "nth" in old).toBe(false);
    expect(sizeChangeWords(old, true)).toContain("$300.00 more was billed.");
  });

  it("a receipt is the plan year's own invoice, read in a fixed order", async () => {
    // The size invoice was paid after the plan year's: it used to be added to "paid", and
    // could be the invoice the receipt named.
    const env = fakeSupabase({
      invoices: [
        {
          id: "s1",
          roof_care_plan_id: PLAN,
          plan_part: "size",
          display_number: "RC-1077-S1",
          paid_amount: 200,
          status: "paid",
          created_at: "2026-11-25T10:00:00Z",
        },
        {
          id: "main",
          roof_care_plan_id: PLAN,
          plan_part: null,
          display_number: "RC-1077",
          paid_amount: 840,
          status: "paid",
          created_at: "2026-11-20T10:00:00Z",
        },
        {
          id: "gone",
          roof_care_plan_id: PLAN,
          display_number: "RC-1077",
          paid_amount: 0,
          status: "void",
          created_at: "2026-11-19T10:00:00Z",
        },
        {
          id: "other",
          roof_care_plan_id: OLD,
          display_number: "RC-1002",
          paid_amount: 5,
          status: "paid",
        },
      ],
    });
    const inv = await planYearInvoices(env.db as never, PLAN);
    expect(inv.map((i) => i.display_number)).toEqual(["RC-1077"]);
    expect(inv.reduce((n, i) => n + Number(i.paid_amount), 0)).toBe(840);
    const fn = flat(read("src/lib/roof-care-email.server.ts"));
    expect(fn).toContain("const inv = await planYearInvoices(admin, p.id);");
    expect(fn).toContain("invoice_number: inv[0]?.display_number ?? null,");
  });

  const world = (invoices: Record<string, unknown>[]) =>
    fakeSupabase({
      roof_care_plans: [
        {
          id: PLAN,
          plan: "care",
          status: "awaiting_payment",
          pay_first: true,
          plan_number: 1077,
          price: 1040,
          roof_sqft: 26000,
          account_id: ACCOUNT,
          site_id: SITE,
          renewed_from: null,
          renewal_credit: 0,
          renewal_owed: 0,
        },
      ],
      crm_accounts: [{ id: ACCOUNT, name: "Mill Co" }],
      crm_sites: [{ id: SITE, name: "Main plant", address1: "120 Mill St", city: "London" }],
      company_settings: [{ payment_terms: "Net 30" }],
      invoices,
      invoice_lines: [],
    });
  const voided = (id: string, number: string, at: string) => ({
    id,
    roof_care_plan_id: PLAN,
    status: "void",
    display_number: number,
    created_at: at,
  });
  it("an invoice made again after a finalised one was voided has a number of its own", async () => {
    expect(planInvoiceNumber(1077, 0)).toBe("RC-1077");
    expect(planInvoiceNumber(1077, 1)).toBe("RC-1077-R1");
    expect(planInvoiceNumber(1077, 2)).toBe("RC-1077-R2");
    // The first invoice of a plan is the plan's number, as before.
    const first = world([]);
    const a = await makePlanInvoice(first.db, PLAN, WHO);
    expect(first.tables["invoices"]!.find((i) => i["id"] === a.id)!["display_number"]).toBe(
      "RC-1077",
    );
    // A finalised RC-1077 went to the customer and was voided when the size was corrected:
    // the new one, at the new amount, is not a second "RC-1077".
    const again = world([voided("v1", "RC-1077", "2026-11-20T10:00:00Z")]);
    const b = await makePlanInvoice(again.db, PLAN, WHO);
    expect(b.made).toBe(true);
    expect(again.tables["invoices"]!.find((i) => i["id"] === b.id)).toMatchObject({
      display_number: "RC-1077-R1",
      status: "draft",
      total: 1040,
    });
    const third = world([
      voided("v1", "RC-1077", "2026-11-20T10:00:00Z"),
      voided("v2", "RC-1077-R1", "2026-11-22T10:00:00Z"),
    ]);
    const c = await makePlanInvoice(third.db, PLAN, WHO);
    expect(third.tables["invoices"]!.find((i) => i["id"] === c.id)!["display_number"]).toBe(
      "RC-1077-R2",
    );
  });
  it("the plan year's own invoice is never taken for the invoice of a size difference", async () => {
    // A void size invoice does not number the plan's own, and an open one is not "the plan's
    // invoice that is already there".
    const env = world([
      { ...voided("s0", "RC-1077-S1", "2026-11-21T10:00:00Z"), plan_part: "size" },
      {
        id: "s1",
        roof_care_plan_id: PLAN,
        plan_part: "size",
        status: "final",
        display_number: "RC-1077-S2",
        created_at: "2026-11-23T10:00:00Z",
      },
    ]);
    const r = await makePlanInvoice(env.db, PLAN, WHO);
    expect(r.made).toBe(true);
    expect(r.id).not.toBe("s1");
    expect(env.tables["invoices"]!.find((i) => i["id"] === r.id)!["display_number"]).toBe(
      "RC-1077",
    );
  });
});

// ── Also ────────────────────────────────────────────────────────────────────────────────────

describe("also", () => {
  it("a plan that waits is not corrected while a bank payment for it is on its way", () => {
    expect(fnOf("roof_care_size_worked")).toContain(
      "if v_waits and p.bank_pending_at is not null then raise exception 'A payment from the customer''s bank account is on its way. Wait until it clears or fails, then correct the size.';",
    );
    expect(SQL).toContain("add column if not exists bank_pending_at timestamptz;");
  });
  it("the migration is safe to run twice, and leaves the two patched functions alone", () => {
    expect(SQL).not.toMatch(/create function /);
    expect(SQL).not.toMatch(/create trigger (?!invoices_size_paid|roof_care_plans_size_at_end)/);
    expect(SQL).toContain("drop trigger if exists invoices_size_paid on public.invoices;");
    expect(SQL).toContain(
      "drop trigger if exists roof_care_plans_size_at_end on public.roof_care_plans;",
    );
    expect(SQL).toContain("Applied on the live database by hand (AGENTS.md).");
    for (const name of [
      "roof_care_end",
      "roof_care_end_refund",
      "roof_care_sign_up",
      "roof_care_push_back",
    ])
      expect(SQL).not.toContain(`function public.${name}(`);
  });
  it("only a manager or an admin is answered, and the money sums are not open to a visitor", () => {
    for (const name of ["roof_care_size_offer", "roof_care_correct_size"])
      expect(fnOf(name)).toContain(
        "if auth.uid() is null or not (public.is_admin() or public.is_manager()) then raise exception 'Only a manager or an admin corrects a plan''s roof size' using errcode = '42501';",
      );
    for (const line of [
      "revoke all on function public.roof_care_size_offer(uuid, numeric) from public, anon;",
      "revoke all on function public.roof_care_correct_size(uuid, numeric, numeric, text) from public, anon;",
      "revoke all on function public.roof_care_refund_worked(uuid) from public, anon, authenticated;",
      "revoke all on function public.invoices_size_paid() from public, anon, authenticated;",
      "revoke all on function public.invoices_plan_guard() from public, anon, authenticated;",
      "revoke all on function public.roof_care_plans_size_at_end() from public, anon, authenticated;",
    ])
      expect(SQL).toContain(line);
    // Every security definer function pins its search path.
    const definers = SQL.split("security definer").length - 1;
    const pinned =
      SQL.split(/security definer set search_path (?:= public|to 'public')/).length - 1;
    expect(definers).toBeGreaterThan(0);
    expect(pinned).toBe(definers);
  });
  it("the generated types are not edited: the new columns are read loose", () => {
    const types = read("src/integrations/supabase/types.ts");
    for (const name of [
      "size_settled",
      "roof_care_size_offer",
      "p_shown_amount",
      "bank_pending_at",
    ])
      expect(types).not.toContain(name);
    expect(read("src/lib/database-rpc.ts")).toContain("roof_care_size_offer: {");
  });
});

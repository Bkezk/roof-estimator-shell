/**
 * Roof Care break test of Nov 20, the payment fixes (docs/qa/roof-care-break-fixes-payments-2026-11-20.md):
 * numbers 1, 13, 19, 22, 23, 24, 26 and 28 of the owner's list.
 *
 *   1.  A payment taken back must not leave a plan running unseen.
 *   13. The plan year never starts before the day the plan was signed.
 *   19. "Next window" uses a window that is open today when two weeks of it are left.
 *   22. The old sign-up is switched off.
 *   23. A plan starts on its invoice only when the money is there.
 *   24. The database refuses what the screens never offer on an invoice.
 *   26. Card payments: every one kept, none taken twice, none changing a plan it did not pay for.
 *   28. Who may run the plan functions.
 *
 * THE NUMBERS HERE ARE MADE UP.
 */
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const told: unknown[][] = [];
const hold = { admin: null as unknown, service: true };
const made: unknown[][] = [];
const mailed: unknown[] = [];
vi.mock("@/lib/notify.server", () => ({
  notify: async (...a: unknown[]) => {
    told.push(a);
    return 1;
  },
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => hold.service,
  appUrl: () => "",
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
  dispatchPlanEmails: async (_sb: unknown, a: unknown) => {
    mailed.push(a);
    return { agreements_sent: 0, receipts_sent: 0, email_errors: 0, held: null };
  },
}));
vi.mock("@/lib/roof-care-plan-invoice.functions", () => ({
  makePlanInvoice: async (...a: unknown[]) => {
    made.push(a.slice(1));
    return { id: "inv-made", made: true };
  },
}));

import {
  planHoldsInvoice,
  planPaymentOnIt,
  planRefundStands,
  planRunsOnPayment,
} from "@/lib/invoice-payment";
import { markInvoicePaid, voidInvoice } from "@/lib/invoices.functions";
import { ATTENTION_DEFAULTS, attentionList, planRunsUnpaid } from "@/lib/owner-attention";
import { cardPaidNotice, checkoutAmount } from "@/lib/roof-care-checkout";
import { Route } from "@/routes/api.stripe.webhook";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const START = flat(read("supabase/migrations/20261120600000_roof_care_start_rules.sql"));
const GUARD = flat(read("supabase/migrations/20261120610000_roof_care_invoice_guard.sql"));
const CARD = flat(read("supabase/migrations/20261120620000_roof_care_card_payments.sql"));
const RIGHTS = flat(read("supabase/migrations/20261120630000_roof_care_rights.sql"));
const run = (fn: unknown, db: unknown, data: unknown, userId = "u1") =>
  (fn as (a: unknown) => Promise<unknown>)({ data, context: { supabase: db, userId } });

const PLAN = "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e11";
const INV = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";

// ── 1. A payment taken back ─────────────────────────────────────────────────────────────────

describe("1. a payment taken back does not leave a plan running unseen", () => {
  const active = { status: "active", plan_number: 1042, refund_due: null };
  const paid = { status: "paid", total: 840, paid_amount: 840 };

  it("while the plan is in force, its paid invoice is not un-paid, lowered, voided or deleted", () => {
    const words = planRunsOnPayment(1042);
    expect(words).toBe(
      "Roof Care plan RC-1042 is running on this invoice's payment. End the plan first: open the property, press Care Plan, then End plan. The refund is worked there.",
    );
    // The payment taken off.
    expect(planHoldsInvoice(active, paid, { status: "final", paid_amount: 0 })).toBe(words);
    // Lowered under what is owed.
    expect(planHoldsInvoice(active, paid, { status: "final", paid_amount: 899 })).toBe(words);
    // Voided or deleted.
    expect(planHoldsInvoice(active, paid, null)).toBe(words);
    // A typed amount put right, still covering the invoice, is the office's to change.
    expect(planHoldsInvoice(active, paid, { status: "paid", paid_amount: 840 })).toBeNull();
    expect(planHoldsInvoice(active, paid, { status: "paid", paid_amount: 950 })).toBeNull();
  });

  it("while the plan waits, an invoice with a payment on it is not voided until the payment is off", () => {
    const waiting = { status: "awaiting_payment", plan_number: 1043, refund_due: null };
    const part = { status: "final", total: 840, paid_amount: 300 };
    expect(planHoldsInvoice(waiting, part, null)).toBe(planPaymentOnIt(1043));
    // Taking the part payment off is how it is put right, and nothing is running yet.
    expect(planHoldsInvoice(waiting, part, { status: "final", paid_amount: 0 })).toBeNull();
    // With nothing paid, the invoice is voided and a new one made, as before.
    expect(
      planHoldsInvoice(waiting, { status: "final", total: 840, paid_amount: 0 }, null),
    ).toBeNull();
  });

  it("after a plan ended with a refund owed, the payment stays while the refund stands", () => {
    const ended = { status: "ended", plan_number: 1044, refund_due: 450 };
    const words = planRefundStands(1044, 450);
    expect(words).toBe(
      "Roof Care plan RC-1044 ended with a refund of $450.00 worked from this payment. The payment stays on the invoice while that refund stands.",
    );
    expect(planHoldsInvoice(ended, paid, { status: "final", paid_amount: 0 })).toBe(words);
    expect(planHoldsInvoice(ended, paid, null)).toBe(words);
    // Ended with nothing owed back: the invoice is the office's again.
    expect(
      planHoldsInvoice({ ...ended, refund_due: 0 }, paid, { status: "final", paid_amount: 0 }),
    ).toBeNull();
    // An invoice that is not a plan's is never held.
    expect(planHoldsInvoice(null, paid, null)).toBeNull();
  });

  const world = (plan: Record<string, unknown>, invoice: Record<string, unknown>) =>
    fakeSupabase({
      profiles: [
        { id: "u1", role: "admin", access: [], technician: false, full_name: "Ann", email: "a@x" },
      ],
      roof_care_plans: [{ id: PLAN, ...plan }],
      invoices: [
        {
          id: INV,
          roof_care_plan_id: PLAN,
          service_job_id: null,
          bid_id: null,
          number: null,
          ...invoice,
        },
      ],
      invoice_lines: [],
    });

  it("Mark paid with 0, or with less, says to end the plan first and writes nothing", async () => {
    const env = world(active, { status: "paid", total: 840, paid_amount: 840 });
    await expect(
      run(markInvoicePaid, env.db, { id: INV, paid_on: "2026-11-20", amount: 0 }),
    ).rejects.toThrow(planRunsOnPayment(1042));
    await expect(
      run(markInvoicePaid, env.db, { id: INV, paid_on: "2026-11-20", amount: 420 }),
    ).rejects.toThrow(planRunsOnPayment(1042));
    expect(env.writes).toEqual([]);
    // The same amount again with its check number is still saved.
    await run(markInvoicePaid, env.db, {
      id: INV,
      paid_on: "2026-11-20",
      amount: 840,
      method: "Check",
      ref: "1042",
    });
    expect(env.tables["invoices"]![0]!["paid_ref"]).toBe("1042");
    expect(env.tables["invoices"]![0]!["status"]).toBe("paid");
  });

  it("Void says the same, ahead of the plainer refusal", async () => {
    const env = world(active, { status: "paid", total: 840, paid_amount: 840 });
    await expect(run(voidInvoice, env.db, { id: INV })).rejects.toThrow(planRunsOnPayment(1042));
    const refund = world(
      { status: "ended", plan_number: 1044, refund_due: 450 },
      { status: "paid", total: 840, paid_amount: 840 },
    );
    await expect(
      run(markInvoicePaid, refund.db, { id: INV, paid_on: "2026-11-20", amount: 0 }),
    ).rejects.toThrow(planRefundStands(1044, 450));
    expect(env.writes).toEqual([]);
    expect(refund.writes).toEqual([]);
  });

  it("the database refuses the same, in the same words, for a signed-in person", () => {
    expect(GUARD).toContain(
      "v_person boolean := auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role';",
    );
    expect(GUARD).toContain(
      "create trigger invoices_plan_guard before update or delete on public.invoices for each row execute function public.invoices_plan_guard();",
    );
    expect(GUARD).toContain(
      "if v_status = 'active' and old.status = 'paid' and (tg_op = 'DELETE' or new.status <> 'paid' or coalesce(new.paid_amount, 0) + 0.005 < coalesce(new.total, 0) or new.roof_care_plan_id is distinct from old.roof_care_plan_id) then",
    );
    const sql = (s: string) => s.replace(/'/g, "''");
    expect(GUARD).toContain(sql(planRunsOnPayment(1042)).replace("RC-1042", "RC-%"));
    expect(GUARD).toContain(sql(planPaymentOnIt(1043)).replace("RC-1043", "RC-%"));
    expect(GUARD).toContain(
      sql(planRefundStands(1044, 450)).replace("RC-1044", "RC-%").replace("$450.00", "$%"),
    );
  });

  it("Needs attention lists a plan in force with nothing paid toward it", () => {
    const plan = {
      status: "active",
      pay_first: true,
      price: 840,
      renewal_credit: 0,
      invoice: { paid_amount: 0 },
      card_paid: null,
    };
    expect(planRunsUnpaid(plan)).toBe(true);
    expect(planRunsUnpaid({ ...plan, invoice: null })).toBe(true);
    // Paid on its invoice, or by card.
    expect(planRunsUnpaid({ ...plan, invoice: { paid_amount: 840 } })).toBe(false);
    expect(planRunsUnpaid({ ...plan, card_paid: { on: "2026-11-20" } })).toBe(false);
    // A manager's free year owes nothing.
    expect(planRunsUnpaid({ ...plan, renewal_credit: 840 })).toBe(false);
    // Waiting plans have their own row; one billed at each inspection is not judged here.
    expect(planRunsUnpaid({ ...plan, status: "awaiting_payment" })).toBe(false);
    expect(planRunsUnpaid({ ...plan, pay_first: false })).toBe(false);

    const list = attentionList({
      today: "2026-11-25",
      now: "2026-11-25T15:00:00Z",
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
      careNoPayment: [
        {
          plan_id: PLAN,
          site_id: "s1",
          title: "Roof Care · Main Plant (Acme)",
          starts_on: "2026-11-20",
          price: 840,
          invoice: { id: INV, number: "RC-1042", status: "final" },
        },
      ],
    });
    const row = list.rows.find((r) => r.kind === "care_plan_no_payment")!;
    expect(row.group).toBe("office");
    expect(row.tone).toBe("red");
    expect(row.amount).toBe(840);
    expect(row.age).toBe(5);
    expect(row.href).toBe(`/service/invoices?id=${INV}`);
    expect(row.why).toBe(
      "The plan is in force and nothing is recorded as paid toward it. Its inspections are still being done. Find the payment and mark invoice #RC-1042 paid, or end the plan on the property.",
    );
    const fn = flat(read("src/lib/owner-attention.functions.ts"));
    expect(fn).toContain(
      "const noPayment: AttCareNoPayment[] = plans .filter((p) => planRunsUnpaid(p))",
    );
    expect(fn).toContain("careNoPayment: care.noPayment,");
  });
});

// ── 13 and 19. When the plan year and its first inspection start ────────────────────────────

describe("13 and 19. the plan year and the first inspection", () => {
  it("the paid day is held between the signing day and today", () => {
    expect(START).toContain(
      "v_paid := greatest(least(coalesce(p_paid, v_today), v_today), coalesce(v_p.signed_on, v_today));",
    );
    expect(START).toContain(
      "set status = 'active', paid_on = v_paid, starts_on = v_start, renews_on = v_renews,",
    );
  });
  it("Next window is the window open that day when two weeks of it are left, else the next one", () => {
    expect(START).toContain("v_day := greatest(v_today, v_start);");
    expect(START).toContain(
      "select greatest(w.w_from, v_day), w.w_to into v_from, v_by from public.roof_care_windows(v_day) w where w.w_from > v_day or w.w_to - v_day >= 13 order by w.w_from limit 1;",
    );
    // The second inspection keeps its rule.
    expect(START).toContain("where x.t - x.f >= 13 order by x.f limit 1;");
  });
});

// ── 22 and 28. Who may run what ─────────────────────────────────────────────────────────────

describe("22 and 28. who may run the plan functions", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  const code = files("src").filter(
    (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.endsWith("supabase/types.ts"),
  );

  it("no code of the site calls the old sign-up, the ticket maker or the windows", () => {
    for (const p of code) {
      const s = read(p);
      expect(s, p).not.toMatch(/rpc\(\s*["']roof_care_sign_up["']/);
      expect(s, p).not.toMatch(/["']roof_care_make_tickets["']/);
      expect(s, p).not.toMatch(/["']roof_care_windows["']/);
    }
  });
  it("the old sign-up is kept and no signed-in person can run it", () => {
    expect(RIGHTS).toContain(
      "revoke all on function public.roof_care_sign_up( uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text) from public, anon, authenticated;",
    );
    expect(RIGHTS).not.toContain("drop function");
  });
  it("the ticket maker is the morning run's and the plan functions'", () => {
    expect(RIGHTS).toContain(
      "revoke all on function public.roof_care_make_tickets(uuid) from public, anon, authenticated;",
    );
    expect(START).toContain("perform public.roof_care_make_tickets(p_plan);");
  });
  it("prices and windows answer only someone with Service or Customers access", () => {
    expect(RIGHTS).toContain(
      "if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' and not (public.has_access('service') or public.has_access('customers')) then raise exception 'Only someone with Service or Customers access reads the Roof Care prices' using errcode = '42501';",
    );
    expect(RIGHTS).toContain(
      "if current_user = 'authenticated' and not (public.has_access('service') or public.has_access('customers')) then raise exception 'Only someone with Service or Customers access reads the inspection windows' using errcode = '42501';",
    );
    // The price is still worked the same way, floor included.
    expect(RIGHTS).toContain(
      "v_list := v_base + v_per * greatest(p_sqft, coalesce((d->>'min_price_sqft')::numeric, 0));",
    );
  });
});

// ── 23. The money has to be there ───────────────────────────────────────────────────────────

describe("23. a plan starts on its invoice only when the money is there", () => {
  it("the invoice is for the plan's own amount, and its payment covers it", () => {
    expect(START).toContain(
      "select p.status, p.plan_number, round(greatest(p.price - coalesce(p.renewal_credit, 0), 0), 2) into v_status, v_number, v_owed",
    );
    expect(START).toContain("if round(coalesce(new.total, 0), 2) <> v_owed then raise exception");
    expect(START).toContain(
      "if coalesce(new.paid_amount, 0) + 0.005 < coalesce(new.total, 0) then raise exception",
    );
    // Only a plan that is waiting is judged: one in force already is left alone.
    expect(START).toContain(
      "if not found or v_status <> 'awaiting_payment' then return null; end if;",
    );
    const at = START.indexOf("create or replace function public.invoices_plan_paid()");
    const body = START.slice(at);
    expect(body.indexOf("raise exception 'Only $%")).toBeLessThan(
      body.indexOf("perform public.roof_care_start(new.roof_care_plan_id, new.paid_on);"),
    );
  });
});

// ── 24. What the screens never offer ────────────────────────────────────────────────────────

describe("24. the database refuses what the screens never offer", () => {
  it("a void invoice stays void", () => {
    expect(GUARD).toContain(
      "if tg_op = 'UPDATE' and old.status = 'void' and new.status <> 'void' then raise exception 'A void invoice stays void. Make a new invoice instead.'; end if;",
    );
  });
  it("a plan's line goes on an invoice of its own property, while the plan is in force", () => {
    expect(GUARD).toContain(
      "raise exception 'A Roof Care plan line goes on the invoice of a ticket at the plan''s property.';",
    );
    expect(GUARD).toContain("elsif v_site is null or v_plan_site is distinct from v_site then");
    expect(GUARD).toContain("if v_own is distinct from v_plan then");
    expect(GUARD).toContain("if v_plan_status = 'awaiting_payment' then");
    expect(GUARD).toContain("if v_plan_status <> 'active' then");
    // A line already there is left alone when its plan later ends.
    expect(GUARD).toContain(
      "and (tg_op = 'INSERT' or new.source is distinct from old.source or new.invoice_id is distinct from old.invoice_id or new.total < old.total)",
    );
  });
  it("a plan's lines take no more off than the invoice bills, whatever order they are written in", () => {
    expect(GUARD).toContain(
      "create trigger invoice_lines_care_cover_ins after insert on public.invoice_lines referencing new table as changed for each statement execute function public.invoice_lines_care_cover();",
    );
    expect(GUARD).toContain(
      "create trigger invoice_lines_care_cover_upd after update on public.invoice_lines referencing old table as before new table as changed for each statement execute function public.invoice_lines_care_cover();",
    );
    expect(GUARD).toContain("if v_off > greatest(v_rest, 0) + 0.005 then");
    // And again when the draft is made final.
    expect(GUARD).toContain(
      "if tg_op = 'UPDATE' and old.status = 'draft' and new.status in ('final', 'paid') then",
    );
    expect(GUARD).toContain("if v_allow > greatest(v_other, 0) + 0.005 then");
    expect(GUARD).toContain("if v_waived > greatest(v_travel, 0) + 0.005 then");
  });
  it("a return trip is on an invoice once, and only for a visit that was charged", () => {
    expect(GUARD).toContain(
      "where l.source = new.source and l.invoice_id = new.invoice_id and l.id is distinct from new.id) then raise exception 'This return trip is already on this invoice. It is billed once.';",
    );
    expect(GUARD).toContain(
      "select n.charged into v_charged from public.roof_care_no_access n where n.id = v_rec;",
    );
    expect(GUARD).toContain(
      "raise exception 'That visit was rescheduled at no charge, so there is no return trip to bill for it.';",
    );
    // Its price is not held to the recorded amount.
    expect(GUARD).not.toContain("n.amount");
  });
});

// ── 26. Card payments ───────────────────────────────────────────────────────────────────────

const SECRET = "whsec_made_up_for_tests";
const sign = (body: string, t: number, secret = SECRET) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex")}`;
const paidEvent = () => ({
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_1",
      payment_status: "paid",
      currency: "usd",
      amount_total: 84000,
      payment_intent: "pi_9",
      metadata: { kind: "roof_care_plan", plan_id: PLAN },
      customer_details: { email: "pat@example.com" },
    },
  },
});

describe("26. card payments", () => {
  it("every payment is its own row, written only by the server's key, a reference taken once", () => {
    expect(CARD).toContain("create table if not exists public.roof_care_card_payments (");
    expect(CARD).toContain("constraint roof_care_card_payments_ref_key unique (ref),");
    expect(CARD).toContain(
      "revoke all on table public.roof_care_card_payments from public, anon, authenticated;",
    );
    expect(CARD).toContain(
      "grant select on table public.roof_care_card_payments to authenticated;",
    );
    expect(CARD).toContain(
      "if exists (select 1 from public.roof_care_card_payments c where c.ref = v_ref) or p.card_paid_ref = v_ref then return 'already'; end if;",
    );
    expect(CARD).toContain(
      "revoke all on function public.roof_care_card_paid(uuid, numeric, text, date) from public, anon, authenticated;",
    );
  });
  it("a plan that is not waiting is not touched: the money is kept as money to send back", () => {
    const at = CARD.indexOf("if p.status <> 'awaiting_payment' then");
    const write = CARD.indexOf("update public.roof_care_plans set card_paid_on = v_on");
    expect(at).toBeGreaterThan(0);
    // Decided before anything is written on the plan.
    expect(at).toBeLessThan(write);
    expect(CARD.slice(at, write)).toContain(
      "values (p_plan, v_ref, p_amount, v_on, 'send_back', case when p.status = 'active' then 'paid_already' else 'ended' end, 0); return 'send_back';",
    );
    expect(CARD.slice(at, write)).toContain("'send_back', 'short', v_owed,");
  });
  it("a payment that starts the plan makes its waiting invoice final and paid, by card", () => {
    expect(CARD).toContain(
      "v_fits := v_has and inv.status in ('draft', 'final') and round(coalesce(inv.total, 0), 2) = v_price;",
    );
    expect(CARD).toContain(
      "set status = 'paid', finalized_at = coalesce(finalized_at, now()), paid_on = v_on, paid_amount = inv.total, paid_method = 'Card', paid_ref = left(v_ref, 80), updated_by_name = 'Card payment'",
    );
    expect(CARD).toContain(
      "greatest(round(p_amount - v_owed, 2), 0), case when v_fits then inv.id end);",
    );
    expect(CARD).toContain("raise exception 'A card payment needs its amount';");
  });
  it("the card page asks for what the database will take", () => {
    const plan = { price: 840, renewal_credit: 0 };
    expect(checkoutAmount(plan, null)).toBe(840);
    expect(checkoutAmount({ price: 840, renewal_credit: 250 }, null)).toBe(590);
    // The plan's own invoice, draft or final: what it still owes.
    expect(checkoutAmount(plan, { status: "draft", total: 840, paid_amount: 0 })).toBe(840);
    expect(checkoutAmount(plan, { status: "final", total: 840, paid_amount: 300 })).toBe(540);
    // An invoice for another amount does not decide: the plan starts on its own price.
    expect(checkoutAmount(plan, { status: "final", total: 975.4, paid_amount: 0 })).toBe(840);
    expect(checkoutAmount(plan, { status: "draft", total: 1, paid_amount: 0 })).toBe(840);
  });
  it("the words the admins and managers get", () => {
    const base = { plan: "care", site_id: "s1", site: "Main Plant" };
    const row = { amount: 840, outcome: "send_back", owed: 0, over: 0, ref: "pi_9" };
    expect(
      cardPaidNotice({ ...base, result: "send_back", payment: { ...row, reason: "paid_already" } }),
    ).toEqual({
      kind: "plan_card_paid",
      title: "Card payment to send back: Main Plant",
      body: "A card payment of $840.00 came in online for a Roof Care plan that was already paid. The plan is not changed. Send the $840.00 back to the customer. Reference pi_9.",
      url: "/properties/s1",
    });
    expect(
      cardPaidNotice({ ...base, result: "send_back", payment: { ...row, reason: "ended" } }).body,
    ).toBe(
      "A card payment of $840.00 came in online for a Roof Care plan that has ended. Nothing was started. Send the $840.00 back to the customer. Reference pi_9.",
    );
    expect(
      cardPaidNotice({
        ...base,
        result: "send_back",
        payment: { ...row, amount: 800, reason: "short", owed: 840 },
      }).body,
    ).toBe(
      "A card payment of $800.00 came in online, and $840.00 is owed for the Roof Care plan. The plan has not started. Send the $800.00 back to the customer. Then take the full payment. Reference pi_9.",
    );
    expect(
      cardPaidNotice({
        ...base,
        result: "invoice_paid",
        payment: {
          amount: 940,
          outcome: "started",
          reason: null,
          owed: 840,
          over: 100,
          ref: "pi_9",
        },
      }).body,
    ).toBe(
      "The customer paid the year by card online. Its invoice is marked paid and the plan has started. The card was charged $940.00, which is $100.00 more than the $840.00 owed. Send the $100.00 back to the customer. Reference pi_9.",
    );
  });

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
  const world = (
    plan: Record<string, unknown>,
    answer: string,
    payment: Record<string, unknown> | null,
  ) => {
    const order: string[] = [];
    const env = fakeSupabase(
      {
        roof_care_plans: [{ id: PLAN, plan: "care", site_id: "s1", customer_email: null, ...plan }],
        crm_sites: [{ id: "s1", name: "Main Plant" }],
        profiles: [
          { id: "a1", role: "admin" },
          { id: "m1", role: "manager" },
          { id: "t1", role: "user" },
        ],
        roof_care_card_payments: payment
          ? [{ id: "c1", plan_id: PLAN, ref: "pi_9", ...payment }]
          : [],
      },
      {
        rpcs: {
          roof_care_card_paid: () => {
            order.push(`paid after ${made.length} invoice made`);
            return answer;
          },
        },
      },
    );
    hold.admin = env.db;
    return { env, order };
  };
  const nowS = () => Math.floor(Date.now() / 1000);
  beforeEach(() => {
    told.length = 0;
    made.length = 0;
    mailed.length = 0;
    hold.service = true;
    process.env["STRIPE_SECRET_KEY"] = "sk_test_made_up";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
  });
  afterEach(() => {
    delete process.env["STRIPE_SECRET_KEY"];
    delete process.env["STRIPE_WEBHOOK_SECRET"];
  });

  it("money to send back: the admins and managers are told, the plan and its emails are left alone", async () => {
    const { env } = world({ status: "active", sold_by: "t1" }, "send_back", {
      amount: 840,
      outcome: "send_back",
      reason: "paid_already",
      owed: 0,
      over: 0,
    });
    const body = JSON.stringify(paidEvent());
    const res = await post(body, sign(body, nowS()));
    // Stripe is not to send it again.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, handled: true, result: "send_back" });
    expect(told).toHaveLength(1);
    expect(told[0]![0]).toEqual(["a1", "m1"]);
    expect(told[0]![1]).toMatchObject({
      title: "Card payment to send back: Main Plant",
      body: "A card payment of $840.00 came in online for a Roof Care plan that was already paid. The plan is not changed. Send the $840.00 back to the customer. Reference pi_9.",
    });
    // Not waiting: no invoice is made, the plan's email is not written over, nothing is mailed.
    expect(made).toEqual([]);
    expect(env.tables["roof_care_plans"]![0]!["customer_email"]).toBeNull();
    expect(mailed).toEqual([]);
  });

  it("a waiting plan with no invoice gets one first, so the payment marks it paid", async () => {
    const { env, order } = world({ status: "awaiting_payment", sold_by: "t1" }, "invoice_paid", {
      amount: 940,
      outcome: "started",
      reason: null,
      owed: 840,
      over: 100,
    });
    const body = JSON.stringify(paidEvent());
    const res = await post(body, sign(body, nowS()));
    expect(await res.json()).toEqual({ ok: true, handled: true, result: "invoice_paid" });
    expect(made).toEqual([[PLAN, { id: "t1", name: "Card payment" }]]);
    expect(order).toEqual(["paid after 1 invoice made"]);
    // What is over is told.
    expect((told[0]![1] as { body: string }).body).toContain(
      "which is $100.00 more than the $840.00 owed. Send the $100.00 back to the customer.",
    );
    expect(env.tables["roof_care_plans"]![0]!["customer_email"]).toBe("pat@example.com");
    expect(mailed).toEqual([{ planId: PLAN }]);
  });
});

/**
 * Paid means paid in full (owner, Nov 9, after the audit's finding 4: a $700 payment on a
 * $711.57 invoice read Paid, the Paid group summed totals while the footer summed payments, and
 * nothing showed a balance). A payment that covers the total makes the invoice Paid; a smaller
 * one is recorded — day, amount, method, reference — and the invoice stays Final with the
 * balance due, so Open money is what is still owed and Paid money is what came in. Pure; the
 * server (invoices.functions.ts markInvoicePaid), the editor and the list read it.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

export interface PaymentFields {
  status: string;
  total: number | string | null;
  paid_amount: number | string | null;
  paid_on?: string | null;
}

/** The status a payment of `amount` leaves an invoice of `total` in (a cent's rounding forgiven). */
export const paidStatusFor = (total: number | string | null, amount: number): "paid" | "final" =>
  amount + 0.005 >= num(total) ? "paid" : "final";

/**
 * A zero amount on an invoice that has a total takes the recorded payment off (owner, Nov 10,
 * re-audit finding 1: a payment typed on the wrong invoice could not be removed — set to $0 it
 * still read "Partly paid $0.00" with no Mark paid and no Void). The server then clears the day,
 * the method and the reference, and the invoice is a plain Final again. A $0 invoice is not
 * touched by this: marking it paid with $0 is its payment.
 */
export const clearsPayment = (total: number | string | null, amount: number): boolean =>
  amount <= 0 && num(total) > 0.005;

/**
 * How much a payment is over the total — 0 when it is not (a cent's rounding forgiven). The
 * dialog asks before recording one (owner, Nov 10, re-audit finding 2).
 */
export const overpaidBy = (total: number | string | null, amount: number): number => {
  const over = r2(amount - num(total));
  return over >= 0.01 ? over : 0;
};

/** Has a payment been recorded (an amount, or a day)? */
export const hasPayment = (inv: Pick<PaymentFields, "paid_amount" | "paid_on">): boolean =>
  num(inv.paid_amount) > 0 || !!inv.paid_on;

/** What is still owed: the total less what was paid, never below zero. */
export const balanceDue = (inv: Pick<PaymentFields, "total" | "paid_amount">): number =>
  r2(Math.max(0, num(inv.total) - num(inv.paid_amount)));

/** A final invoice with a payment recorded that did not cover it. */
export const partlyPaid = (inv: PaymentFields): boolean =>
  inv.status === "final" && hasPayment(inv) && balanceDue(inv) > 0;

/** The footer's Paid: every payment recorded on a live invoice (partial ones included). */
export const paidSumOf = (rows: readonly PaymentFields[]): number =>
  r2(rows.filter((r) => r.status !== "void").reduce((n, r) => n + num(r.paid_amount), 0));

/** The footer's Open: what the final invoices still owe. */
export const openSumOf = (rows: readonly PaymentFields[]): number =>
  r2(rows.filter((r) => r.status === "final").reduce((n, r) => n + balanceDue(r), 0));

// ── The invoice of a Roof Care plan year (owner, Nov 20: break test, number 1) ───────────────
//
// A payment taken back must not leave a plan running unseen. While a plan is in force, the paid
// invoice it runs on is not voided, deleted or left holding less than its total: the plan is
// ended first, and the refund is worked there. While a plan waits for its payment, an invoice
// with a payment on it is not voided until the payment is taken off. After a plan has ended
// with a refund owed, the payment the refund was worked from stays while the refund stands.
// The database refuses the same, in the same words (invoices_plan_guard); the server says it
// before it tries.

/** The plan an invoice belongs to, as far as these rules read it. */
export interface InvoicePlan {
  status: string;
  plan_number: number | null;
  refund_due: number | string | null;
  /**
   * The invoice is the plan's invoice for a roof size difference (invoices.plan_part = 'size'),
   * not the plan year's own (Nov 26). The plan does not run on its payment.
   */
  size_invoice?: boolean;
}

const planLabel = (n: number | null) => `RC-${n ?? ""}`;
const usd = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const planRunsOnPayment = (planNumber: number | null): string =>
  `Roof Care plan ${planLabel(planNumber)} is running on this invoice's payment. End the plan first: open the property, press Care Plan, then End plan. The refund is worked there.`;
export const planPaymentOnIt = (planNumber: number | null): string =>
  `This invoice has a payment recorded toward Roof Care plan ${planLabel(planNumber)}. Take the payment off before it is voided or deleted.`;
export const planRefundStands = (planNumber: number | null, refund: number): string =>
  `Roof Care plan ${planLabel(planNumber)} ended with a refund of $${usd(refund)} worked from this payment. The payment stays on the invoice while that refund stands.`;

/**
 * Why a change to a plan year's invoice is refused, or null when it may go ahead. `after` is
 * what the invoice would then hold; null when it would be void or gone.
 */
export function planHoldsInvoice(
  plan: InvoicePlan | null | undefined,
  before: PaymentFields,
  after: { status: string; paid_amount: number } | null,
): string | null {
  if (!plan) return null;
  const wasPaid = before.status === "paid";
  const had = num(before.paid_amount);
  if (plan.status === "active" && wasPaid) {
    // The invoice of a size difference (Nov 26): a payment marked on it by mistake could not be
    // taken off, with "the plan is running on this invoice's payment", which is not true of
    // it. The plan runs on its own invoice; this one settles a difference and nothing else.
    if (plan.size_invoice) return null;
    if (!after || after.status !== "paid" || after.paid_amount + 0.005 < num(before.total))
      return planRunsOnPayment(plan.plan_number);
    return null;
  }
  if (plan.status === "awaiting_payment")
    return had > 0 && !after ? planPaymentOnIt(plan.plan_number) : null;
  const refund = num(plan.refund_due);
  if (plan.status === "ended" && refund > 0 && (had > 0 || wasPaid)) {
    if (!after || (wasPaid && after.status !== "paid") || after.paid_amount + 0.005 < had)
      return planRefundStands(plan.plan_number, refund);
  }
  return null;
}

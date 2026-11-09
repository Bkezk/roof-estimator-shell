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

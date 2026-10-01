/**
 * The invoice page's totals (invoice-editor.tsx): Subtotal / Tax / Total as the server computes
 * them (invoices.server.ts totals()), and the internal side — Cost, Margin, Margin / hour — that
 * only admins and managers see, folded ("Internal — cost and margin").
 *
 * Purchase orders (owner, Oct 1; purchase-orders.ts): the ticket's APPROVED PO total is its own
 * internal line, "Purchase orders (approved)", and part of Cost (so Margin and Margin / hour
 * move by it). It is never an invoice line, never on the customer's invoice or PDF, and never in
 * the stored invoices.cost_total (that stays the lines' cost; the PO cost is read live from the
 * ticket).
 *
 * Pure: no database, no browser (unit tested in purchase-orders.test.ts).
 */

/** Cents-rounded, like the server (invoices.server.ts r2). */
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface TotalsLine {
  kind: string;
  /** null = the box is blank (counts as 0). */
  qty: number | null;
  rate: number | null;
  cost_rate: number;
  taxable: boolean;
}

export interface InvoiceTotals {
  subtotal: number;
  tax: number;
  total: number;
  /** The approved purchase orders of the ticket (internal; part of cost_total). */
  po_cost: number;
  /** The lines' cost plus po_cost. */
  cost_total: number;
  margin: number;
  /** Travel + labor hours on the lines. */
  hours: number;
  perHour: number | null;
}

/** Live totals of the lines; a blank box is 0. `poCost` is the ticket's approved PO total. */
export function computeTotals(
  lines: readonly TotalsLine[],
  taxRate: number,
  poCost = 0,
): InvoiceTotals {
  let subtotal = 0;
  let taxable = 0;
  let cost = 0;
  let hours = 0;
  for (const l of lines) {
    const qty = l.qty ?? 0;
    const amount = r2(qty * (l.rate ?? 0));
    subtotal += amount;
    if (l.taxable) taxable += amount;
    cost += r2(qty * l.cost_rate);
    if (l.kind === "labor" || l.kind === "travel") hours += qty;
  }
  subtotal = r2(subtotal);
  const tax = r2(r2(taxable) * taxRate);
  const total = r2(subtotal + tax);
  const po_cost = r2(Number.isFinite(poCost) ? poCost : 0);
  const cost_total = r2(cost + po_cost);
  const margin = r2(total - cost_total);
  return {
    subtotal,
    tax,
    total,
    po_cost,
    cost_total,
    margin,
    hours,
    perHour: hours > 0 ? margin / hours : null,
  };
}

/**
 * A final invoice: the stored totals are the record (subtotal, tax, total, the lines' cost);
 * the live figures supply the hours, and the ticket's approved PO total is added to the cost.
 */
export function storedTotals(
  inv: {
    subtotal: number | string;
    tax_amount: number | string;
    total: number | string;
    cost_total: number | string;
  },
  live: InvoiceTotals,
): InvoiceTotals {
  const total = Number(inv.total);
  const cost_total = r2(Number(inv.cost_total) + live.po_cost);
  const margin = r2(total - cost_total);
  return {
    ...live,
    subtotal: Number(inv.subtotal),
    tax: Number(inv.tax_amount),
    total,
    cost_total,
    margin,
    perHour: live.hours > 0 ? margin / live.hours : null,
  };
}

/**
 * The invoice page's totals (invoice-editor.tsx): Subtotal / Tax / Total as the server computes
 * them (invoices.server.ts totals()), and the internal side — Cost, Margin, Margin / hour — that
 * only admins and managers see, folded ("Internal — cost and margin").
 *
 * Purchase orders (owner, Oct 1; purchase-orders.ts): the ticket's APPROVED PO total is its own
 * internal line, "Purchase orders (approved)", and part of Cost (so Margin and Margin / hour
 * move by it). It is never an invoice line, never on the customer's invoice or PDF, and never in
 * the stored invoices.cost_total (that stays the lines' cost; the PO cost is read live from the
 * ticket). Each approved PO counts toward exactly one invoice of the ticket, its earliest live
 * one (poCostForInvoice); the ticket's other invoices add $0 and say where it is counted.
 *
 * Pure: no database, no browser (unit tested in purchase-orders.test.ts and
 * po-cost-per-invoice.test.ts).
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

/**
 * A ticket's invoice as the ticket's invoice list has it (invoices.functions.ts
 * listTicketInvoices): its label ("6000", "6000.2", or a legacy integer) and status.
 */
export interface TicketInvoiceRef {
  id: string;
  label: string;
  status: string;
  created_at: string;
}

/** Where an invoice's approved-PO cost stands: what it carries, and where it is counted. */
export interface PoCostShare {
  /** The approved PO total this invoice carries in its cost and margin (all of it, or 0). */
  cost: number;
  /** The label of the invoice that carries it when that is another invoice, else null. */
  countedOn: string | null;
}

/** "6000" → [6000, 1]; "6000.2" → [6000, 2] (slots compare as integers: .10 after .9). */
function labelOrder(label: string): [number, number] {
  const m = /^\s*(\d+)(?:\.(\d+))?\s*$/.exec(label);
  if (!m) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  return [Number(m[1]), m[2] ? Number(m[2]) : 1];
}

/**
 * The invoice that carries the ticket's approved purchase orders: its earliest live (not void)
 * invoice by number ("6000" before "6000.2"), the one made first when the numbers tie. Null
 * when the ticket has no live invoice.
 */
export function poCostInvoice<T extends TicketInvoiceRef>(invoices: readonly T[]): T | null {
  const live = invoices.filter((i) => i.status !== "void");
  live.sort((a, b) => {
    const [an, as] = labelOrder(a.label);
    const [bn, bs] = labelOrder(b.label);
    if (an !== bn) return an < bn ? -1 : 1;
    if (as !== bs) return as < bs ? -1 : 1;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return live[0] ?? null;
}

/**
 * Each approved PO counts toward exactly one invoice of its ticket (audit, Oct 2: with two
 * invoices on a ticket each added the whole approved total, so a $500 PO was $1,000 of cost).
 * The carrying invoice (poCostInvoice) gets all of `approvedTotal`; every other invoice of the
 * ticket gets 0 and the label of the one that carries it ("counted on #6000"). A void invoice
 * carries nothing.
 */
export function poCostForInvoice(
  invoiceId: string,
  invoicesOfTicket: readonly TicketInvoiceRef[],
  approvedTotal: number,
): PoCostShare {
  const carrier = poCostInvoice(invoicesOfTicket);
  if (carrier && carrier.id === invoiceId)
    return { cost: r2(Number.isFinite(approvedTotal) ? approvedTotal : 0), countedOn: null };
  return { cost: 0, countedOn: carrier?.label ?? null };
}

/**
 * The invoice page's totals (invoice-editor.tsx): Subtotal / Tax / Total as the server computes
 * them (invoices.server.ts totals()), and the internal side — Cost, Margin, Margin / hour — that
 * only admins and managers see, folded ("Internal — cost and margin").
 *
 * Purchase orders (owner, Oct 1; purchase-orders.ts): the ticket's PO total — every PO, approved
 * or not (owner, Oct 28: "PO's should count to internal cost regardless as they happened") — is
 * its own internal line, "Purchase orders", and part of Cost (so Margin and Margin / hour move
 * by it). It is never in the stored invoices.cost_total (that stays the lines' cost; the PO
 * cost is read live from the ticket). Each PO counts toward exactly one invoice of the ticket,
 * its earliest live one (poCostForInvoice); the ticket's other invoices add $0 and say where it
 * is counted.
 *
 * Since Oct 14 (owner) a draft built from the ticket carries its POs as lines too
 * (invoice-po-lines.ts, source "po:<id>", cost = the PO's price). A PO that is a line on the
 * invoice is already in the lines' cost, so the internal row leaves it out (splitPosByLines);
 * the row shows only the POs not on the invoice (e.g. added after the draft was built) and
 * notes how many are on it.
 *
 * Pure: no database, no browser (unit tested in purchase-orders.test.ts,
 * po-cost-per-invoice.test.ts and invoice-workflow-oct14.test.ts).
 */
import { poIdOfLine } from "@/lib/invoice-po-lines";

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
  /** The purchase orders of the ticket (internal; part of cost_total). */
  po_cost: number;
  /** The lines' cost plus po_cost. */
  cost_total: number;
  margin: number;
  /** Travel + labor hours on the lines. */
  hours: number;
  perHour: number | null;
}

/** Live totals of the lines; a blank box is 0. `poCost` is the ticket's PO total. */
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
 * The ticket's purchase orders split by this invoice's lines (owner, Oct 14): `onInvoice` are
 * the POs that have a "po:<id>" line here — their cost is in the lines already, so the Internal
 * row must not add them again; `offInvoice` are the rest (added after the draft was built, or
 * their line removed by hand), whose total still goes through poCostForInvoice.
 */
export function splitPosByLines<T extends { id: string }>(
  pos: readonly T[],
  lines: readonly { source?: string | null }[],
): { onInvoice: T[]; offInvoice: T[] } {
  const onLines = new Set<string>();
  for (const l of lines) {
    const id = poIdOfLine(l);
    if (id) onLines.add(id);
  }
  const onInvoice: T[] = [];
  const offInvoice: T[] = [];
  for (const p of pos) (onLines.has(p.id) ? onInvoice : offInvoice).push(p);
  return { onInvoice, offInvoice };
}

/**
 * A final invoice: the stored totals are the record (subtotal, tax, total, the lines' cost);
 * the live figures supply the hours, and the ticket's PO total is added to the cost.
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

/** Where an invoice's PO cost stands: what it carries, and where it is counted. */
export interface PoCostShare {
  /** The PO total this invoice carries in its cost and margin (all of it, or 0). */
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
 * The invoice that carries the ticket's purchase orders: its earliest live (not void)
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
 * Each PO counts toward exactly one invoice of its ticket (audit, Oct 2: with two invoices on a
 * ticket each added the whole PO total, so a $500 PO was $1,000 of cost). The carrying invoice
 * (poCostInvoice) gets all of `poTotal`; every other invoice of the ticket gets 0 and the label
 * of the one that carries it ("counted on #6000"). A void invoice carries nothing.
 */
export function poCostForInvoice(
  invoiceId: string,
  invoicesOfTicket: readonly TicketInvoiceRef[],
  poTotal: number,
): PoCostShare {
  const carrier = poCostInvoice(invoicesOfTicket);
  if (carrier && carrier.id === invoiceId)
    return { cost: r2(Number.isFinite(poTotal) ? poTotal : 0), countedOn: null };
  return { cost: 0, countedOn: carrier?.label ?? null };
}

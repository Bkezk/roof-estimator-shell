/**
 * The Margin report (owner, Oct 21): for admins, what the finished invoices of a date range made
 * and cost, grouped by month (the default), customer or technician, with a CSV export like the
 * inventory one. Pure: no database, no browser; margin-report.functions.ts reads the rows and
 * calls this, components/margin-report.tsx shows the result.
 *
 * Definitions (the same words sit in the component's help text):
 *  - Only final, sent and paid invoices count — never a draft, never a void one.
 *  - An invoice is dated by its invoice_date, else the day it was finalized, else the day it was
 *    made (`invoiceDay`), read from the date STRING: no time zone math.
 *  - Revenue = the invoice's subtotal, BEFORE tax. Tax is collected and passed on; it is not
 *    margin. (The per-invoice "Internal — cost and margin" fold, invoice-totals.ts computeTotals,
 *    takes margin off the total INCLUDING tax, so a taxed invoice reads a little higher there
 *    than here. The report's way is the honest one for a margin; the fold is left as it was.)
 *  - Material cost = the material lines' cost_total; Labor & travel = the labor and travel lines'
 *    (their cost_rate comes from the rate table, invoice-labor.ts); Other = the other lines'.
 *  - Purchase orders = the ticket's APPROVED purchase orders, counted toward exactly ONE invoice
 *    of the ticket, its earliest live one (invoice-totals.ts poCostForInvoice), and never when
 *    the PO is already a "po:<id>" line on the invoice — then it is in the material cost
 *    (splitPosByLines). Stored invoices.cost_total is the lines' cost only, so the POs are added
 *    here, live, as the invoice page does.
 *  - Cost = material + labor & travel + other + purchase orders. Margin = revenue − cost.
 *    Margin % = margin / revenue as a percent with one decimal; blank (null) when revenue is 0,
 *    never NaN.
 *  - Sorting: months newest first; customers and technicians by margin, biggest first, then by
 *    name. A ticket with nobody assigned is "Unassigned"; an invoice whose ticket is missing is
 *    "No ticket". Every amount is rounded to cents.
 */
import { approvedPoTotal, type PoLike } from "@/lib/purchase-orders";
import { poCostForInvoice, splitPosByLines, type TicketInvoiceRef } from "@/lib/invoice-totals";

/** Cents-rounded, like the server (invoices.server.ts r2). */
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined) => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export const MARGIN_GROUPS = ["month", "customer", "technician"] as const;
export type MarginGroupBy = (typeof MARGIN_GROUPS)[number];
export const MARGIN_GROUP_LABELS: Record<MarginGroupBy, string> = {
  month: "Month",
  customer: "Customer",
  technician: "Technician",
};

/** The invoice statuses the report counts (invoices.functions.ts INVOICE_STATUSES less draft and void). */
export const COUNTED_INVOICE_STATUSES = ["final", "sent", "paid"] as const;

export const UNASSIGNED_LABEL = "Unassigned";
export const NO_TICKET_LABEL = "No ticket";
export const NO_CUSTOMER_LABEL = "No customer name";

// ---- dating -------------------------------------------------------------------------------

/** The YYYY-MM-DD an invoice is dated by: invoice_date, else finalized_at's day, else created_at's. */
export function invoiceDay(inv: {
  invoice_date: string | null | undefined;
  finalized_at: string | null | undefined;
  created_at: string;
}): string {
  const pick = (inv.invoice_date || inv.finalized_at || inv.created_at).trim();
  return pick.slice(0, 10);
}

/** "2026-10-05" → "2026-10" (the string's own month, no Date). */
export const monthKey = (day: string): string => day.slice(0, 7);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10" → "Oct 2026". */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const name = MONTHS[Number(m) - 1];
  return name && y ? `${name} ${y}` : key;
}

// ---- cost ---------------------------------------------------------------------------------

export interface LineCosts {
  material: number;
  /** Labor and travel lines together (both are the crew's time). */
  labor: number;
  other: number;
}

/** The lines' cost split by kind; a kind the report does not know counts under Other. */
export function lineCosts(
  lines: readonly { kind: string; cost_total: number | string | null }[],
): LineCosts {
  let material = 0;
  let labor = 0;
  let other = 0;
  for (const l of lines) {
    const c = num(l.cost_total);
    if (l.kind === "material") material += c;
    else if (l.kind === "labor" || l.kind === "travel") labor += c;
    else other += c;
  }
  return { material: r2(material), labor: r2(labor), other: r2(other) };
}

/**
 * The approved purchase-order cost this invoice carries: the POs not already a "po:<id>" line on
 * it (splitPosByLines), summed when approved (approvedPoTotal), on the ticket's earliest live
 * invoice only (poCostForInvoice) — exactly what the invoice page's Internal fold shows.
 */
export function poCostCarried(
  invoiceId: string,
  ticketInvoices: readonly TicketInvoiceRef[],
  pos: readonly (PoLike & { id: string })[],
  lines: readonly { source?: string | null }[],
): number {
  const { offInvoice } = splitPosByLines(pos, lines);
  return poCostForInvoice(invoiceId, ticketInvoices, approvedPoTotal(offInvoice)).cost;
}

// ---- grouping -----------------------------------------------------------------------------

/** One counted invoice, resolved: its day, names and cost parts (the server builds these). */
export interface MarginInvoiceIn {
  id: string;
  /** YYYY-MM-DD (invoiceDay). */
  day: string;
  /** Revenue: the subtotal, before tax. */
  subtotal: number | string;
  /** The bill-to name (customer account or vendor); "" when none is known. */
  customer: string;
  /** The ticket's technician's name; null when nobody is assigned (or there is no ticket). */
  technician: string | null;
  /** Does the invoice's ticket exist (false → "No ticket")? */
  ticket: boolean;
  material: number;
  labor: number;
  other: number;
  /** poCostCarried for this invoice. */
  purchaseOrders: number;
}

export interface MarginTotals {
  invoices: number;
  revenue: number;
  material: number;
  labor: number;
  other: number;
  purchaseOrders: number;
  cost: number;
  margin: number;
  /** Percent with one decimal (32.5 = 32.5 %); null when revenue is 0. */
  marginPct: number | null;
}

export interface MarginRow extends MarginTotals {
  /** "2026-10", the customer's name, or the technician's id ("unassigned" / "no-ticket"). */
  key: string;
  label: string;
}

export interface MarginReportResult {
  from: string;
  to: string;
  groupBy: MarginGroupBy;
  rows: MarginRow[];
  totals: MarginTotals;
  /** When the numbers were read (ISO). */
  generatedAt: string;
}

/** margin / revenue as a percent with one decimal; null (blank) at zero revenue, never NaN. */
export function marginPctOf(margin: number, revenue: number): number | null {
  if (!(revenue > 0) && !(revenue < 0)) return null;
  const pct = (margin / revenue) * 100;
  return Number.isFinite(pct) ? Math.round(pct * 10) / 10 : null;
}

const emptyTotals = (): MarginTotals => ({
  invoices: 0,
  revenue: 0,
  material: 0,
  labor: 0,
  other: 0,
  purchaseOrders: 0,
  cost: 0,
  margin: 0,
  marginPct: null,
});

function groupOf(inv: MarginInvoiceIn, groupBy: MarginGroupBy): { key: string; label: string } {
  if (groupBy === "month") {
    const key = monthKey(inv.day);
    return { key, label: monthLabel(key) };
  }
  if (groupBy === "customer") {
    const name = inv.customer.trim() || NO_CUSTOMER_LABEL;
    return { key: name, label: name };
  }
  if (!inv.ticket) return { key: "no-ticket", label: NO_TICKET_LABEL };
  const name = (inv.technician ?? "").trim();
  return name ? { key: name, label: name } : { key: "unassigned", label: UNASSIGNED_LABEL };
}

function add(t: MarginTotals, inv: MarginInvoiceIn): void {
  const revenue = num(inv.subtotal);
  const cost = inv.material + inv.labor + inv.other + inv.purchaseOrders;
  t.invoices += 1;
  t.revenue += revenue;
  t.material += inv.material;
  t.labor += inv.labor;
  t.other += inv.other;
  t.purchaseOrders += inv.purchaseOrders;
  t.cost += cost;
  t.margin += revenue - cost;
}

function settle(t: MarginTotals): void {
  t.revenue = r2(t.revenue);
  t.material = r2(t.material);
  t.labor = r2(t.labor);
  t.other = r2(t.other);
  t.purchaseOrders = r2(t.purchaseOrders);
  t.cost = r2(t.cost);
  t.margin = r2(t.margin);
  t.marginPct = marginPctOf(t.margin, t.revenue);
}

/** The rows and totals of `invoices` grouped by `groupBy`, in the report's order. */
export function aggregateMargin(
  invoices: readonly MarginInvoiceIn[],
  groupBy: MarginGroupBy,
): { rows: MarginRow[]; totals: MarginTotals } {
  const groups = new Map<string, MarginRow>();
  const totals = emptyTotals();
  for (const inv of invoices) {
    const g = groupOf(inv, groupBy);
    let row = groups.get(g.key);
    if (!row) {
      row = { ...emptyTotals(), key: g.key, label: g.label };
      groups.set(g.key, row);
    }
    add(row, inv);
    add(totals, inv);
  }
  const rows = [...groups.values()];
  for (const r of rows) settle(r);
  settle(totals);
  if (groupBy === "month") rows.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  else rows.sort((a, b) => b.margin - a.margin || a.label.localeCompare(b.label));
  return { rows, totals };
}

// ---- the default range --------------------------------------------------------------------

/**
 * The last 12 months including this one: from the first of the month 11 months back to `today`
 * (YYYY-MM-DD, the viewer's day). String arithmetic only.
 */
export function defaultMarginRange(today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const months = y * 12 + (m - 1) - 11;
  const fy = Math.floor(months / 12);
  const fm = (months % 12) + 1;
  return { from: `${fy}-${String(fm).padStart(2, "0")}-01`, to: today.slice(0, 10) };
}

/** Is `from`..`to` two YYYY-MM-DD days with from on or before to? */
export const marginRangeValid = (from: string, to: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;

// ---- CSV ----------------------------------------------------------------------------------

export const MARGIN_CSV_HEADER = [
  "Group",
  "Invoices",
  "Revenue",
  "Material",
  "Labor & travel",
  "Purchase orders",
  "Other",
  "Cost",
  "Margin",
  "Margin %",
];

const cents = (n: number) => n.toFixed(2);
const pct = (n: number | null) => (n === null ? "" : n.toFixed(1));

const csvLine = (label: string, t: MarginTotals): string[] => [
  label,
  String(t.invoices),
  cents(t.revenue),
  cents(t.material),
  cents(t.labor),
  cents(t.purchaseOrders),
  cents(t.other),
  cents(t.cost),
  cents(t.margin),
  pct(t.marginPct),
];

/** The header, one row per group and a Totals row; money as plain numbers (review-export.ts toCsv writes it). */
export function marginCsvRows(result: MarginReportResult): string[][] {
  return [
    MARGIN_CSV_HEADER,
    ...result.rows.map((r) => csvLine(r.label, r)),
    csvLine("Totals", result.totals),
  ];
}

/** "margin-month-2025-11-01-to-2026-10-21.csv" */
export const marginCsvFileName = (groupBy: MarginGroupBy, from: string, to: string): string =>
  `margin-${groupBy}-${from}-to-${to}.csv`;

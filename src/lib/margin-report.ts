/**
 * The Margin report (owner, Oct 21): for admins, what the finished invoices of a date range made
 * and cost, grouped by month (the default), customer or technician, with a CSV export like the
 * inventory one. Pure: no database, no browser; margin-report.functions.ts reads the rows and
 * calls this, components/margin-report.tsx shows the result. Extended the same day ("add more
 * detail to the margin section and add some charts to track over time with the ability to
 * compare months/years"; "keep it before tax"): hours and the average invoice per group, the lean
 * per-invoice rows behind each group, the paid / sent / final split, the chart points, and a
 * comparison period (margin-compare.ts aligns the two).
 *
 * Definitions (the same words sit in the component's help text):
 *  - Only final, sent and paid invoices count — never a draft, never a void one.
 *  - An invoice is dated by its invoice_date, else the day it was finalized, else the day it was
 *    made (`invoiceDay`), read from the date STRING: no time zone math.
 *  - Revenue = the invoice's subtotal, BEFORE tax. Tax is collected and passed on; it is not
 *    margin. (The per-invoice "Internal — cost and margin" fold, invoice-totals.ts computeTotals,
 *    takes margin off the total INCLUDING tax, so a taxed invoice reads a little higher there
 *    than here. The report's way is the honest one for a margin; the fold is left as it was.)
 *    Every figure, chart and comparison here is before tax; there is no toggle.
 *  - Material cost = the material lines' cost_total; Labor & travel = the labor and travel lines'
 *    (their cost_rate comes from the rate table, invoice-labor.ts); Other = the other lines'.
 *  - Hours = the labor and travel lines' qty, summed (what computeTotals calls `hours`).
 *  - Purchase orders = the ticket's purchase orders (every one; owner, Oct 28), counted toward
 *    exactly ONE invoice of the ticket, its earliest live one (invoice-totals.ts poCostForInvoice), and never when
 *    the PO is already a "po:<id>" line on the invoice — then it is in the material cost
 *    (splitPosByLines). Stored invoices.cost_total is the lines' cost only, so the POs are added
 *    here, live, as the invoice page does.
 *  - Cost = material + labor & travel + other + purchase orders. Margin = revenue − cost.
 *    Margin % = margin / revenue as a percent with one decimal; blank (null) when revenue is 0,
 *    never NaN. Avg / invoice = revenue / invoices; blank when there are none.
 *  - Sorting: months newest first; customers and technicians by margin, biggest first, then by
 *    name. Technicians are keyed by the profile's id (two people with the same display name stay
 *    two rows), customers by the bill-to name (the only name the invoice has). A ticket with
 *    nobody assigned is "Unassigned"; an invoice whose ticket is missing is "No ticket". Every
 *    amount is rounded to cents.
 *
 * Won bids (owner, Oct 21: "do bids that are accepted go into that report? if not please add
 * them and have it to where you can filter just service, just bids, or both"; and "there also
 * needs to be a way to adjust the date the bid was won … go with the bid won on day add"):
 *  - A won bid (bid-status.ts: status won, the legacy accepted folded in; never a draft,
 *    submitted, lost or deleted one) is a row like an invoice, `kind` "bid", status "won". The
 *    Include select (MARGIN_SOURCES) asks for service and bids (the default), service only, or
 *    bids only; the comparison period follows the same choice.
 *  - Its money is the estimator's stored figures (bid-figures.ts, bids.figures, written at every
 *    save): revenue = the bid total BEFORE tax; material, labor (direct + subs and services) and
 *    other (warranty, shipping, per diem, commission) are the cost; hours the direct-labor hours;
 *    no purchase orders. A won bid saved before the figures existed (null column) is counted
 *    nowhere — not a row, not the totals, not the charts, not the CSV — and only listed
 *    (MarginReportResult.bidsWithoutFigures) so it can be opened and saved once.
 *  - Its day is the day it was won (`bidWonDay`): bids.won_on, the business day the office picked
 *    or that was stamped when it was marked Won; an older won row without one falls back to
 *    status_changed_at's office day (tasks.ts localYmd, TASK_TZ), then updated_at's.
 *  - Its number is the bid's name; its customer the linked account's name, else the name typed
 *    on the bid (data.customer.name), else ""; its "technician" is the estimator who made it
 *    (created_by's profile), keyed by that id, so grouping by Technician / estimator puts a
 *    technician's invoices and an estimator's won bids side by side.
 *  - The status split gains a Won bids tile (counted as bids). The CSV is left as it was: its
 *    rows are groups, and a group mixes invoices and bids; Include says what the file covers.
 */
import type { BidFigures } from "@/lib/bid-figures";
import { poTotal, type PoLike } from "@/lib/purchase-orders";
import { poCostForInvoice, splitPosByLines, type TicketInvoiceRef } from "@/lib/invoice-totals";
import { TASK_TZ, localYmd } from "@/lib/tasks";

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
  /** A ticket's technician, or the estimator who made a won bid (owner, Oct 21). */
  technician: "Technician / estimator",
};

/** The invoice statuses the report counts (invoices.functions.ts INVOICE_STATUSES less draft and void). */
export const COUNTED_INVOICE_STATUSES = ["final", "sent", "paid"] as const;
export type CountedInvoiceStatus = (typeof COUNTED_INVOICE_STATUSES)[number];
/** A row's status: a counted invoice's, or "won" for a bid. */
export type MarginRowStatus = CountedInvoiceStatus | "won";
/** What a row is: a service invoice, or a won bid. */
export type MarginRowKind = "service" | "bid";

/** The Include select (owner, Oct 21: "filter just service, just bids, or both"). */
export const MARGIN_SOURCES = ["both", "service", "bids"] as const;
export type MarginSource = (typeof MARGIN_SOURCES)[number];
export const MARGIN_SOURCE_LABELS: Record<MarginSource, string> = {
  both: "Service and bids",
  service: "Service only",
  bids: "Bids only",
};
/** The count column's heading per Include (a row is an invoice or a bid). */
export const MARGIN_COUNT_LABELS: Record<MarginSource, string> = {
  both: "Invoices + bids",
  service: "Invoices",
  bids: "Bids",
};
/** The average column's heading per Include. */
export const MARGIN_AVG_LABELS: Record<MarginSource, string> = {
  both: "Avg / item",
  service: "Avg / invoice",
  bids: "Avg / bid",
};

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
/** "2026-10" → "Oct 26" (a chart tick). */
export function shortMonthLabel(key: string): string {
  const [y, m] = key.split("-");
  const name = MONTHS[Number(m) - 1];
  return name && y ? `${name} ${y.slice(2)}` : key;
}

/** Every month key from `from`'s month to `to`'s, oldest first; none when from is after to. */
export function monthsBetween(from: string, to: string): string[] {
  const start = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1;
  const end = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7)) - 1;
  const out: string[] = [];
  for (let i = start; i <= end; i++)
    out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
  return out;
}

// ---- cost ---------------------------------------------------------------------------------

export interface LineCosts {
  material: number;
  /** Labor and travel lines together (both are the crew's time). */
  labor: number;
  other: number;
  /** The labor and travel lines' qty (hours), summed. */
  hours: number;
}

/** The lines' cost split by kind, and the hours; a kind the report does not know counts under Other. */
export function lineCosts(
  lines: readonly {
    kind: string;
    cost_total: number | string | null;
    qty?: number | string | null;
  }[],
): LineCosts {
  let material = 0;
  let labor = 0;
  let other = 0;
  let hours = 0;
  for (const l of lines) {
    const c = num(l.cost_total);
    if (l.kind === "material") material += c;
    else if (l.kind === "labor" || l.kind === "travel") {
      labor += c;
      hours += num(l.qty);
    } else other += c;
  }
  return { material: r2(material), labor: r2(labor), other: r2(other), hours: r2(hours) };
}

/**
 * The purchase-order cost this invoice carries: the POs not already a "po:<id>" line on it
 * (splitPosByLines), summed (poTotal — every PO, approved or not; owner, Oct 28), on the
 * ticket's earliest live invoice only (poCostForInvoice) — exactly what the invoice page's
 * Internal fold shows.
 */
export function poCostCarried(
  invoiceId: string,
  ticketInvoices: readonly TicketInvoiceRef[],
  pos: readonly (PoLike & { id: string })[],
  lines: readonly { source?: string | null }[],
): number {
  const { offInvoice } = splitPosByLines(pos, lines);
  return poCostForInvoice(invoiceId, ticketInvoices, poTotal(offInvoice)).cost;
}

// ---- the invoices -------------------------------------------------------------------------

/** One counted invoice or won bid, resolved: its day, names and cost parts (the server builds these). */
export interface MarginInvoiceIn {
  id: string;
  /** A service invoice, or a won bid (bidToMarginIn). */
  kind: MarginRowKind;
  /** The invoice's label ("6012.2"; invoice-numbering.ts invoiceLabel), or the bid's name. */
  number: string;
  /** YYYY-MM-DD (invoiceDay; bidWonDay for a bid). */
  day: string;
  status: MarginRowStatus;
  /** Revenue: the subtotal, before tax (a bid: its total less the tax charged). */
  subtotal: number | string;
  /** The bill-to name (customer account or vendor); a bid's account or typed customer; "" when none is known. */
  customer: string;
  /** The ticket's technician's name, or the bid's estimator's; null when nobody is assigned (or there is no ticket). */
  technician: string | null;
  /** The technician's (estimator's) profile id (the grouping key); null when nobody is assigned. */
  technicianId: string | null;
  /** Does the invoice's ticket exist (false → "No ticket")? Always true for a bid. */
  ticket: boolean;
  /** The labor and travel hours on the lines; a bid's direct-labor hours. */
  hours: number;
  material: number;
  labor: number;
  other: number;
  /** poCostCarried for this invoice; 0 for a bid. */
  purchaseOrders: number;
}

/** A won bid as the server reads and resolves it, before it becomes a MarginInvoiceIn. */
export interface MarginBidIn {
  id: string;
  name: string;
  /** bids.won_on (YYYY-MM-DD), the day the office says it was won; null on older rows. */
  won_on: string | null | undefined;
  /** When the status last changed (null on rows older than Oct 12). */
  status_changed_at: string | null | undefined;
  updated_at: string;
  /** The linked crm_accounts row's name, when there is one. */
  accountName: string | null | undefined;
  /** The customer name typed on the bid (data.customer.name). */
  dataCustomerName: string | null | undefined;
  /** The estimator (created_by's profile): name and id. */
  estimator: string | null;
  estimatorId: string | null;
  figures: BidFigures;
}

/**
 * The day a bid was won: won_on (a day the office picked or that was stamped when it was marked
 * Won), else the office's calendar day (TASK_TZ) of status_changed_at, else of updated_at (a row
 * marked won before Oct 12 has no status_changed_at).
 */
export function bidWonDay(b: {
  won_on: string | null | undefined;
  status_changed_at: string | null | undefined;
  updated_at: string;
}): string {
  if (b.won_on && /^\d{4}-\d{2}-\d{2}$/.test(b.won_on)) return b.won_on;
  return localYmd(new Date(b.status_changed_at || b.updated_at), TASK_TZ);
}

/** A won bid as a report row input: the rules at the top of the file. */
export function bidToMarginIn(b: MarginBidIn): MarginInvoiceIn {
  const f = b.figures;
  return {
    id: b.id,
    kind: "bid",
    number: b.name,
    day: bidWonDay(b),
    status: "won",
    subtotal: f.revenue,
    customer: (b.accountName ?? "").trim() || (b.dataCustomerName ?? "").trim(),
    technician: b.estimator,
    technicianId: b.estimatorId,
    ticket: true,
    hours: f.hours,
    material: f.material,
    labor: f.labor,
    other: f.other,
    purchaseOrders: 0,
  };
}

/**
 * The lean per-invoice row the report sends and shows under an expanded group: who, when, what
 * status, and the money — no tax, no lines, no snapshots.
 */
export interface MarginInvoiceRow {
  id: string;
  kind: MarginRowKind;
  number: string;
  day: string;
  status: MarginRowStatus;
  customer: string;
  technician: string | null;
  technicianId: string | null;
  ticket: boolean;
  hours: number;
  /** The subtotal, before tax. */
  revenue: number;
  material: number;
  labor: number;
  other: number;
  purchaseOrders: number;
  cost: number;
  margin: number;
  marginPct: number | null;
}

/** margin / revenue as a percent with one decimal; null (blank) at zero revenue, never NaN. */
export function marginPctOf(margin: number, revenue: number): number | null {
  if (!(revenue > 0) && !(revenue < 0)) return null;
  const pct = (margin / revenue) * 100;
  return Number.isFinite(pct) ? Math.round(pct * 10) / 10 : null;
}

export function toMarginInvoiceRow(inv: MarginInvoiceIn): MarginInvoiceRow {
  const revenue = r2(num(inv.subtotal));
  const material = r2(inv.material);
  const labor = r2(inv.labor);
  const other = r2(inv.other);
  const purchaseOrders = r2(inv.purchaseOrders);
  const cost = r2(material + labor + other + purchaseOrders);
  const margin = r2(revenue - cost);
  return {
    id: inv.id,
    kind: inv.kind,
    number: inv.number,
    day: inv.day,
    status: inv.status,
    customer: inv.customer,
    technician: inv.technician,
    technicianId: inv.technicianId,
    ticket: inv.ticket,
    hours: r2(inv.hours),
    revenue,
    material,
    labor,
    other,
    purchaseOrders,
    cost,
    margin,
    marginPct: marginPctOf(margin, revenue),
  };
}

// ---- grouping -----------------------------------------------------------------------------

export interface MarginTotals {
  invoices: number;
  /** Labor and travel hours. */
  hours: number;
  revenue: number;
  /** revenue / invoices; null when there are no invoices. */
  avgRevenue: number | null;
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

/** One period's answer: its groups, totals and the invoices behind them. */
export interface MarginPeriod {
  from: string;
  to: string;
  rows: MarginRow[];
  totals: MarginTotals;
  invoices: MarginInvoiceRow[];
}

export interface MarginReportResult extends MarginPeriod {
  groupBy: MarginGroupBy;
  /** What was included: service invoices, won bids, or both (the comparison follows it). */
  source: MarginSource;
  /**
   * Won bids of the range whose figures column is null (saved before Oct 21, 2026): counted
   * nowhere, listed so each can be opened in the estimator and saved once.
   */
  bidsWithoutFigures: { id: string; name: string; day: string }[];
  /** When the numbers were read (ISO). */
  generatedAt: string;
  /** The comparison period, when one was asked for (the same groupBy and source). */
  comparison?: MarginPeriod;
}

export const emptyMarginTotals = (): MarginTotals => ({
  invoices: 0,
  hours: 0,
  revenue: 0,
  avgRevenue: null,
  material: 0,
  labor: 0,
  other: 0,
  purchaseOrders: 0,
  cost: 0,
  margin: 0,
  marginPct: null,
});

type GroupFields = Pick<
  MarginInvoiceRow,
  "day" | "customer" | "technician" | "technicianId" | "ticket"
>;

/** The group an invoice falls in under `groupBy`: its key and the label the row shows. */
export function marginGroupKey(
  inv: GroupFields,
  groupBy: MarginGroupBy,
): { key: string; label: string } {
  if (groupBy === "month") {
    const key = monthKey(inv.day);
    return { key, label: monthLabel(key) };
  }
  if (groupBy === "customer") {
    const name = inv.customer.trim() || NO_CUSTOMER_LABEL;
    return { key: name, label: name };
  }
  if (!inv.ticket) return { key: "no-ticket", label: NO_TICKET_LABEL };
  if (!inv.technicianId) return { key: "unassigned", label: UNASSIGNED_LABEL };
  return { key: inv.technicianId, label: (inv.technician ?? "").trim() || UNASSIGNED_LABEL };
}

function add(t: MarginTotals, inv: MarginInvoiceRow): void {
  t.invoices += 1;
  t.hours += inv.hours;
  t.revenue += inv.revenue;
  t.material += inv.material;
  t.labor += inv.labor;
  t.other += inv.other;
  t.purchaseOrders += inv.purchaseOrders;
  t.cost += inv.cost;
  t.margin += inv.margin;
}

function settle(t: MarginTotals): void {
  t.hours = r2(t.hours);
  t.revenue = r2(t.revenue);
  t.material = r2(t.material);
  t.labor = r2(t.labor);
  t.other = r2(t.other);
  t.purchaseOrders = r2(t.purchaseOrders);
  t.cost = r2(t.cost);
  t.margin = r2(t.margin);
  t.marginPct = marginPctOf(t.margin, t.revenue);
  t.avgRevenue = t.invoices > 0 ? r2(t.revenue / t.invoices) : null;
}

/** `rows` summed into one MarginTotals (settled). */
export function sumMarginRows(rows: readonly MarginInvoiceRow[]): MarginTotals {
  const t = emptyMarginTotals();
  for (const r of rows) add(t, r);
  settle(t);
  return t;
}

const sortRows = (rows: MarginRow[], groupBy: MarginGroupBy) => {
  if (groupBy === "month") rows.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  else rows.sort((a, b) => b.margin - a.margin || a.label.localeCompare(b.label));
  return rows;
};

/** The rows and totals of the per-invoice `rows` grouped by `groupBy`, in the report's order. */
export function aggregateMarginRows(
  invoices: readonly MarginInvoiceRow[],
  groupBy: MarginGroupBy,
): { rows: MarginRow[]; totals: MarginTotals } {
  const groups = new Map<string, MarginRow>();
  const totals = emptyMarginTotals();
  for (const inv of invoices) {
    const g = marginGroupKey(inv, groupBy);
    let row = groups.get(g.key);
    if (!row) {
      row = { ...emptyMarginTotals(), key: g.key, label: g.label };
      groups.set(g.key, row);
    }
    add(row, inv);
    add(totals, inv);
  }
  const rows = [...groups.values()];
  for (const r of rows) settle(r);
  settle(totals);
  return { rows: sortRows(rows, groupBy), totals };
}

/** The rows and totals of `invoices` grouped by `groupBy`, in the report's order. */
export function aggregateMargin(
  invoices: readonly MarginInvoiceIn[],
  groupBy: MarginGroupBy,
): { rows: MarginRow[]; totals: MarginTotals } {
  return aggregateMarginRows(invoices.map(toMarginInvoiceRow), groupBy);
}

// ---- the status split ---------------------------------------------------------------------

/** The split's tiles in order: the three invoice statuses, then the won bids. */
export const MARGIN_SPLIT_STATUSES = [...COUNTED_INVOICE_STATUSES, "won"] as const;
/** `invoices` counts rows: invoices in the first three buckets, bids in `won`. */
export type StatusSplit = Record<MarginRowStatus, { invoices: number; revenue: number }>;
/** The words of the split's tiles (the component). */
export const STATUS_SPLIT_LABELS: Record<MarginRowStatus, string> = {
  paid: "Paid",
  sent: "Sent, unpaid",
  final: "Final, not yet sent",
  won: "Won bids",
};

/** Of the period's revenue (before tax), how much is paid, sent and unpaid, final not yet sent, and won bids. */
export function statusSplit(invoices: readonly MarginInvoiceRow[]): StatusSplit {
  const out: StatusSplit = {
    paid: { invoices: 0, revenue: 0 },
    sent: { invoices: 0, revenue: 0 },
    final: { invoices: 0, revenue: 0 },
    won: { invoices: 0, revenue: 0 },
  };
  for (const i of invoices) {
    const slot = out[i.status];
    if (!slot) continue;
    slot.invoices += 1;
    slot.revenue += i.revenue;
  }
  for (const s of MARGIN_SPLIT_STATUSES) out[s].revenue = r2(out[s].revenue);
  return out;
}

// ---- chart points -------------------------------------------------------------------------

/** One month of the "By month" and "Cost mix" charts; `label` is the "Oct 26" tick. */
export interface MonthPoint extends MarginTotals {
  key: string;
  label: string;
}

/** Every month of from..to as a point, oldest first, zero where nothing was invoiced. */
export function monthSeries(
  invoices: readonly MarginInvoiceRow[],
  from: string,
  to: string,
): MonthPoint[] {
  const byMonth = new Map(aggregateMarginRows(invoices, "month").rows.map((r) => [r.key, r]));
  return monthsBetween(from, to).map((key) => {
    const row = byMonth.get(key);
    const totals: MarginTotals = row
      ? {
          invoices: row.invoices,
          hours: row.hours,
          revenue: row.revenue,
          avgRevenue: row.avgRevenue,
          material: row.material,
          labor: row.labor,
          other: row.other,
          purchaseOrders: row.purchaseOrders,
          cost: row.cost,
          margin: row.margin,
          marginPct: row.marginPct,
        }
      : emptyMarginTotals();
    return { key, label: shortMonthLabel(key), ...totals };
  });
}

/**
 * The margin % chart's axis: always shows 0, never zooms onto one value. From the next 5 under
 * the lowest month (0 when none is negative) up to the next 5 over the highest, at least 10 —
 * owner, Oct 21: one month invoiced at about −1 % made the axis run −1 % to −5 % with nothing
 * visible on it. Months without invoices (null) do not count.
 */
export function marginPctDomain(values: readonly (number | null)[]): [number, number] {
  const seen = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const lo = seen.length ? Math.min(0, Math.floor(Math.min(...seen) / 5) * 5) : 0;
  const hi = seen.length ? Math.max(10, Math.ceil(Math.max(...seen) / 5) * 5) : 10;
  return [lo, hi];
}

/**
 * The ticks for that axis: round steps (5, 10, 20, 25, 50, 100 …) from the bottom to the top of
 * the domain, at most seven of them, so the labels read 0 %, 5 %, 10 % rather than 3 %.
 */
export function marginPctTicks([lo, hi]: readonly [number, number]): number[] {
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const step = steps.find((st) => (hi - lo) / st <= 6) ?? 1000;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

export const OTHERS_KEY = "others";
export const OTHERS_LABEL = "Others";

/** The first `n` rows (they come sorted by margin) and the rest folded into one Others row. */
export function topByMargin(rows: readonly MarginRow[], n = 10): MarginRow[] {
  if (rows.length <= n) return [...rows];
  const others: MarginRow = { ...emptyMarginTotals(), key: OTHERS_KEY, label: OTHERS_LABEL };
  for (const r of rows.slice(n)) {
    others.invoices += r.invoices;
    others.hours += r.hours;
    others.revenue += r.revenue;
    others.material += r.material;
    others.labor += r.labor;
    others.other += r.other;
    others.purchaseOrders += r.purchaseOrders;
    others.cost += r.cost;
    others.margin += r.margin;
  }
  settle(others);
  return [...rows.slice(0, n), others];
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
  "Hours",
  "Revenue",
  "Avg / invoice",
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
/** Hours as written: "3", "2.5". */
const hrs = (n: number) => String(r2(n));

/** Money with 2 decimals, percent with 1, blank when none (margin-compare.ts marginCsvRows adds the comparison columns). */
export const marginCsvLine = (label: string, t: MarginTotals): string[] => [
  label,
  String(t.invoices),
  hrs(t.hours),
  cents(t.revenue),
  t.avgRevenue === null ? "" : cents(t.avgRevenue),
  cents(t.material),
  cents(t.labor),
  cents(t.purchaseOrders),
  cents(t.other),
  cents(t.cost),
  cents(t.margin),
  pct(t.marginPct),
];
/** The CSV's number formats, for the comparison columns. */
export const marginCsvFormat = { cents, pct };

/** "margin-month-2025-11-01-to-2026-10-21.csv"; "…-vs-<from>-to-<to>.csv" when comparing. */
export const marginCsvFileName = (
  groupBy: MarginGroupBy,
  from: string,
  to: string,
  compare?: { from: string; to: string } | null,
): string =>
  `margin-${groupBy}-${from}-to-${to}${compare ? `-vs-${compare.from}-to-${compare.to}` : ""}.csv`;

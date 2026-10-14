/**
 * Purchase orders as invoice lines (owner, Oct 14: "I'd like the mark up to be able to be
 * toggled to applied to the PO or not — material markup that is").
 *
 * A draft built or rebuilt from the ticket carries one material line per APPROVED purchase
 * order of the ticket (invoices.server.ts buildLinesFromJob): "PO <number> — <title> (<vendor>)",
 * quantity 1, cost = the PO's price, rate = price × (1 + the invoice's material markup) while
 * invoices.po_markup is on (the default) or the price itself when it is off. Its source is
 * "po:<po id>", so Rebuild from ticket treats it like a ticket material (a typed price is kept;
 * invoice-rebuild.ts mergeRebuild) and the Internal fold does not count the same PO twice
 * (invoice-totals.ts splitPosByLines). The PDF prints it like any material line.
 *
 * Pure: no database, no browser (unit tested in invoice-workflow-oct14.test.ts).
 */

export const PO_SOURCE = "po:";

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined) => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** A line made from a purchase order (its source is "po:<po id>"). */
export const isPoLine = (l: { source?: string | null }): boolean =>
  !!l.source && l.source.startsWith(PO_SOURCE);

/** The PO's id a line was made from, or null for any other line. */
export const poIdOfLine = (l: { source?: string | null }): string | null =>
  isPoLine(l) ? l.source!.slice(PO_SOURCE.length) : null;

/** What a PO line is built from (a subset of service_job_purchase_orders' Row). */
export interface PoForLine {
  id: string;
  po_number: string;
  title: string | null;
  price: number | string;
  /** The day it was bought: the line's on_date. */
  po_date?: string | null;
  /** The supplier as typed on the PO, or the linked vendor's name; null when none. */
  vendor_name?: string | null;
}

/** "PO Jbk24-0255 — Seam tape (Lowe's)"; no title → "PO Jbk24-0255"; vendor only when known. */
export function poLineDescription(po: PoForLine): string {
  const title = (po.title ?? "").trim();
  const vendor = (po.vendor_name ?? "").trim();
  const base = `PO ${po.po_number.trim()}${title ? ` — ${title}` : ""}`;
  return (vendor ? `${base} (${vendor})` : base).slice(0, 300);
}

/** The rate a PO line bills at: cost plus the markup, or the cost itself (po_markup off). */
export function poLineRate(price: number, markup: number, poMarkup: boolean): number {
  const cost = r2(price);
  return poMarkup ? r2(cost * (1 + markup)) : cost;
}

/** The columns a PO line is inserted with (invoice_lines; the flags take the columns' defaults,
 * as a material line's do). */
export interface PoLineInsert {
  sort: number;
  kind: "material";
  description: string;
  qty: number;
  unit: string;
  rate: number;
  total: number;
  cost_rate: number;
  cost_total: number;
  on_date: string | null;
  source: string;
  taxable: boolean;
}

/**
 * One invoice line for an approved PO at `markup` (0.75 = 75 %). `poMarkup` false bills it at
 * cost. Quantity 1 "ea"; the PO's price is the line's cost, so Cost and Margin stay truthful.
 */
export function poLineFor(
  po: PoForLine,
  markup: number,
  poMarkup: boolean,
  sort: number,
): PoLineInsert {
  const cost = r2(num(po.price));
  const rate = poLineRate(cost, markup, poMarkup);
  return {
    sort,
    kind: "material",
    description: poLineDescription(po),
    qty: 1,
    unit: "ea",
    rate,
    total: rate,
    cost_rate: cost,
    cost_total: cost,
    on_date: po.po_date ?? null,
    source: `${PO_SOURCE}${po.id}`,
    taxable: true,
  };
}

/**
 * The markup or the Mark up purchase orders switch changed on a draft: every PO line that
 * follows them (not typed by hand, `rate_overridden`) is priced again — cost × (1 + markup)
 * with the switch on, cost with it off. Other lines, a typed price and a blank rate stay.
 * The editor's twin of applyMarkup (invoice-materials.ts) for "po:" lines.
 */
export function applyPoMarkup<
  T extends {
    source: string | null;
    rate: number | null;
    cost_rate: number;
    rate_overridden?: boolean;
  },
>(lines: readonly T[], markup: number, poMarkup: boolean): T[] {
  return lines.map((l) => {
    if (!isPoLine(l) || l.rate === null || l.rate_overridden === true) return l;
    const rate = poLineRate(l.cost_rate, markup, poMarkup);
    return rate === l.rate ? l : { ...l, rate, rate_overridden: false };
  });
}

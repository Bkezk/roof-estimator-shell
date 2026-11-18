/**
 * The Owner page's numbers by line of business (owner, Nov 18: "include trade bids profitablility
 * on the owner business charts as well as the roof care plans and have the ability to compare
 * trade bids, roof care, to just our regular buisness as well as filter to just see roof care,
 * trade bids, or our regular view").
 *
 * Three lines, and every row of the margin report is in exactly one:
 *   - Roof Care plans: the invoice of a Roof Care plan inspection. Its revenue is the visit's
 *     share of the plan; its cost is what the visit took (time, materials, purchase orders).
 *   - Trade bids: a won trade bid.
 *   - Regular business: everything else, as before: service invoices and won roofing bids.
 *
 * Pure. The three always add up to the whole: nothing is counted twice and nothing is left out
 * (a trade bid's own invoices were never rows; margin-report.functions.ts).
 */
import { marginPctOf, monthSeries, type MarginInvoiceRow } from "@/lib/margin-report";

export const MARGIN_LINES = ["regular", "trade", "roofcare"] as const;
export type MarginLine = (typeof MARGIN_LINES)[number];
export const MARGIN_LINE_LABELS: Record<MarginLine, string> = {
  regular: "Regular business",
  trade: "Trade bids",
  roofcare: "Roof Care plans",
};

/** The Business select: everything, or one line alone. */
export const MARGIN_LINE_FILTERS = ["all", ...MARGIN_LINES] as const;
export type MarginLineFilter = (typeof MARGIN_LINE_FILTERS)[number];
export const MARGIN_LINE_FILTER_LABELS: Record<MarginLineFilter, string> = {
  all: "All business",
  regular: "Regular business only",
  trade: "Trade bids only",
  roofcare: "Roof Care plans only",
};

/** Which line a row belongs to. */
export function marginLineOf(r: Pick<MarginInvoiceRow, "bidKind" | "carePlan">): MarginLine {
  if (r.carePlan) return "roofcare";
  return r.bidKind === "trade" ? "trade" : "regular";
}

export function filterByLine<T extends Pick<MarginInvoiceRow, "bidKind" | "carePlan">>(
  rows: readonly T[],
  line: MarginLineFilter,
): T[] {
  return line === "all" ? [...rows] : rows.filter((r) => marginLineOf(r) === line);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface MarginLineTotals {
  line: MarginLine;
  label: string;
  /** Invoices and won bids in the line. */
  items: number;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number | null;
}

/** The three lines' totals, always all three and in the same order, zero where there is none. */
export function lineTotals(rows: readonly MarginInvoiceRow[]): MarginLineTotals[] {
  return MARGIN_LINES.map((line) => {
    const mine = rows.filter((r) => marginLineOf(r) === line);
    const revenue = r2(mine.reduce((n, r) => n + r.revenue, 0));
    const cost = r2(mine.reduce((n, r) => n + r.cost, 0));
    const margin = r2(revenue - cost);
    return {
      line,
      label: MARGIN_LINE_LABELS[line],
      items: mine.length,
      revenue,
      cost,
      margin,
      marginPct: marginPctOf(margin, revenue),
    };
  });
}

export interface LineMonthPoint {
  key: string;
  label: string;
  regular: number;
  trade: number;
  roofcare: number;
  regularMargin: number;
  tradeMargin: number;
  roofcareMargin: number;
}

/** Every month of from..to with each line's revenue and margin, zero where there is none. */
export function lineMonthSeries(
  rows: readonly MarginInvoiceRow[],
  from: string,
  to: string,
): LineMonthPoint[] {
  const per = MARGIN_LINES.map((line) =>
    monthSeries(
      rows.filter((r) => marginLineOf(r) === line),
      from,
      to,
    ),
  );
  return per[0]!.map((m, i) => ({
    key: m.key,
    label: m.label,
    regular: per[0]![i]!.revenue,
    trade: per[1]![i]!.revenue,
    roofcare: per[2]![i]!.revenue,
    regularMargin: per[0]![i]!.margin,
    tradeMargin: per[1]![i]!.margin,
    roofcareMargin: per[2]![i]!.margin,
  }));
}

/** The Roof Care plans in force: how many, and what they are worth a year. */
export interface RoofCareInForce {
  plans: number;
  yearly: number;
}

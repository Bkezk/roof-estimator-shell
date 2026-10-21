/**
 * Comparing two periods of the Margin report (owner, Oct 21: "charts to track over time with the
 * ability to compare months/years"; "keep it before tax"). Pure: the Compare select's presets and
 * their ranges from today's date, the rule that pairs a month of the current range with one of
 * the earlier range, the change math, and the compared rows and chart series the component and
 * the CSV draw from. margin-report.ts is the base this builds on; nothing here reads a database.
 *
 * The presets (from the viewer's local day, string arithmetic only):
 *  - This year vs last year: Jan 1 .. today, against Jan 1 .. the same day last year.
 *  - This month vs same month last year: the 1st .. today, against the 1st .. the same day of
 *    that month last year (January's is last January, not December).
 *  A day that does not exist a year earlier (Feb 29) clamps to the month's last day (Feb 28).
 *  - Custom: the second From/To pair is the viewer's.
 *
 * THE ALIGNMENT RULE (by month):
 *  1. Both ranges are laid out as their full month lists, oldest first (every month of the range,
 *     invoiced or not).
 *  2. When the two lists are the same length, the i-th month of each is paired — for the presets
 *     (always a year apart) that is Jan over Jan, Oct over Oct; for a custom pair of quarters it is
 *     the first month over the first month.
 *  3. When the lengths differ, each current month is paired with the earlier month of the same
 *     month-of-year (the first such, when the earlier range spans more than a year); months that
 *     find none stay unpaired. If NO current month finds one, the months are paired by position
 *     from the start instead, and the leftovers stay unpaired.
 *  A paired month that had nothing invoiced compares against zero figures (its change has no
 *  percent); an unpaired month has no comparison. By customer / technician the rows pair by key
 *  (the customer's name, the technician's id); a group with no earlier row has no comparison.
 *
 * The change: Δ$ = current − earlier; Δ% = Δ$ / |earlier| with one decimal, blank when the
 * earlier figure is 0; margin % changes in percentage points (current − earlier), blank when
 * either is blank.
 */
import {
  MARGIN_CSV_HEADER,
  emptyMarginTotals,
  marginCsvFormat,
  marginCsvLine,
  monthLabel,
  monthSeries,
  monthsBetween,
  topByMargin,
  type MarginReportResult,
  type MarginRow,
  type MarginTotals,
  type MonthPoint,
} from "@/lib/margin-report";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

// ---- the presets --------------------------------------------------------------------------

export const COMPARE_MODES = ["off", "year", "month", "custom"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];
export const COMPARE_LABELS: Record<CompareMode, string> = {
  off: "Off",
  year: "This year vs last year",
  month: "This month vs same month last year",
  custom: "Custom",
};

export interface CompareRange {
  from: string;
  to: string;
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The same day `years` later (negative: earlier), the day clamped to that month's length. */
export function shiftYears(day: string, years: number): string {
  const y = Number(day.slice(0, 4)) + years;
  const m = Number(day.slice(5, 7));
  const d = Math.min(Number(day.slice(8, 10)), daysInMonth(y, m));
  return ymd(y, m, d);
}

/** The ranges a preset means on `today` (YYYY-MM-DD, the viewer's day). */
export function comparePreset(
  mode: "year" | "month",
  today: string,
): { from: string; to: string; compare: CompareRange } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const to = today.slice(0, 10);
  const from = mode === "year" ? ymd(y, 1, 1) : ymd(y, m, 1);
  return { from, to, compare: { from: shiftYears(from, -1), to: shiftYears(to, -1) } };
}

// ---- alignment ----------------------------------------------------------------------------

/**
 * Each month key of `current` → the month key of `earlier` it is compared with, or null (the rule
 * at the top of the file). Both lists oldest first (monthsBetween).
 */
export function alignMonths(
  current: readonly string[],
  earlier: readonly string[],
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (current.length === earlier.length) {
    current.forEach((k, i) => out.set(k, earlier[i] ?? null));
    return out;
  }
  const byMonthOfYear = new Map<string, string>();
  for (const k of earlier) {
    const mo = k.slice(5, 7);
    if (!byMonthOfYear.has(mo)) byMonthOfYear.set(mo, k);
  }
  const anyMatch = current.some((k) => byMonthOfYear.has(k.slice(5, 7)));
  current.forEach((k, i) =>
    out.set(k, anyMatch ? (byMonthOfYear.get(k.slice(5, 7)) ?? null) : (earlier[i] ?? null)),
  );
  return out;
}

// ---- the change ---------------------------------------------------------------------------

export interface Delta {
  /** current − earlier, in dollars (cents-rounded). */
  amount: number;
  /** amount / |earlier| as a percent with one decimal; null when the earlier figure is 0. */
  pct: number | null;
}

export function deltaOf(current: number, earlier: number): Delta {
  const amount = r2(current - earlier);
  return { amount, pct: earlier === 0 ? null : r1((amount / Math.abs(earlier)) * 100) };
}

/** Margin % change in percentage points; null when either side is blank. */
export function ptsDelta(current: number | null, earlier: number | null): number | null {
  if (current === null || earlier === null) return null;
  return r1(current - earlier);
}

/** One row's (or the totals') comparison: the earlier figures and the change beside each. */
export interface Compared {
  earlier: MarginTotals | null;
  /** The earlier row's label ("Oct 2025", the customer's name); null when unpaired. */
  earlierLabel: string | null;
  revenue: Delta | null;
  cost: Delta | null;
  margin: Delta | null;
  /** Margin % change in points. */
  marginPct: number | null;
}

export function compareTotals(
  current: MarginTotals,
  earlier: MarginTotals | null,
  earlierLabel: string | null,
): Compared {
  if (!earlier)
    return {
      earlier: null,
      earlierLabel: null,
      revenue: null,
      cost: null,
      margin: null,
      marginPct: null,
    };
  return {
    earlier,
    earlierLabel,
    revenue: deltaOf(current.revenue, earlier.revenue),
    cost: deltaOf(current.cost, earlier.cost),
    margin: deltaOf(current.margin, earlier.margin),
    marginPct: ptsDelta(current.marginPct, earlier.marginPct),
  };
}

export interface ComparedReport {
  /** By the current row's key. */
  rows: Map<string, Compared>;
  totals: Compared;
}

/** The comparison beside every current row and the totals; null when the report has none. */
export function compareMargin(result: MarginReportResult): ComparedReport | null {
  const c = result.comparison;
  if (!c) return null;
  const earlierByKey = new Map(c.rows.map((r) => [r.key, r]));
  const rows = new Map<string, Compared>();
  if (result.groupBy === "month") {
    const pairs = alignMonths(monthsBetween(result.from, result.to), monthsBetween(c.from, c.to));
    for (const r of result.rows) {
      const earlierKey = pairs.get(r.key) ?? null;
      const earlier = earlierKey ? (earlierByKey.get(earlierKey) ?? emptyMarginTotals()) : null;
      rows.set(r.key, compareTotals(r, earlier, earlierKey ? monthLabel(earlierKey) : null));
    }
  } else {
    for (const r of result.rows) {
      const earlier = earlierByKey.get(r.key) ?? null;
      rows.set(r.key, compareTotals(r, earlier, earlier ? earlier.label : null));
    }
  }
  return { rows, totals: compareTotals(result.totals, c.totals, "Earlier period") };
}

// ---- chart series -------------------------------------------------------------------------

export interface ComparedMonthPoint extends MonthPoint {
  earlierKey: string | null;
  earlierRevenue: number | null;
  earlierMargin: number | null;
  earlierMarginPct: number | null;
}

/** Every month of the current range with the aligned earlier revenue, margin and margin % (null without a comparison). */
export function comparedMonthSeries(result: MarginReportResult): ComparedMonthPoint[] {
  const current = monthSeries(result.invoices, result.from, result.to);
  const c = result.comparison;
  if (!c)
    return current.map((p) => ({
      ...p,
      earlierKey: null,
      earlierRevenue: null,
      earlierMargin: null,
      earlierMarginPct: null,
    }));
  const earlier = new Map(monthSeries(c.invoices, c.from, c.to).map((p) => [p.key, p]));
  const pairs = alignMonths(
    current.map((p) => p.key),
    [...earlier.keys()],
  );
  return current.map((p) => {
    const key = pairs.get(p.key) ?? null;
    const e = key ? earlier.get(key) : undefined;
    return {
      ...p,
      earlierKey: key,
      earlierRevenue: e ? e.revenue : null,
      earlierMargin: e ? e.margin : null,
      earlierMarginPct: e ? e.marginPct : null,
    };
  });
}

export interface ComparedGroupBar extends MarginRow {
  /** The earlier period's margin for the same key; for Others, the earlier rows outside the top; null without a comparison or match. */
  earlierMargin: number | null;
}

/** By customer / technician: the top `n` groups by margin with Others, each with the earlier margin by key. */
export function comparedGroupBars(result: MarginReportResult, n = 10): ComparedGroupBar[] {
  const top = topByMargin(result.rows, n);
  const c = result.comparison;
  if (!c) return top.map((r) => ({ ...r, earlierMargin: null }));
  const topKeys = new Set(top.map((r) => r.key));
  const earlierByKey = new Map(c.rows.map((r) => [r.key, r.margin]));
  return top.map((r) => {
    if (r.key === "others" && !earlierByKey.has("others")) {
      let sum = 0;
      for (const e of c.rows) if (!topKeys.has(e.key)) sum += e.margin;
      return { ...r, earlierMargin: r2(sum) };
    }
    return { ...r, earlierMargin: earlierByKey.get(r.key) ?? null };
  });
}

// ---- CSV ----------------------------------------------------------------------------------

/** The columns added after MARGIN_CSV_HEADER when a comparison is on. */
export const MARGIN_CSV_COMPARE_HEADER = [
  "Revenue (earlier)",
  "Revenue change",
  "Revenue change %",
  "Cost (earlier)",
  "Cost change",
  "Cost change %",
  "Margin (earlier)",
  "Margin change",
  "Margin change %",
  "Margin % (earlier)",
  "Margin % change (pts)",
];

const blankCompare = () => MARGIN_CSV_COMPARE_HEADER.map(() => "");

/** The comparison columns of one row: blank when the row has no earlier counterpart. */
function compareCells(c: Compared | undefined): string[] {
  if (!c || !c.earlier || !c.revenue || !c.cost || !c.margin) return blankCompare();
  const { cents, pct } = marginCsvFormat;
  return [
    cents(c.earlier.revenue),
    cents(c.revenue.amount),
    pct(c.revenue.pct),
    cents(c.earlier.cost),
    cents(c.cost.amount),
    pct(c.cost.pct),
    cents(c.earlier.margin),
    cents(c.margin.amount),
    pct(c.margin.pct),
    pct(c.earlier.marginPct),
    pct(c.marginPct),
  ];
}

/**
 * The header, one row per group and a Totals row; money as plain numbers (review-export.ts toCsv
 * writes it). With a comparison, every row carries the earlier figures and the change too.
 */
export function marginCsvRows(result: MarginReportResult): string[][] {
  const compared = compareMargin(result);
  if (!compared)
    return [
      MARGIN_CSV_HEADER,
      ...result.rows.map((r) => marginCsvLine(r.label, r)),
      marginCsvLine("Totals", result.totals),
    ];
  return [
    [...MARGIN_CSV_HEADER, ...MARGIN_CSV_COMPARE_HEADER],
    ...result.rows.map((r) => [
      ...marginCsvLine(r.label, r),
      ...compareCells(compared.rows.get(r.key)),
    ]),
    [...marginCsvLine("Totals", result.totals), ...compareCells(compared.totals)],
  ];
}

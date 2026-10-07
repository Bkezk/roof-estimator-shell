/**
 * The Setup step's per-diem chart feeds the Review's Per-Diem Charge (owner, Oct 7: "the per
 * diem chart, can we have the total added to the per diem charge on the review page
 * automatically?"). The chart was informational (per-diem-chart.ts); now its total — the
 * checked job costs — is ADDED to the charge: Per-Diem Charge = hand rate × man-days + chart
 * total. The engine (src/lib/engine, untouched) bills only rate × its own man-days, so the chart
 * total becomes rate: the estimate runs once for the man-days, then again with
 * rate + total ÷ man-days — the same arithmetic as the Review's calculator (float32, like
 * legacy). Off per bid with `perDiemFromChart: false`; on by default when a chart exists.
 */
import { normalizePerDiemChart, perDiemChartTotal } from "./per-diem-chart";

const f32 = Math.fround;

export interface PerDiemChartSource {
  customer?: { perDiemChart?: unknown } | undefined;
  /** Default true: the chart's total joins the Per-Diem Charge. */
  perDiemFromChart?: boolean | undefined;
}

/** The dollars the chart adds to the Per-Diem Charge: its checked items' total, or 0. */
export function perDiemChartAddOn(s: PerDiemChartSource): number {
  if (s.perDiemFromChart === false) return 0;
  const raw = s.customer?.perDiemChart;
  if (!raw) return 0;
  const total = perDiemChartTotal(normalizePerDiemChart(raw));
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/** The $/man-day rate that bills the hand rate plus the chart total over the estimate's man-days. */
export function perDiemRateWithChart(
  handRate: number,
  chartTotal: number,
  manDays: number,
): number {
  if (!(chartTotal > 0) || !(manDays > 0)) return handRate;
  return f32(f32(handRate) + f32(f32(chartTotal) / f32(manDays)));
}

/**
 * Run the estimate so the Per-Diem Charge carries the chart's total: a first pass for the
 * man-days, a second with the combined rate when the chart adds anything. Returns the pass that
 * counts, its bid, and what the chart added (0 when nothing did).
 */
export function runEstimateWithChartPerDiem<
  B extends { perDiem: number },
  Build,
  R extends { money: { totalManDays: number } },
>(
  bid: B,
  saved: PerDiemChartSource,
  build: (bid: B) => Build,
  compute: (build: Build) => R,
): { bid: B; build: Build; r: R; chartAddOn: number } {
  const first = build(bid);
  const r1 = compute(first);
  const addOn = perDiemChartAddOn(saved);
  const manDays = r1.money.totalManDays;
  if (!(addOn > 0) || !(manDays > 0)) return { bid, build: first, r: r1, chartAddOn: 0 };
  const bid2 = { ...bid, perDiem: perDiemRateWithChart(bid.perDiem, addOn, manDays) };
  const second = build(bid2);
  return { bid: bid2, build: second, r: compute(second), chartAddOn: addOn };
}

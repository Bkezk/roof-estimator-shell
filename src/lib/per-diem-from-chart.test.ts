/**
 * The Setup per-diem chart's total joins the Review's Per-Diem Charge (owner, Oct 7: "can we
 * have the total added to the per diem charge on the review page automatically?").
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  perDiemChartAddOn,
  perDiemRateWithChart,
  runEstimateWithChartPerDiem,
} from "./per-diem-from-chart";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const chart = {
  men: 4,
  days: 5,
  items: [
    { label: "Hotel", checked: true, price: 1200 },
    { label: "Food", checked: true, price: 800 },
    { label: "Fuel", checked: false, price: 999 },
  ],
};

describe("perDiemChartAddOn", () => {
  it("is the checked items' total; nothing without a chart, when switched off, or at zero", () => {
    expect(perDiemChartAddOn({ customer: { perDiemChart: chart } })).toBe(2000);
    expect(perDiemChartAddOn({ customer: { perDiemChart: chart }, perDiemFromChart: true })).toBe(
      2000,
    );
    expect(perDiemChartAddOn({ customer: { perDiemChart: chart }, perDiemFromChart: false })).toBe(
      0,
    );
    expect(perDiemChartAddOn({ customer: {} })).toBe(0);
    expect(perDiemChartAddOn({})).toBe(0);
    expect(
      perDiemChartAddOn({
        customer: {
          perDiemChart: { ...chart, items: [{ label: "Hotel", checked: false, price: 5 }] },
        },
      }),
    ).toBe(0);
  });
});

describe("perDiemRateWithChart", () => {
  it("adds the chart total spread over the man-days to the hand rate (float32, as the Review calculator)", () => {
    const f32 = Math.fround;
    expect(perDiemRateWithChart(0, 2000, 40)).toBe(f32(2000 / 40));
    expect(perDiemRateWithChart(25, 2000, 40)).toBe(f32(f32(25) + f32(f32(2000) / f32(40))));
    expect(perDiemRateWithChart(25, 0, 40)).toBe(25);
    expect(perDiemRateWithChart(25, 2000, 0)).toBe(25);
  });
});

describe("runEstimateWithChartPerDiem", () => {
  // A stand-in engine: man-days fixed at 40; the charge = rate × man-days.
  const build = (b: { perDiem: number }) => ({ inputs: b });
  const compute = (bu: { inputs: { perDiem: number } }) => ({
    money: { totalManDays: 40, perDiemValue: Math.fround(bu.inputs.perDiem) * 40 },
  });
  it("runs twice and the charge carries hand rate × man-days + the chart total", () => {
    const out = runEstimateWithChartPerDiem(
      { perDiem: 25 },
      { customer: { perDiemChart: chart } },
      build,
      compute,
    );
    expect(out.chartAddOn).toBe(2000);
    expect(out.bid.perDiem).toBeCloseTo(75, 5);
    expect(out.r.money.perDiemValue).toBeCloseTo(25 * 40 + 2000, 2);
  });
  it("runs once when the chart adds nothing or there are no man-days", () => {
    let calls = 0;
    const counting = (bu: { inputs: { perDiem: number } }) => {
      calls++;
      return compute(bu);
    };
    const off = runEstimateWithChartPerDiem(
      { perDiem: 25 },
      { customer: { perDiemChart: chart }, perDiemFromChart: false },
      build,
      counting,
    );
    expect([off.chartAddOn, off.bid.perDiem, calls]).toEqual([0, 25, 1]);
    calls = 0;
    const noDays = runEstimateWithChartPerDiem(
      { perDiem: 25 },
      { customer: { perDiemChart: chart } },
      build,
      () => ({ money: { totalManDays: 0, perDiemValue: 0 } }),
    );
    expect([noDays.chartAddOn, noDays.bid.perDiem]).toEqual([0, 25]);
  });
});

describe("the wiring", () => {
  it("the estimator, the proposal and the BAX import all run through it; the flag is saved and hydrated", () => {
    const est = read("../routes/estimate.tsx");
    expect(est).toContain("runEstimateWithChartPerDiem(");
    expect(est).toContain("setPerDiemFromChart(d.perDiemFromChart ?? true)");
    expect(est).toMatch(/perDiemInMarkup,\s*perDiemFromChart,/);
    expect(est).toContain("Add the chart&apos;s total to the Per-Diem Charge on Review");
    expect(est).toContain("chartAddOn: result.perDiemChartAddOn");
    expect(read("../routes/proposal.tsx")).toContain("runEstimateWithChartPerDiem(");
    expect(read("../components/import-bax-dialog.tsx")).toContain("runEstimateWithChartPerDiem(");
    expect(read("./proposal-bid.ts")).toContain("perDiemFromChart?: boolean;");
    expect(read("../components/estimate-review-ledger.tsx")).toContain("from the per diem chart");
  });
});

/**
 * The Margin report's charts and comparison (owner, Oct 21: "add some charts to track over time
 * with the ability to compare months/years"; "keep it before tax").
 *
 *  pure      lib/margin-report.ts — every month of the range as a chart point (zero where nothing
 *            was invoiced), "Oct 26" ticks, the top 10 groups by margin with the rest folded into
 *            Others.
 *            lib/margin-compare.ts — the Compare presets' ranges from today's date, the month
 *            alignment rule, the change math (percent points for margin %), the compared rows
 *            and chart series.
 *  component components/margin-charts.tsx — pinned to its source: the shadcn chart wrapper with
 *            a ChartConfig whose colours are theme pairs from the validated palette or theme
 *            tokens, never a hard-coded light colour; a legend and tooltip on every chart; no
 *            second y-axis; the horizontal bars when grouped by customer or technician.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  COMPARE_LABELS,
  COMPARE_MODES,
  alignMonths,
  compareMargin,
  comparePreset,
  comparedGroupBars,
  comparedMonthSeries,
  deltaOf,
  ptsDelta,
  shiftYears,
} from "@/lib/margin-compare";
import {
  aggregateMargin,
  marginPctDomain,
  marginPctTicks,
  monthSeries,
  monthsBetween,
  shortMonthLabel,
  toMarginInvoiceRow,
  topByMargin,
  type MarginInvoiceIn,
  type MarginReportResult,
  type MarginRow,
} from "@/lib/margin-report";

const read = (p: string) => readFileSync(p, "utf8");

const inv = (over: Partial<MarginInvoiceIn> & { id: string }): MarginInvoiceIn => ({
  kind: "service",
  number: over.id,
  day: "2026-10-05",
  status: "paid",
  subtotal: 1000,
  customer: "Acme",
  technician: "Tom Tech",
  technicianId: "tom",
  ticket: true,
  hours: 4,
  material: 100,
  labor: 200,
  other: 0,
  purchaseOrders: 0,
  ...over,
});

const result = (
  from: string,
  to: string,
  invoices: MarginInvoiceIn[],
  groupBy: MarginReportResult["groupBy"] = "month",
  comparison?: { from: string; to: string; invoices: MarginInvoiceIn[] },
): MarginReportResult => ({
  from,
  to,
  groupBy,
  source: "both",
  bidsWithoutFigures: [],
  generatedAt: "2026-10-21T15:00:00.000Z",
  invoices: invoices.map(toMarginInvoiceRow),
  ...aggregateMargin(invoices, groupBy),
  ...(comparison
    ? {
        comparison: {
          from: comparison.from,
          to: comparison.to,
          invoices: comparison.invoices.map(toMarginInvoiceRow),
          ...aggregateMargin(comparison.invoices, groupBy),
        },
      }
    : {}),
});

// ---- chart data ---------------------------------------------------------------------------

describe("monthsBetween and the month ticks", () => {
  it("every month from the range's first to its last, chronological, across a year boundary", () => {
    expect(monthsBetween("2025-11-01", "2026-02-15")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(monthsBetween("2026-10-03", "2026-10-21")).toEqual(["2026-10"]);
    expect(monthsBetween("2026-10-03", "2026-09-21")).toEqual([]);
  });
  it('ticks read "Oct 26"', () => {
    expect(shortMonthLabel("2026-10")).toBe("Oct 26");
    expect(shortMonthLabel("2025-01")).toBe("Jan 25");
  });
});

describe("monthSeries: one point per month of the range, zero where nothing was invoiced", () => {
  it("aggregates the per-invoice rows by month, chronological, with the cost mix", () => {
    const rows = [
      inv({ id: "a", day: "2026-09-15", subtotal: 1000, material: 100, labor: 200, other: 5 }),
      inv({ id: "b", day: "2026-09-20", subtotal: 500, material: 0, labor: 0, purchaseOrders: 50 }),
      inv({ id: "c", day: "2026-11-02", subtotal: 100, material: 0, labor: 0 }),
    ].map(toMarginInvoiceRow);
    const s = monthSeries(rows, "2026-08-01", "2026-11-30");
    expect(
      s.map((p) => [p.key, p.label, p.invoices, p.revenue, p.cost, p.margin, p.marginPct]),
    ).toEqual([
      ["2026-08", "Aug 26", 0, 0, 0, 0, null],
      ["2026-09", "Sep 26", 2, 1500, 355, 1145, 76.3],
      ["2026-10", "Oct 26", 0, 0, 0, 0, null],
      ["2026-11", "Nov 26", 1, 100, 0, 100, 100],
    ]);
    expect(s[1]).toMatchObject({ material: 100, labor: 200, other: 5, purchaseOrders: 50 });
    expect(monthSeries([], "2026-10-01", "2026-10-31")).toEqual([
      expect.objectContaining({ key: "2026-10", invoices: 0, revenue: 0 }),
    ]);
  });
});

describe("topByMargin: the top 10 groups, the rest folded into Others", () => {
  const rows = (n: number): MarginRow[] =>
    aggregateMargin(
      Array.from({ length: n }, (_, i) =>
        inv({
          id: `i${i}`,
          customer: `Customer ${String(i).padStart(2, "0")}`,
          subtotal: 1000 - i * 10,
          material: 0,
          labor: 0,
          hours: 1,
        }),
      ),
      "customer",
    ).rows;
  it("ten or fewer rows come back as they are", () => {
    expect(topByMargin(rows(10)).map((r) => r.label)).toHaveLength(10);
    expect(topByMargin(rows(3))).toEqual(rows(3));
    expect(topByMargin([])).toEqual([]);
  });
  it("past ten, the tail is one Others row with the summed figures", () => {
    const top = topByMargin(rows(13));
    expect(top).toHaveLength(11);
    expect(top.slice(0, 10).map((r) => r.label)).toEqual(
      rows(13)
        .slice(0, 10)
        .map((r) => r.label),
    );
    const others = top[10]!;
    expect(others.key).toBe("others");
    expect(others.label).toBe("Others");
    expect(others.invoices).toBe(3);
    expect(others.hours).toBe(3);
    expect(others.revenue).toBe(900 + 890 + 880);
    expect(others.margin).toBe(2670);
    expect(others.marginPct).toBe(100);
    expect(others.avgRevenue).toBe(890);
  });
});

// ---- compare: presets ---------------------------------------------------------------------

describe("the Compare select's modes", () => {
  it("Off, this year vs last year, this month vs the same month last year, Custom", () => {
    expect([...COMPARE_MODES]).toEqual(["off", "year", "month", "custom"]);
    expect(COMPARE_LABELS).toEqual({
      off: "Off",
      year: "This year vs last year",
      month: "This month vs same month last year",
      custom: "Custom",
    });
  });
});

describe("shiftYears: the same day a year earlier, clamped to the month's length", () => {
  it("plain days, February 29 and year boundaries", () => {
    expect(shiftYears("2026-10-21", -1)).toBe("2025-10-21");
    expect(shiftYears("2028-02-29", -1)).toBe("2027-02-28");
    expect(shiftYears("2027-02-28", 1)).toBe("2028-02-28");
    expect(shiftYears("2026-01-01", -1)).toBe("2025-01-01");
    expect(shiftYears("2026-12-31", -1)).toBe("2025-12-31");
    expect(shiftYears("2000-02-29", -4)).toBe("1996-02-29");
    expect(shiftYears("2000-02-29", -1)).toBe("1999-02-28");
  });
});

describe("comparePreset: the ranges from today's local date", () => {
  it("this year vs last year: Jan 1 to today, against Jan 1 to the same day last year", () => {
    expect(comparePreset("year", "2026-10-21")).toEqual({
      from: "2026-01-01",
      to: "2026-10-21",
      compare: { from: "2025-01-01", to: "2025-10-21" },
    });
    expect(comparePreset("year", "2026-01-01")).toEqual({
      from: "2026-01-01",
      to: "2026-01-01",
      compare: { from: "2025-01-01", to: "2025-01-01" },
    });
    expect(comparePreset("year", "2026-12-31")).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
      compare: { from: "2025-01-01", to: "2025-12-31" },
    });
    // A leap day: last year's February has no 29th.
    expect(comparePreset("year", "2028-02-29")).toEqual({
      from: "2028-01-01",
      to: "2028-02-29",
      compare: { from: "2027-01-01", to: "2027-02-28" },
    });
  });
  it("this month vs the same month last year: the 1st to today, against the 1st to the same day a year earlier", () => {
    expect(comparePreset("month", "2026-10-21")).toEqual({
      from: "2026-10-01",
      to: "2026-10-21",
      compare: { from: "2025-10-01", to: "2025-10-21" },
    });
    // January: the same month last year is last January, not December.
    expect(comparePreset("month", "2026-01-15")).toEqual({
      from: "2026-01-01",
      to: "2026-01-15",
      compare: { from: "2025-01-01", to: "2025-01-15" },
    });
    expect(comparePreset("month", "2028-02-29")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
      compare: { from: "2027-02-01", to: "2027-02-28" },
    });
    expect(comparePreset("month", "2027-02-28")).toEqual({
      from: "2027-02-01",
      to: "2027-02-28",
      compare: { from: "2026-02-01", to: "2026-02-28" },
    });
  });
});

// ---- compare: alignment -------------------------------------------------------------------

describe("alignMonths: the rule", () => {
  it("ranges of the same length pair month by month from the start (Jan over Jan when a year apart)", () => {
    const m = alignMonths(
      monthsBetween("2026-01-01", "2026-10-21"),
      monthsBetween("2025-01-01", "2025-10-21"),
    );
    expect(m.get("2026-01")).toBe("2025-01");
    expect(m.get("2026-10")).toBe("2025-10");
    // Positional even when the months of the year differ (a custom comparison of two quarters).
    const q = alignMonths(["2026-07", "2026-08", "2026-09"], ["2026-04", "2026-05", "2026-06"]);
    expect([...q.entries()]).toEqual([
      ["2026-07", "2026-04"],
      ["2026-08", "2026-05"],
      ["2026-09", "2026-06"],
    ]);
  });
  it("ranges of different lengths pair by month of the year where any month finds one; the rest stay unpaired", () => {
    const m = alignMonths(["2026-09", "2026-10"], monthsBetween("2025-06-01", "2025-12-31"));
    expect([...m.entries()]).toEqual([
      ["2026-09", "2025-09"],
      ["2026-10", "2025-10"],
    ]);
    const partial = alignMonths(
      ["2026-05", "2026-06", "2026-07"],
      ["2025-06", "2025-07", "2025-08", "2025-09"],
    );
    expect([...partial.entries()]).toEqual([
      ["2026-05", null],
      ["2026-06", "2025-06"],
      ["2026-07", "2025-07"],
    ]);
    // An earlier range of more than a year: the first month of that name.
    const long = alignMonths(["2026-03"], monthsBetween("2024-01-01", "2025-12-31"));
    expect(long.get("2026-03")).toBe("2024-03");
  });
  it("when no month of the year matches, the months pair by position; leftovers stay unpaired", () => {
    const m = alignMonths(["2026-09", "2026-10", "2026-11"], ["2025-01", "2025-02"]);
    expect([...m.entries()]).toEqual([
      ["2026-09", "2025-01"],
      ["2026-10", "2025-02"],
      ["2026-11", null],
    ]);
    expect([...alignMonths(["2026-09"], []).entries()]).toEqual([["2026-09", null]]);
    expect(alignMonths([], ["2025-01"]).size).toBe(0);
  });
});

describe("the change math", () => {
  it("amount and percent of the earlier figure; no percent against zero; one decimal", () => {
    expect(deltaOf(120, 100)).toEqual({ amount: 20, pct: 20 });
    expect(deltaOf(80, 100)).toEqual({ amount: -20, pct: -20 });
    expect(deltaOf(1234.5, 1000)).toEqual({ amount: 234.5, pct: 23.5 });
    expect(deltaOf(5, 0)).toEqual({ amount: 5, pct: null });
    expect(deltaOf(0, 0)).toEqual({ amount: 0, pct: null });
    // Against a loss, the percent is of the loss's size, so a recovery reads positive.
    expect(deltaOf(50, -100)).toEqual({ amount: 150, pct: 150 });
    expect(deltaOf(1, 3)).toEqual({ amount: -2, pct: -66.7 });
  });
  it("margin % changes in percentage points, blank when either side is blank", () => {
    expect(ptsDelta(45.4, 40.1)).toBe(5.3);
    expect(ptsDelta(30, 32.5)).toBe(-2.5);
    expect(ptsDelta(null, 40)).toBeNull();
    expect(ptsDelta(40, null)).toBeNull();
    expect(ptsDelta(33.3, 33.3)).toBe(0);
  });
});

describe("compareMargin: the earlier figures beside each row and the totals", () => {
  const cur = [
    inv({ id: "a", day: "2026-10-02", subtotal: 1234.5, material: 100, labor: 200 }),
    inv({ id: "b", day: "2026-09-02", subtotal: 0, material: 40, labor: 0 }),
  ];
  it("off: nothing to compare", () => {
    expect(compareMargin(result("2026-09-01", "2026-10-31", cur))).toBeNull();
  });
  it("by month: aligned by the rule; a month with nothing invoiced earlier compares against zero", () => {
    const r = result("2026-09-01", "2026-10-31", cur, "month", {
      from: "2025-09-01",
      to: "2025-10-31",
      invoices: [inv({ id: "p", day: "2025-10-10", subtotal: 1000, material: 100, labor: 100 })],
    });
    const c = compareMargin(r)!;
    const oct = c.rows.get("2026-10")!;
    expect(oct.earlierLabel).toBe("Oct 2025");
    expect(oct.earlier).toMatchObject({ revenue: 1000, cost: 200, margin: 800, marginPct: 80 });
    expect(oct.revenue).toEqual({ amount: 234.5, pct: 23.5 });
    expect(oct.cost).toEqual({ amount: 100, pct: 50 });
    expect(oct.margin).toEqual({ amount: 134.5, pct: 16.8 });
    expect(oct.marginPct).toBe(-4.3);
    const sep = c.rows.get("2026-09")!;
    expect(sep.earlierLabel).toBe("Sep 2025");
    expect(sep.earlier).toMatchObject({
      invoices: 0,
      revenue: 0,
      cost: 0,
      margin: 0,
      marginPct: null,
    });
    expect(sep.cost).toEqual({ amount: 40, pct: null });
    expect(sep.marginPct).toBeNull();
    expect(c.totals.earlier).toMatchObject({ revenue: 1000, margin: 800 });
    expect(c.totals.revenue).toEqual({ amount: 234.5, pct: 23.5 });
    expect(c.totals.marginPct).toBe(-7.5); // 72.5 − 80
  });
  it("by month with no earlier month to pair: the row has no comparison", () => {
    const r = result("2026-09-01", "2026-11-30", cur, "month", {
      from: "2025-01-01",
      to: "2025-02-28",
      invoices: [],
    });
    const c = compareMargin(r)!;
    // Three months against two with no month of the year in common: by position.
    expect(c.rows.get("2026-09")!.earlierLabel).toBe("Jan 2025");
    expect(c.rows.get("2026-10")!.earlierLabel).toBe("Feb 2025");
    expect(c.rows.get("2026-09")!.earlier).toMatchObject({ revenue: 0 });
  });
  it("by customer or technician: matched by key; a new group has no earlier figures", () => {
    const r = result(
      "2026-09-01",
      "2026-10-31",
      [
        inv({ id: "a", customer: "Acme", subtotal: 500, material: 0, labor: 100 }),
        inv({ id: "b", customer: "New Co", subtotal: 300, material: 0, labor: 0 }),
      ],
      "customer",
      {
        from: "2025-09-01",
        to: "2025-10-31",
        invoices: [
          inv({ id: "p", customer: "Acme", subtotal: 400, material: 0, labor: 100 }),
          inv({ id: "q", customer: "Gone Co", subtotal: 50, material: 0, labor: 0 }),
        ],
      },
    );
    const c = compareMargin(r)!;
    const acme = c.rows.get("Acme")!;
    expect(acme.earlierLabel).toBe("Acme");
    expect(acme.earlier).toMatchObject({ revenue: 400, margin: 300 });
    expect(acme.revenue).toEqual({ amount: 100, pct: 25 });
    expect(acme.margin).toEqual({ amount: 100, pct: 33.3 });
    expect(acme.marginPct).toBe(5); // 80 − 75
    const fresh = c.rows.get("New Co")!;
    expect(fresh.earlier).toBeNull();
    expect(fresh.earlierLabel).toBeNull();
    expect(fresh.revenue).toBeNull();
    expect(fresh.marginPct).toBeNull();
    expect(c.rows.has("Gone Co")).toBe(false);
    expect(c.totals.earlier).toMatchObject({ revenue: 450 });
  });
});

describe("the chart series with a comparison", () => {
  it("comparedMonthSeries: every month of the current range with the aligned earlier revenue, margin and margin %", () => {
    const r = result(
      "2026-09-01",
      "2026-10-31",
      [inv({ id: "a", day: "2026-10-02", subtotal: 1200, material: 200, labor: 0 })],
      "month",
      {
        from: "2025-09-01",
        to: "2025-10-31",
        invoices: [
          inv({ id: "p", day: "2025-09-10", subtotal: 800, material: 0, labor: 200 }),
          inv({ id: "q", day: "2025-10-10", subtotal: 1000, material: 100, labor: 100 }),
        ],
      },
    );
    expect(
      comparedMonthSeries(r).map((p) => [
        p.key,
        p.label,
        p.revenue,
        p.margin,
        p.earlierKey,
        p.earlierRevenue,
        p.earlierMargin,
        p.earlierMarginPct,
      ]),
    ).toEqual([
      ["2026-09", "Sep 26", 0, 0, "2025-09", 800, 600, 75],
      ["2026-10", "Oct 26", 1200, 1000, "2025-10", 1000, 800, 80],
    ]);
  });
  it("comparedMonthSeries without a comparison: the earlier fields are null", () => {
    const r = result("2026-10-01", "2026-10-31", [inv({ id: "a" })]);
    expect(comparedMonthSeries(r)).toEqual([
      expect.objectContaining({
        key: "2026-10",
        revenue: 1000,
        earlierKey: null,
        earlierRevenue: null,
        earlierMargin: null,
        earlierMarginPct: null,
      }),
    ]);
  });
  it("comparedGroupBars: the top 10 by margin with Others, each with the earlier margin by key (Others: the earlier rows outside the top)", () => {
    const cur = Array.from({ length: 12 }, (_, i) =>
      inv({
        id: `i${i}`,
        customer: `C${String(i).padStart(2, "0")}`,
        subtotal: 1000 - i,
        material: 0,
        labor: 0,
      }),
    );
    const earlier = [
      inv({ id: "p0", customer: "C00", subtotal: 900, material: 0, labor: 0 }),
      inv({ id: "p11", customer: "C11", subtotal: 50, material: 0, labor: 0 }),
      inv({ id: "pz", customer: "Gone Co", subtotal: 25, material: 0, labor: 0 }),
    ];
    const r = result("2026-09-01", "2026-10-31", cur, "customer", {
      from: "2025-09-01",
      to: "2025-10-31",
      invoices: earlier,
    });
    const bars = comparedGroupBars(r);
    expect(bars).toHaveLength(11);
    expect(bars[0]).toMatchObject({ key: "C00", margin: 1000, earlierMargin: 900 });
    expect(bars[1]).toMatchObject({ key: "C01", margin: 999, earlierMargin: null });
    expect(bars[10]).toMatchObject({
      key: "others",
      label: "Others",
      margin: 990 + 989,
      earlierMargin: 75,
    });
    // Without a comparison, no earlier margin.
    expect(comparedGroupBars(result("2026-09-01", "2026-10-31", cur, "customer"))[0]).toMatchObject(
      {
        key: "C00",
        earlierMargin: null,
      },
    );
  });
});

// ---- the charts component, pinned to its source -------------------------------------------

describe("marginPctDomain: the margin % axis always shows 0 and is never zoomed onto one value", () => {
  // Owner, Oct 21: one month invoiced at about -1 % made the axis run -1 % to -5 % with nothing
  // drawn on it.
  it("one slightly negative month: from a little under 0 up to 10", () => {
    expect(marginPctDomain([null, null, -1.2])).toEqual([-5, 10]);
  });
  it("positive months: 0 up to the next 5 above the top; nothing yet: 0 to 10", () => {
    expect(marginPctDomain([42.3, 51])).toEqual([0, 55]);
    expect(marginPctDomain([null, null])).toEqual([0, 10]);
    expect(marginPctDomain([])).toEqual([0, 10]);
  });
  it("a deep loss: down to the next 5 under it, still up to 10", () => {
    expect(marginPctDomain([-37, 3])).toEqual([-40, 10]);
  });
  it("marginPctTicks: round steps, at most seven labels, always through 0", () => {
    expect(marginPctTicks([-5, 10])).toEqual([-5, 0, 5, 10]);
    expect(marginPctTicks([0, 55])).toEqual([0, 10, 20, 30, 40, 50]);
    expect(marginPctTicks([-40, 10])).toEqual([-40, -30, -20, -10, 0, 10]);
    expect(marginPctTicks([0, 10])).toEqual([0, 5, 10]);
  });
});

describe("components/margin-charts.tsx", () => {
  const src = read("src/components/margin-charts.tsx");
  it("exports MarginCharts and draws with the shadcn chart wrapper", () => {
    expect(src).toContain("export function MarginCharts(");
    expect(src).toMatch(/import \{[^}]*ChartContainer[^}]*\} from "@\/components\/ui\/chart";/s);
    expect(src).toContain("ChartTooltip");
    expect(src).toContain("ChartTooltipContent");
    expect(src).toContain("ChartLegend");
    expect(src).toContain("ChartLegendContent");
    expect(src).toContain("satisfies ChartConfig");
  });
  it("the ChartConfig's colours are light/dark theme pairs from the validated palette or theme tokens — never a hard-coded light colour", () => {
    const configs = [
      ...src.matchAll(/theme:\s*\{\s*light:\s*"(#[0-9a-f]{6})",\s*dark:\s*"(#[0-9a-f]{6})"\s*\}/g),
    ];
    expect(configs.length).toBeGreaterThanOrEqual(3);
    // The dataviz palette's first three slots, light and dark steps (validated in both modes).
    const allowed = new Set(["#2a78d6/#3987e5", "#eb6834/#d95926", "#1baf7a/#199e70"]);
    for (const m of configs) expect(allowed.has(`${m[1]}/${m[2]}`)).toBe(true);
    // Grey series (Other, the earlier period) take the theme's muted token.
    expect(src).toContain('color: "var(--muted-foreground)"');
    // No single-value hex colours, no colour classes with a hex, no fill="#…".
    expect(src).not.toMatch(/color:\s*"#/);
    expect(src).not.toMatch(/(fill|stroke)="#/);
    expect(src).not.toMatch(/(bg|text|border)-\[#/);
    expect(src).not.toMatch(/(?<![\w:-])(bg-white|text-black|bg-gray-\d|bg-slate-\d)/);
  });
  it("one y-axis per chart: margin % has its own small chart under the bars, never a second axis", () => {
    expect(src).not.toMatch(/yAxisId="right"/);
    expect(src).not.toMatch(/orientation="right"/);
    expect(src).toContain("Margin %");
    expect(src).toContain("By month");
    expect(src).toContain("Cost mix");
  });
  it("by customer or technician: horizontal bars of margin per group, top 10 with Others; the cost mix stays by month", () => {
    expect(src).toContain('layout="vertical"');
    expect(src).toContain("comparedGroupBars(");
    expect(src).toContain("comparedMonthSeries(");
    expect(src).toContain("monthSeries(");
  });
  it("marks: thin rounded bars, 2px lines, the earlier period faded; ticks like Oct 26; accessible", () => {
    expect(src).toContain("maxBarSize={24}");
    expect(src).toContain("strokeWidth={2}");
    expect(src).toContain("fillOpacity={0.45}");
    expect(src).toContain("accessibilityLayer");
    expect(src).not.toMatch(/strokeDasharray="3 3"/); // no dashed gridlines
    expect(src).toContain("shortMonthLabel");
  });
  it("margin %: a dot on every month (one month alone still shows), the axis from marginPctDomain, a 0 % line", () => {
    expect(src).toContain("marginPctDomain(");
    expect(src).toContain("ticks={marginPctTicks(");
    expect(src).toContain("<ReferenceLine y={0}");
    expect(src).not.toMatch(/dataKey="marginPct"[\s\S]{0,200}dot=\{false\}/);
    expect(src).toMatch(/dataKey="marginPct"[\s\S]{0,300}dot=\{\{ r: /);
  });
  it("renders nothing when there are no invoices (the report shows the empty line)", () => {
    expect(src).toContain("if (invoices.length === 0) return null;");
  });
});

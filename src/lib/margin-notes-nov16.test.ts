/**
 * Owner, Nov 16: "on the cost mix by month, what does other contain? also on the monthly
 * breakdown what does avg/item mean" … "add a hover note for both please".
 *
 * The notes say what the code counts: Other is the lines that are not material, labor or travel
 * (lineCosts) and, for a won bid, warranty + shipping + per diem + commission (bid-figures.ts);
 * the average is revenue over the row's count (groupMargins). So the notes are tested against
 * those rules, not only for being on the page.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bidFigures } from "@/lib/bid-figures";
import {
  aggregateMargin,
  lineCosts,
  MARGIN_AVG_LABELS,
  MARGIN_AVG_NOTES,
  MARGIN_OTHER_NOTE,
  MARGIN_SOURCES,
  type MarginInvoiceIn,
} from "@/lib/margin-report";

const read = (p: string) => readFileSync(p, "utf8");

describe("the Other note", () => {
  it("names what Other holds on a bid and on an invoice", () => {
    expect(MARGIN_OTHER_NOTE).toContain("warranty, shipping, per diem and commission");
    expect(MARGIN_OTHER_NOTE).toContain("lines whose type is Other");
    expect(MARGIN_OTHER_NOTE).toContain("not material, labor and travel, or a purchase order");
  });
  it("is true of an invoice: only the lines that are not material, labor or travel", () => {
    const c = lineCosts([
      { kind: "material", cost_total: 200 },
      { kind: "labor", cost_total: 120, qty: 4 },
      { kind: "travel", cost_total: 30, qty: 1 },
      { kind: "other", cost_total: 50 },
    ]);
    expect(c).toEqual({ material: 200, labor: 150, other: 50, hours: 5 });
  });
  it("is true of a bid: warranty (d5) + shipping (d9) + per diem (d17) + commission (d18)", () => {
    const d: number[] = [];
    d[4] = 1000; // Duro-Last material
    d[5] = 300; // warranty
    d[6] = 50;
    d[7] = 25;
    d[9] = 200; // shipping
    d[10] = 700;
    d[11] = 100;
    d[17] = 40; // per diem
    d[18] = 60; // commission
    const f = bidFigures({
      laborSubtotal1Hours: 12,
      money: { dTotals: d, grandTotal: 3000, taxCharged: 100 },
    } as never);
    expect(f.other).toBe(600);
    expect(f.material).toBe(1075);
    expect(f.labor).toBe(800);
    expect(f.revenue).toBe(2900);
  });
  it("sits on the table heading and on the cost mix legend, on Other only", () => {
    const table = read("src/components/margin-report.tsx");
    expect(table).toMatch(/title=\{MARGIN_OTHER_NOTE\} data-note="other">\s*Other\s*<\/span>/);
    const charts = read("src/components/margin-charts.tsx");
    expect(charts).toContain("<ChartLegend content={<CostMixLegend />} />");
    expect(charts).toContain("title={noted ? MARGIN_OTHER_NOTE : undefined}");
    expect(charts).toContain('const noted = key === "other";');
  });
});

describe("the average note", () => {
  it("each Include has its own words, matching its heading", () => {
    expect(Object.keys(MARGIN_AVG_NOTES).sort()).toEqual([...MARGIN_SOURCES].sort());
    expect(MARGIN_AVG_LABELS.both).toBe("Avg / item");
    expect(MARGIN_AVG_NOTES.both).toContain("An item is one invoice or one won bid");
    expect(MARGIN_AVG_NOTES.service).toContain("number of invoices");
    expect(MARGIN_AVG_NOTES.bids).toContain("number of won bids");
    for (const s of MARGIN_SOURCES)
      expect(MARGIN_AVG_NOTES[s]).toMatch(/^Revenue before tax, divided by/);
  });
  it("is what the report computes: revenue over the count, an invoice and a won bid each one item", () => {
    const row = (over: Partial<MarginInvoiceIn>): MarginInvoiceIn => ({
      id: "a",
      kind: "service",
      number: "6001",
      day: "2026-11-05",
      status: "paid",
      subtotal: 1000,
      customer: "Made Up Customer",
      technician: "Ted",
      technicianId: "t1",
      ticket: true,
      hours: 4,
      material: 100,
      labor: 200,
      other: 50,
      purchaseOrders: 0,
      ...over,
    });
    const r = aggregateMargin(
      [
        row({}),
        row({ id: "b", subtotal: 500 }),
        row({ id: "c", kind: "bid", status: "won", subtotal: 9000 }),
      ],
      "month",
    );
    expect(r.rows).toHaveLength(1);
    // 10,500 of revenue over three items.
    expect(r.rows[0]).toMatchObject({ invoices: 3, revenue: 10500, avgRevenue: 3500, other: 150 });
    expect(r.totals.avgRevenue).toBe(3500);
    // Nothing counted: blank, never a division by zero.
    expect(aggregateMargin([], "month").totals.avgRevenue).toBeNull();
  });
  it("sits on the average heading", () => {
    expect(read("src/components/margin-report.tsx")).toMatch(
      /title=\{MARGIN_AVG_NOTES\[d\.source\]\} data-note="avg">\s*\{MARGIN_AVG_LABELS\[d\.source\]\}/,
    );
  });
});

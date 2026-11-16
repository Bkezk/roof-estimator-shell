/**
 * Owner, Nov 16, on two margin figures that read differently in two places: "which would be
 * most accurate?" … "go for both".
 *
 * 1. A won bid in the Margin report. Sales tax PAID on materials (a bid priced with tax on
 *    material only) is a cost of the job and part of the price the customer pays, so it counts
 *    as revenue and as material cost. The margin in dollars does not move; the margin % becomes
 *    the one the bid was priced at (a bid priced at 30% gross profit read 30.7%). Sales tax
 *    CHARGED on top of the price is still left out of both sides: it is passed on.
 * 2. The invoice page's "Internal — cost and margin" fold. Margin is the subtotal BEFORE tax
 *    less the cost, the Margin report's figure for the same invoice. It used to come off the
 *    total with tax, so a taxed invoice read higher by the tax collected.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { asBidFigures, bidFigures, bidMaterialTax, type BidFigures } from "@/lib/bid-figures";
import { computeTotals, storedTotals } from "@/lib/invoice-totals";
import {
  bidToMarginIn,
  toMarginInvoiceRow,
  type MarginBidIn,
  type MarginReportResult,
} from "@/lib/margin-report";
import { listMarginReport } from "@/lib/margin-report.functions";
import { fakeSupabase } from "@/test/fake-supabase";

/**
 * A bid priced with tax on material only, at 30% gross profit: material 3,000, material tax
 * 180 (6%), shipping 500, labor 2,000. Subtotal 1 = 5,680; markup = 30% of the price, so the
 * price is 5,680 / 0.7 = 8,114.29 and the markup 2,434.29. No end-of-chain tax (d19 = 0).
 */
const materialTaxBid = () => {
  const d: number[] = new Array(22).fill(0);
  d[4] = 3000;
  d[8] = 3180; // purchases, the material tax folded in
  d[9] = 500; // shipping
  d[10] = 2000; // labor
  d[13] = 5680;
  d[14] = 2434.29;
  d[16] = 8114.29;
  d[19] = 0;
  d[20] = 8114.29;
  return { laborSubtotal1Hours: 40, money: { dTotals: d, grandTotal: 8114.29, taxCharged: 180 } };
};
/** The same job with sales tax charged to the customer on top instead: 6% of 7,857.14. */
const salesTaxBid = () => {
  const d: number[] = new Array(22).fill(0);
  d[4] = 3000;
  d[8] = 3000;
  d[9] = 500;
  d[10] = 2000;
  d[13] = 5500;
  d[14] = 2357.14;
  d[16] = 7857.14;
  d[19] = 471.43;
  d[20] = 8328.57;
  return {
    laborSubtotal1Hours: 40,
    money: { dTotals: d, grandTotal: 8328.57, taxCharged: 471.43 },
  };
};
const bid = (figures: BidFigures, over: Partial<MarginBidIn> = {}): MarginBidIn => ({
  id: "b1",
  name: "Made Up Bid",
  won_on: "2026-11-10",
  status_changed_at: null,
  updated_at: "2026-11-10T15:00:00Z",
  accountName: "Made Up Customer",
  dataCustomerName: null,
  estimator: "Erin Estimator",
  estimatorId: "e1",
  figures,
  ...over,
});

describe("1. the figures say which tax it was", () => {
  it("tax on material only: all of the tax is material tax", () => {
    const f = bidFigures(materialTaxBid() as never);
    expect(f).toMatchObject({ total: 8114.29, tax: 180, materialTax: 180, revenue: 7934.29 });
    expect(f.material).toBe(3000); // still without the tax: the report adds it
  });
  it("sales tax on top of the price: none of it is", () => {
    const f = bidFigures(salesTaxBid() as never);
    expect(f).toMatchObject({ total: 8328.57, tax: 471.43, materialTax: 0, revenue: 7857.14 });
  });
  it("the stored shape still reads without it (figures saved before Nov 16) and with it", () => {
    const old = { v: 1, revenue: 1, material: 1, labor: 1, other: 1, hours: 1, tax: 1, total: 2 };
    expect(asBidFigures(old)).toEqual(old);
    expect(asBidFigures({ ...old, materialTax: 1 })).toEqual({ ...old, materialTax: 1 });
    expect(asBidFigures({ ...old, materialTax: "1" })).toBeNull();
  });
  it("bidMaterialTax: the stored figure, else the bid's tax mode, else none", () => {
    const f = bidFigures(materialTaxBid() as never);
    const { materialTax: _gone, ...older } = f;
    expect(bidMaterialTax(f, null)).toBe(180);
    expect(bidMaterialTax(f, false)).toBe(180); // the stored figure wins over the mode
    expect(bidMaterialTax(older, true)).toBe(180);
    expect(bidMaterialTax(older, false)).toBe(0);
    expect(bidMaterialTax(older, null)).toBe(0);
    expect(bidMaterialTax(older, undefined)).toBe(0);
    // Never more than the tax, never negative.
    expect(bidMaterialTax({ ...f, materialTax: 999 }, null)).toBe(180);
    expect(bidMaterialTax({ ...f, materialTax: -5 }, null)).toBe(0);
  });
});

describe("1. the report counts material tax as revenue and as material cost", () => {
  it("the bid priced at 30% gross profit reads 30.0%, with the same dollars of margin", () => {
    const row = toMarginInvoiceRow(bidToMarginIn(bid(bidFigures(materialTaxBid() as never))));
    expect(row).toMatchObject({
      revenue: 8114.29, // the whole price the customer pays
      material: 3180, // the tax paid to the supplier is material cost
      labor: 2000,
      other: 500,
      cost: 5680, // the bid's own Subtotal 1
      margin: 2434.29, // the bid's own markup value
      marginPct: 30,
    });
    // What it read before: revenue 7,934.29, cost 5,500, the same margin, 30.7%.
    expect(Math.round((2434.29 / 7934.29) * 1000) / 10).toBe(30.7);
  });
  it("sales tax charged on top stays out of both sides, as before", () => {
    const row = toMarginInvoiceRow(bidToMarginIn(bid(bidFigures(salesTaxBid() as never))));
    expect(row).toMatchObject({
      revenue: 7857.14,
      material: 3000,
      cost: 5500,
      margin: 2357.14,
      marginPct: 30,
    });
  });
  it("figures saved before Nov 16 follow the bid's tax mode", () => {
    const { materialTax: _gone, ...older } = bidFigures(materialTaxBid() as never);
    const known = toMarginInvoiceRow(bidToMarginIn(bid(older, { taxMaterialOnly: true })));
    expect(known).toMatchObject({ revenue: 8114.29, cost: 5680, margin: 2434.29, marginPct: 30 });
    const unknown = toMarginInvoiceRow(bidToMarginIn(bid(older)));
    expect(unknown).toMatchObject({ revenue: 7934.29, cost: 5500, margin: 2434.29 });
  });
});

describe("1. the server reads the bid's tax mode for older figures", () => {
  const ANN = "00000000-0000-4000-8000-0000000000a1";
  const { materialTax: _gone, ...older } = bidFigures(materialTaxBid() as never);
  const wonBid = (id: string, data: Record<string, unknown>) => ({
    id,
    name: `Made Up Bid ${id}`,
    status: "won",
    status_changed_at: "2026-11-10T15:00:00Z",
    updated_at: "2026-11-10T15:00:00Z",
    created_at: "2026-11-01T15:00:00Z",
    account_id: null,
    created_by: null,
    grand_total: 8114.29,
    figures: older,
    won_on: "2026-11-10",
    deleted_at: null,
    data,
  });
  const run = (data: Record<string, unknown>) =>
    (
      listMarginReport as unknown as (a: {
        data: unknown;
        context: unknown;
      }) => Promise<MarginReportResult>
    )({
      data: { from: "2026-11-01", to: "2026-11-30", groupBy: "month", source: "bids" },
      context: {
        supabase: fakeSupabase({
          profiles: [{ id: ANN, role: "admin", access: [], full_name: "Ann", email: "a@x" }],
          bids: [wonBid("11111111-1111-4111-8111-111111111111", data)],
          invoices: [],
          crm_accounts: [],
        }).db,
        userId: ANN,
      },
    });
  it("priced under the company setting (the pricing snapshot): tax on material only", async () => {
    const r = await run({ adminSnapshot: { settings: { taxMaterialOnly: true } } });
    expect(r.totals).toMatchObject({
      revenue: 8114.29,
      cost: 5680,
      margin: 2434.29,
      marginPct: 30,
    });
  });
  it("the bid's own setting wins over the snapshot", async () => {
    const r = await run({
      taxMaterialOnly: false,
      adminSnapshot: { settings: { taxMaterialOnly: true } },
    });
    expect(r.totals).toMatchObject({ revenue: 7934.29, cost: 5500, margin: 2434.29 });
  });
});

describe("2. the invoice page's margin is before tax", () => {
  const lines = [
    { kind: "labor", qty: 4, rate: 75, cost_rate: 30, taxable: false, source: null },
    { kind: "material", qty: 1, rate: 525, cost_rate: 250, taxable: true, source: null },
  ];
  it("a draft: subtotal less cost; the sales tax is not margin", () => {
    const t = computeTotals(lines as never, 0.06, 80);
    expect(t).toMatchObject({ subtotal: 825, tax: 31.5, total: 856.5, cost_total: 450 });
    expect(t.margin).toBe(375); // it read 406.50, the 31.50 of tax counted as margin
    expect(t.perHour).toBeCloseTo(375 / 4, 10);
  });
  it("a final invoice: the stored subtotal less the stored cost and the POs", () => {
    const t = storedTotals(
      { subtotal: "825", tax_amount: "49.50", total: "874.50", cost_total: "400" },
      computeTotals(lines as never, 0.06, 80),
    );
    expect(t).toMatchObject({ subtotal: 825, total: 874.5, cost_total: 480, margin: 345 });
  });
  it("it is the Margin report's figure for the same invoice", () => {
    const fold = storedTotals(
      { subtotal: "825", tax_amount: "49.50", total: "874.50", cost_total: "400" },
      computeTotals(lines as never, 0.06, 80),
    );
    const row = toMarginInvoiceRow({
      id: "i1",
      kind: "service",
      number: "6100",
      day: "2026-11-10",
      status: "paid",
      subtotal: 825,
      customer: "Made Up Customer",
      technician: null,
      technicianId: null,
      ticket: true,
      hours: 5,
      material: 250,
      labor: 150,
      other: 0,
      purchaseOrders: 80,
    });
    expect(row.margin).toBe(fold.margin);
    expect(row.cost).toBe(fold.cost_total);
  });
});

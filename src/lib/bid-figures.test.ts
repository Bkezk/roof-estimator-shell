/**
 * The money figures a bid carries for the Margin report (owner, Oct 21: "do bids that are
 * accepted go into that report? if not please add them"). The estimator computes the engine
 * result in the browser and stores these at every save (bids.figures); the report reads them
 * instead of recomputing (lib/bid-figures.ts has the definitions).
 *
 *  pure      bidFigures from a MoneyResult: revenue before tax, the cost split, hours; margin =
 *            revenue − cost is the markup value whatever the markup mode; a material-only tax is
 *            never in material or revenue; asBidFigures rejects anything that is not v1.
 *  source    the estimator sends `figures` built with bidFigures in its save payload; saveBid
 *            writes the column; the migration adds it; the Database types know it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BID_FIGURES_VERSION,
  asBidFigures,
  bidFigures,
  bidFiguresSchema,
  type BidFigures,
} from "@/lib/bid-figures";
import { computeMoney, type MoneyResult } from "@/lib/engine/money";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * A hand-built chain: material after discounts 1000, warranty 50, underlayment 200, other material
 * 100, shipping 75, direct labor 400, subs 150; markup 20 % of subtotal 1 (1975) = 395; per diem
 * 90 and commission 120 outside the markup; 7 % tax on subtotal 2 + commission.
 */
const money = ({
  dTotals,
  ...over
}: Partial<Omit<MoneyResult, "dTotals">> & { dTotals?: Record<number, number> }): MoneyResult => {
  const d: Record<number, number> = {
    0: 1000,
    1: -50,
    2: 0,
    3: 0,
    4: 1000,
    5: 50,
    6: 200,
    7: 100,
    8: 1350,
    9: 75,
    10: 400,
    11: 150,
    13: 1975,
    14: 395,
    16: 2370,
    17: 90,
    18: 120,
    19: 174.3,
    20: 2754.3,
    21: 2,
    ...dTotals,
  };
  return {
    dTotals: d,
    grandTotal: d[20]!,
    subtotal1: d[13]!,
    markupValue: d[14]!,
    subtotal2: d[16]!,
    commissionValue: d[18]!,
    perDiemValue: d[17]!,
    totalManDays: d[21]!,
    salesTaxValue: d[19]!,
    taxCharged: d[19]!,
    ...over,
  };
};

describe("bidFigures: the estimator's money figures for the Margin report", () => {
  it("total is the bid total, tax what the bid charged, revenue the total BEFORE tax; the cost split; hours", () => {
    const f = bidFigures({ laborSubtotal1Hours: 18, money: money({}) });
    expect(f).toEqual({
      v: 1,
      total: 2754.3,
      tax: 174.3,
      revenue: 2580,
      material: 1300, // d4 + d6 + d7
      labor: 550, // d10 + d11
      other: 335, // warranty 50 + shipping 75 + per diem 90 + commission 120
      hours: 18,
    });
    expect(BID_FIGURES_VERSION).toBe(1);
  });
  it("margin = revenue − cost is the markup value (d14) when nothing is in the markup", () => {
    const f = bidFigures({ laborSubtotal1Hours: 18, money: money({}) });
    expect(f.revenue - (f.material + f.labor + f.other)).toBeCloseTo(395, 2);
  });
  it("a material-only tax is folded into purchases (d8) by the engine: never in material, never in revenue", () => {
    // 7 % on the 1300 of material = 91, inside d8; no end-of-chain tax.
    const m = money({
      dTotals: { 8: 1441, 13: 2066, 14: 413.2, 16: 2479.2, 19: 0, 20: 2689.2 },
      taxCharged: 91,
    });
    const f = bidFigures({ laborSubtotal1Hours: 18, money: m });
    expect(f.material).toBe(1300);
    expect(f.tax).toBe(91);
    expect(f.total).toBe(2689.2);
    expect(f.revenue).toBe(2598.2);
    // Margin is still the markup value: the tax is on neither side.
    expect(f.revenue - (f.material + f.labor + f.other)).toBeCloseTo(413.2, 2);
  });
  it("with per diem and commission IN the markup (the real engine), margin is still the markup value to the cent", () => {
    const r = computeMoney({
      duroLastMaterial: 1000,
      membraneCostBeforeDiscount: 800,
      sqFtTotalMembrane: 10000,
      prepayDiscount: false,
      stdSizeDiscount: false,
      volumeDiscount: false,
      warrantyTotalCost: 50,
      materialUnderlayment: 200,
      otherMaterial: 100,
      shipping: 75,
      laborSubtotal1: 400,
      laborSubtotal2: 150,
      laborSubtotal1Hours: 18,
      hoursPerDay: 9,
      markupMode: 0,
      markup: 20,
      salesTax: 0.07,
      taxMaterialOnly: false,
      taxExempt: false,
      materialTotalBeforeTax: 1300,
      perDiem: 45,
      perDiemInMarkup: true,
      commission: 5,
      commissionInMarkup: true,
    });
    const f = bidFigures({ laborSubtotal1Hours: 18, money: r });
    // The engine's figures carry float noise (2791.259994506836); the stored ones are cents.
    expect(f.total).toBeCloseTo(r.grandTotal, 2);
    expect(f.tax).toBeCloseTo(r.taxCharged, 2);
    expect(f.revenue).toBeCloseTo(r.grandTotal - r.taxCharged, 2);
    expect(f.other).toBeCloseTo(50 + 75 + r.perDiemValue + r.commissionValue, 2);
    expect(f.revenue - (f.material + f.labor + f.other)).toBeCloseTo(r.markupValue, 2);
    // Every figure is cents-rounded.
    for (const v of Object.values(f)) expect(v).toBe(Math.round(v * 100) / 100);
  });
  it("the schema accepts what bidFigures makes and refuses other versions or non-finite numbers", () => {
    const f = bidFigures({ laborSubtotal1Hours: 18, money: money({}) });
    expect(bidFiguresSchema.parse(f)).toEqual(f);
    expect(bidFiguresSchema.safeParse({ ...f, v: 2 }).success).toBe(false);
    expect(bidFiguresSchema.safeParse({ ...f, revenue: Infinity }).success).toBe(false);
    expect(bidFiguresSchema.safeParse({ ...f, hours: "18" }).success).toBe(false);
  });
  it("asBidFigures: the column read back, null for missing, garbage, a wrong shape or another version", () => {
    const f: BidFigures = bidFigures({ laborSubtotal1Hours: 18, money: money({}) });
    expect(asBidFigures(f)).toEqual(f);
    expect(asBidFigures(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(asBidFigures(null)).toBeNull();
    expect(asBidFigures(undefined)).toBeNull();
    expect(asBidFigures("x")).toBeNull();
    expect(asBidFigures({})).toBeNull();
    expect(asBidFigures({ ...f, v: 2 })).toBeNull();
    expect(asBidFigures({ ...f, labor: null })).toBeNull();
    expect(asBidFigures({ ...f, total: NaN })).toBeNull();
  });
});

describe("pinned to the source", () => {
  it("the estimator sends `figures` built with bidFigures in the save payload", () => {
    const src = read("src/routes/estimate.tsx");
    expect(src).toContain('import { bidFigures } from "@/lib/bid-figures";');
    const save = src.indexOf("const row = await saveBidFn({");
    expect(save).toBeGreaterThan(0);
    const payload = src.slice(save, src.indexOf("});", save));
    expect(payload).toContain("figures: result ? bidFigures(result.r) : null,");
  });
  it("saveBid takes `figures` (nullable, optional) and writes the column", () => {
    const fns = read("src/lib/bids.functions.ts");
    expect(fns).toContain("figures: bidFiguresSchema.nullable().optional(),");
    expect(fns).toContain("...(data.figures !== undefined ? { figures: data.figures } : {}),");
  });
  it("the migration adds bids.figures jsonb with a comment; the Database types know the column", () => {
    const sql = read("supabase/migrations/20261021140000_bid_figures.sql");
    expect(sql).toContain("alter table public.bids add column if not exists figures jsonb;");
    expect(sql).toMatch(/comment on column public\.bids\.figures is/);
    expect(sql).toContain("lib/bid-figures.ts");
    const types = read("src/integrations/supabase/types.ts");
    const bids = types.slice(types.indexOf("      bids: {\n        Row: {"));
    const row = bids.slice(0, bids.indexOf("Insert: {"));
    const insert = bids.slice(bids.indexOf("Insert: {"), bids.indexOf("Update: {"));
    const update = bids.slice(bids.indexOf("Update: {"), bids.indexOf("Relationships:"));
    expect(row).toContain("figures: Json | null;");
    expect(insert).toContain("figures?: Json | null;");
    expect(update).toContain("figures?: Json | null;");
  });
});

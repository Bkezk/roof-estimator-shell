import { describe, it, expect } from "vitest";

import {
  savedToBidInput,
  buildBidInput,
  cityStZip,
  effectiveHighWind,
  markupTypeToMode,
  resolveBidComputeData,
  emptyCustomer,
  MAX_WIND_OPTIONS,
  type SavedBidState,
  type WarrantyData,
} from "./proposal-bid";
import type { EngineAdminData } from "./engine/adapters";

const warrantyData: WarrantyData = {
  warranties: [
    { name: "15 + 5 Yr Material & Labor", pricePerSqFt: 0.18, nonMasterEliteSurcharge: 0.03 },
    { name: "10 Yr Ballast", pricePerSqFt: 0, nonMasterEliteSurcharge: 0 },
  ],
  highWind: [{ termYears: 15, windBand: "101-110", mechPerSqFt: 0.13, adheredPerSqFt: 0.14 }],
};

const base = (over: Partial<SavedBidState> = {}): SavedBidState => ({
  roofSystem: "Duro-Last",
  attachment: "mechanical",
  sections: [],
  accessories: [],
  nonDlLines: [],
  customer: emptyCustomer(),
  markupMode: 2,
  markup: 35,
  laborRate: 50,
  commission: 3,
  taxExempt: false,
  ...over,
});

describe("savedToBidInput money controls pass-through", () => {
  it("defaults the optional money controls off when a bid omits them", () => {
    const b = savedToBidInput(base());
    expect(b.prepayDiscount).toBe(false);
    expect(b.stdSizeDiscount).toBe(false);
    expect(b.volumeDiscount).toBe(false);
    expect(b.perDiem).toBe(0);
    expect(b.perDiemInMarkup).toBe(true);
    expect(b.commissionInMarkup).toBe(false);
    expect(b.adjustLaborPct).toBe(0);
  });

  it("passes discounts, per-diem, commission-in-markup and adjust-labor through when set", () => {
    const b = savedToBidInput(
      base({
        prepayDiscount: true,
        stdSizeDiscount: true,
        volumeDiscount: true,
        perDiem: 120,
        perDiemInMarkup: false,
        commissionInMarkup: true,
        adjustLaborPct: 8,
      }),
    );
    expect(b.prepayDiscount).toBe(true);
    expect(b.stdSizeDiscount).toBe(true);
    expect(b.volumeDiscount).toBe(true);
    expect(b.perDiem).toBe(120);
    expect(b.perDiemInMarkup).toBe(false);
    expect(b.commissionInMarkup).toBe(true);
    expect(b.adjustLaborPct).toBe(8);
  });
});

describe("warranty resolution (buildBidInput)", () => {
  it("resolves the selected warranty's $/sqft and non-elite surcharge", () => {
    const b = buildBidInput(base({ warrantyName: "15 + 5 Yr Material & Labor" }), warrantyData);
    expect(b.warrantyCostPerSqFt).toBe(0.18);
    expect(b.warrantyNonEliteMasterCharge).toBe(0.03);
    expect(b.warrantyIsHighWind).toBe(false);
    expect(b.warrantyHighWindUpcharge).toBe(0);
  });

  it("adds the high-wind upcharge by term × band × attachment", () => {
    const mech = buildBidInput(
      base({
        warrantyName: "15 + 5 Yr Material & Labor",
        highWind: true,
        highWindTermYears: 15,
        highWindBand: "101-110",
        attachment: "mechanical",
      }),
      warrantyData,
    );
    expect(mech.warrantyIsHighWind).toBe(true);
    expect(mech.warrantyHighWindUpcharge).toBe(0.13);
    const adhered = buildBidInput(
      base({
        warrantyName: "15 + 5 Yr Material & Labor",
        highWind: true,
        highWindTermYears: 15,
        highWindBand: "101-110",
        attachment: "adhered",
      }),
      warrantyData,
    );
    expect(adhered.warrantyHighWindUpcharge).toBe(0.14);
  });

  it("without warranty data (or a selection) warranty stays 0", () => {
    expect(
      buildBidInput(base({ warrantyName: "15 + 5 Yr Material & Labor" })).warrantyCostPerSqFt,
    ).toBe(0);
    expect(buildBidInput(base(), warrantyData).warrantyCostPerSqFt).toBe(0);
  });
});

describe("markupTypeToMode", () => {
  it("maps the stored preset enums to engine modes; unknown → null", () => {
    expect(markupTypeToMode("percent_cost")).toBe(0);
    expect(markupTypeToMode("dollar_manday")).toBe(1);
    expect(markupTypeToMode("gross_profit")).toBe(2);
    expect(markupTypeToMode("something_else")).toBeNull();
  });
});

describe("resolveBidComputeData (frozen pricing / Update Pricing & Labor)", () => {
  const mkAdmin = (salesTax: number): EngineAdminData => ({
    deckOrder: [],
    priceMatrix: {},
    labor: {},
    settings: {
      hoursPerDay: 9,
      masterEliteCont: true,
      salesTax,
      taxMaterialOnly: true,
      shippingMode: "stepped",
      shippingPercent: 0,
    },
  });
  const frozen = mkAdmin(0.05);
  const live = mkAdmin(0.0625);

  it("a bid with a snapshot computes against it, ignoring live data", () => {
    const cd = resolveBidComputeData(
      {
        adminSnapshot: frozen,
        warrantySnapshot: warrantyData,
        pricingAsOf: "2026-09-01T00:00:00Z",
      },
      live,
      { warranties: [], highWind: [] },
    );
    expect(cd.admin).toBe(frozen);
    expect(cd.warranty).toBe(warrantyData);
    expect(cd.frozenAsOf).toBe("2026-09-01T00:00:00Z");
  });

  it("without a snapshot it computes from live data (frozenAsOf null)", () => {
    const cd = resolveBidComputeData({}, live, warrantyData);
    expect(cd.admin).toBe(live);
    expect(cd.warranty).toBe(warrantyData);
    expect(cd.frozenAsOf).toBeNull();
  });

  it("a pre-warranty-freeze snapshot falls back to live warranty tables", () => {
    const cd = resolveBidComputeData({ adminSnapshot: frozen }, live, warrantyData);
    expect(cd.admin).toBe(frozen);
    expect(cd.warranty).toBe(warrantyData); // fallback, not dropped
    expect(cd.frozenAsOf).toBe("");
  });
});

describe("§17 Home: legacy warranty flags, max wind, per-bid tax", () => {
  const flagged: WarrantyData = {
    warranties: [
      {
        name: "20 Yr High Wind",
        pricePerSqFt: 0.13,
        nonMasterEliteSurcharge: 0,
        reqThickness: 50,
        isHighWind: true,
        termYears: 20,
      },
      {
        name: "15 Yr NDL",
        pricePerSqFt: 0,
        nonMasterEliteSurcharge: 0,
        reqThickness: 40,
        isHighWind: false,
        termYears: 15,
      },
    ],
    highWind: [
      { termYears: 20, windBand: "91-100", mechPerSqFt: 0.13, adheredPerSqFt: 0.14 },
      { termYears: 15, windBand: "91-100", mechPerSqFt: 0.11, adheredPerSqFt: 0.12 },
    ],
  };

  it("the warranty carries IsHighWind + term; the bid only picks Max Expected Wind", () => {
    const b = buildBidInput(
      base({ warrantyName: "20 Yr High Wind", maxWindExpected: 100 }),
      flagged,
    );
    expect(b.warrantyIsHighWind).toBe(true);
    expect(b.warrantyHighWindUpcharge).toBe(0.13); // 20-yr row, 91-100 band, mechanical
    // a saved highWind toggle cannot turn a non-high-wind warranty into one
    const ndl = buildBidInput(
      base({
        warrantyName: "15 Yr NDL",
        highWind: true,
        highWindTermYears: 15,
        maxWindExpected: 100,
      }),
      flagged,
    );
    expect(ndl.warrantyIsHighWind).toBe(false);
    expect(ndl.warrantyHighWindUpcharge).toBe(0);
  });

  it("warranty rows without the flags (older snapshots) fall back to the saved high-wind fields", () => {
    const eff = effectiveHighWind(
      base({
        warrantyName: "15 + 5 Yr Material & Labor",
        highWind: true,
        highWindTermYears: 15,
        highWindBand: "101-110",
      }),
      warrantyData,
    );
    expect(eff).toEqual({ isHighWind: true, termYears: 15, band: "101-110", fromWarranty: false });
  });

  it("MAX_WIND_OPTIONS mirror the legacy cbMaxWind list (label → MaxWindExpected → band)", () => {
    expect(MAX_WIND_OPTIONS.map((o) => o.value)).toEqual([72, 80, 90, 100, 110, 120]);
    expect(MAX_WIND_OPTIONS.map((o) => o.label)).toEqual([
      "55-72 mph",
      "73-80 mph",
      "81-90 mph",
      "91-100 mph",
      "101-110 mph",
      "111-120 mph",
    ]);
  });

  it("per-bid sales tax / tax mode pass through only when set", () => {
    expect(savedToBidInput(base()).salesTaxRate).toBeUndefined();
    expect(savedToBidInput(base()).taxMaterialOnly).toBeUndefined();
    const b = savedToBidInput(base({ salesTaxRate: 0.07, taxMaterialOnly: false }));
    expect(b.salesTaxRate).toBe(0.07);
    expect(b.taxMaterialOnly).toBe(false);
  });

  it("cityStZip joins the parts the way the legacy 'City St, Zip' line reads", () => {
    expect(cityStZip("Saginaw", "MI", "48601")).toBe("Saginaw, MI 48601");
    expect(cityStZip("Saginaw", "", "")).toBe("Saginaw");
    expect(cityStZip("", "MI", "48601")).toBe("MI 48601");
    expect(cityStZip()).toBe("");
  });
});

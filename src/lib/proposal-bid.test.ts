import { describe, it, expect } from "vitest";

import {
  savedToBidInput,
  buildBidInput,
  emptyCustomer,
  type SavedBidState,
  type WarrantyData,
} from "./proposal-bid";

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

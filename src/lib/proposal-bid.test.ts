import { describe, it, expect } from "vitest";

import { savedToBidInput, emptyCustomer, type SavedBidState } from "./proposal-bid";

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

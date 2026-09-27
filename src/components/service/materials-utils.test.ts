import { describe, expect, it } from "vitest";

import {
  amountText,
  matchesSearch,
  onHandText,
  ownFreshEntries,
  packUnitLabel,
  pieceFromLedger,
  planReduce,
  suggestedUnits,
  usedPacks,
  type LedgerRow,
} from "./materials-utils";

const cart = { name: "cartridge", perPack: 12 };
const cell = {
  location_id: "truck-1",
  screen_id: "duro_last:adhesives",
  row_label: "Duro-Fleece Adhesive",
  price_col: "price",
};
const now = Date.parse("2026-09-27T15:00:00Z");
const row = (id: number, qty: number, extra: Partial<LedgerRow> = {}): LedgerRow => ({
  ...cell,
  id,
  qty,
  unit: "case",
  counted_note: null,
  created_by_name: "Sam Tech",
  created_at: new Date(now - id * 60_000).toISOString(),
  ...extra,
});

describe("materials utils", () => {
  it("reads on hand in pieces and packs", () => {
    expect(onHandText(14 / 12, "case", cart)).toBe("14 cartridges · 1.2 cases");
    expect(onHandText(1 / 12, "case", cart)).toBe("1 cartridge · 0.1 cases");
    expect(onHandText(2, "pail", null)).toBe("2 pails");
    expect(onHandText(120, "sq ft", null)).toBe("120 sq ft");
    expect(amountText(3, null, "box")).toBe("3 boxes");
    expect(packUnitLabel(2, "4-Cartridge Case")).toBe("4-Cartridge Cases");
    expect(packUnitLabel(1, "case")).toBe("case");
  });

  it("counts what the ticket used at that truck", () => {
    const rows = [
      row(1, -1 / 12),
      row(2, -0.25),
      row(3, 1 / 12),
      row(4, -1, { location_id: "shop" }),
    ];
    expect(usedPacks(rows, cell) * 12).toBeCloseTo(3, 6);
  });

  it("reads the piece size back from the ledger note", () => {
    expect(pieceFromLedger([row(1, -0.25, { counted_note: "3 cartridges" })], cell)).toEqual(cart);
    expect(pieceFromLedger([row(1, -0.083, { counted_note: "1 cartridge" })], cell)).toEqual(cart);
    expect(pieceFromLedger([row(1, -1)], cell)).toBeNull();
  });

  it("suggests the usual amount rounded up, at least one", () => {
    expect(suggestedUnits(0.17, cart)).toBe(3);
    expect(suggestedUnits(0.25, cart)).toBe(3);
    expect(suggestedUnits(0.01, null)).toBe(1);
    expect(suggestedUnits(2, null)).toBe(2);
  });

  it("finds only my own entries under 24 h, newest first", () => {
    const rows = [
      row(3, -0.25),
      row(1, -1 / 12),
      row(2, -1 / 12, { created_by_name: "Someone Else" }),
      row(5, -1 / 12, { created_at: new Date(now - 25 * 3600_000).toISOString() }),
      row(4, 1 / 12),
    ];
    expect(ownFreshEntries(rows, cell, cart, "Sam Tech", now)).toEqual([
      { id: 1, units: 1 },
      { id: 3, units: 3 },
    ]);
  });

  it("plans a take-back", () => {
    const entries = [
      { id: 1, units: 1 },
      { id: 2, units: 3 },
    ];
    expect(planReduce(entries, 1, false)).toEqual([{ kind: "undo", id: 1, units: 1 }]);
    expect(planReduce(entries, 3, true)).toEqual([{ kind: "undo", id: 2, units: 3 }]);
    expect(planReduce(entries, 2, true)).toEqual([{ kind: "release", units: 2 }]);
    expect(planReduce(entries, 2, false)).toEqual([
      { kind: "undo", id: 1, units: 1 },
      { kind: "undo", id: 2, units: 3 },
      { kind: "consume", units: 2 },
    ]);
    expect(planReduce([{ id: 2, units: 3 }], 1, false)).toEqual([
      { kind: "undo", id: 2, units: 3 },
      { kind: "consume", units: 2 },
    ]);
    expect(planReduce([], 1, false)).toBeNull();
    expect(planReduce(entries, 5, false)).toBeNull();
  });

  it("searches name, category, colour and item #", () => {
    const r = {
      row_label: "Duro-Caulk",
      category: "Sealants",
      price_col: "White",
      item_no: "1106",
    };
    expect(matchesSearch(r, "caulk white")).toBe(true);
    expect(matchesSearch(r, "1106")).toBe(true);
    expect(matchesSearch(r, "tan")).toBe(false);
    expect(matchesSearch(r, "  ")).toBe(true);
  });
});

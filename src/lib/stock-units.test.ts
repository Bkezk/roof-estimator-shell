import { describe, it, expect } from "vitest";

import {
  describeStock,
  displayStock,
  packsFromPieces,
  pieceDefFromPack,
  pieceDefFromUnitType,
} from "./stock-units";

describe("stock units — pieces of a priced pack", () => {
  it("reads the adhesive unit types the catalog carries", () => {
    expect(pieceDefFromUnitType("4-Cartridge Case")).toEqual({ name: "cartridge", perPack: 4 });
    expect(pieceDefFromUnitType("5-gal. Bucket")).toEqual({ name: "gallon", perPack: 5 });
    expect(pieceDefFromUnitType("50-Gal Drum Set")).toEqual({ name: "gallon", perPack: 50 });
    expect(pieceDefFromUnitType("5-gal. Box Set")).toBeNull();
    expect(pieceDefFromUnitType("")).toBeNull();
  });
  it("reads pack columns on row screens", () => {
    expect(pieceDefFromPack("Fasteners/Box", 1000)).toEqual({ name: "fastener", perPack: 1000 });
    expect(pieceDefFromPack("Parts/Bag", 25)).toEqual({ name: "part", perPack: 25 });
    expect(pieceDefFromPack("Parts/Bag", null)).toBeNull();
    expect(pieceDefFromPack(undefined, 25)).toBeNull();
  });
  it("converts and describes", () => {
    const def = { name: "cartridge", perPack: 4 };
    expect(packsFromPieces(3, def)).toBe(0.75);
    expect(describeStock(0.75, "4-Cartridge Case", def)).toBe("3 cartridges");
    expect(describeStock(0.25, "4-Cartridge Case", def)).toBe("1 cartridge");
    expect(describeStock(0.6, "box", { name: "fastener", perPack: 1000 })).toBe("600 fasteners");
    expect(describeStock(2, "pail", null)).toBe("2 pail");
    expect(displayStock(2.5, "4-Cartridge Case", def)).toEqual({ amount: 10, unit: "cartridges" });
  });
});

import { describe, it, expect } from "vitest";

import type { OrderLine } from "./order-list";
import { ORDER_COLUMNS, orderListHtml, orderListRows, toBuyCount } from "./order-list-export";

const lines: OrderLine[] = [
  {
    group: "Membrane",
    name: "Duro-Bond - 50 · White",
    needed: 55880,
    unit: "sq ft",
    pulled: 0,
    pullable: 0,
    toBuy: 55880,
  },
  {
    group: "Adhesives",
    name: "Duro-Fleece Adhesive(cartridge)",
    needed: 3,
    unit: "4-Cartridge Case",
    pulled: 0.75,
    pullable: 1.25,
    onHand: 1.25,
    toBuy: 3,
    piece: { name: "cartridge", perPack: 4 },
  },
  {
    group: "Accessories",
    name: 'Drip Edge — 2" Drip Edge White',
    needed: 120,
    unit: "ft",
    pulled: 0,
    pullable: 0,
    toBuy: 120,
    stockUnit: "piece",
  },
  {
    group: "Accessories",
    name: "Sealants — Duro-Caulk Plus - White",
    needed: 15,
    unit: "tube",
    pulled: 15,
    pullable: 0,
    onHand: 2,
    toBuy: 0,
  },
];

describe("order list export", () => {
  it("builds sheet rows with numbers kept numeric", () => {
    const rows = orderListRows(lines);
    expect(ORDER_COLUMNS).toHaveLength(7);
    expect(rows[0]).toEqual(["Membrane", "Duro-Bond - 50 · White", 55880, "sq ft", "", "", 55880]);
    expect(rows[1]).toEqual([
      "Adhesives",
      "Duro-Fleece Adhesive(cartridge)",
      3,
      "4-Cartridge Case",
      0.75,
      1.25,
      3,
    ]);
    expect(rows[2]![5]).toBe("shelf in piece");
    expect(rows[3]).toEqual([
      "Accessories",
      "Sealants — Duro-Caulk Plus - White",
      15,
      "tube",
      15,
      2,
      0,
    ]);
    expect(toBuyCount(lines)).toBe(3);
  });

  it("renders a printable page in pieces where the product has them", () => {
    const html = orderListHtml(lines, {
      bidName: "Knox <County>",
      client: "Board",
      printedAt: new Date(0),
    });
    expect(html).toContain("Order list — Knox &lt;County&gt;");
    expect(html).toContain("3 × 4-Cartridge Case (12 cartridges)");
    expect(html).toContain("0.75 × 4-Cartridge Case (3 cartridges)");
    expect(html).toContain("shelf in piece");
    expect(html).toContain("3 of 4 products still to buy");
  });
});

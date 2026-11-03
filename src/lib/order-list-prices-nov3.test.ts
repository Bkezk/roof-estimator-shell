/**
 * Order list prices (owner, 2026-11-03): every line shows the material price for one unit and
 * what that material costs for the whole job (price each × needed), with a Material total under
 * the table, on the screen, the Excel sheet and the print page.
 */
import { describe, it, expect } from "vitest";

import type { PriceTarget } from "./admin-item-numbers.functions";
import type { EngineAdminData } from "./engine/adapters";
import type { BidSectionInput } from "./engine/bid-builder";
import { buildOrderList, lineTotal, orderListTotal, type OrderLine } from "./order-list";
import { ORDER_COLUMNS, orderListHtml, orderListRows, orderMoney } from "./order-list-export";

const targets: PriceTarget[] = [
  {
    screen_id: "duro_last:duro_last_membrane",
    category: "Duro-Last Membrane",
    rows: ["Duro-Tuff - 60"],
    price_cols: ["White", "Tan"],
    values: { "Duro-Tuff - 60": { White: 1.1, Tan: 1.25 } },
  },
  {
    screen_id: "duro_last:underlayment",
    category: "Underlayment",
    rows: ['2" ISO', "Geotextile"],
    price_cols: ["Cost/Sq. Ft."],
    // Geotextile has no price in the catalog (blank cell)
    values: { '2" ISO': { "Cost/Sq. Ft.": 0.95 }, Geotextile: { "Cost/Sq. Ft.": null } },
  },
  {
    screen_id: "duro_last:fasteners_and_bits",
    category: "Fasteners & Bits",
    rows: ['3" [Spade]'],
    price_cols: ["Price/Box"],
    values: { '3" [Spade]': { "Price/Box": 120 } },
    pack_col: "Fasteners/Box",
    packs: { '3" [Spade]': 1000 },
    pieces: { '3" [Spade]': { name: "fastener", perPack: 1000 } },
  },
  {
    screen_id: "duro_last:adhesives",
    category: "Adhesives",
    rows: ["Duro-Fleece Adhesive(cartridge)"],
    price_cols: ["price"],
    values: { "Duro-Fleece Adhesive(cartridge)": { price: 389 } },
    row_units: { "Duro-Fleece Adhesive(cartridge)": "4-Cartridge Case" },
    pieces: { "Duro-Fleece Adhesive(cartridge)": { name: "cartridge", perPack: 4 } },
  },
  {
    screen_id: "duro_last:drip_edge",
    category: "Drip Edge",
    rows: ['Drip Edge 2"'],
    price_cols: ["White Price"],
    // The catalog prices drip edge per 10' PIECE; the engine bills it per foot.
    values: { 'Drip Edge 2"': { "White Price": 42 } },
  },
];

const section = (over: Partial<BidSectionInput> = {}): BidSectionInput => ({
  id: "s1",
  name: "S1",
  length: 100,
  width: 80,
  deckType: "Steel",
  thickness: 60,
  color: "Tan",
  fieldLap: 60,
  fastenerOc: 18,
  perimLengthFt: 0,
  cornerLengthFt: 0,
  enhancementWidthFt: 3,
  perimFastenerOc: 12,
  cornerFastenerOc: 6,
  underlaymentBoard: "",
  sheetSizeLabel: "1500 sf",
  tearOff: false,
  tearOffType: "",
  toThicknessInches: 0,
  layers: [
    {
      board: '2" ISO',
      attachment: "mechanical",
      fastenersPerBoard: 0,
      adhesiveName: "",
      substrate: "",
    },
    {
      board: "Geotextile",
      attachment: "none",
      fastenersPerBoard: 0,
      adhesiveName: "",
      substrate: "",
    },
  ],
  ...over,
});

const admin = {} as EngineAdminData; // flat families never touch the admin tables

const build = () =>
  buildOrderList({
    admin,
    roofSystem: "Duro-Tuff",
    attachment: "mechanical",
    sections: [section()],
    build: {
      inputs: { sections: [{ membraneWithOverlap: 8800 }] } as never,
      accessories: {
        fasteners: { cost: 360, rows: [{ key: '3"|Spade', totalQty: 2500, boxes: 3, cost: 360 }] },
        lines: [
          {
            screen: "Drip Edge",
            qty: 120,
            name: '2" Drip Edge White',
            unitCost: 4.2,
            totalCost: 504,
            hours: 0,
          },
          // A line the catalog cannot price: no cell matches and the engine has no unit cost
          { screen: "Vents", qty: 2, name: "Mystery Vent", unitCost: 0, totalCost: 0, hours: 0 },
        ],
      } as never,
      adhesiveLines: [
        {
          screen: "Adhesives",
          qty: 3,
          name: "Duro-Fleece Adhesive(cartridge)",
          unitCost: 389,
          totalCost: 1167,
          hours: 0,
        },
      ],
    },
    targets,
    stock: [],
  });

const byName = (lines: OrderLine[], re: RegExp) => lines.find((l) => re.test(l.name))!;

describe("order list — price each and material total per line", () => {
  it("membrane and underlayment take the catalog cell's $/sq ft", () => {
    const lines = build();
    const membrane = byName(lines, /^Duro-Tuff - 60 · Tan$/);
    expect(membrane).toMatchObject({ needed: 8800, unit: "sq ft", unitPrice: 1.25, total: 11000 });
    // 100 × 80 × 1.03 waste = 8,240 sq ft of ISO at $0.95
    const iso = byName(lines, /^2" ISO$/);
    expect(iso).toMatchObject({ needed: 8240, unitPrice: 0.95, total: 7828 });
  });

  it("a blank catalog price leaves the line unpriced rather than showing $0", () => {
    const geo = byName(build(), /^Geotextile$/);
    expect(geo.needed).toBe(8480);
    expect(geo.unitPrice).toBeUndefined();
    expect(geo.total).toBeUndefined();
  });

  it("fasteners, adhesives and accessories use the engine's own unit cost per billed unit", () => {
    const lines = build();
    expect(byName(lines, /^3" Spade$/)).toMatchObject({ needed: 3, unitPrice: 120, total: 360 });
    expect(byName(lines, /Duro-Fleece/)).toMatchObject({ needed: 3, unitPrice: 389, total: 1167 });
    // Drip edge: the engine bills per foot ($4.20/ft), the catalog cell is per piece ($42) —
    // the per-foot figure must win or the job total is ten times too high.
    const drip = byName(lines, /Drip Edge/);
    expect(drip).toMatchObject({ unit: "ft", needed: 120, unitPrice: 4.2, total: 504 });
    const mystery = byName(lines, /Mystery Vent/);
    expect(mystery.unitPrice).toBeUndefined();
  });

  it("sums the job's material total and counts unpriced lines", () => {
    const t = orderListTotal(build());
    expect(t).toEqual({ total: 11000 + 7828 + 360 + 1167 + 504, unpriced: 2 });
    expect(lineTotal(0.333, 3)).toBe(1); // cents, not floating dust
    expect(orderListTotal([])).toEqual({ total: 0, unpriced: 0 });
  });

  it("the sheet and the print page carry both figures", () => {
    const lines = build();
    expect(ORDER_COLUMNS.slice(4, 6)).toEqual(["Price each", "Material total"]);
    const row = orderListRows(lines).find((r) => r[1] === "Duro-Tuff - 60 · Tan")!;
    expect(row[4]).toBe(1.25);
    expect(row[5]).toBe(11000);
    const geo = orderListRows(lines).find((r) => r[1] === "Geotextile")!;
    expect(geo[4]).toBe("");
    expect(geo[5]).toBe("");
    expect(orderMoney(1.25)).toBe("$1.25");
    expect(orderMoney(undefined)).toBe("—");
    const html = orderListHtml(lines, { bidName: "B", printedAt: new Date(0) });
    expect(html).toContain('<th class="n">Price each</th><th class="n">Material total</th>');
    expect(html).toContain("$1.25 <small>/ sq ft</small>");
    expect(html).toContain("$11,000.00");
    expect(html).toContain("$20,859.00");
    expect(html).toContain("2 products have no catalog price and are not in the total");
  });
});

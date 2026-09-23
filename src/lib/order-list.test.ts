import { describe, it, expect } from "vitest";

import type { PriceTarget } from "./admin-item-numbers.functions";
import type { EngineAdminData } from "./engine/adapters";
import type { BidSectionInput } from "./engine/bid-builder";
import type { StockRow } from "./inventory.functions";
import { buildOrderList, matchAccessoryCell, membraneRowForSection } from "./order-list";

const targets: PriceTarget[] = [
  {
    screen_id: "duro_last:duro_last_membrane",
    category: "Duro-Last Membrane",
    rows: ["Duro-Tuff - 60", "Duro-Last - 60mil Roll Goods"],
    price_cols: ["White", "Tan"],
    values: {},
  },
  {
    screen_id: "duro_last:underlayment",
    category: "Underlayment",
    rows: ['2" ISO', "Geotextile"],
    price_cols: ["Cost/Sq. Ft."],
    values: {},
  },
  {
    screen_id: "duro_last:fasteners_and_bits",
    category: "Fasteners & Bits",
    rows: ['3" [Spade]', '3" Insulation Plates'],
    price_cols: ["Price/Box"],
    values: {},
    pack_col: "Fasteners/Box",
    packs: { '3" [Spade]': 1000, '3" Insulation Plates': 1000 },
    pieces: { '3" [Spade]': { name: "fastener", perPack: 1000 } },
  },
  {
    screen_id: "duro_last:adhesives",
    category: "Adhesives",
    rows: ["Duro-Fleece Adhesive(cartridge)"],
    price_cols: ["price"],
    values: {},
    row_units: { "Duro-Fleece Adhesive(cartridge)": "4-Cartridge Case" },
    pieces: { "Duro-Fleece Adhesive(cartridge)": { name: "cartridge", perPack: 4 } },
  },
  {
    screen_id: "duro_last:termination_bars",
    category: "Termination Bars",
    rows: ["White", "Tan", "Gray"],
    price_cols: ["Price"],
    values: {},
  },
  {
    screen_id: "duro_last:corners",
    category: "Corners",
    rows: ["Inside Corner", "Outside Corner"],
    price_cols: ["White", "Tan", "Gray"],
    values: {},
  },
  {
    screen_id: "duro_last:sealants",
    category: "Sealants",
    rows: ["Duro-Caulk Plus - White", "Duro-Caulk - White"],
    price_cols: ["Price"],
    values: {},
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

describe("order list — matching engine lines to stock cells", () => {
  it("resolves accessory lines to the catalog row and colour column", () => {
    expect(
      matchAccessoryCell({ screen: "Term Bar", name: "Termination Bars Tan" }, targets),
    ).toEqual({
      screen_id: "duro_last:termination_bars",
      row_label: "Tan",
      price_col: "Price",
    });
    expect(
      matchAccessoryCell({ screen: "Corners", name: "Outside Corner corner - Gray" }, targets),
    ).toEqual({ screen_id: "duro_last:corners", row_label: "Outside Corner", price_col: "Gray" });
    // Longest label wins: "Duro-Caulk Plus - White" over "Duro-Caulk - White".
    expect(
      matchAccessoryCell({ screen: "Sealants", name: "Duro-Caulk Plus - White" }, targets)
        ?.row_label,
    ).toBe("Duro-Caulk Plus - White");
    expect(matchAccessoryCell({ screen: "Unknown", name: "x" }, targets)).toBeUndefined();
  });

  it("names a flat-family section's membrane row like the catalog", () => {
    expect(membraneRowForSection(admin, "Duro-Tuff", "mechanical", section())).toBe(
      "Duro-Tuff - 60",
    );
  });

  it("needs less on hand; pack units round up; unmatched lines still list", () => {
    const stock: StockRow[] = [
      {
        screen_id: "duro_last:duro_last_membrane",
        category: "Duro-Last Membrane",
        row_label: "Duro-Tuff - 60",
        price_col: "Tan",
        unit: "sq ft",
        on_hand: 1500,
        last_at: null,
        item_nos: [],
      },
      {
        screen_id: "duro_last:fasteners_and_bits",
        category: "Fasteners & Bits",
        row_label: '3" [Spade]',
        price_col: "Price/Box",
        unit: "box",
        on_hand: 0.6,
        last_at: null,
        item_nos: [],
      },
      {
        screen_id: "duro_last:adhesives",
        category: "Adhesives",
        row_label: "Duro-Fleece Adhesive(cartridge)",
        price_col: "price",
        unit: "4-Cartridge Case",
        on_hand: 0.75,
        last_at: null,
        item_nos: [],
      },
    ];
    const lines = buildOrderList({
      admin,
      roofSystem: "Duro-Tuff",
      attachment: "mechanical",
      sections: [section()],
      build: {
        inputs: { sections: [{ membraneWithOverlap: 8591 }] } as never,
        accessories: {
          fasteners: { cost: 0, rows: [{ key: '3" [Spade]', totalQty: 2500, boxes: 3, cost: 0 }] },
          lines: [
            {
              screen: "Fasteners",
              qty: 3,
              name: '3" Spade (2500 pcs, boxes of 1000)',
              unitCost: 0,
              totalCost: 0,
              hours: 0,
            },
            {
              screen: "Term Bar",
              qty: 360,
              name: "Termination Bars Tan",
              unitCost: 0,
              totalCost: 0,
              hours: 0,
            },
            {
              screen: "Walk Pads",
              qty: 2,
              name: "Some pad nobody sells",
              unitCost: 0,
              totalCost: 0,
              hours: 0,
            },
            {
              screen: "Membrane Acc.",
              qty: 1,
              name: "Stripping (labor only)",
              unitCost: 0,
              totalCost: 0,
              hours: 1,
            },
          ],
        } as never,
        adhesiveLines: [
          {
            screen: "Adhesives",
            qty: 2,
            name: "Duro-Fleece Adhesive(cartridge)",
            unitCost: 389,
            totalCost: 778,
            hours: 0,
          },
        ],
      },
      targets,
      stock,
    });
    const by = (name: string) => lines.find((l) => l.name.includes(name))!;
    // Membrane: 8,591 sq ft needed, 1,500 on hand → 7,091 to buy (sq ft, not rounded to packs).
    expect(by("Duro-Tuff - 60 · Tan")).toMatchObject({
      group: "Membrane",
      needed: 8591,
      onHand: 1500,
      toBuy: 7091,
      unit: "sq ft",
    });
    // Underlayment: 8,000 × 1.03 for ISO, × 1.06 for Geotextile; no stock rows → to buy = needed.
    expect(by('2" ISO')).toMatchObject({ group: "Underlayment", needed: 8240, toBuy: 8240 });
    expect(by("Geotextile").needed).toBe(8480);
    expect(by("Geotextile").onHand).toBeUndefined();
    // Fasteners: 3 boxes needed, 0.6 box on hand → 2.4 → 3 whole boxes to buy; pieces shown.
    expect(by("Spade")).toMatchObject({
      group: "Fasteners",
      needed: 3,
      onHand: 0.6,
      toBuy: 3,
      pieces: 2500,
      unit: "box",
    });
    // Adhesive: 2 cases needed, 0.75 case on hand → 1.25 → 2 cases; unit from the product.
    expect(by("cartridge")).toMatchObject({
      group: "Adhesives",
      needed: 2,
      onHand: 0.75,
      toBuy: 2,
      unit: "4-Cartridge Case",
    });
    // Accessories: term bar matched; unknown pad listed without a cell; labor-only line skipped.
    expect(by("Termination Bars Tan").cell?.row_label).toBe("Tan");
    expect(by("Some pad").cell).toBeUndefined();
    expect(lines.some((l) => l.name.includes("labor only"))).toBe(false);
  });
});

/**
 * Owner, 2026-11-03, on Knox County BOE CTC Test 2's order list: "why is the labor for the drip
 * edge included there". The engine's legacy summary carries a "4" Drip Edge Labor" row (the
 * measured length, hours only) and tags drip edge / gravel stop / fascia lines with the size in
 * the screen name, so the order list listed the labor row as a product and called the bars
 * "each" with no catalog match.
 */
import { describe, it, expect } from "vitest";

import type { PriceTarget } from "./admin-item-numbers.functions";
import type { EngineAdminData } from "./engine/adapters";
import type { BidSectionInput } from "./engine/bid-builder";
import { accessoryLineUnit, buildOrderList, matchAccessoryCell, orderScreen } from "./order-list";

const targets: PriceTarget[] = [
  {
    screen_id: "duro_last:drip_edge",
    category: "Drip Edge",
    rows: [
      'Drip Edge 2"',
      'Drip Edge 2" Corner',
      'Drip Edge 4"',
      'Drip Edge 4" Clip',
      'Drip Edge 4" Corner',
    ],
    price_cols: ["White Price", "Tan Price", "Gray Price"],
    values: { 'Drip Edge 4"': { "White Price": 9.6, "Tan Price": 11.08, "Gray Price": 11.08 } },
  },
  {
    screen_id: "duro_last:gravel_stops",
    category: "Gravel Stops",
    rows: ['Gravel Stop 2"', 'Gravel Stop 2" Cover', 'Gravel Stop 4"', 'Gravel Stop 4" Cover'],
    price_cols: ["White Price", "Tan Price", "Gray Price"],
    values: {},
  },
  {
    screen_id: "duro_last:facia_bars_vinyl_covers",
    category: "Facia Bars / Vinyl Covers",
    rows: [
      '1 3/4" Fascia Bar',
      "White Vinyl Cover [1001]",
      "Metal Cover [1002]",
      '4" Fascia Bar',
      "White Vinyl Cover [2001]",
      "Metal Cover [2002]",
    ],
    price_cols: ["Price"],
    values: {},
  },
];

const section = (): BidSectionInput => ({
  id: "s1",
  name: "S1",
  length: 10,
  width: 10,
  deckType: "Steel",
  thickness: 60,
  color: "White",
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
  layers: [],
});

const acc = (screen: string, qty: number, name: string, unitCost: number, hours = 0) => ({
  screen,
  qty,
  name,
  unitCost,
  totalCost: qty * unitCost,
  hours,
});

describe("order list — drip edge, gravel stop and fascia lines as the engine names them", () => {
  it("maps the engine's sized screen labels to the order list's screen names", () => {
    expect(orderScreen('4" Drip Edge')).toBe("Drip Edge");
    expect(orderScreen('2" Gravel Stop')).toBe("Gravel Stop");
    expect(orderScreen('1-3/4" Fascia')).toBe('Fascia Bar 3"');
    expect(orderScreen('4" Fascia')).toBe('Fascia Bar 4"');
    expect(orderScreen("Term Bar")).toBe("Term Bar");
  });

  it("drip edge and gravel stop bars are feet, their corners each", () => {
    expect(accessoryLineUnit('4" Drip Edge', '4" Drip Edge White')).toBe("ft");
    expect(accessoryLineUnit('4" Drip Edge', '4" Drip Edge Corners White')).toBe("each");
    expect(accessoryLineUnit('2" Gravel Stop', '2" Gravel Stop Tan')).toBe("ft");
    expect(accessoryLineUnit('1-3/4" Fascia', '1-3/4" Fascia Bar')).toBe("ft");
    // Vinyl and metal covers are bought by length, like the bar.
    expect(accessoryLineUnit('4" Fascia', '4" Fascia Bar White Vinyl Covers')).toBe("ft");
  });

  it("matches the sized lines to their catalog rows and colour columns", () => {
    expect(
      matchAccessoryCell({ screen: '4" Drip Edge', name: '4" Drip Edge White' }, targets),
    ).toEqual({
      screen_id: "duro_last:drip_edge",
      row_label: 'Drip Edge 4"',
      price_col: "White Price",
    });
    expect(
      matchAccessoryCell({ screen: '4" Drip Edge', name: '4" Drip Edge Corners Tan' }, targets),
    ).toEqual({
      screen_id: "duro_last:drip_edge",
      row_label: 'Drip Edge 4" Corner',
      price_col: "Tan Price",
    });
    expect(
      matchAccessoryCell({ screen: '2" Gravel Stop', name: '2" Gravel Stop Gray' }, targets),
    ).toEqual({
      screen_id: "duro_last:gravel_stops",
      row_label: 'Gravel Stop 2"',
      price_col: "Gray Price",
    });
    // The 1-3/4" bar is written "1 3/4"" on the catalog.
    expect(
      matchAccessoryCell({ screen: '1-3/4" Fascia', name: '1-3/4" Fascia Bar' }, targets)
        ?.row_label,
    ).toBe('1 3/4" Fascia Bar');
    // A label repeated for both bar sizes: the 3" screen takes the earlier row, the 4" the later.
    expect(
      matchAccessoryCell(
        { screen: '1-3/4" Fascia', name: '1-3/4" Fascia Bar White Vinyl Covers' },
        targets,
      )?.row_label,
    ).toBe("White Vinyl Cover [1001]");
    expect(
      matchAccessoryCell({ screen: '4" Fascia', name: '4" Fascia Bar White Vinyl Covers' }, targets)
        ?.row_label,
    ).toBe("White Vinyl Cover [2001]");
    // Base & Snap Cover is priced off the Exceptional Metals grid, which Inventory does not stock.
    expect(
      matchAccessoryCell({ screen: "Base & Snap Cover", name: '6" Piece Covers' }, targets),
    ).toBeUndefined();
  });

  it("leaves the legacy labor rows off the list and prices the bar per foot", () => {
    const lines = buildOrderList({
      admin: {} as EngineAdminData,
      roofSystem: "Duro-Tuff",
      attachment: "mechanical",
      sections: [section()],
      build: {
        inputs: { sections: [{ membraneWithOverlap: 0 }] } as never,
        accessories: {
          fasteners: { cost: 0, rows: [] },
          lines: [
            acc('4" Drip Edge', 376, '4" Drip Edge Labor', 0, 12.5),
            acc('4" Drip Edge', 390, '4" Drip Edge White', 10.08),
            acc('2" Gravel Stop', 100, '2" Gravel Stop Labor', 0, 3),
            acc("Membrane Acc.", 40, "Stripping (labor only)", 0, 1),
            acc("Roof Drains & Boots", 2, "Reuse Ring", 0, 0.5),
          ],
        } as never,
        adhesiveLines: [],
      },
      targets,
      stock: [],
    });
    expect(lines.map((l) => l.name)).toEqual(['4" Drip Edge — 4" Drip Edge White']);
    expect(lines[0]).toMatchObject({
      unit: "ft",
      needed: 390,
      unitPrice: 10.08,
      total: 3931.2,
      cell: {
        screen_id: "duro_last:drip_edge",
        row_label: 'Drip Edge 4"',
        price_col: "White Price",
      },
    });
  });
});

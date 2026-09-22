import { describe, expect, it } from "vitest";

import {
  guessHeader,
  guessMembraneHeader,
  matchMembrane,
  matchSheet,
  readMembraneSheet,
  normalizeItemNo,
  parsePrice,
  readSheetItems,
  type ItemNumberMapping,
} from "./price-import";

const mappings: ItemNumberMapping[] = [
  {
    item_no: "1225",
    screen_id: "duro_last:termination_bars",
    row_label: "White",
    price_col: "Price",
  },
  {
    item_no: "1225B",
    screen_id: "duro_last:termination_bars",
    row_label: "Tan",
    price_col: "Price",
  },
  {
    item_no: "1312 BF",
    screen_id: "duro_last:corners",
    row_label: 'Outside Butterfly 6" x 6"',
    price_col: "White",
  },
  // One item number feeding two cells (legacy vents share 1231 across colours).
  { item_no: "1231", screen_id: "duro_last:vents", row_label: "White Vent", price_col: "Price" },
  { item_no: "1231", screen_id: "duro_last:vents", row_label: "Tan Vent", price_col: "Price" },
];

describe("price import — parsing", () => {
  it("normalises item numbers (case, inner spaces) and parses currency strings", () => {
    expect(normalizeItemNo(" 1312 bf ")).toBe("1312BF");
    expect(normalizeItemNo(1225)).toBe("1225");
    expect(parsePrice("$1,234.50")).toBe(1234.5);
    expect(parsePrice(" 12.5 ")).toBe(12.5);
    expect(parsePrice(12.5)).toBe(12.5);
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("n/a")).toBeNull();
  });

  it("finds the header row and the item / description / price columns", () => {
    const rows = [
      ["Duro-Last Price List", null, null],
      ["Effective 1/1/2026"],
      ["Item #", "Description", "Unit", "Price"],
      ["1225", "Term Bar White", "ft", "$0.75"],
    ];
    expect(guessHeader(rows)).toEqual({
      headerRow: 2,
      itemCol: 0,
      descCol: 1,
      priceCol: 3,
      unitCol: 2,
    });
    // The real Duro-Last sheet: Item / Description / Category / … / Price / Unit of Measure.
    const dl = [
      [
        "Item",
        "Description",
        "Category",
        "Category Type",
        "Size",
        "Item Color",
        "Metal Gauge",
        "Price",
        "Unit of Measure",
      ],
      [
        1222,
        "PANDUIT SS BAND 14 (BAG)",
        "Stack Flashings",
        "Panduit Bands",
        null,
        null,
        null,
        44,
        "BG",
      ],
    ];
    expect(guessHeader(dl)).toEqual({
      headerRow: 0,
      itemCol: 0,
      descCol: 1,
      priceCol: 7,
      unitCol: 8,
    });
    const it0 = readSheetItems(dl, guessHeader(dl)!)[0]!;
    expect([it0.itemNo, it0.price, it0.unit]).toEqual(["1222", 44, "BG"]);
    expect(guessHeader([["a", "b"]])).toBeNull();
  });

  it("reads data rows under the header and skips blank item numbers", () => {
    const rows = [
      ["Item Number", "Description", "List Price"],
      ["1225", "Term Bar White", "0.75"],
      [null, "note row", null],
      [1231, "Vent", 25.75],
    ];
    const items = readSheetItems(rows, { headerRow: 0, itemCol: 0, descCol: 1, priceCol: 2 });
    expect(items.map((i) => [i.itemNo, i.price])).toEqual([
      ["1225", 0.75],
      ["1231", 25.75],
    ]);
  });
});

describe("price import — matching", () => {
  it("matches by normalised item number, reports unmatched, no-price and not-in-sheet", () => {
    const rows = [
      ["Item #", "Description", "Price"],
      ["1225", "TERM BAR WHITE", "0.80"],
      ["1312bf", "BUTTERFLY CORNER", "5.10"],
      ["1231", "VENT", "26.00"],
      ["9999", "NEW WIDGET", "1.00"],
      ["1225B", "TERM BAR TAN", ""],
    ];
    const items = readSheetItems(rows, guessHeader(rows)!);
    const r = matchSheet(items, mappings);
    // 1225 → one cell; 1312 BF → one; 1231 → two cells (both vents).
    expect(r.matched.map((m) => `${m.mapping.row_label}=${m.item.price}`)).toEqual([
      "White=0.8",
      'Outside Butterfly 6" x 6"=5.1',
      "White Vent=26",
      "Tan Vent=26",
    ]);
    expect(r.unmatched.map((u) => u.itemNo)).toEqual(["9999"]);
    expect(r.noPrice.map((u) => u.itemNo)).toEqual(["1225B"]);
    expect(r.notInSheet).toEqual([]);
    expect(r.duplicatesInSheet).toEqual([]);
  });

  it("flags item numbers listed twice (last wins) and mapped items missing from the sheet", () => {
    const rows = [
      ["Part No", "Price"],
      ["1225", "1"],
      ["1225", "2"],
    ];
    const items = readSheetItems(rows, { headerRow: 0, itemCol: 0, descCol: null, priceCol: 1 });
    const r = matchSheet(items, mappings);
    expect(r.duplicatesInSheet).toEqual(["1225"]);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0]!.item.price).toBe(2);
    expect(r.notInSheet.map((m) => m.item_no).sort()).toEqual(["1225B", "1231", "1231", "1312 BF"]);
  });
});

describe("price import — Duro-Last Membrane sheet", () => {
  const sheet = [
    ["Description", "Mil", "Color", "Price per SqFt"],
    ["Roll Goods", 40, "White", 1.23],
    ["Roll Goods", 40, "Tan", 1.25],
    ['60" Tabs', 50, "Terra Cotta", 1.42],
    ["Parapets", 60, "Dark Gray", 1.63],
    ["Roll Goods", 70, "White", 2],
    ["Roll Goods", 40, "Blue", 1.3],
    ["Roll Goods", 50, "White", ""],
  ];
  const target = {
    rows: [
      "Duro-Last - 40mil Roll Goods",
      'Duro-Last - 50mil 60" Tabs',
      "Duro-Last - 60mil Parapets",
      "Duro-Last - 50mil Roll Goods",
      "Duro-Bond - 40",
    ],
    price_cols: ["White", "Tan", "Gray", "Dark Gray", "Terra Cotta", "Rock-Ply"],
  };
  it("finds the header and maps Description + Mil onto the matrix row, Color onto the column", () => {
    expect(guessMembraneHeader(sheet)).toEqual({
      headerRow: 0,
      descCol: 0,
      milCol: 1,
      colorCol: 2,
      priceCol: 3,
    });
    expect(guessMembraneHeader([["Item", "Description", "Price"]])).toBeNull();
    const r = matchMembrane(readMembraneSheet(sheet), target);
    expect(r.matched.map((m) => `${m.row_label} · ${m.price_col} = ${m.item.price}`)).toEqual([
      "Duro-Last - 40mil Roll Goods · White = 1.23",
      "Duro-Last - 40mil Roll Goods · Tan = 1.25",
      'Duro-Last - 50mil 60" Tabs · Terra Cotta = 1.42',
      "Duro-Last - 60mil Parapets · Dark Gray = 1.63",
    ]);
    expect(r.unmatched.map((u) => u.reason)).toEqual([
      'no matrix row "Duro-Last - 70mil Roll Goods"',
      'no "Blue" colour column',
    ]);
    expect(r.noPrice.map((u) => `${u.mil} ${u.description}`)).toEqual(["50 Roll Goods"]);
  });
});

import { describe, expect, it } from "vitest";

import {
  headerSignature,
  membranePerSqFt,
  nameMatchScore,
  nameTokens,
  rollAreaSqFt,
  suggestCatalogRow,
  suggestSheetLine,
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
      sizeCol: null,
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
      sizeCol: 4,
    });
    const it0 = readSheetItems(dl, guessHeader(dl)!)[0]!;
    expect([it0.itemNo, it0.price, it0.unit, it0.size]).toEqual(["1222", 44, "BG", ""]);
    expect(guessHeader([["a", "b"]])).toBeNull();
  });

  it("turns a roll-goods line (per roll) into the membrane matrix's $/sq ft via its Size cell", () => {
    // The real sheet's Duro-Last Roll Goods: 5'4 × 100' = 533.33 sq ft; 2'8" × 100' = 266.67.
    expect(rollAreaSqFt("5'4 X 100'")).toBeCloseTo(533.333, 3);
    expect(rollAreaSqFt("2'8\" X 100'")).toBeCloseTo(266.667, 3);
    expect(rollAreaSqFt("10' X 100'")).toBe(1000);
    expect(rollAreaSqFt("2'6\" x 100'")).toBe(250);
    expect(rollAreaSqFt("10\" X 100'- STRIPPING")).toBeCloseTo(83.333, 3);
    expect(rollAreaSqFt("")).toBeNull();
    expect(rollAreaSqFt("BAG")).toBeNull();
    // 55701 DL 40MIL WHT 5'4"X100' $656.72 → 1.23 (= the membrane tab's 40 mil White Roll Goods).
    expect(membranePerSqFt({ price: 656.72, size: "5'4 X 100'" })).toBe(1.23);
    expect(membranePerSqFt({ price: 328.41, size: "2'8\" X 100'" })).toBe(1.23);
    expect(membranePerSqFt({ price: 667.32, size: "5'4 X 100'" })).toBe(1.25);
    // 44103 D-TECH TPO WHT 45 MIL 120x1200 $750 → 0.75; 44127 80 mil $1300 → 1.30.
    expect(membranePerSqFt({ price: 750, size: "10' X 100'" })).toBe(0.75);
    expect(membranePerSqFt({ price: 1300, size: "10' X 100'" })).toBe(1.3);
    expect(membranePerSqFt({ price: 44, size: "" })).toBeNull();
    expect(membranePerSqFt({ price: null, size: "10' X 100'" })).toBeNull();
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

describe("price import — layout memory and name suggestions", () => {
  it("signs a header row by its cells so a re-issued sheet with the same headings is recognised", () => {
    expect(headerSignature(["Item", "Description", null, "Price", "Unit of Measure"])).toBe(
      "item|description||price|unit of measure",
    );
    expect(headerSignature(undefined)).toBe("");
  });

  it("tokenises names with Duro-Last's abbreviations expanded and units dropped", () => {
    expect([...nameTokens("TERM BAR WHT 10'")]).toEqual(["TERM", "BAR", "WHITE", "10"]);
    expect([...nameTokens("Term Bar White")]).toEqual(["TERM", "BAR", "WHITE"]);
    expect(nameTokens("MATL 40MIL D/GRY 64X100' DL").has("DARKGRAY")).toBe(true);
    expect(nameTokens("DRAIN GUARD WHITE EA").has("EA")).toBe(false);
  });

  it("scores a sheet line against a catalog name, rejecting colour and size conflicts", () => {
    expect(nameMatchScore("Term Bar White", "TERM BAR WHT 10'")).toBe(1);
    expect(nameMatchScore("Term Bar White", "TERM BAR TAN 10'")).toBeNull();
    expect(nameMatchScore('3" Square Steel Plate', "PLATE SQ STEEL 3")).toBe(1);
    expect(nameMatchScore('3" Square Steel Plate', "PLATE SQ STEEL 2")).toBeNull();
    expect(nameMatchScore("Drain Guard White", "DRAIN GUARD WHITE")).toBe(1);
    expect(nameMatchScore("Drain Guard White", "GUARD RAIL")).toBeNull();
    expect(nameMatchScore("Sealant", "CAULK")).toBeNull();
    // Variant words on one side only are different products; plurals and I/C fold together.
    expect(nameMatchScore("Duro-Caulk - White", "CAULK DURO PLUS WHT")).toBeNull();
    expect(nameMatchScore("Duro-Caulk Plus - White", "CAULK DURO PLUS WHT")).toBe(1);
    expect(nameMatchScore("Metal Cleat Plates", "PLATE METAL CLEAT")).toBe(1);
    expect(nameMatchScore('Inside 6" x 6"', "I/C 6X6 WHT")).toBe(1);
    expect(nameMatchScore('3 1/2"', "AUGER 3-1/2")).toBeNull();
  });

  it("suggests the closest catalog row for a sheet line and the closest sheet line for a product", () => {
    const rows = [
      { screen_id: "s", category: "Edge", row_label: "Term Bar White", price_col: "Price" },
      { screen_id: "s", category: "Edge", row_label: "Term Bar Tan", price_col: "Price" },
      { screen_id: "s", category: "Edge", row_label: "Term Bar White 2-Piece", price_col: "Price" },
    ];
    expect(suggestCatalogRow("TERM BAR TAN 10'", rows)?.row.row_label).toBe("Term Bar Tan");
    // Full coverage beats partial: the plain white bar, not the 2-piece it only half names.
    expect(suggestCatalogRow("TERM BAR WHT 10'", rows)?.row.row_label).toBe("Term Bar White");
    expect(suggestCatalogRow("PANDUIT SS BAND", rows)).toBeNull();
    const items = readSheetItems(
      [
        ["Item", "Description", "Price"],
        ["1225", "TERM BAR WHT 10'", 7.5],
        ["1225L", "TERM BAR WHT 10' LONG PACK", 70],
        ["1226", "TERM BAR TAN 10'", 7.6],
      ],
      { headerRow: 0, itemCol: 0, descCol: 1, priceCol: 2 },
    );
    expect(suggestSheetLine("Term Bar White", items)?.item.itemNo).toBe("1225");
    expect(suggestSheetLine("Term Bar Tan", items)?.item.itemNo).toBe("1226");
    expect(suggestSheetLine("Walkway Pad", items)).toBeNull();
  });
});

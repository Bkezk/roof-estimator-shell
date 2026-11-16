/**
 * Inventory › Count, the screen (owner, Nov 16: "is it as efficient and good as it could be
 * especially with the reconciliation part"). The helpers the count sheet is built from
 * (inventory-count-sheet.ts), then the screen itself (inventory-count-tab.tsx): drawn to a
 * string as an admin sees it and as everyone else does, and a few pins on its source. There is
 * no browser here, so nothing below types in a box or presses Save.
 *
 * Every expected number below was worked out by hand first; the arithmetic is written beside it
 * so a reader can check it without running anything.
 */
import { readFileSync } from "node:fs";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The screen is drawn to a string below with its answers already in the query cache, so no
// server function runs: the server wrapper and the sign-in check are stand-ins.
vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
// The screen is drawn here without a router; the leave guard (useBlocker) is pinned in source.
vi.mock("@tanstack/react-router", () => ({
  useBlocker: () => ({ status: "idle", proceed: () => {}, reset: () => {} }),
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { InventoryCountTab } from "@/components/inventory-count-tab";
import type { CountSheet, CountSummary } from "@/lib/inventory-count.functions";
import {
  BLANK_LINE,
  fmtDay,
  groupByCategory,
  lineFromProduct,
  lineKey,
  lineState,
  matchesSearch,
  NOT_A_COUNT,
  NOT_A_PRICE,
  printSheetFileName,
  printSheetRows,
  saveLines,
  searchProducts,
  sheetSummary,
  signedQty,
  TOO_BIG,
  typedCount,
  type CountProduct,
  type SheetLine,
  type TypedLine,
} from "@/lib/inventory-count-sheet";
import { officeToday } from "@/lib/inventory-year-end";
import { pieceFromCountedNotes } from "@/lib/stock-units";

const FASTENER = { name: "fastener", perPack: 1000 };
const CARTRIDGE = { name: "cartridge", perPack: 4 };

function line(over: Partial<SheetLine> & { row_label: string }): SheetLine {
  return {
    screen_id: "service",
    price_col: "price",
    item: over.row_label,
    colour: "",
    category: "Service",
    unit: "each",
    piece: null,
    item_nos: [],
    expected: 0,
    avg: null,
    estimated: false,
    ...over,
  };
}
const typed = (packs: string, pieces = "", cost = ""): TypedLine => ({ packs, pieces, cost });
const ADMIN = { opening: false, dollars: true };
const CREW = { opening: false, dollars: false };

describe("typedCount: what a line's boxes mean", () => {
  it("is not counted while every box is blank", () => {
    expect(typedCount("", "", "pail", null)).toBeNull();
    expect(typedCount("  ", " ", "box", FASTENER)).toBeNull();
  });

  it("reads one box in the stock unit", () => {
    expect(typedCount("3", "", "pail", null)).toEqual({ counted: 3, note: null });
    expect(typedCount(" 4.5 ", "", "pail", null)).toEqual({ counted: 4.5, note: null });
    // 1.23456 to 3 decimals: 1.235 (the 4th decimal, 5, rounds the 4 up).
    expect(typedCount("1.23456", "", "pail", null)).toEqual({ counted: 1.235, note: null });
  });

  it("takes a typed 0 as a count: a shelf can be empty", () => {
    expect(typedCount("0", "", "pail", null)).toEqual({ counted: 0, note: null });
    expect(typedCount("0", "0", "box", FASTENER)).toEqual({
      counted: 0,
      note: "0 boxes + 0 fasteners",
    });
  });

  it("adds whole packs and loose pieces", () => {
    // 2 boxes + 150 of 1,000 = 2 + 150 / 1000 = 2 + 0.15 = 2.15
    expect(typedCount("2", "150", "box", FASTENER)).toEqual({
      counted: 2.15,
      note: "2 boxes + 150 fasteners",
    });
    // 1 case + 3 of 4 cartridges = 1 + 3 / 4 = 1.75
    expect(typedCount("1", "3", "4-Cartridge Case", CARTRIDGE)).toEqual({
      counted: 1.75,
      note: "1 4-Cartridge Case + 3 cartridges",
    });
    // 1 box + 1 of 1,000 = 1.001; one of each reads in the singular.
    expect(typedCount("1", "1", "box", FASTENER)).toEqual({
      counted: 1.001,
      note: "1 box + 1 fastener",
    });
  });

  it("takes loose pieces alone, and whole packs alone", () => {
    // 150 of 1,000 = 0.15
    expect(typedCount("", "150", "box", FASTENER)).toEqual({
      counted: 0.15,
      note: "0 boxes + 150 fasteners",
    });
    // Whole boxes only: the number says it all, so there is no note.
    expect(typedCount("2", "", "box", FASTENER)).toEqual({ counted: 2, note: null });
  });

  it("rounds to 3 decimals, as the count is stored", () => {
    // 1 of 12 = 0.08333… → 0.083
    expect(typedCount("0", "1", "case", { name: "cartridge", perPack: 12 })).toEqual({
      counted: 0.083,
      note: "0 cases + 1 cartridge",
    });
    // 2 of 3 = 0.66666… → 0.667
    expect(typedCount("", "2", "pail", { name: "gallon", perPack: 3 })).toEqual({
      counted: 0.667,
      note: "0 pails + 2 gallons",
    });
  });

  it("ignores the pieces box when the item has no pieces", () => {
    expect(typedCount("2", "999", "pail", null)).toEqual({ counted: 2, note: null });
    expect(typedCount("2", "junk", "pail", null)).toEqual({ counted: 2, note: null });
    expect(typedCount("", "999", "pail", null)).toBeNull();
    // A pack that holds nothing is not a pack of pieces.
    expect(typedCount("2", "5", "box", { name: "part", perPack: 0 })).toEqual({
      counted: 2,
      note: null,
    });
  });

  it("reads 1,000 as one thousand", () => {
    expect(typedCount("1,000", "", "each", null)).toEqual({ counted: 1000, note: null });
    // 1,250 of 1,000 = 1.25
    expect(typedCount("", "1,250", "box", FASTENER)).toEqual({
      counted: 1.25,
      note: "0 boxes + 1250 fasteners",
    });
  });

  it("refuses what is not a number at or above zero", () => {
    for (const bad of ["-1", "abc", "1e3", ".", "2,5", "1.2.3", "0x10", "Infinity", "+2"])
      expect(typedCount(bad, "", "pail", null), bad).toEqual({ error: NOT_A_COUNT });
    expect(typedCount("2", "-5", "box", FASTENER)).toEqual({ error: NOT_A_COUNT });
    expect(typedCount("", "many", "box", FASTENER)).toEqual({ error: NOT_A_COUNT });
  });

  it("refuses a count above what a save accepts (10,000,000)", () => {
    expect(typedCount("10000000", "", "each", null)).toEqual({ counted: 10_000_000, note: null });
    expect(typedCount("10000001", "", "each", null)).toEqual({ error: TOO_BIG });
  });

  it("never writes a note that reads as a pack size", () => {
    // The note is kept on the correcting entry, whose quantity is the DIFFERENCE. A note of the
    // shape "150 fasteners" there would be read back as "one box holds 150 / difference"
    // (stock-units.ts pieceFromCountedNotes), so the note always names both amounts.
    for (const [packs, pieces] of [
      ["2", "150"],
      ["", "150"],
      ["0", "1"],
      ["3", "0"],
    ] as const) {
      const r = typedCount(packs, pieces, "box", FASTENER);
      if (!r || "error" in r || r.note == null) throw new Error("expected a note");
      expect(pieceFromCountedNotes([{ qty: -0.5, counted_note: r.note }])).toBeNull();
    }
  });
});

describe("lineState: one line of the sheet", () => {
  it("works the owner's example: 20 expected, 17 counted, average $98.75", () => {
    // 17 − 20 = −3;  −3 × 98.75 = −296.25
    const s = lineState(
      line({ row_label: "Box of plates", unit: "box", expected: 20, avg: 98.75 }),
      typed("17"),
      ADMIN,
    );
    expect(s.counted).toBe(17);
    expect(s.diff).toBe(-3);
    expect(s.value).toBe(-296.25);
    expect(s.costShown).toBe(false);
    expect(s.error).toBeNull();
  });

  it("is not counted while blank, and has no difference", () => {
    const l = line({ row_label: "Tape", expected: 4, avg: 10 });
    for (const t of [undefined, BLANK_LINE, typed("", "", "12")]) {
      const s = lineState(l, t, ADMIN);
      expect(s.counted).toBeNull();
      expect(s.diff).toBeNull();
      expect(s.value).toBeNull();
      expect(s.costShown).toBe(false);
      expect(s.unitCost).toBeNull();
    }
  });

  it("carries a typing mistake as an error, not as a count", () => {
    const s = lineState(line({ row_label: "Tape", expected: 4, avg: 10 }), typed("-2"), ADMIN);
    expect(s.counted).toBeNull();
    expect(s.error).toBe(NOT_A_COUNT);
  });

  it("matches at zero dollars even when no cost is known", () => {
    const s = lineState(line({ row_label: "Tape", expected: 5, avg: null }), typed("5"), ADMIN);
    expect(s.diff).toBe(0);
    expect(s.value).toBe(0);
    expect(s.costShown).toBe(false);
  });

  it("counts a pack of pieces against what is expected", () => {
    // 2 boxes + 150 of 1,000 = 2.15;  2.15 − 3 = −0.85;  −0.85 × 40 = −34
    const l = line({ row_label: "Screws", unit: "box", piece: FASTENER, expected: 3, avg: 40 });
    const s = lineState(l, typed("2", "150"), ADMIN);
    expect(s.counted).toBe(2.15);
    expect(s.note).toBe("2 boxes + 150 fasteners");
    expect(s.diff).toBe(-0.85);
    expect(s.value).toBeCloseTo(-34, 9);
    // 2.15 − 2.15 = 0
    expect(lineState({ ...l, expected: 2.15 }, typed("2", "150"), ADMIN).diff).toBe(0);
  });

  it("shows no dollars to someone who may not see them", () => {
    // The server sends no average either; nothing here may put a dollar on the screen.
    const s = lineState(line({ row_label: "Tape", expected: 0, avg: null }), typed("4"), CREW);
    expect(s.diff).toBe(4);
    expect(s.value).toBeNull();
    expect(s.costShown).toBe(false);
    expect(
      lineState(line({ row_label: "Tape", expected: 0 }), typed("4", "", "9"), {
        opening: true,
        dollars: false,
      }).unitCost,
    ).toBeNull();
    // A match is "0" in units and still nothing in dollars.
    expect(lineState(line({ row_label: "Tape", expected: 4 }), typed("4"), CREW).value).toBeNull();
  });

  it("offers the cost box for stock found with no cost known", () => {
    const l = line({ row_label: "New item", expected: 0, avg: null });
    // 4 − 0 = +4, cost unknown.
    const blank = lineState(l, typed("4"), ADMIN);
    expect(blank.costShown).toBe(true);
    expect(blank.unitCost).toBeNull();
    expect(blank.value).toBeNull();
    // 4 × $12.50 = $50.00: the cost typed is what the stock comes in at.
    const priced = lineState(l, typed("4", "", "12.50"), ADMIN);
    expect(priced.unitCost).toBe(12.5);
    expect(priced.value).toBe(50);
    // "$1,250.50" is 1250.5;  4 × 1250.5 = 5002
    expect(lineState(l, typed("4", "", "$1,250.50"), ADMIN).value).toBe(5002);
  });

  it("offers the cost box on an opening count even when an average is known", () => {
    const l = line({ row_label: "Pail", unit: "pail", expected: 10, avg: 90 });
    const opening = { opening: true, dollars: true };
    // 12 − 10 = +2;  no cost typed: 2 × the $90 average = $180
    const blank = lineState(l, typed("12"), opening);
    expect(blank.costShown).toBe(true);
    expect(blank.value).toBe(180);
    // cost typed: 2 × $100 = $200
    expect(lineState(l, typed("12", "", "100"), opening).value).toBe(200);
    // Not an opening count: no cost box, and a cost left in the box counts for nothing.
    const plain = lineState(l, typed("12", "", "100"), ADMIN);
    expect(plain.costShown).toBe(false);
    expect(plain.unitCost).toBeNull();
    expect(plain.value).toBe(180);
  });

  it("offers no cost box for a line counted at or below what is expected", () => {
    const l = line({ row_label: "Pail", expected: 10, avg: null });
    const opening = { opening: true, dollars: true };
    expect(lineState(l, typed("10"), opening).costShown).toBe(false);
    // 8 − 10 = −2, cost unknown.
    const under = lineState(l, typed("8", "", "100"), opening);
    expect(under.costShown).toBe(false);
    expect(under.unitCost).toBeNull();
    expect(under.value).toBeNull();
  });

  it("flags a cost that is not a price", () => {
    const l = line({ row_label: "New item", expected: 0, avg: null });
    const s = lineState(l, typed("4", "", "about ten"), ADMIN);
    expect(s.costError).toBe(NOT_A_PRICE);
    expect(s.unitCost).toBeNull();
    expect(lineState(l, typed("4", "", "1000001"), ADMIN).costError).toBe(TOO_BIG);
    expect(lineState(l, typed("4", "", "0"), ADMIN).unitCost).toBe(0);
  });
});

describe("sheetSummary: the line above the sheet", () => {
  const lines = [
    line({ row_label: "A", expected: 20, avg: 98.75 }), // 17: −3 × 98.75 = −296.25
    line({ row_label: "B", expected: 10, avg: 90 }), // 12: +2 × 90 = +180
    line({ row_label: "C", expected: 5, avg: 7 }), // 5: matches, 0
    line({ row_label: "D", expected: 9, avg: 7 }), // blank: not counted
    line({ row_label: "E", expected: 0, avg: null }), // 4: +4, no cost known
  ];
  const states = (texts: (string | undefined)[], opts = ADMIN) =>
    lines.map((l, i) => {
      const t = texts[i];
      return lineState(l, t == null ? undefined : typed(t), opts);
    });

  it("counts lines, differences and the net dollars that are known", () => {
    // counted: A B C E = 4 of 5;  differ: A B E = 3;  −296.25 + 180 = −116.25
    expect(sheetSummary(states(["17", "12", "5", undefined, "4"]))).toEqual({
      lines: 5,
      counted: 4,
      differ: 3,
      value: -116.25,
      missingCost: true,
      errors: 0,
    });
  });

  it("says nothing is missing when every differing line has a cost", () => {
    // counted: A B C = 3;  differ: A B = 2;  −296.25 + 180 = −116.25
    expect(sheetSummary(states(["17", "12", "5", undefined, undefined]))).toEqual({
      lines: 5,
      counted: 3,
      differ: 2,
      value: -116.25,
      missingCost: false,
      errors: 0,
    });
  });

  it("is all zeros for a sheet nobody has typed on", () => {
    expect(sheetSummary(states([]))).toEqual({
      lines: 5,
      counted: 0,
      differ: 0,
      value: 0,
      missingCost: false,
      errors: 0,
    });
  });

  it("counts typing mistakes apart from counted lines", () => {
    const s = sheetSummary(states(["17", "abc", "5", "-1", undefined]));
    // counted: A C = 2;  differ: A = 1;  mistakes: B D = 2
    expect(s).toMatchObject({ counted: 2, differ: 1, errors: 2, value: -296.25 });
  });

  it("adds to the cent", () => {
    // +1 × $0.10 = 0.10;  +2 × $0.10 = 0.20;  0.10 + 0.20 = 0.30 (not 0.30000000000000004)
    const s = sheetSummary([
      lineState(line({ row_label: "A", expected: 0, avg: 0.1 }), typed("1"), ADMIN),
      lineState(line({ row_label: "B", expected: 0, avg: 0.1 }), typed("2"), ADMIN),
    ]);
    expect(s.value).toBe(0.3);
  });
});

describe("saveLines: what a save sends", () => {
  const lines = [
    line({ row_label: "Plates", unit: "box", expected: 20, avg: 98.75 }),
    line({ row_label: "Screws", unit: "box", piece: FASTENER, expected: 3, avg: 40 }),
    line({ row_label: "Blank", expected: 9, avg: 7 }),
    line({ row_label: "Found", expected: 0, avg: null }),
    line({ row_label: "Found 2", price_col: "White", expected: 0, avg: null }),
    line({ row_label: "Mistake", expected: 1, avg: 1 }),
  ];
  const state: Record<string, TypedLine> = {
    [lineKey(lines[0]!)]: typed("17", "", "55"), // a cost left behind on a line with no cost box
    [lineKey(lines[1]!)]: typed("2", "150"),
    [lineKey(lines[2]!)]: typed("", ""),
    [lineKey(lines[3]!)]: typed("4", "", "12.50"),
    [lineKey(lines[4]!)]: typed("1"),
    [lineKey(lines[5]!)]: typed("x"),
  };

  it("sends only counted lines, a note for packs, a cost only where the box is shown", () => {
    expect(saveLines(lines, state, ADMIN)).toStrictEqual([
      { screen_id: "service", row_label: "Plates", price_col: "price", counted: 17 },
      {
        screen_id: "service",
        row_label: "Screws",
        price_col: "price",
        counted: 2.15,
        counted_note: "2 boxes + 150 fasteners",
      },
      {
        screen_id: "service",
        row_label: "Found",
        price_col: "price",
        counted: 4,
        unit_cost: 12.5,
      },
      { screen_id: "service", row_label: "Found 2", price_col: "White", counted: 1 },
    ]);
  });

  it("never sends a cost from someone who may not see dollars", () => {
    const sent = saveLines(lines, state, { opening: true, dollars: false });
    expect(sent).toHaveLength(4);
    for (const l of sent) expect("unit_cost" in l).toBe(false);
  });

  it("sends the cost of opening stock when the opening box is ticked", () => {
    // Plates: 17 is below the 20 expected, so even an opening count sends no cost for it.
    const more = { ...state, [lineKey(lines[0]!)]: typed("22", "", "55") };
    const sent = saveLines(lines, more, { opening: true, dollars: true });
    expect(sent[0]).toStrictEqual({
      screen_id: "service",
      row_label: "Plates",
      price_col: "price",
      counted: 22,
      unit_cost: 55,
    });
    expect(saveLines(lines, state, { opening: true, dollars: true })[0]).toStrictEqual({
      screen_id: "service",
      row_label: "Plates",
      price_col: "price",
      counted: 17,
    });
  });

  it("sends nothing from a blank sheet", () => {
    expect(saveLines(lines, {}, ADMIN)).toEqual([]);
  });
});

describe("search", () => {
  const screws = line({
    row_label: "HD screws",
    item: '#14 HD Screws 6"',
    colour: "White",
    category: "Fasteners & bits",
    item_nos: ["FA-1406", "88123"],
  });

  it("shows every line while the box is blank", () => {
    expect(matchesSearch(screws, "")).toBe(true);
    expect(matchesSearch(screws, "   ")).toBe(true);
  });

  it("finds a line by name, colour, category or item number, whatever the case", () => {
    expect(matchesSearch(screws, "hd SCREWS")).toBe(true);
    expect(matchesSearch(screws, "white")).toBe(true);
    expect(matchesSearch(screws, "fasteners")).toBe(true);
    expect(matchesSearch(screws, "fa-1406")).toBe(true);
    expect(matchesSearch(screws, "#88123")).toBe(true);
    expect(matchesSearch(screws, "tan")).toBe(false);
  });

  it("needs every word to be somewhere on the line", () => {
    expect(matchesSearch(screws, "screws white")).toBe(true);
    expect(matchesSearch(screws, "white 88123 hd")).toBe(true);
    expect(matchesSearch(screws, "screws tan")).toBe(false);
  });

  const product = (name: string, variant: string, itemNos: string[] = []): CountProduct => ({
    ref: { screen_id: "duro_last:corners", row_label: name, price_col: variant || "price" },
    key: `duro_last:corners|${name}|${variant || "price"}`,
    name,
    variant,
    category: "Corners",
    itemNos,
    unit: "each",
    piece: null,
  });
  const products = [
    product("Outside corner", "White", ["1100"]),
    product("Outside corner", "Tan", ["1101"]),
    product("Inside corner", "White", ["1200"]),
    product("Pipe stack", "", ["1100-B"]),
  ];

  it("finds products for Add an item, every word matching", () => {
    expect(searchProducts(products, "corner white").map((p) => p.name)).toEqual([
      "Inside corner",
      "Outside corner",
    ]);
    expect(searchProducts(products, "CORNERS tan").map((p) => p.variant)).toEqual(["Tan"]);
    expect(searchProducts(products, "gutter")).toEqual([]);
  });

  it("shows nothing until something is typed", () => {
    expect(searchProducts(products, "")).toEqual([]);
    expect(searchProducts(products, "  ")).toEqual([]);
  });

  it("puts an exact item number first", () => {
    // "1100" is also inside "1100-B"; the item whose number IS 1100 leads.
    expect(searchProducts(products, "1100").map((p) => p.name)).toEqual([
      "Outside corner",
      "Pipe stack",
    ]);
  });

  it("shows at most 20 matches", () => {
    const many = Array.from({ length: 45 }, (_, i) => product(`Corner ${i + 1}`, ""));
    const found = searchProducts(many, "corner");
    expect(found).toHaveLength(20);
    // Numbers sort as numbers: Corner 1, Corner 2 … Corner 20 (not 1, 10, 11 …).
    expect(found[1]?.name).toBe("Corner 2");
    expect(found[19]?.name).toBe("Corner 20");
    expect(searchProducts(many, "corner", 5)).toHaveLength(5);
  });

  it("turns a product into a sheet line that expects nothing", () => {
    const p: CountProduct = {
      ref: { screen_id: "duro_last:fasteners_and_bits", row_label: "HD screws", price_col: "6" },
      key: "duro_last:fasteners_and_bits|HD screws|6",
      name: "HD screws",
      variant: "6",
      category: "Fasteners",
      itemNos: ["88123"],
      unit: "box",
      piece: FASTENER,
    };
    expect(lineFromProduct(p)).toEqual({
      screen_id: "duro_last:fasteners_and_bits",
      row_label: "HD screws",
      price_col: "6",
      item: "HD screws",
      colour: "6",
      category: "Fasteners",
      unit: "box",
      piece: FASTENER,
      item_nos: ["88123"],
      expected: 0,
      avg: null,
      estimated: false,
    });
    expect(lineKey(lineFromProduct(p))).toBe("duro_last:fasteners_and_bits|HD screws|6");
  });
});

describe("groupByCategory: the sheet's headings", () => {
  it("keeps the order the lines came in, a heading per category", () => {
    const rows = [
      line({ row_label: "A1", category: "Adhesives" }),
      line({ row_label: "A2", category: "Adhesives" }),
      line({ row_label: "F1", category: "Fasteners" }),
      line({ row_label: "X", category: "" }),
      // An item added by hand lands at the end of its own category.
      line({ row_label: "A3", category: "Adhesives" }),
    ];
    const groups = groupByCategory(rows, (r) => r.category);
    expect(groups.map((g) => [g.category, g.rows.map((r) => r.row_label)])).toEqual([
      ["Adhesives", ["A1", "A2", "A3"]],
      ["Fasteners", ["F1"]],
      ["Other", ["X"]],
    ]);
  });
});

describe("the sheet to print", () => {
  it("lists every line with a blank Counted column", () => {
    const rows = printSheetRows({
      lines: [
        line({
          row_label: "Screws",
          item: 'HD Screws, 6"',
          colour: "White",
          category: "Fasteners",
          unit: "box",
          piece: FASTENER,
          expected: 2.15,
        }),
        line({ row_label: "Pail", category: "Adhesives", unit: "pail", expected: 3 }),
        // 1 / 3 kept to 3 decimals: 0.333
        line({ row_label: "Roll", category: "Membrane", unit: "sq ft", expected: 1 / 3 }),
      ],
    });
    expect(rows).toEqual([
      ["Category", "Item", "Colour", "Unit", "Expected", "Counted"],
      ["Fasteners", 'HD Screws, 6"', "White", "box", "2.15", ""],
      ["Adhesives", "Pail", "", "pail", "3", ""],
      ["Membrane", "Roll", "", "sq ft", "0.333", ""],
    ]);
  });

  it("is only the headings for an empty sheet", () => {
    expect(printSheetRows({ lines: [] })).toEqual([
      ["Category", "Item", "Colour", "Unit", "Expected", "Counted"],
    ]);
  });

  it("names the file after the place and the day", () => {
    expect(printSheetFileName("Shop", "2026-12-31")).toBe("count-sheet-shop-2026-12-31.csv");
    expect(printSheetFileName("Truck #2 (Ford)", "2026-11-16")).toBe(
      "count-sheet-truck-2-ford-2026-11-16.csv",
    );
    expect(printSheetFileName("  ", "2026-11-16")).toBe("count-sheet-place-2026-11-16.csv");
  });
});

describe("how numbers and days read", () => {
  it("keeps the sign on a difference, so it does not rest on colour", () => {
    expect(signedQty(2)).toBe("+2");
    expect(signedQty(-1.5)).toBe("−1.5");
    expect(signedQty(0)).toBe("0");
    // −0.85000000001 is float noise for −0.85
    expect(signedQty(-0.85000000001)).toBe("−0.85");
    expect(signedQty(1234.5)).toBe("+1234.5");
  });

  it("writes a day as a person does", () => {
    expect(fmtDay("2026-12-31")).toBe("Dec 31, 2026");
    expect(fmtDay("2026-01-03")).toBe("Jan 3, 2026");
    expect(fmtDay("")).toBe("");
  });
});

describe("the screen, drawn with a sheet and a saved count loaded", () => {
  const today = officeToday();
  const SHOP = { id: "shop", name: "Shop", kind: "shop" as const, sort: 0 };
  const TRUCK = { id: "truck-2", name: "Truck 2", kind: "vehicle" as const, sort: 1 };
  const COUNT_ID = "7b0f6f0e-0d0c-4c53-9a53-0d4b6c1f2a10";

  const sheetFor = (dollars: boolean): CountSheet => ({
    location_id: "shop",
    location_name: "Shop",
    counted_on: today,
    today,
    dollars,
    lines: [
      line({
        row_label: "Plates",
        category: "Fasteners",
        unit: "box",
        expected: 20,
        // The server sends no average to someone who may not see dollars.
        avg: dollars ? 98.75 : null,
      }),
      line({
        row_label: "Screws",
        colour: "White",
        category: "Fasteners",
        unit: "box",
        piece: FASTENER,
        item_nos: ["88123"],
        expected: 2.15,
        avg: dollars ? 40 : null,
        estimated: dollars,
      }),
      line({ row_label: "Tape", category: "Sealants", unit: "tube", expected: -2 }),
    ],
  });
  const pastFor = (dollars: boolean): CountSummary[] => [
    {
      id: COUNT_ID,
      location_id: "shop",
      location_name: "Shop",
      counted_on: "2026-10-31",
      opening: true,
      note: "First load",
      by_name: "Dana",
      created_at: "2026-11-01T14:00:00.000Z",
      lines: 12,
      differences: 3,
      value: dollars ? -116.25 : null,
      dollars,
    },
  ];

  function draw(seed: { sheet?: CountSheet; past?: CountSummary[] }) {
    const qc = new QueryClient();
    if (seed.sheet) qc.setQueryData(["inventory-count-sheet", "shop", today], seed.sheet);
    if (seed.past) qc.setQueryData(["inventory-counts"], seed.past);
    return renderToString(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(InventoryCountTab, {
          locations: [SHOP, TRUCK],
          products: [],
          onSaved: () => {},
        }),
      ),
    ).replace(/<!-- -->/g, "");
  }
  /** Every opening tag that carries the attribute (not one whose name only starts with it). */
  const tags = (html: string, attr: string) =>
    html.match(new RegExp(`<[a-z]+[^>]*\\s${attr}(?=[=\\s>])[^>]*>`, "g")) ?? [];

  it("shows the dollar column and the net dollars to an admin or a manager", () => {
    const html = draw({ sheet: sheetFor(true), past: pastFor(true) });
    expect(html).toContain("Difference ($)");
    expect(tags(html, "data-count-value")).toHaveLength(3);
    // Nothing is typed yet: 0 of 3 counted, nothing differs, $0.00.
    expect(html).toMatch(
      /data-count-summary[^>]*>0 of 3 lines counted · 0 differ · net difference \$0\.00</,
    );
    expect(html).toContain("Value of differences");
    expect(html).toContain("-$116.25");
    // No line is counted above expected yet, so no cost box.
    expect(tags(html, "data-count-cost")).toHaveLength(0);
  });

  it("shows no dollar column, no cost box and no dollar sign to anyone else", () => {
    const html = draw({ sheet: sheetFor(false), past: pastFor(false) });
    expect(tags(html, "data-count-line")).toHaveLength(3);
    expect(html).toMatch(/data-count-summary[^>]*>0 of 3 lines counted · 0 differ</);
    expect(html).not.toContain("Difference ($)");
    expect(html).not.toContain("Value of differences");
    expect(html).not.toContain("net difference");
    expect(tags(html, "data-count-value")).toHaveLength(0);
    expect(tags(html, "data-count-cost")).toHaveLength(0);
    expect(html).not.toContain("estimate");
    expect(html).not.toContain("$");
  });

  it("starts every count box blank", () => {
    const html = draw({ sheet: sheetFor(true), past: [] });
    const boxes = [...tags(html, "data-count-input"), ...tags(html, "data-count-pieces")];
    // Three lines, and the box of screws has a second box for loose fasteners: 3 + 1 = 4.
    expect(boxes).toHaveLength(4);
    for (const box of boxes) {
      expect(box).toMatch(/^<input/);
      expect(box).toContain('value=""');
      expect(box).toContain('inputMode="decimal"');
      expect(box).not.toContain('type="number"');
    }
    expect(tags(html, "data-count-pieces")).toHaveLength(1);
    expect(html).toContain("loose fasteners");
    expect(html).toContain("whole boxes");
    // With nothing counted there is nothing to save.
    expect(tags(html, "data-count-save")[0]).toContain('disabled=""');
    expect(tags(html, "data-count-diff")).toHaveLength(3);
    expect(html).toMatch(/data-count-diff[^>]*><\/td>/);
  });

  it("keeps every box a person types in at 16px, so a phone does not zoom in on it", () => {
    const html = draw({ sheet: sheetFor(true), past: [] });
    // The tick box keeps a hidden input of its own; it is never typed in.
    const inputs = (html.match(/<input[^>]*>/g) ?? []).filter((t) => !t.includes("aria-hidden"));
    // Place is a button; the boxes are the day, the note, the search and the 4 count boxes.
    expect(inputs).toHaveLength(7);
    for (const box of inputs) {
      const classes = (/class="([^"]*)"/.exec(box)?.[1] ?? "").split(" ");
      expect(classes).toContain("text-base");
      expect(classes).toContain("md:text-base");
      // The plain input shrinks to 14px on a wide screen (md:text-sm); these must not.
      expect(classes).not.toContain("md:text-sm");
      expect(classes).not.toContain("text-sm");
    }
  });

  it("reads like the Stock tab: names, item numbers and what is expected", () => {
    const html = draw({ sheet: sheetFor(true), past: [] });
    expect(tags(html, "data-count-tab")).toHaveLength(1);
    expect(html).toContain('data-count-line="service|Screws|price"');
    expect(html).toContain("Count sheet: Shop, ");
    expect(html).toContain("Screws · White");
    expect(html).toContain("#88123");
    expect(html).toContain("20 boxes");
    // 2.15 boxes of 1,000 = 2,150 fasteners
    expect(html).toContain("2.15 boxes");
    expect(html).toContain("2150 fasteners");
    expect(html).toContain("-2 tubes");
    // Headings in the order the server sent the lines.
    expect(html.indexOf(">Fasteners<")).toBeGreaterThan(-1);
    expect(html.indexOf(">Sealants<")).toBeGreaterThan(html.indexOf(">Fasteners<"));
  });

  it("lists past counts, newest first as the server sends them", () => {
    const html = draw({ sheet: sheetFor(false), past: pastFor(false) });
    expect(tags(html, "data-count-past")).toHaveLength(1);
    expect(html).toContain(`data-count-past-row="${COUNT_ID}"`);
    expect(html).toContain("Oct 31, 2026");
    expect(html).toContain("Opening count");
    expect(html).toContain("First load");
    expect(html).toContain("Dana");
    expect(html).toContain(">View<");
    expect(html).toContain("Export");
  });

  it("says so while it loads, and when nothing has been saved", () => {
    const loading = draw({});
    expect(loading).toContain("Loading the count sheet…");
    expect(loading).toContain("Loading past counts…");
    expect(draw({ sheet: sheetFor(false), past: [] })).toContain("No counts saved yet.");
  });

  it("puts the plain-words help where the brief asks for it", () => {
    const html = draw({ sheet: sheetFor(false), past: [] });
    expect(html).toContain(
      "Counting for an earlier day? Pick that day. The count is compared with what inventory held at the end of it.",
    );
    expect(html).toContain("This is the opening count");
    expect(html).toContain(
      "Tick this only for the first count, when stock is being loaded into inventory. Stock you count comes in as opening stock.",
    );
    expect(html).toMatch(
      new RegExp(`<input[^>]*type="date"[^>]*max="${today}"[^>]*value="${today}"`),
    );
    expect(html).toContain("Count every blank line as zero");
    expect(html).toContain("Download the sheet to print");
    expect(html).toContain("Add an item");
  });
});

describe("the screen's source", () => {
  const src = readFileSync("src/components/inventory-count-tab.tsx", "utf8");
  /** Every place `needle` appears has `guard` within the `within` characters before it. */
  const guarded = (needle: string, guard: RegExp, within = 400) => {
    let at = src.indexOf(needle);
    expect(at, `${needle} is on the screen`).toBeGreaterThan(-1);
    while (at !== -1) {
      expect(src.slice(Math.max(0, at - within), at), `${needle} at ${at}`).toMatch(guard);
      at = src.indexOf(needle, at + needle.length);
    }
  };

  it("renders a dollar column only when the server says the reader sees dollars", () => {
    const whenDollars = /[dD]ollars(?: &&| \?)/;
    guarded("Difference ($)", whenDollars);
    guarded("data-count-value", whenDollars);
    guarded("data-count-cost", whenDollars);
    guarded("Value of differences", whenDollars);
    guarded("net difference", whenDollars);
    // The flag is the server's: the sheet's, and each saved count's.
    expect(src).toMatch(/sheet\.dollars/);
    expect(src).toMatch(/\.dollars\b/);
    // No dollar sign is written by hand: every amount goes through fmtDollars.
    expect(src).not.toMatch(/>\s*\$[^{]/);
    expect(src).not.toMatch(/`\$\$\{/);
  });

  it("starts every number box blank, never at 0", () => {
    expect(src).toMatch(/data-count-input/);
    expect(src).not.toMatch(/defaultValue/);
    expect(src).not.toMatch(/value=\{[^}]*\?\?\s*["']?0/);
    expect(src).not.toMatch(/value=\{0\}|value="0"/);
    expect(src).not.toMatch(/placeholder="0"/);
    expect(src).not.toMatch(/useState\((?:0|"0")\)/);
    expect(src).toMatch(/inputMode="decimal"/);
  });

  it("saves through the server function, called the way the rest of the app calls one", () => {
    expect(src).toMatch(/useServerFn\(saveCount\)/);
    expect(src).toMatch(/useServerFn\(getCountSheet\)/);
    expect(src).toMatch(/useServerFn\(listCounts\)/);
    expect(src).toMatch(/useServerFn\(getCount\)/);
    expect(src).toMatch(/useServerFn\(exportCountCsv\)/);
    expect(src).toMatch(/\["inventory-count-sheet", /);
    expect(src).toMatch(/queryKey: \["inventory-counts"\]/);
  });

  it("asks with the app's own dialog, never the browser's", () => {
    expect(src).toMatch(/AlertDialogContent/);
    expect(src).toMatch(/from "@\/components\/ui\/alert-dialog"/);
    expect(src).not.toMatch(/window\.confirm|\bconfirm\(|\balert\(|window\.prompt/);
  });

  it("says inventory, in plain words", () => {
    // Words inside quotes or between tags: what a person reads. Comments are left out.
    const code = src.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bthe app\b|\bthe system\b/i);
    expect(code).not.toMatch(/\bledger\b|\bdelta\b|\bRPC\b/i);
  });

  it("exports the tab and nothing else", () => {
    const exported = [...src.matchAll(/^export\s+(?:\w+\s+)*?(\w+)\s*[(<{=:]/gm)].map((m) => m[1]);
    expect(src.match(/^export /gm)).toHaveLength(1);
    expect(exported).toEqual(["InventoryCountTab"]);
  });
});

describe("leaving the sheet with counts typed", () => {
  const src = readFileSync("src/components/inventory-count-tab.tsx", "utf8");
  // Another Inventory tab is a router link: without a guard there, a mis-tap on "History"
  // dropped an hour of typed counts without a word.
  it("asks through the router, for a tab, the menu or a link, and on closing the page", () => {
    expect(src).toContain('import { useBlocker } from "@tanstack/react-router";');
    expect(src).toContain("shouldBlockFn: () => typedRef.current,");
    expect(src).toContain("enableBeforeUnload: () => typedRef.current,");
    expect(src).toContain('open={blocker.status === "blocked"}');
    expect(src).toContain("Leave the count sheet?");
    expect(src).toContain("Stay on the sheet");
    expect(src).toContain("Leave without saving");
    expect(src).not.toContain("window.confirm");
  });
});

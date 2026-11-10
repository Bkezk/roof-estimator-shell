/**
 * Speed pass, Nov 10, finding 6: Inventory's stock list asked the database for each stocked
 * item's pack size one item after another — two reads an item (the item's price screen, then the
 * service material list): 0.77 s with ten items, about 6 s at a hundred. The same loop sat in a
 * truck's stock (myTruckStock), the Export dialog's reports and the close-out's material list.
 *
 * Now the screens the cells sit on are read ONCE (`pieceDefsForCells`) and each cell is worked
 * out in memory by the same rules (`cellUnitFrom`, which `cellUnit` also runs). Both paths are
 * fed the same rows here and must agree, cell for cell.
 *
 * Fails on the old code: no pieceDefsForCells / cellUnitFrom; the four loops call cellUnit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { cellUnit, cellUnitFrom, pieceDefsForCells } from "@/lib/inventory.functions";
import { SERVICE_STOCK_SCREEN } from "@/lib/service-materials";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");

const FASTENERS = {
  id: "duro_last:fasteners_and_bits",
  branch: "duro_last",
  category: "Fasteners & Bits",
  data: {
    columns: ["Description", "Subtype", "Fasteners/Box", "Price/Box"],
    rows: [
      { Description: '2"', Subtype: "HD", "Fasteners/Box": 1000 },
      { Description: '3"', Subtype: "XHD", "Fasteners/Box": 500 },
    ],
  },
};
const ADHESIVES = {
  id: "duro_last:adhesives",
  branch: "duro_last",
  category: "Adhesives",
  data: {
    kind: "adhesives",
    products: [
      { name: "Quick Prime", unit_type: "1-gal can" },
      { name: "Duro-Fleece Adhesive", unit_type: "4-cartridge case" },
      { name: "Box Set Glue", unit_type: "15 gal Box Set" },
    ],
  },
};
const UNDERLAY = {
  id: "duro_last:underlayment",
  branch: "duro_last",
  category: "Underlayment",
  data: { columns: ["Description", "Price"], rows: [{ Description: '1" ISO' }] },
};
const MATERIALS: Row[] = [
  // A service material of its own (no catalog twin): whole units, no pieces.
  { id: "m1", name: "Acetone", unit: "Gal", sort: 1, active: true, stock_screen_id: null },
  // A twin counted in its own unit against the catalog's stock: a board is 32 sq ft.
  {
    id: "m2",
    name: '1" ISO board',
    unit: "Board",
    sort: 2,
    active: true,
    stock_screen_id: UNDERLAY.id,
    stock_row_label: '1" ISO',
    stock_price_col: "Price",
    stock_per_unit: 32,
    piece_name: "board",
  },
];

const CELLS = [
  { screen_id: FASTENERS.id, row_label: '2"', price_col: "Price/Box" },
  { screen_id: FASTENERS.id, row_label: '3"', price_col: "Price/Box" },
  { screen_id: ADHESIVES.id, row_label: "Quick Prime", price_col: "price" },
  { screen_id: ADHESIVES.id, row_label: "Duro-Fleece Adhesive", price_col: "price" },
  { screen_id: ADHESIVES.id, row_label: "Box Set Glue", price_col: "price" },
  { screen_id: UNDERLAY.id, row_label: '1" ISO', price_col: "Price" },
  { screen_id: SERVICE_STOCK_SCREEN, row_label: "Acetone", price_col: "price" },
  // Cells cellUnit refuses: a row renamed since, a column that is not a price, a screen gone,
  // a service material taken off the list. Each has no pieces, as before.
  { screen_id: FASTENERS.id, row_label: '9" (renamed)', price_col: "Price/Box" },
  { screen_id: FASTENERS.id, row_label: '2"', price_col: "Description" },
  { screen_id: "duro_last:gone", row_label: "x", price_col: "Price" },
  { screen_id: SERVICE_STOCK_SCREEN, row_label: "Not on the list", price_col: "price" },
  // The same cell twice (two locations hold it): one answer.
  { screen_id: FASTENERS.id, row_label: '2"', price_col: "Price/Box" },
];

/** A stand-in that counts the reads of each table. */
function world() {
  const env = fakeSupabase({
    pricing_catalog_units: [FASTENERS, ADHESIVES, UNDERLAY],
    service_materials_catalog: MATERIALS.map((m) => ({ ...m })),
  });
  const reads: Record<string, number> = {};
  const inner = env.db as unknown as { from: (t: string) => unknown };
  const db = {
    ...(env.db as object),
    from: (t: string) => {
      reads[t] = (reads[t] ?? 0) + 1;
      return inner.from(t);
    },
  };
  return { db: db as never, reads };
}

/** The old path: cellUnit for one cell after another, a refusal meaning "no pieces". */
async function oneByOne(db: never) {
  const out = [];
  for (const c of CELLS) {
    try {
      out.push((await cellUnit(db, c)).piece);
    } catch {
      out.push(null);
    }
  }
  return out;
}

describe("the pack size of every stocked item, from one read", () => {
  it("the same answers as asking cell by cell", async () => {
    const old = world();
    const before = await oneByOne(old.db);
    const now = world();
    const pieceOf = await pieceDefsForCells(now.db, CELLS);
    expect(CELLS.map(pieceOf)).toEqual(before);
    // And the answers are the real ones, not eleven nulls.
    expect(before).toEqual([
      { name: "fastener", perPack: 1000 },
      { name: "fastener", perPack: 500 },
      { name: "gallon", perPack: 1 },
      { name: "cartridge", perPack: 4 },
      null,
      { name: "board", perPack: 1 / 32 },
      null,
      null,
      null,
      null,
      null,
      { name: "fastener", perPack: 1000 },
    ]);
  });
  it("one read of the screens and one of the material list, whatever the number of items", async () => {
    const old = world();
    await oneByOne(old.db);
    // Cell by cell: a screen read for each catalog cell and the material list for every cell.
    expect(old.reads["pricing_catalog_units"]).toBe(10);
    expect(old.reads["service_materials_catalog"]).toBeGreaterThanOrEqual(9);
    const now = world();
    await pieceDefsForCells(now.db, CELLS);
    expect(now.reads).toEqual({ pricing_catalog_units: 1, service_materials_catalog: 1 });
    // A caller that has the material list already (the stock lists do) passes it in.
    const withList = world();
    const { loadServiceMaterialLinks } = await import("@/lib/service-materials.server");
    const materials = await loadServiceMaterialLinks(withList.db);
    withList.reads["service_materials_catalog"] = 0;
    await pieceDefsForCells(withList.db, CELLS, materials);
    expect(withList.reads).toEqual({ pricing_catalog_units: 1, service_materials_catalog: 0 });
  });
  it("a hundred stocked items are still two reads", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      screen_id: i % 2 ? FASTENERS.id : ADHESIVES.id,
      row_label: `item ${i}`,
      price_col: "Price/Box",
    }));
    const w = world();
    const pieceOf = await pieceDefsForCells(w.db, [...many, ...CELLS]);
    expect(w.reads).toEqual({ pricing_catalog_units: 1, service_materials_catalog: 1 });
    expect(pieceOf(CELLS[0]!)).toEqual({ name: "fastener", perPack: 1000 });
    expect(pieceOf(many[3]!)).toBeNull();
  });
  it("only service materials stocked: no screen is read at all; nothing stocked: nothing is read", async () => {
    const w = world();
    const pieceOf = await pieceDefsForCells(w.db, [CELLS[6]!]);
    expect(w.reads).toEqual({ service_materials_catalog: 1 });
    expect(pieceOf(CELLS[6]!)).toBeNull();
    const none = world();
    expect((await pieceDefsForCells(none.db, []))(CELLS[0]!)).toBeNull();
    expect(none.reads).toEqual({});
  });
  it("cellUnitFrom is cellUnit's rule: the unit too, and the same refusals in the same words", async () => {
    const { loadServiceMaterialLinks } = await import("@/lib/service-materials.server");
    const w = world();
    const materials = await loadServiceMaterialLinks(w.db);
    expect(cellUnitFrom(CELLS[2]!, ADHESIVES, materials)).toEqual(await cellUnit(w.db, CELLS[2]!));
    expect(cellUnitFrom(CELLS[6]!, null, materials)).toEqual(await cellUnit(w.db, CELLS[6]!));
    for (const [cell, screen] of [
      [CELLS[7]!, FASTENERS],
      [CELLS[8]!, FASTENERS],
      [CELLS[9]!, null],
      [CELLS[10]!, null],
    ] as const) {
      const said = await cellUnit(w.db, cell).then(
        () => "no refusal",
        (e: Error) => e.message,
      );
      expect(() => cellUnitFrom(cell, screen, materials)).toThrow(said);
    }
  });
});

describe("the four lists use the one read", () => {
  it("Inventory's stock on hand and a truck's stock", () => {
    const s = read("src/lib/inventory.functions.ts");
    const stock = s.slice(
      s.indexOf("export async function readStock"),
      s.indexOf("async function readStockCells"),
    );
    expect(stock).toContain("await pieceDefsForCells(sb, [...byCell.values()], materials)");
    expect(stock).not.toContain("await cellUnit(");
    const truck = s.slice(s.indexOf("export const myTruckStock"));
    expect(truck).toContain("await pieceDefsForCells(sb, rows, materials)");
    expect(truck).not.toContain("await cellUnit(");
    // cellUnit itself (one cell: taking and putting back stock) still reads its one screen.
    expect(s).toMatch(
      /export async function cellUnit\([\s\S]*?\.select\("data"\)\s*\.eq\("id", cell\.screen_id\)/,
    );
  });
  it("the Export dialog's reports and the close-out's material list", () => {
    const x = read("src/lib/inventory-export.functions.ts");
    expect(x).toContain("pieceDefsForCells(sb, cells)");
    expect(x).not.toContain("cellUnit");
    const f = read("src/lib/service-field.functions.ts");
    const options = f.slice(f.indexOf("export const listServiceMaterialOptions"));
    expect(options).toContain("const catalogPiece = await pieceDefsForCells(");
    expect(options).not.toContain("await catalogPiece(");
    expect(f).not.toContain("cellUnit");
  });
});

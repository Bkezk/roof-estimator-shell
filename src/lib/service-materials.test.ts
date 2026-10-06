/**
 * Service material pricing (owner, Oct 6): "currently the materials pull from the bid estimate
 * pricing page, we need to separate the two. Do not change anything on the bid estimate pricing
 * side"; CenterPoint's materials with their prices on a Setup tab "Material pricing"; cost +
 * markup; one stock for items in both lists, auto-matched, with no "same stock as" control.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  SERVICE_STOCK_SCREEN,
  materialForCell,
  materialsByCell,
  packCostFor,
  sellPrice,
  serviceLabel,
  serviceStockTargets,
  stockCellOf,
  unitWord,
  type ServiceMaterialLink,
} from "@/lib/service-materials";

const own = (name: string, unit = "ea", active = true): ServiceMaterialLink => ({
  name,
  unit,
  active,
  stock_screen_id: null,
  stock_row_label: null,
  stock_price_col: null,
});
const twin = (name: string, row: string, sort = 0): ServiceMaterialLink & { sort: number } => ({
  name,
  unit: "Each",
  active: true,
  sort,
  stock_screen_id: "duro_last:pipe_stacks",
  stock_row_label: row,
  stock_price_col: "Price",
});

describe("the stock a service material is counted in", () => {
  it("is its bid-catalog twin when matched, else its own 'service' row by name", () => {
    expect(stockCellOf(twin('2" DL Open Stack', '2" Closed/Open'))).toEqual({
      screen_id: "duro_last:pipe_stacks",
      row_label: '2" Closed/Open',
      price_col: "Price",
    });
    expect(stockCellOf(own("Acetone"))).toEqual({
      screen_id: SERVICE_STOCK_SCREEN,
      row_label: "Acetone",
      price_col: "price",
    });
  });
  it("names and prices a shared cell by the first active material in list order", () => {
    const byCell = materialsByCell([
      { ...twin('2" DL Open Stack', '2" Closed/Open', 2), active: false },
      twin('2" DL Closed Stack', '2" Closed/Open', 1),
      twin('2" DL Open Stack', '2" Closed/Open', 0),
    ]);
    const cell = {
      screen_id: "duro_last:pipe_stacks",
      row_label: '2" Closed/Open',
      price_col: "Price",
    };
    expect(materialForCell(byCell, cell)?.sort).toBe(0);
    expect(serviceLabel(byCell, cell)).toBe('2" DL Open Stack');
    // A catalog cell no service material covers keeps the catalog label.
    expect(serviceLabel(byCell, { ...cell, price_col: "Tan Price" })).toBeNull();
  });
});

describe("prices", () => {
  it("bills cost × (1 + markup): Quick Prime $54.35 bills $95.11, as CenterPoint's 5431 did", () => {
    expect(sellPrice(54.35, 0.75)).toBe(95.11);
  });
  it("prices a stock pack from the per-piece price (a box of 1,000 plates at $0.27 each)", () => {
    expect(packCostFor(0.27, { name: "fastener", perPack: 1000 })).toBeCloseTo(270);
    expect(packCostFor(11.4, null)).toBe(11.4);
  });
  it("reads CenterPoint's units as one word each", () => {
    expect(["Each", "ea", "EACH", "1"].map(unitWord)).toEqual(["each", "each", "each", "each"]);
    expect(["SqFt", "sqft"].map(unitWord)).toEqual(["sq ft", "sq ft"]);
    expect(["LF", "Foot", "Lf"].map(unitWord)).toEqual(["ft", "ft", "ft"]);
    expect(unitWord("Tube")).toBe("tube");
  });
});

describe("the Inventory page's service group", () => {
  it("lists only active materials with no bid-catalog twin, in their own unit", () => {
    const [t] = serviceStockTargets([
      own("Splice Wash", "Gallon"),
      own("Acetone", "Gallon"),
      own("Old thing", "ea", false),
      twin('2" DL Open Stack', '2" Closed/Open'),
    ]);
    expect(t).toMatchObject({
      screen_id: "service",
      category: "Service materials",
      rows: ["Acetone", "Splice Wash"],
      price_cols: ["price"],
      row_units: { Acetone: "gal", "Splice Wash": "gal" },
    });
    expect(serviceStockTargets([twin("x", "y")])).toEqual([]);
  });
});

const PATH = "supabase/migrations/20261006130000_service_materials.sql";
const sql = existsSync(PATH) ? readFileSync(PATH, "utf8") : "";
const seed = [
  ...sql.matchAll(
    /^ \((\d+), '((?:[^']|'')*)', '([^']+)', ([\d.]+), (null|'(?:[^']|'')*'), (null|'(?:[^']|'')*'), (null|'(?:[^']|'')*')\)/gm,
  ),
].map((m) => ({
  name: m[2]!.replace(/''/g, "'"),
  unit: m[3]!,
  cost: Number(m[4]),
  screen: m[5] === "null" ? null : m[5]!.slice(1, -1),
  row: m[6] === "null" ? null : m[6]!.slice(1, -1).replace(/''/g, "'"),
  col: m[7] === "null" ? null : m[7]!.slice(1, -1),
}));
const one = (n: string) => seed.find((s) => s.name === n);

describe("the service materials migration", () => {
  it("seeds CenterPoint's 133 materials with their prices, as they are", () => {
    expect(seed).toHaveLength(133);
    expect(one("Quick Prime 1 Gal")).toMatchObject({ unit: "Gal", cost: 54.35, screen: null });
    expect(one("Uniflex One Flash Sealant")).toMatchObject({ unit: "Gallon", cost: 113.75 });
    expect(seed.filter((s) => s.name === "Duro-Caulk White")).toHaveLength(2);
    expect(sql).toMatch(/where not exists \(select 1 from public\.service_materials\);/);
  });
  it("auto-matches 79 to the same stock as a bid-catalog product, by name and unit", () => {
    expect(seed.filter((s) => s.screen)).toHaveLength(79);
    expect(one('2" DL Open Stack')).toMatchObject({
      screen: "duro_last:pipe_stacks",
      row: '2" Closed/Open',
      col: "Price",
    });
    expect(one('Drain Boot 2-1/2"')).toMatchObject({ row: '2 1/2" Drain Boot' });
    expect(one('CDR 2-1/2"')).toMatchObject({ row: '2 1/2" Drain Ring' });
    expect(one('Plate 2" Poly Round')).toMatchObject({
      screen: "duro_last:fasteners_and_bits",
      row: '2" Poly Plates',
    });
    // A unit that does not match the catalog's stays its own stock (strip mastic by the foot
    // is not the catalog's pail).
    expect(one("Duro-Mastic Strip Mastic")?.screen).toBeNull();
    expect(one("Acetone")?.screen).toBeNull();
  });
  it("never writes Estimate Pricing", () => {
    expect(sql).not.toMatch(
      /(update|insert into|delete from|alter table)\s+public\.pricing_catalog/i,
    );
  });
  it("keeps the cost from technicians and gives them the names", () => {
    expect(sql).toMatch(
      /create policy service_materials_read[\s\S]*?not public\.is_technician\(\)/,
    );
    const view = /create or replace view public\.service_materials_catalog[\s\S]*?;/.exec(sql)?.[0];
    expect(view).toBeDefined();
    expect(view).not.toMatch(/\bcost\b/);
  });
  it("keeps a service-only name unique and renames its stock with it", () => {
    expect(sql).toMatch(/unique index[\s\S]*?\(name\) where stock_screen_id is null/);
    expect(sql).toMatch(/update public\.inventory_movements\s+set row_label = new\.name/);
  });
});

describe("the wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("prices a ticket's materials from the service list, the catalog only as a fallback", () => {
    const inv = read("src/lib/invoices.server.ts");
    expect(inv).toContain("materialsByCell(await loadServiceMaterials(sb))");
    expect(inv).toContain("packCostFor(material.cost, piece)");
    expect(inv).toContain("material ? null : cellCost(sb, c)");
  });
  it("stocks a service-only material in its own unit", () => {
    expect(read("src/lib/inventory.functions.ts")).toMatch(
      /if \(cell\.screen_id === SERVICE_STOCK_SCREEN\) \{[\s\S]*?unitWord\(m\.unit\)/,
    );
  });
  it("shows the service names on the ticket's material list", () => {
    const ms = read("src/components/service/materials-section.tsx");
    expect(ms).toContain("{cellName(row)}");
    expect(ms).toContain("label: r.label,");
  });
  it("has a Material pricing tab on Setup and no 'same stock as' control", () => {
    expect(read("src/routes/setup.tsx")).toContain("<MaterialPricingSettings />");
    const tab = read("src/components/service/material-pricing-settings.tsx");
    expect(tab).not.toMatch(/stock_screen_id|same stock/i);
  });
});

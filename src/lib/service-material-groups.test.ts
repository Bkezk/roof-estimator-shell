/**
 * Owner, Oct 6: "the service only items are sometimes used as a bid items. ISO is underlayment,
 * epdm, TPO are Roofing Membranes, Acetone is cleaning supplies"; "where is the bills at number
 * coming from? also can we add the add material button at the top rather than bottom".
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  materialsByCell,
  materialForCell,
  packCostFor,
  serviceCategoryOf,
  servicePiece,
  serviceStockTargets,
  type ServiceMaterialLink,
} from "@/lib/service-materials";
import { materialLineFor } from "@/lib/invoice-materials";

const iso: ServiceMaterialLink = {
  name: 'ISO Insulation 2"',
  unit: "ea",
  active: true,
  stock_screen_id: "duro_last:underlayment",
  stock_row_label: '2" ISO',
  stock_price_col: "Cost/Sq. Ft.",
  stock_per_unit: 32,
  piece_name: "board",
};
const own = (name: string, category: string | null): ServiceMaterialLink => ({
  name,
  unit: "Gallon",
  active: true,
  stock_screen_id: null,
  stock_row_label: null,
  stock_price_col: null,
  category,
});

describe("an ISO board against the bids' ISO by the sq ft", () => {
  it("counts in boards of 32 sq ft", () => {
    expect(servicePiece(iso)).toEqual({ name: "board", perPack: 1 / 32 });
    expect(servicePiece({ ...iso, stock_per_unit: null })).toBeNull();
    expect(servicePiece(undefined)).toBeNull();
  });
  it("bills 2 boards at the board price: 64 sq ft taken, $36.96 a board + 75 %", () => {
    const piece = servicePiece(iso)!;
    const line = materialLineFor(
      { row_label: iso.name, price_col: "", item_no: null, unit: "sq ft" },
      64,
      packCostFor(36.96, piece),
      0.75,
      piece,
    );
    expect(line).toMatchObject({ qty: 2, unit: "board", cost_rate: 36.96, rate: 64.68 });
    expect(line.total).toBe(129.36);
  });
  it("shares the bids' cell", () => {
    const byCell = materialsByCell([iso]);
    expect(
      materialForCell(byCell, {
        screen_id: "duro_last:underlayment",
        row_label: '2" ISO',
        price_col: "Cost/Sq. Ft.",
      })?.name,
    ).toBe('ISO Insulation 2"');
  });
});

describe("groups for the materials stocked on their own", () => {
  const list = [
    own("Acetone", "Cleaning Supplies"),
    own("Splice Wash", "Cleaning Supplies"),
    own("ISO Insulation A", "Underlayment"),
    own("New thing", null),
  ];
  it("puts each in its own group on the Inventory page", () => {
    const t = serviceStockTargets(list);
    expect(t.map((x) => [x.category, x.rows])).toEqual([
      ["Cleaning Supplies", ["Acetone", "Splice Wash"]],
      ["Service materials", ["New thing"]],
      ["Underlayment", ["ISO Insulation A"]],
    ]);
    expect(t.every((x) => x.screen_id === "service")).toBe(true);
  });
  it("names a stock row's category from its material", () => {
    expect(serviceCategoryOf(list, "Acetone")).toBe("Cleaning Supplies");
    expect(serviceCategoryOf(list, "New thing")).toBe("Service materials");
  });
});

const PATH = "supabase/migrations/20261006140000_service_material_groups.sql";
const sql = existsSync(PATH) ? readFileSync(PATH, "utf8") : "";
describe("the migration", () => {
  it("matches EPDM, TPO and ISO to the bids' stock, ISO at 32 sq ft a board", () => {
    expect(sql).toContain(
      `('045 EPDM 10''x100"', 'duro_last:duro_last_membrane', 'EPDM Rubber - 45', 'Black'`,
    );
    expect(sql).toContain(
      `('TPO 60 mil white membrane', 'duro_last:duro_last_membrane', 'Non-DL TPO - 60', 'White'`,
    );
    expect(sql).toContain(
      `('ISO Insulation 2"', 'duro_last:underlayment', '2" ISO', 'Cost/Sq. Ft.', 32, 'board')`,
    );
    expect(sql).toMatch(/where m\.name = v\.name and m\.stock_screen_id is null;/);
  });
  it("groups Acetone under Cleaning Supplies and tapered ISO under Underlayment", () => {
    expect(sql).toContain("('Acetone', 'Cleaning Supplies')");
    expect(sql).toContain("('ISO Insulation A', 'Underlayment')");
    expect(sql).not.toMatch(
      /(update|insert into|delete from|alter table)\s+public\.pricing_catalog/i,
    );
  });
});

describe("Setup › Material pricing", () => {
  const tab = readFileSync("src/components/service/material-pricing-settings.tsx", "utf8");
  it("has Add material at the top, before the list, and adds the row first", () => {
    expect(tab.indexOf("Add material")).toBeLessThan(tab.indexOf("<ul"));
    expect(tab).toMatch(/setRows\(\(rs\) => \[\n\s+\{[\s\S]*?\},\n\s+\.\.\.\(rs \?\? \[\]\),/);
  });
  it("says where Bills at comes from: the markup on the Service rates tab", () => {
    expect(tab).toContain("material markup set on the Service rates tab");
  });
});

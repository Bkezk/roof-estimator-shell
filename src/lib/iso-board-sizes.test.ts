/**
 * Owner, Oct 6: "there are two different iso boards, theres 8x4 and 4x4". The bids' catalog has
 * both (… ISO and … ISO 4'x 4', by the sq ft); a 4' x 8' board is 32 sq ft, a 4' x 4' one 16.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { packCostFor, servicePiece } from "@/lib/service-materials";
import { materialLineFor, unitText } from "@/lib/invoice-materials";

const PATH = "supabase/migrations/20261006160000_iso_board_sizes.sql";
const sql = existsSync(PATH) ? readFileSync(PATH, "utf8") : "";

describe("ISO board sizes", () => {
  it("names CenterPoint's boards 4'x8' and adds 4'x4' boards against the catalog's 4'x 4' ISO", () => {
    expect(sql).toContain(`('ISO Insulation 2"', 'ISO Insulation 2" 4''x8''', '2" ISO')`);
    expect(sql).toContain(`('ISO Insulation 2" 4''x4''', '2" ISO 4''x 4''', '2" ISO')`);
    expect(sql).toMatch(/'Cost\/Sq\. Ft\.', 16, 'board'/);
    expect(sql).toContain("round(b.cost / 2, 2)");
    expect(sql).toMatch(
      /where not exists \(select 1 from public\.service_materials x where x\.name = v\.name\)/,
    );
  });
  it("a 4'x4' board takes 16 sq ft and bills as a board", () => {
    const piece = servicePiece({
      name: `ISO Insulation 2" 4'x4'`,
      unit: "ea",
      active: true,
      stock_screen_id: "duro_last:underlayment",
      stock_row_label: `2" ISO 4'x 4'`,
      stock_price_col: "Cost/Sq. Ft.",
      stock_per_unit: 16,
      piece_name: "board",
    })!;
    const line = materialLineFor(
      { row_label: "x", price_col: "", item_no: null, unit: "sq ft" },
      48,
      packCostFor(18.48, piece),
      0.75,
      piece,
    );
    expect(line).toMatchObject({ qty: 3, unit: "board", cost_rate: 18.48, rate: 32.34 });
  });
});

describe("the invoice line of a board counted against sq-ft stock (owner, Oct 6, QA audit bug 2)", () => {
  const board = (name: string, label: string, sqFt: number) =>
    servicePiece({
      name,
      unit: "ea",
      active: true,
      stock_screen_id: "duro_last:underlayment",
      stock_row_label: label,
      stock_price_col: "Cost/Sq. Ft.",
      stock_per_unit: sqFt,
      piece_name: "board",
    })!;
  // buildLinesFromJob names the cell after the material (price_col ""); an older ledger entry
  // can still carry the catalog's own column — neither may read "0.031 boards per sq ft".
  const cell = (price_col: string) => ({
    row_label: `1" ISO`,
    price_col,
    item_no: null,
    unit: "sq ft",
  });
  it("64 sq ft of 1\" ISO 4'x8' bills as 2 boards — 32 sq ft per board", () => {
    const piece = board(`ISO Insulation 1" 4'x8'`, `1" ISO`, 32);
    const line = materialLineFor(cell(""), 64, packCostFor(18.48, piece), 0.75, piece);
    expect(line.qty).toBe(2);
    expect(line.unit).toBe("board");
    expect(line.description).toBe(`1" ISO — 32 sq ft per board`);
    expect(unitText(2, "board")).toBe("boards");
    expect(unitText(1, "board")).toBe("board");
  });
  it("a 4'x4' board: 16 sq ft per board", () => {
    const piece = board(`ISO Insulation 1" 4'x4'`, `1" ISO 4'x 4'`, 16);
    const line = materialLineFor(cell(""), 48, packCostFor(18.48, piece), 0.75, piece);
    expect(line.qty).toBe(3);
    expect(line.description.endsWith("— 16 sq ft per board")).toBe(true);
  });
  it("a Cost… price column says no more than the unit does (as Price… already did)", () => {
    const piece = board(`ISO Insulation 1" 4'x8'`, `1" ISO`, 32);
    const line = materialLineFor(cell("Cost/Sq. Ft."), 64, packCostFor(18.48, piece), 0.75, piece);
    expect(line.description).toBe(`1" ISO — 32 sq ft per board`);
    expect(line.description).not.toContain("Cost/Sq. Ft.");
  });
  it("a pack that is not a whole number of the unit keeps two decimals", () => {
    const piece = { name: "roll", perPack: 1 / 10.5 };
    const line = materialLineFor(cell(""), 21, 1, 0.75, piece);
    expect(line.description).toBe(`1" ISO — 10.5 sq ft per roll`);
    expect(unitText(3, "roll")).toBe("rolls");
    expect(unitText(2, "pad")).toBe("pads");
  });
});

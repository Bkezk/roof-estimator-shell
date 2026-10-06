/**
 * Owner, Oct 6: "there are two different iso boards, theres 8x4 and 4x4". The bids' catalog has
 * both (… ISO and … ISO 4'x 4', by the sq ft); a 4' x 8' board is 32 sq ft, a 4' x 4' one 16.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { packCostFor, servicePiece } from "@/lib/service-materials";
import { materialLineFor } from "@/lib/invoice-materials";

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

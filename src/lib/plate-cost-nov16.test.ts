/**
 * Plates priced per plate, and the Setup history fix that the change needed (owner, Nov 16:
 * "what do you mean about the plates?" … "yes change the plate costs").
 *
 * Found: three plates on Setup › Material pricing were counted against a box in Estimate Pricing
 * (the "Price/Box" column) with nothing saying how many plates are in the box. A linked
 * material's cost follows the catalog (service_material_follows_catalog), so their cost was the
 * price of a BOX, and the invoice, which takes a material's cost as the price of one piece,
 * would have billed every plate at the box price.
 *
 * Fixed in the data, the way an ISO board already says it is 32 sq ft of the catalog's ISO: each
 * plate now says it is 1/1000 (or 1/500) of the box, so its cost is the box price over the
 * plates in the box and keeps following the catalog. Saving that link was itself refused by
 * the Setup history recorder; 20261116180000 fixes that.
 *
 * The numbers here are made up for the test (a $300 box of 1,000), not the catalog's.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { materialLineFor } from "@/lib/invoice-materials";
import { packCostFor, servicePiece } from "@/lib/service-materials";

const CELL = {
  screen_id: "duro_last:fasteners_and_bits",
  row_label: "Plate",
  price_col: "Price/Box",
  item_no: null,
  unit: "box",
};
const link = (over: {
  cost: number;
  stock_per_unit: number | null;
  piece_name: string | null;
}) => ({
  name: "Plate",
  unit: "Each",
  active: true,
  stock_screen_id: CELL.screen_id,
  stock_row_label: CELL.row_label,
  stock_price_col: CELL.price_col,
  ...over,
});
/** What the catalog says of the box when the material says nothing: 1,000 fasteners. */
const CATALOG_PIECE = { name: "fastener", perPack: 1000 };

describe("a plate counted by the plate against a box of 1,000", () => {
  it("as it was: the cost was the box price, so 20 plates cost 20 boxes", () => {
    const was = link({ cost: 300, stock_per_unit: null, piece_name: null });
    const piece = servicePiece(was) ?? CATALOG_PIECE;
    // 20 plates are 0.02 of a box in inventory.
    const line = materialLineFor(CELL, 0.02, packCostFor(was.cost, piece), 0, piece);
    expect(line.qty).toBe(20);
    expect(line.cost_rate).toBe(300);
    expect(line.cost_total).toBe(6000);
  });

  it("now: one plate is 1/1000 of the box, $0.30, and 20 plates cost $6.00", () => {
    // The database works the cost out: box price × stock_per_unit = 300 × 0.001.
    const now = link({ cost: 0.3, stock_per_unit: 0.001, piece_name: "plate" });
    const piece = servicePiece(now);
    expect(piece).toEqual({ name: "plate", perPack: 1000 });
    const line = materialLineFor(CELL, 0.02, packCostFor(now.cost, piece), 0, piece);
    expect(line).toMatchObject({ qty: 20, unit: "plate", cost_rate: 0.3, cost_total: 6 });
    // With a 50% markup the plate bills at $0.45.
    const marked = materialLineFor(CELL, 0.02, packCostFor(now.cost, piece), 0.5, piece);
    expect(marked).toMatchObject({ rate: 0.45, total: 9 });
  });

  it("a box of 500 is 1/500 each", () => {
    const piece = servicePiece(link({ cost: 0.38, stock_per_unit: 0.002, piece_name: "plate" }));
    expect(piece).toEqual({ name: "plate", perPack: 500 });
  });
});

describe("Setup history no longer refuses a change to a material's stock link", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the word added to the list of changes has its type", () => {
    const fix = read("supabase/migrations/20261116180000_setup_materials_stock_link_history.sql");
    expect(fix).toContain("create or replace function public.audit_setup_materials()");
    expect(fix).toContain("v_parts := v_parts || 'stock link changed'::text;");
    const was = read("supabase/migrations/20261110214000_setup_history.sql");
    const body = (s: string) => {
      const i = s.indexOf("create or replace function public.audit_setup_materials()");
      return s.slice(i, s.indexOf("end $$;", i));
    };
    // The bare word, which Postgres read as a malformed list, is gone from the newest definition
    // (the file's own comment quotes it, so the function's body is what is read).
    expect(body(fix)).not.toMatch(/v_parts := v_parts \|\| 'stock link changed';/);
    // The rest of the function is the one from the history migration, line for line.
    expect(body(fix)).toBe(
      body(was).replace("'stock link changed';", "'stock link changed'::text;"),
    );
  });
});

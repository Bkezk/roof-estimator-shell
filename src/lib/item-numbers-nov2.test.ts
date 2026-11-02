/**
 * Item numbers checked against the owner's inventory item list and the sheet photos (owner,
 * Nov 2: "we want to ensure we dont have duplicate products, and we need the correct item numbers
 * assigned to the correct things"). What this pins, each with its source:
 *  - The Quickseam Yellow Safety Strip is $545 a carton (Universal accessories sheet); the seed
 *    had read the termination bar's $397 from the line above it.
 *  - SkyPaver Chestnut 1.23" is W56GARPAVB: the sheet prints PAVW for Chestnut and Ash alike, and
 *    its 1.98" set prints Chestnut PAVB2 / Ash PAVW2. Two colours never share one code.
 *  - The TECH-Bond spray canister (11028T, $595) is on the Adhesives list under the estimator's
 *    name "TECH-Bond TPO Spray Adhesive" (legacy_adhesive id 13) and nowhere else, so a Duro-Tech
 *    bid that picks it prices it.
 *  - The migration takes the inventory list's numbers: Duro-Caulk PLUS owns 1134-1137, the white
 *    vent alone owns 1231, the 6"/7"/8" nails are 1628/1638/1639 (1629-1631 stay on the screws),
 *    and the typed 5 1/2" / 9" nail numbers come off.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADHESIVE_PRODUCTS,
  CUSTOM_APPLICATION_ROWS,
  DURO_LAST_OTHER_SCREEN,
  EPDM_SCREENS,
  NON_DL_TPO_SCREENS,
  seedItemNumbers,
} from "@/lib/pricing-seed/accessory-families";

const MIGRATION = "supabase/migrations/20261102120000_item_numbers_inventory_and_sheets.sql";
/** The Duro-Last screens' columns the seed's Duro-Tech rows land on (copied from the seed test). */
const EXISTING_COLUMNS: Record<string, string[]> = {
  "duro_last:sealants": ["Description", "Part #", "Price"],
  "duro_last:pipe_stacks": [
    "Description",
    "Size",
    "Open Part #",
    "Closed Part #",
    "Price",
    "Tan Price",
    "Gray Price",
    "Dark Gray",
    "Terra Cotta",
    "Rock Ply",
  ],
  "duro_last:corners": [
    "Description",
    "Part #",
    "White",
    "Tan",
    "Gray",
    "Dark Gray",
    "Terra Cotta",
  ],
  "duro_last:walk_pads_wall_vents": ["Description", "Part #", "Price"],
  "duro_last:drain_boots": ["Description", "Part #", "Price", "+ for Color"],
  "duro_last:drain_boot_accessories": ["Description", "Part #", "Price"],
  "duro_last:vents": ["Description", "Part #", "Price"],
  "duro_last:fasteners_and_bits": [
    "Part #",
    "Subtype",
    "Description",
    "Price/Box",
    "Fasteners/Box",
  ],
};
const sql = () => readFileSync(MIGRATION, "utf8");

describe("Nov 2 item-number corrections", () => {
  it("prices the Quickseam Yellow Safety Strip at $545 a carton on both Firestone families", () => {
    for (const screens of [NON_DL_TPO_SCREENS, EPDM_SCREENS]) {
      const other = screens.find((s) => s.id.endsWith(":other_accessories"))!;
      const strip = other.rows.find((r) =>
        String(r["Description"]).startsWith("Quickseam Yellow"),
      )!;
      expect(strip["Price"]).toBe(545);
    }
    expect(sql()).toContain("then jsonb_set(e, '{Price}', '545'::jsonb)");
  });

  it("gives SkyPaver Chestnut 1.23\" its own code, PAVB, never Ash's PAVW", () => {
    const code = (colour: string, thickness: string) =>
      CUSTOM_APPLICATION_ROWS.find((r) =>
        String(r["Description"]).startsWith(`SkyPaver ${colour} 4" x 8" x ${thickness}"`),
      )?.part;
    expect(code("Chestnut", "1.23")).toBe("W56GARPAVB");
    expect(code("Ash", "1.23")).toBe("W56GARPAVW");
    expect(code("Chestnut", "1.98")).toBe("W56GARPAVB2");
    const codes = CUSTOM_APPLICATION_ROWS.filter((r) =>
      String(r["Description"]).startsWith("SkyPaver"),
    ).map((r) => r.part);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("puts the TECH-Bond spray canister on the Adhesives list under the estimator's name only", () => {
    const spray = ADHESIVE_PRODUCTS.find((p) => p.part_no === "11028T");
    expect(spray?.name).toBe("TECH-Bond TPO Spray Adhesive");
    expect(spray?.price).toBe(595);
    expect(spray?.unit).toBe("canister");
    // Coverage rows exist for the office to fill, blank like the TECH-Bond pails.
    expect(spray?.coverage.length).toBe(
      ADHESIVE_PRODUCTS.find((p) => p.part_no === "1112T")!.coverage.length,
    );
    expect(
      DURO_LAST_OTHER_SCREEN.rows.some((r) =>
        String(r["Description"]).includes("Spray Solvent Adhesive"),
      ),
    ).toBe(false);
    const links = seedItemNumbers(EXISTING_COLUMNS).filter((n) => n.item_no === "11028T");
    expect(links.map((n) => n.screen_id)).toEqual(["duro_last:adhesives"]);
    expect(sql()).toContain("'name', 'TECH-Bond TPO Spray Adhesive'");
    expect(sql()).toContain(
      "where e->>'Description' <> 'Duro-Tech TPO TECH-Bond Spray Solvent Adhesive (canister)'",
    );
  });

  it("moves the inventory list's numbers onto the right rows and takes wrong ones off", () => {
    const s = sql();
    const off = (no: string, screen: string, row: string, col: string) =>
      expect(s).toContain(`  ('${no}', '${screen}', '${row}', '${col}')`);
    const on = (no: string, screen: string, row: string, col: string) =>
      expect(s).toContain(`  ('${no}', '${screen}', '${row}', '${col}', null)`);
    // Duro-Caulk Plus owns 1134-1137 (inventory DL-1134 "Duro-Caulk Plus Gray" ...).
    for (const [no, colour] of [
      ["1134", "Gray"],
      ["1135", "Bronze"],
      ["1136", "White"],
      ["1137", "Tan"],
    ] as const)
      off(no, "duro_last:sealants", `Duro-Caulk - ${colour}`, "Price");
    off("1137P", "duro_last:sealants", "Duro-Caulk Plus - Tan", "Price");
    on("1137", "duro_last:sealants", "Duro-Caulk Plus - Tan", "Price");
    // 1231 is the white two-way vent; the colours have their own numbers.
    for (const row of [
      "Tan Vent",
      "Gray Vent",
      "Dark Gray Vent",
      "Terra Cotta Vent",
      "Rock Ply Vent",
    ])
      off("1231", "duro_last:vents", row, "Price");
    on("1231B", "duro_last:vents", "Tan Vent", "Price");
    on("1231G", "duro_last:vents", "Gray Vent", "Price");
    on("1231DG", "duro_last:vents", "Dark Gray Vent", "Price");
    expect(s).not.toContain("('1231', 'duro_last:vents', 'White Vent'");
    // Nails: 1629/1630/1631 are the SDS and straight screws; the nails are 1628/1638/1639.
    off("1629", "duro_last:fasteners_and_bits", '6" [Nail]', "Price/Box");
    off("1630", "duro_last:fasteners_and_bits", '7" [Nail]', "Price/Box");
    off("1631", "duro_last:fasteners_and_bits", '8" [Nail]', "Price/Box");
    on("1628", "duro_last:fasteners_and_bits", '6" [Nail]', "Price/Box");
    on("1638", "duro_last:fasteners_and_bits", '7" [Nail]', "Price/Box");
    on("1639", "duro_last:fasteners_and_bits", '8" [Nail]', "Price/Box");
    off("1628", "duro_last:fasteners_and_bits", '5 1/2" [Nail]', "Price/Box");
    off("162-009", "duro_last:fasteners_and_bits", '9" [Nail]', "Price/Box");
    for (const no of ["1629", "1630", "1631"])
      expect(s).not.toContain(`('${no}', 'duro_last:fasteners_and_bits', '3/16`);
    // Drip edge and gravel stops had no numbers at all.
    on("1220", "duro_last:drip_edge", 'Drip Edge 2"', "White Price");
    on("1583G", "duro_last:drip_edge", 'Drip Edge 4"', "Gray Price");
    on("1226B", "duro_last:gravel_stops", 'Gravel Stop 2"', "Tan Price");
    // Duro-Tuff 60 White: the lost decimal.
    expect(s).toContain("e->>'Description' = 'Duro-Tuff - 60' and (e->>'White')::numeric = 125");
    expect(s).toContain("on conflict (item_no, screen_id, row_label, price_col) do nothing");
  });
});

/**
 * Non-DL TPO and EPDM Adhesives get their own page under Non Duro-Last Pricing (owner, Oct 27:
 * the Firestone / TECH-Bond / I.S.O. products sat in the Duro-Last › Adhesives dropdown —
 * confusing). As the membranes were done: the products stay in the one adhesives screen the
 * engine reads; the new page shows the non-DL ones in the same editor and merges its edits back
 * on save; the Duro-Last tab shows the rest (TECH-Bond is Duro-Tech, a Duro-Last family, and stays
 * there). Fails on the old code (no helper, no page, the editor had no filter).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { pageForPath } from "@/lib/access";
import { ADHESIVE_PRODUCTS } from "@/lib/pricing-seed/accessory-families";

import {
  ADHESIVES_SCREEN_ID,
  isDuroLastAdhesive,
  isNonDlAdhesive,
  mergeAdhesiveProducts,
  NON_DL_ADHESIVE_DEFAULT_GROUP,
  NON_DL_ADHESIVES_PATH,
  NON_DL_ADHESIVES_TITLE,
  type AdhesiveProduct,
} from "./non-dl-adhesives";

const read = (p: string) => readFileSync(p, "utf8");
const seeded = (name: string) => {
  const p = ADHESIVE_PRODUCTS.find((x) => x.name === name);
  if (!p) throw new Error(`no seeded product ${name}`);
  return { part_no: p.part_no, coverage: p.coverage };
};
const product = (name: string, part_no: string, groups: string[], price = 1): AdhesiveProduct => ({
  name,
  price,
  unit_type: "",
  part_no,
  field_spacing: "",
  perim_spacing: "",
  coverage: groups.map((group) => ({ group, substrate: "Wood", field_coverage: 100 })),
});
/** The two vendor-seeded Duro-Last adhesives (engine/adapters DEFAULT_ADHESIVE_OPTIONS). */
const waterBased = product("Water Based Adhesive", "", ["Duro-Last", "Duro-Tuff", "Duro-Fleece"]);
const solventBased = product("Solvent Based Adhesive", "", ["Duro-Last", "Insulations"]);

describe("isNonDlAdhesive", () => {
  it("the seeded Firestone bonding adhesives (Non-DL TPO / EPDM Rubber groups) are non-DL", () => {
    expect(isNonDlAdhesive(seeded("Single-Ply LVOC Bonding Adhesive"))).toBe(true);
    expect(isNonDlAdhesive(seeded("UltraPly Bonding Adhesive"))).toBe(true);
    expect(isNonDlAdhesive(seeded("EPDM Bonding Adhesive"))).toBe(true);
    expect(isNonDlAdhesive(seeded("Water Based Bonding Adhesive (P)"))).toBe(true);
  });
  it("the I.S.O. insulation adhesives are non-DL by their W56 part number (their group is Insulations)", () => {
    const iso = seeded("I.S.O.FIX Adhesive (canister; hose and wand separate)");
    expect(iso.coverage.every((c) => c.group === "Insulations")).toBe(true);
    expect(isNonDlAdhesive(iso)).toBe(true);
    expect(isNonDlAdhesive(seeded("I.S.O.SPRAY S Part A + Part B (55 gal drum set)"))).toBe(true);
    expect(isNonDlAdhesive({ part_no: " w56RACINSA ", coverage: [] })).toBe(true);
  });
  it("TECH-Bond (Duro-Tech) and the Duro-Last adhesives stay on the Duro-Last side", () => {
    expect(isNonDlAdhesive(seeded("TECH-Bond TPO Bonding Adhesive"))).toBe(false);
    expect(isNonDlAdhesive(seeded("TECH-Bond TPO LVOC Bonding Adhesive"))).toBe(false);
    expect(isNonDlAdhesive(waterBased)).toBe(false);
    expect(isNonDlAdhesive(solventBased)).toBe(false);
    expect(isDuroLastAdhesive(waterBased)).toBe(true);
    expect(isDuroLastAdhesive(seeded("UltraPly Bonding Adhesive"))).toBe(false);
    // Every seeded product lands on exactly one side.
    for (const p of ADHESIVE_PRODUCTS) expect(isNonDlAdhesive(p)).toBe(!isDuroLastAdhesive(p));
  });
});

describe("mergeAdhesiveProducts: a view's edits go back into the whole list", () => {
  const ultra = product("UltraPly Bonding Adhesive", "W56TPO3005", ["Non-DL TPO"]);
  const techBond = product("TECH-Bond TPO Bonding Adhesive", "1112T", ["Duro-Tech TPO"]);
  const iso = product("I.S.O.FIX Adhesive", "W56RACINSA", ["Insulations"]);
  const stored = [waterBased, ultra, solventBased, techBond, iso];
  it("the non-DL page's edits land in place; the Duro-Last products are untouched", () => {
    const out = mergeAdhesiveProducts(stored, isNonDlAdhesive, [
      { ...ultra, price: 135 },
      { ...iso, price: 330 },
    ]);
    expect(out.map((p) => [p.name, p.price])).toEqual([
      ["Water Based Adhesive", 1],
      ["UltraPly Bonding Adhesive", 135],
      ["Solvent Based Adhesive", 1],
      ["TECH-Bond TPO Bonding Adhesive", 1],
      ["I.S.O.FIX Adhesive", 330],
    ]);
  });
  it("a product added on the non-DL page goes after the last non-DL one; a removed one is dropped", () => {
    const added = product("XR Bonding Adhesive", "W56TPO3009", [NON_DL_ADHESIVE_DEFAULT_GROUP]);
    expect(
      mergeAdhesiveProducts(stored, isNonDlAdhesive, [ultra, iso, added]).map((p) => p.name),
    ).toEqual([
      "Water Based Adhesive",
      "UltraPly Bonding Adhesive",
      "Solvent Based Adhesive",
      "TECH-Bond TPO Bonding Adhesive",
      "I.S.O.FIX Adhesive",
      "XR Bonding Adhesive",
    ]);
    // Positional like the membranes' mergeRows: the view's rows in order, the last one removed.
    expect(mergeAdhesiveProducts(stored, isNonDlAdhesive, [ultra]).map((p) => p.name)).toEqual([
      "Water Based Adhesive",
      "UltraPly Bonding Adhesive",
      "Solvent Based Adhesive",
      "TECH-Bond TPO Bonding Adhesive",
    ]);
  });
  it("the Duro-Last tab's edits leave the non-DL products untouched", () => {
    const out = mergeAdhesiveProducts(stored, isDuroLastAdhesive, [
      { ...waterBased, price: 9 },
      { ...solventBased, price: 8 },
      { ...techBond, price: 140 },
    ]);
    expect(out.map((p) => [p.name, p.price])).toEqual([
      ["Water Based Adhesive", 9],
      ["UltraPly Bonding Adhesive", 1],
      ["Solvent Based Adhesive", 8],
      ["TECH-Bond TPO Bonding Adhesive", 140],
      ["I.S.O.FIX Adhesive", 1],
    ]);
  });
});

describe("the page, the menu and the two views (front end only)", () => {
  it("is a pricing page at /admin/non-dl-adhesives titled Non-DL TPO and EPDM Adhesives, over the one adhesives screen", () => {
    expect(NON_DL_ADHESIVES_PATH).toBe("/admin/non-dl-adhesives");
    expect(NON_DL_ADHESIVES_TITLE).toBe("Non-DL TPO and EPDM Adhesives");
    expect(NON_DL_ADHESIVE_DEFAULT_GROUP).toBe("Non-DL TPO");
    expect(ADHESIVES_SCREEN_ID).toBe("duro_last:adhesives");
    expect(pageForPath(NON_DL_ADHESIVES_PATH)).toBe("pricing");
    const route = read("src/routes/admin.non-dl-adhesives.tsx");
    expect(route).toContain('createFileRoute("/admin/non-dl-adhesives")');
    expect(route).toContain("title: `${NON_DL_ADHESIVES_TITLE} — JBK Portal`");
    expect(route).toContain(
      '<h1 className="text-2xl font-bold tracking-tight">{NON_DL_ADHESIVES_TITLE}</h1>',
    );
    expect(route).toContain("productFilter={isNonDlAdhesive}");
    expect(route).toContain("newProductGroup={NON_DL_ADHESIVE_DEFAULT_GROUP}");
    expect(read("src/routeTree.gen.ts")).toContain("/admin/non-dl-adhesives");
  });
  it("sits under Non Duro-Last Pricing right after Non-DL TPO and EPDM, before the accessories pages", () => {
    const nav = read("src/components/app-sidebar.tsx");
    const membrane = nav.indexOf('{ title: "Non-DL TPO and EPDM", url: "/admin/non-dl-membrane" }');
    const adhesives = nav.indexOf(
      '{ title: "Non-DL TPO and EPDM Adhesives", url: "/admin/non-dl-adhesives" }',
    );
    const tpoAcc = nav.indexOf('{ title: "Non-DL TPO Accessories", url: "/admin/non-dl-tpo" }');
    const epdmAcc = nav.indexOf('{ title: "EPDM Accessories", url: "/admin/epdm" }');
    expect(membrane).toBeGreaterThan(0);
    expect(adhesives).toBeGreaterThan(membrane);
    expect(tpoAcc).toBeGreaterThan(adhesives);
    expect(epdmAcc).toBeGreaterThan(tpoAcc);
    // No other menu entry between the membranes and the adhesives.
    expect(nav.slice(membrane, adhesives).match(/title:/g) ?? []).toHaveLength(1);
  });
  it("the Duro-Last › Adhesives tab shows the rest, and the editor filters and merges on save", () => {
    const dl = read("src/routes/admin.duro-last.tsx");
    expect(dl).toContain("<AdhesivesTab productFilter={isDuroLastAdhesive} />");
    const editor = read("src/components/adhesives-editor.tsx");
    expect(editor).toContain(
      "productFilter?: ((product: AdhesiveProduct) => boolean) | undefined;",
    );
    expect(editor).toContain("newProductGroup?: string | undefined;");
    expect(editor).toContain("(stored.products ?? []).filter(productFilter)");
    expect(editor).toContain(
      "mergeAdhesiveProducts(stored.products ?? [], productFilter, data.products)",
    );
    expect(editor).toContain("d.products.push(emptyProduct(newProductGroup))");
    expect(editor).toContain(
      'coverage: group ? [{ group, substrate: "", field_coverage: 0 }] : [],',
    );
  });
  it("the back end is untouched: one screen, read by the engine as before", () => {
    expect(read("src/lib/engine/adapters.ts")).toContain("LEGACY_RS_ID_BY_NAME[group]");
  });
});

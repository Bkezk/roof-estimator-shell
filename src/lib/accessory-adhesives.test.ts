/**
 * Owner, Oct 27: "Non-DL TPO and EPDM groups have no Adhesives screen under Calculated Items."
 * The Adhesives screen belongs to the bid's ACTIVE family's group (the roof's adhesive is one
 * calculation per bid): the Non-DL TPO group on a Non-DL TPO bid, the EPDM group on an EPDM bid,
 * the DL group otherwise — and the other two hide it, so the tree entry appears in exactly one
 * group per bid. The pure helper, the screens rendered for the three cases, the EXTRA boxes bound
 * to the DL state the engine bills, and the estimate's wiring. Fails on the old code (the family
 * groups passed `adhesiveNames={[]}`; the DL group listed every priced adhesive on every bid).
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccessoriesScreens } from "@/components/accessories-screens";
import { emptyAccessoriesState } from "@/lib/engine/accessories";
import { adhesiveOptionsForSystem } from "@/lib/engine/adapters";
import { FAMILY_SCREENS, LABOR_ROWS, type SeedScreen } from "@/lib/pricing-seed/accessory-families";

import { adhesiveNamesFor, adhesiveNamesForGroup, adhesivesGroupFor } from "./accessory-adhesives";
import {
  EPDM_SYSTEM,
  FAMILIES,
  NON_DL_TPO_SYSTEM,
  buildFamilyAccessoryData,
  type CatalogRow,
} from "./accessory-families";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// Admin data: Duro-Last's roof adhesives by legacy RoofSystemID (1 = Duro-Last), the Non-DL TPO
// (7) and EPDM (8) ones, every one priced.
const cov = (deck: string) => ({
  byDeckName: { [deck]: 1 },
  underlaymentUniform: null,
  byUnderlaymentGroup: undefined,
  wallCoverage: null,
});
const admin = {
  membraneAdhesives: {
    1: { "DL Water-Based Adhesive": cov("Wood"), "DL Solvent Adhesive": cov("Wood") },
    7: { "TECH-Bond Bonding Adhesive": cov("Wood"), "Firestone I.S.O. Twin Pack": cov("Wood") },
    8: { "Firestone BA-2012 Bonding Adhesive": cov("Wood") },
  },
  adhesivePrices: {
    "DL Water-Based Adhesive": 190,
    "DL Solvent Adhesive": 210,
    "TECH-Bond Bonding Adhesive": 150,
    "Firestone I.S.O. Twin Pack": 400,
    "Firestone BA-2012 Bonding Adhesive": 175,
    "Old Adhesive Nobody Sells": 99,
  },
} as unknown as Parameters<typeof adhesiveNamesFor>[0];

describe("adhesiveNamesFor: one Adhesives screen per bid, in the active family's group", () => {
  it("the group is the bid's active family", () => {
    expect(adhesivesGroupFor("Duro-Last")).toBe("duroLast");
    expect(adhesivesGroupFor("Duro-Tech TPO")).toBe("duroLast");
    expect(adhesivesGroupFor(NON_DL_TPO_SYSTEM)).toBe("nonDlTpo");
    expect(adhesivesGroupFor(EPDM_SYSTEM)).toBe("epdm");
  });

  it("a Non-DL TPO bid lists the system's roof adhesives, plus any with units or extras", () => {
    expect(adhesiveNamesFor(admin, NON_DL_TPO_SYSTEM, undefined, undefined)).toEqual([
      "TECH-Bond Bonding Adhesive",
      "Firestone I.S.O. Twin Pack",
    ]);
    expect(
      adhesiveNamesFor(
        admin,
        NON_DL_TPO_SYSTEM,
        { "DL Water-Based Adhesive": 3 },
        { "Firestone BA-2012 Bonding Adhesive": 1, "TECH-Bond Bonding Adhesive": 0 },
      ),
    ).toEqual([
      "TECH-Bond Bonding Adhesive",
      "Firestone I.S.O. Twin Pack",
      "DL Water-Based Adhesive",
      "Firestone BA-2012 Bonding Adhesive",
    ]);
  });

  it("an EPDM bid the same with EPDM Rubber's adhesives", () => {
    expect(adhesiveNamesFor(admin, EPDM_SYSTEM, {}, {})).toEqual([
      "Firestone BA-2012 Bonding Adhesive",
    ]);
  });

  it("a Duro-Last-family bid keeps the DL group's whole priced list (never narrowed) plus any with units or extras", () => {
    const names = adhesiveNamesFor(admin, "Duro-Last", undefined, { "Some Typed One": 2 });
    // Every priced adhesive, in the admin's order — a name an existing bid typed extras on stays.
    expect(names.slice(0, 6)).toEqual(Object.keys(admin!.adhesivePrices!));
    expect(names).toContain("Old Adhesive Nobody Sells");
    expect(names).toContain("Some Typed One");
    expect(
      adhesiveNamesFor(admin, "Duro-Last", undefined, { "Old Adhesive Nobody Sells": 1 }),
    ).toEqual(Object.keys(admin!.adhesivePrices!));
  });

  it("no admin data: the engine's default options", () => {
    const defaults = adhesiveOptionsForSystem(null, NON_DL_TPO_SYSTEM, "roof");
    expect(defaults).toEqual(["Water Based Adhesive", "Solvent Based Adhesive"]);
    expect(adhesiveNamesFor(null, NON_DL_TPO_SYSTEM, undefined, undefined)).toEqual(defaults);
  });

  it("adhesiveNamesForGroup: the list for the active group, none for the other two", () => {
    for (const [system, active] of [
      [NON_DL_TPO_SYSTEM, "nonDlTpo"],
      [EPDM_SYSTEM, "epdm"],
      ["Duro-Last", "duroLast"],
    ] as const) {
      const withNames = FAMILIES.filter(
        (f) => adhesiveNamesForGroup(f, admin, system, undefined, undefined).length > 0,
      );
      expect(withNames).toEqual([active]);
    }
  });
});

// ── The screens rendered ────────────────────────────────────────────────────────────────────

const toRow = (s: SeedScreen): CatalogRow => ({
  id: s.id,
  category: s.category,
  data: { columns: s.columns, rows: s.rows },
});
const laborRows: CatalogRow[] = LABOR_ROWS.map((t) => ({
  id: t.table,
  category: t.table,
  data: {
    columns: ["Description", t.column],
    rows: t.rows.map(([d, h]) => ({ Description: d, [t.column]: h })),
  },
}));
const fam = buildFamilyAccessoryData({
  duroLastRows: [],
  familyRows: FAMILY_SCREENS.map(toRow),
  laborRows,
});
const treeLabels = (html: string) =>
  [...html.matchAll(/<button type="button"[^>]*>([^<]+?)<\/button>/g)].map((m) => m[1]!.trim());

const render = (
  family: (typeof FAMILIES)[number],
  roofSystem: string,
  extra: Record<string, number> = {},
  calc: Record<string, number> = {},
) =>
  renderToString(
    createElement(AccessoriesScreens, {
      family,
      countsFromRoof: adhesivesGroupFor(roofSystem) === family,
      state: emptyAccessoriesState(),
      onChange: () => {},
      refData: family === "duroLast" ? fam.refs.nonDlTpo : fam.refs[family],
      result: undefined,
      sections: [],
      initialScreen: "adhesives",
      adhesiveNames: adhesiveNamesForGroup(family, admin, roofSystem, calc, extra),
      adhesiveCalc: calc,
      // The family groups are bound to the DL state (accessoriesCalc.adhesivesExtra).
      ...(family === "duroLast" ? {} : { adhesivesExtra: extra, onAdhesiveExtraChange: () => {} }),
      arpCalcQty: 0,
    }),
  );

describe("the Adhesives tree entry appears in exactly one group per bid", () => {
  it("Non-DL TPO bid: the TPO group has it (Calc Qty from the engine, EXTRA from the DL state); DL and EPDM do not", () => {
    const tpo = render(
      "nonDlTpo",
      NON_DL_TPO_SYSTEM,
      { "TECH-Bond Bonding Adhesive": 4 },
      {
        "TECH-Bond Bonding Adhesive": 7,
      },
    );
    expect(treeLabels(tpo)).toContain("Adhesives");
    expect(tpo).toContain("TECH-Bond Bonding Adhesive");
    expect(tpo).toContain("Firestone I.S.O. Twin Pack");
    // The engine's whole units in Calc Qty, the DL state's typed extra in the EXTRA box.
    expect(tpo).toMatch(/tabular-nums">7<\/span>/);
    expect(tpo).toMatch(/value="4"/);
    expect(treeLabels(render("duroLast", NON_DL_TPO_SYSTEM))).not.toContain("Adhesives");
    expect(treeLabels(render("epdm", NON_DL_TPO_SYSTEM))).not.toContain("Adhesives");
  });

  it("EPDM bid: the EPDM group has it with EPDM Rubber's adhesives; DL and TPO do not", () => {
    const epdm = render("epdm", EPDM_SYSTEM);
    expect(treeLabels(epdm)).toContain("Adhesives");
    expect(epdm).toContain("Firestone BA-2012 Bonding Adhesive");
    expect(epdm).not.toContain("TECH-Bond Bonding Adhesive");
    expect(treeLabels(render("duroLast", EPDM_SYSTEM))).not.toContain("Adhesives");
    expect(treeLabels(render("nonDlTpo", EPDM_SYSTEM))).not.toContain("Adhesives");
  });

  it("Duro-Last bid: the DL group keeps it as today (every priced adhesive); the family groups hide it", () => {
    const dl = render("duroLast", "Duro-Last", { "Old Adhesive Nobody Sells": 2 });
    expect(treeLabels(dl)).toContain("Adhesives");
    for (const name of Object.keys(admin!.adhesivePrices!)) expect(dl).toContain(name);
    expect(treeLabels(render("nonDlTpo", "Duro-Last"))).not.toContain("Adhesives");
    expect(treeLabels(render("epdm", "Duro-Last"))).not.toContain("Adhesives");
  });
});

describe("the estimate wires the screen to the engine's figures and the DL state", () => {
  const src = read("src/routes/estimate.tsx");
  const screens = read("src/components/accessories-screens.tsx");
  it("both group kinds take adhesiveNamesForGroup; the family groups bind EXTRA to accessoriesCalc", () => {
    expect(src).toContain('import { adhesiveNamesForGroup } from "@/lib/accessory-adhesives";');
    expect(src).not.toContain("adhesiveNames={[]}");
    expect(src).not.toContain("adhesiveNames={Object.keys(admin?.adhesivePrices ?? {})}");
    expect(src).toContain(
      'adhesiveNames={adhesiveNamesForGroup(\n                      "duroLast",\n                      admin,\n                      roofSystem,\n                      result?.adhesiveWholeUnits,\n                      accessoriesCalc.adhesivesExtra,\n                    )}',
    );
    expect(src).toContain(
      "adhesiveNames={adhesiveNamesForGroup(\n                              family,\n                              admin,\n                              roofSystem,\n                              result?.adhesiveWholeUnits,\n                              accessoriesCalc.adhesivesExtra,\n                            )}",
    );
    expect(src).toContain("adhesivesExtra={accessoriesCalc.adhesivesExtra}");
    expect(src).toContain("next.adhesivesExtra[name] = units;");
    expect((src.match(/adhesiveCalc=\{result\?\.adhesiveWholeUnits\}/g) ?? []).length).toBe(2);
  });
  it("the screens hide Adhesives for any group given no names and read the handed-in EXTRA state", () => {
    const fn = screens.slice(
      screens.indexOf("function hiddenAccessoryScreens("),
      screens.indexOf('if (!refData || !props.family || props.family === "duroLast") return out;'),
    );
    expect(fn).toContain('if (props.adhesiveNames.length === 0) out.add("adhesives");');
    expect(screens).toContain(
      "const adhesivesExtra = props.adhesivesExtra ?? state.adhesivesExtra;",
    );
    expect(screens).toContain("value={adhesivesExtra[name] ?? 0}");
    expect(screens).toContain("onCommit={(v) => setAdhesiveExtra(name, v)}");
  });
});

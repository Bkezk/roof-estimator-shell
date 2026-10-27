/**
 * The family groups' fastener screens list the family's rows (owner's screenshot, Oct 27: Non-DL
 * TPO › Parapet Wall-Tabs showed "Fasteners Needed: 632 / Steel Plates Needed: 632" and no rows).
 * The edge and parapet grids used to list the engine's fixed Duro-Last catalog keys
 * (EDGE_FASTENER_GROUPS / PLATE_ROWS), which the Firestone catalogs do not carry; a Non-DL TPO or
 * EPDM group now lists its rows by SUBTYPE (lib/accessory-families.ts familyFastenerKeys) and nets
 * its typed rows against the Needed counters for display (familyParapetNeeds). The DL group is
 * unchanged. Fails on the old code (no rows listed; parapet counters never netted).
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccessoriesScreens } from "@/components/accessories-screens";
import {
  EDGE_FASTENER_GROUPS,
  emptyAccessoriesState,
  fastenerKey,
  PLATE_ROWS,
} from "@/lib/engine/accessories";
import { FAMILY_SCREENS, LABOR_ROWS, type SeedScreen } from "@/lib/pricing-seed/accessory-families";

import {
  buildFamilyAccessoryData,
  computeFamilyResults,
  FAMILY_EDGE_SUBTYPES,
  FAMILY_PARAPET_SUBTYPES,
  FAMILY_PLATE_SUBTYPES,
  familyFastenerKeys,
  familyParapetNeeds,
  fastenerInchKey,
  isNonDlFamily,
  type AdminSnapshot,
  type CatalogRow,
} from "./accessory-families";

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
const tpo = fam.refs.nonDlTpo;
const admin = {
  deckOrder: [],
  priceMatrix: {},
  labor: {},
  settings: {},
  accessoryFamilies: fam,
} as unknown as AdminSnapshot;

describe("fastenerInchKey", () => {
  it("reads both legacy and Firestone size spellings; no size sorts last", () => {
    expect(fastenerInchKey('1 1/2" Spade')).toBe(1.5);
    expect(fastenerInchKey('1-1/4" All-Purpose (.235)')).toBe(1.25);
    expect(fastenerInchKey('10" Pre-Assembled HD Fastener w/ HD Seam Plate')).toBe(10);
    expect(fastenerInchKey('2-3/8" HD Seam Plate (stacked)')).toBe(2.375);
    expect(fastenerInchKey("Metal Anchors")).toBe(999);
  });
});

describe("familyFastenerKeys on the seed's Non-DL TPO catalog", () => {
  it("the parapet screen's XHD rows and DL-Plates rows, size-sorted", () => {
    const xhd = familyFastenerKeys(tpo, FAMILY_PARAPET_SUBTYPES);
    expect(xhd.length).toBeGreaterThan(5);
    expect(xhd).toContain(fastenerKey('3" Pre-Assembled HD Fastener w/ HD Seam Plate', "XHD"));
    expect(xhd.every((k) => k.endsWith("|XHD"))).toBe(true);
    const sizes = xhd.map((k) => fastenerInchKey(k));
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
    const plates = familyFastenerKeys(tpo, FAMILY_PLATE_SUBTYPES);
    expect(plates).toContain(fastenerKey('2-3/8" HD Seam Plate (stacked)', "DL-Plates"));
    expect(plates.every((k) => k.endsWith("|DL-Plates"))).toBe(true);
    // None of the engine's fixed Duro-Last keys exist in this catalog — that was the empty screen.
    for (const k of EDGE_FASTENER_GROUPS.parapet)
      expect(tpo.fasteners.some((f) => f.key === k)).toBe(false);
  });
  it("the edge screens list Spade and XHD; masonry bits are absent so their column hides", () => {
    const edge = familyFastenerKeys(tpo, FAMILY_EDGE_SUBTYPES);
    expect(edge.some((k) => k.endsWith("|Spade"))).toBe(true);
    expect(edge.some((k) => k.endsWith("|XHD"))).toBe(true);
    expect(edge).toContain(fastenerKey('1-1/4" All-Purpose (.235)', "Spade"));
    expect(familyFastenerKeys(tpo, ["Bit-SDS", "Bit-Straight", "Bit-TE-CX"])).toEqual([]);
    expect(familyFastenerKeys(tpo, ["SD-Tips"])).toEqual([]);
    expect(familyFastenerKeys(undefined, FAMILY_EDGE_SUBTYPES)).toEqual([]);
    expect(isNonDlFamily("nonDlTpo")).toBe(true);
    expect(isNonDlFamily("epdm")).toBe(true);
    expect(isNonDlFamily("duroLast")).toBe(false);
    expect(isNonDlFamily(undefined)).toBe(false);
  });
});

describe("familyParapetNeeds nets the family's typed rows for display", () => {
  const xhdKey = fastenerKey('3" Pre-Assembled HD Fastener w/ HD Seam Plate', "XHD");
  const plateKey = fastenerKey('2-3/8" HD Seam Plate (stacked)', "DL-Plates");
  const result = { parapetTabs: { fastenersNeeded: 632, steelPlatesNeeded: 632 } };
  const state = (parapet: Record<string, number>) => ({ fastenerQty: { parapet } });
  it("nothing typed: the engine's figures", () => {
    expect(familyParapetNeeds(result, state({}), tpo)).toEqual({
      fastenersNeeded: 632,
      steelPlatesNeeded: 632,
    });
    expect(familyParapetNeeds(undefined, state({}), tpo)).toEqual({
      fastenersNeeded: 0,
      steelPlatesNeeded: 0,
    });
  });
  it("typed XHD fasteners reduce Fasteners Needed; typed plates reduce Steel Plates Needed, as the engine nets its own rows", () => {
    expect(familyParapetNeeds(result, state({ [xhdKey]: 632 }), tpo)).toEqual({
      fastenersNeeded: 0,
      steelPlatesNeeded: 632,
    });
    expect(familyParapetNeeds(result, state({ [xhdKey]: 700, [plateKey]: 700 }), tpo)).toEqual({
      fastenersNeeded: -68,
      steelPlatesNeeded: 0,
    });
    // A key the engine already nets (its own group) or an unknown key is not counted twice.
    expect(
      familyParapetNeeds(result, state({ [PLATE_ROWS.steel]: 100, "nope|XHD": 5 }), tpo),
    ).toEqual({ fastenersNeeded: 632, steelPlatesNeeded: 632 });
  });
});

describe("the Non-DL TPO group's fastener screens render the seed's rows", () => {
  const render = (screen: "termBar" | "parapetTabs" | "wood" | "metal") =>
    renderToString(
      createElement(AccessoriesScreens, {
        family: "nonDlTpo",
        initialScreen: screen,
        state: emptyAccessoriesState(),
        onChange: () => {},
        refData: tpo,
        result: computeFamilyResults(
          {
            sections: [],
            parapets: [],
            curbs: [],
            roofSystem: "Non-DL TPO",
            attachment: "mechanical",
          },
          admin,
        ).nonDlTpo,
        sections: [],
        adhesiveNames: [],
        adhesiveCalc: undefined,
        arpCalcQty: 0,
      }),
    );
  it("Parapet Wall-Tabs lists an XHD row and a DL-Plates row, no Masonry Bits column", () => {
    const html = render("parapetTabs");
    expect(html).toContain("Parapet Wall-Tab Fasteners");
    expect(html).toContain("Pre-Assembled HD Fastener w/ HD Seam Plate XHD");
    expect(html).toContain("HD Seam Plate (stacked)");
    expect(html).toContain("Steel Plates");
    expect(html).not.toContain("Masonry Bits");
    expect(html).not.toContain("Metal Anchors");
  });
  it("Term Bar lists a Spade row", () => {
    const html = render("termBar");
    expect(html).toContain("All-Purpose (.235) Spade");
    expect(html).not.toContain("Metal Anchors");
  });
  it("the deck screens list the Firestone rows by subtype and drop the empty Driver Tips column", () => {
    const wood = render("wood");
    expect(wood).toContain("All-Purpose (.235)");
    expect(wood).toContain("Pre-Assembled HD Fastener w/ HD Seam Plate");
    expect(wood).toContain(">Plates<");
    expect(wood).not.toContain("Driver Tips");
    const metal = render("metal");
    expect(metal).toContain("Purlin Fasteners");
    expect(metal).not.toContain("Driver Tips");
  });
  it("the DL group keeps the engine's captured keys", () => {
    const screens = readFileSync("src/components/accessories-screens.tsx", "utf8");
    expect(screens).toContain(
      ": EDGE_FASTENER_GROUPS.parapet.filter((k) => k !== PLATE_ROWS.steel);",
    );
    expect(screens).toContain(
      "nonDl ? familyFastenerKeys(refData, FAMILY_EDGE_SUBTYPES) : EDGE_FASTENER_GROUPS[slot]",
    );
    expect(screens).toContain("if (nonDl && rows.length === 0) return null;");
  });
});

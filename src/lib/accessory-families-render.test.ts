/**
 * The accessory group screens rendered against the seed's own Non-DL TPO and EPDM branches
 * (src/lib/pricing-seed/accessory-families.ts → lib/accessory-families.ts → the engine's ref
 * builder → AccessoriesScreens): a family group lists only the screens its ref carries rows for
 * (EPDM has no vents, no fascia, no drip edge), the DL group keeps every screen, and every
 * group gets the Other Accessories entry when given its items. Fails on the old code (every
 * screen listed for every ref; no Other Accessories entry; no family marker).
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccessoriesScreens } from "@/components/accessories-screens";
import { emptyAccessoriesState } from "@/lib/engine/accessories";
import { FAMILY_SCREENS, LABOR_ROWS, type SeedScreen } from "@/lib/pricing-seed/accessory-families";

import {
  buildFamilyAccessoryData,
  computeFamilyResults,
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
const admin = {
  deckOrder: [],
  priceMatrix: {},
  labor: {},
  settings: {},
  accessoryFamilies: fam,
} as unknown as Parameters<typeof computeFamilyResults>[1];
const geo = {
  sections: [],
  parapets: [],
  curbs: [],
  roofSystem: "Duro-Last",
  attachment: "mechanical" as const,
};
const results = computeFamilyResults({ ...geo }, admin);

const render = (family: "duroLast" | "nonDlTpo" | "epdm", withOther: boolean) =>
  renderToString(
    createElement(AccessoriesScreens, {
      family,
      state: emptyAccessoriesState(),
      onChange: () => {},
      refData: family === "duroLast" ? fam.refs.nonDlTpo : fam.refs[family],
      result: family === "duroLast" ? undefined : results[family],
      sections: [],
      adhesiveNames: [],
      adhesiveCalc: undefined,
      arpCalcQty: 0,
      ...(withOther
        ? { otherItems: fam.other[family], otherLines: [], onOtherChange: () => {} }
        : {}),
    }),
  );

const treeLabels = (html: string) =>
  [...html.matchAll(/<button type="button"[^>]*>([^<]+?)<\/button>/g)].map((m) => m[1]!.trim());

describe("the family groups render the seed's refs", () => {
  it("EPDM lists only the screens its ref carries (no vents, fascia, drip edge, panduit)", () => {
    const html = render("epdm", true);
    expect(html).toContain('data-accessory-family="epdm"');
    const labels = treeLabels(html);
    expect(labels).toContain("Corners");
    expect(labels).toContain("Pipe Stacks");
    expect(labels).toContain("Conduit Washers");
    expect(labels).toContain("Roof Drains &amp; Boots");
    expect(labels).toContain("Walk Pads");
    expect(labels).toContain("Term Bar");
    expect(labels).toContain("Sealants");
    expect(labels).toContain("Membrane Acc.");
    expect(labels).toContain("Wood");
    expect(labels).toContain("Other Accessories");
    for (const hidden of [
      "Vents",
      "1-3/4&quot; Fascia",
      "4&quot; Fascia",
      "Gravel Stop",
      "Drip Edge",
      "Base &amp; Snap Cover",
      "Panduit Straps",
      "Adhesives",
    ])
      expect(labels).not.toContain(hidden);
    // The default Term Bar screen is present here, so it opens.
    expect(html).toContain("Roof Edges:");
  });
  it("Non-DL TPO: the same, with its Other Accessories; no vents screen either", () => {
    const labels = treeLabels(render("nonDlTpo", true));
    expect(labels).not.toContain("Vents");
    expect(labels).not.toContain("Conduit Washers");
    expect(labels).toContain("Pipe Stacks");
    expect(labels).toContain("Other Accessories");
    expect(fam.other.nonDlTpo.length).toBeGreaterThan(5);
  });
  it("the DL group keeps every screen whatever its ref holds; Other only when given items", () => {
    const all = treeLabels(render("duroLast", false));
    expect(all).toContain("Vents");
    // renderToString escapes the inch mark.
    expect(all).toContain("1-3/4&quot; Fascia");
    expect(all).toContain("Adhesives");
    expect(all).not.toContain("Other Accessories");
    expect(treeLabels(render("duroLast", true))).toContain("Other Accessories");
  });
  it("the seed's EPDM corners price under White and the T-Patch rows are the one t-joint row per family", () => {
    expect(fam.refs.epdm.corners[0]!.priceByColor).toEqual({ White: 7.35 });
    expect(fam.refs.epdm.corners[0]!.hours).toBe(0.1667);
    expect(fam.refs.nonDlTpo.membraneAccs.tPatch).toEqual({ pricePerPack: 63, partsPerPack: 100 });
    expect(fam.refs.epdm.membraneAccs.tPatch).toEqual({ pricePerPack: 446, partsPerPack: 100 });
    expect(fam.refs.nonDlTpo.pipeStackSizes.map((s) => s.size)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(fam.refs.epdm.walkPads[0]!.hours).toBe(0.5);
    expect(fam.refs.nonDlTpo.strainers[0]!.hours).toBe(0.5);
  });
});

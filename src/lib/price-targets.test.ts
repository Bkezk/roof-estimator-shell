/**
 * The price cells an item number can point at (lib/price-targets.ts): since the accessory
 * families (owner, Oct 26–27) the Item Numbers tab and the price import offer every screen of
 * the four pricing branches, in menu order, the Exceptional Metals pitch pans by Unit Cost
 * included — not the Duro-Last screens alone.
 */
import { describe, expect, it } from "vitest";

import {
  branchOfScreen,
  groupByBranch,
  hasItemNumbers,
  PRICE_TARGET_BRANCHES,
  screenTitle,
} from "@/lib/catalog-branches";
import { NON_PRICE_COLS, priceTargetsOf } from "@/lib/price-targets";

const epdmSealants = {
  id: "epdm:sealants",
  branch: "epdm",
  category: "Sealants",
  sort: 1,
  data: {
    columns: ["Description", "Part #", "Price"],
    rows: [
      { Description: "Lap Sealant (10.3 oz tube)", "Part #": "W56RAC4180", Price: 12.5 },
      { Description: "Water Block (10.3 oz tube)", "Part #": "W56RAC4190", Price: 9 },
    ],
  },
};
const tpoFasteners = {
  id: "non_dl_tpo:fasteners_and_bits",
  branch: "non_dl_tpo",
  category: "Fasteners & Bits",
  sort: 8,
  data: {
    columns: ["Part #", "Subtype", "Description", "Price/Box", "Fasteners/Box"],
    rows: [
      {
        "Part #": "W56HD2",
        Subtype: "Heavy Duty",
        Description: '2"',
        "Price/Box": 210,
        "Fasteners/Box": 1000,
      },
      {
        "Part #": "W56AP2",
        Subtype: "All Purpose",
        Description: '2"',
        "Price/Box": 180,
        "Fasteners/Box": 1000,
      },
    ],
  },
};
const tpoOther = {
  id: "non_dl_tpo:other_accessories",
  branch: "non_dl_tpo",
  category: "Other Accessories",
  sort: 9,
  data: {
    columns: ["Description", "Part #", "Price", "Labor (Hrs)"],
    rows: [
      {
        Description: "UltraPly TPO Flashing 24\" x 50'",
        "Part #": "W56TPO3024",
        Price: 300,
        "Labor (Hrs)": 0,
      },
    ],
  },
};
const customApps = {
  id: "non_dl:preset_custom_applications",
  branch: "non_dl",
  category: "Preset Custom Applications",
  sort: 8,
  data: {
    columns: ["Description", "Price", "LaborPerUnit", "Labor Rate"],
    rows: [
      {
        Description: "EPDM Membrane PreWash (per gal)",
        Price: 39,
        LaborPerUnit: 0,
        "Labor Rate": 0,
      },
    ],
  },
};
const dlSealants = {
  id: "duro_last:sealants",
  branch: "duro_last",
  category: "Sealants",
  sort: 4,
  data: {
    columns: ["Description", "Part #", "Price"],
    rows: [{ Description: "Duro-Caulk Plus", "Part #": "1225B", Price: 11 }],
  },
};
const metals = {
  id: "duro_last:exceptional_metals",
  branch: "duro_last",
  category: "Exceptional Metals",
  sort: 30,
  data: {
    kind: "metals",
    subscreens: {
      gutters: { rows: [{ description: '6" K-style', unit_cost: 5 }] },
      pitch_pans: {
        columns: ["Description", "Unit Cost", "Labor/Unit", "Labor Rate"],
        rows: [
          { description: "Pitch Pan 4x4", unit_cost: 20, labor_per_unit_lf: 1, labor_rate: 45 },
          {
            description: "UltraPly TPO Penetration Pocket (6 pockets/kit, $200)",
            unit_cost: 33.33,
            labor_per_unit_lf: 1,
            labor_rate: 45,
          },
          { description: "", unit_cost: 0, labor_per_unit_lf: 0, labor_rate: 0 },
        ],
      },
    },
  },
};
const adhesives = {
  id: "duro_last:adhesives",
  branch: "duro_last",
  category: "Adhesives",
  sort: 3,
  data: {
    kind: "adhesives",
    products: [{ name: "Single-Ply LVOC Bonding Adhesive", price: 245, unit_type: "5-gal. Pail" }],
  },
};

describe("priceTargetsOf: every pricing branch, in menu order", () => {
  it("lists the family and Non-DL screens beside the Duro-Last ones, grouped by branch then sort", () => {
    // Handed in the database's order (by sort alone, branches interleaved).
    const out = priceTargetsOf([
      epdmSealants,
      adhesives,
      dlSealants,
      customApps,
      tpoFasteners,
      tpoOther,
      metals,
    ]);
    expect(out.map((t) => t.screen_id)).toEqual([
      "duro_last:adhesives",
      "duro_last:sealants",
      "duro_last:exceptional_metals",
      "non_dl:preset_custom_applications",
      "non_dl_tpo:fasteners_and_bits",
      "non_dl_tpo:other_accessories",
      "epdm:sealants",
    ]);
    expect(out.map((t) => t.branch)).toEqual([
      "duro_last",
      "duro_last",
      "duro_last",
      "non_dl",
      "non_dl_tpo",
      "non_dl_tpo",
      "epdm",
    ]);
  });

  it("a family screen offers its rows and price columns like a Duro-Last one", () => {
    const [t] = priceTargetsOf([epdmSealants]);
    expect(t).toMatchObject({
      screen_id: "epdm:sealants",
      branch: "epdm",
      category: "Sealants",
      rows: ["Lap Sealant (10.3 oz tube)", "Water Block (10.3 oz tube)"],
      price_cols: ["Price"],
      values: { "Lap Sealant (10.3 oz tube)": { Price: 12.5 } },
    });
    expect(t!.kind).toBeUndefined();
  });

  it("fastener rows that repeat a label are keyed by Subtype, with the pack size, as on Duro-Last", () => {
    const [t] = priceTargetsOf([tpoFasteners]);
    expect(t!.rows).toEqual(['2" [Heavy Duty]', '2" [All Purpose]']);
    expect(t!.price_cols).toEqual(["Price/Box"]);
    expect(t!.pack_col).toBe("Fasteners/Box");
    expect(t!.packs).toEqual({ '2" [Heavy Duty]': 1000, '2" [All Purpose]': 1000 });
  });

  it("labor columns are never price targets: Labor (Hrs) on Other Accessories, LaborPerUnit / Labor Rate on Preset Custom Applications", () => {
    const [other, custom] = priceTargetsOf([tpoOther, customApps]);
    expect(other!.price_cols).toEqual(["Price"]);
    expect(custom!.price_cols).toEqual(["Price"]);
    for (const c of ["Labor (Hrs)", "LaborPerUnit", "Labor Rate", "Part #", "Subtype", "Size"])
      expect(NON_PRICE_COLS.has(c)).toBe(true);
  });

  it("Exceptional Metals offers its Pitch Pans by description on Unit Cost (the Firestone penetration pockets), nothing else", () => {
    const [t] = priceTargetsOf([metals]);
    expect(t).toMatchObject({
      screen_id: "duro_last:exceptional_metals",
      kind: "metals",
      category: "Exceptional Metals › Pitch Pans",
      rows: ["Pitch Pan 4x4", "UltraPly TPO Penetration Pocket (6 pockets/kit, $200)"],
      price_cols: ["Unit Cost"],
    });
    expect(t!.values["UltraPly TPO Penetration Pocket (6 pockets/kit, $200)"]).toEqual({
      "Unit Cost": 33.33,
    });
    // A metals screen with no pitch pans yet offers nothing.
    expect(
      priceTargetsOf([
        { ...metals, data: { kind: "metals", subscreens: { pitch_pans: { rows: [] } } } },
      ]),
    ).toEqual([]);
  });

  it("adhesives keep their shape, marked by kind so the import's 'add as new product' skips them", () => {
    const [t] = priceTargetsOf([adhesives]);
    expect(t).toMatchObject({
      kind: "adhesives",
      price_cols: ["price"],
      rows: ["Single-Ply LVOC Bonding Adhesive"],
    });
    expect(t!.row_units).toEqual({ "Single-Ply LVOC Bonding Adhesive": "5-gal. Pail" });
  });
});

describe("catalog-branches", () => {
  it("the four branches, their labels and their item-number status", () => {
    expect([...PRICE_TARGET_BRANCHES]).toEqual(["duro_last", "non_dl", "non_dl_tpo", "epdm"]);
    for (const b of PRICE_TARGET_BRANCHES) expect(hasItemNumbers(b)).toBe(true);
    expect(hasItemNumbers("service")).toBe(false);
    expect(branchOfScreen("epdm:sealants")).toBe("epdm");
    expect(branchOfScreen("non_dl_tpo:pipe_stacks")).toBe("non_dl_tpo");
    expect(branchOfScreen("odd")).toBe("odd");
  });
  it("screenTitle keeps the Duro-Last slug and prefixes a family screen with its page", () => {
    expect(screenTitle("duro_last:sealants")).toBe("sealants");
    expect(screenTitle("epdm:sealants")).toBe("EPDM Accessories › sealants");
    expect(screenTitle("non_dl_tpo:corners")).toBe("Non-DL TPO Accessories › corners");
    expect(screenTitle("non_dl:preset_custom_applications")).toBe(
      "Non Duro-Last Pricing › preset_custom_applications",
    );
  });
  it("groupByBranch: menu order, items in their own order, unknown branches last", () => {
    const g = groupByBranch([
      { screen_id: "epdm:corners" },
      { screen_id: "duro_last:sealants" },
      { screen_id: "epdm:sealants" },
      { screen_id: "zzz:thing" },
      { screen_id: "non_dl_tpo:sealants" },
    ]);
    expect(g.map((x) => [x.label, x.items.map((i) => i.screen_id)])).toEqual([
      ["Duro-Last Pricing", ["duro_last:sealants"]],
      ["Non-DL TPO Accessories", ["non_dl_tpo:sealants"]],
      ["EPDM Accessories", ["epdm:corners", "epdm:sealants"]],
      ["zzz", ["zzz:thing"]],
    ]);
  });
});

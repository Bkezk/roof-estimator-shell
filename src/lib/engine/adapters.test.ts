import { describe, it, expect } from "vitest";

import {
  buildPriceMatrix,
  buildLaborTables,
  parseMembraneRow,
  assembleEngineAdminData,
  buildTearOffLookup,
  buildUnderlaymentPrices,
  buildAccessoryCatalog,
  buildAccessoryLaborLookup,
  buildNonDlCatalog,
  buildShippingSteps,
  buildSetupTable,
  buildInspectionTable,
  TEAROFF_DECK_BY_LABOR_DECK,
  type LaborCombo,
} from "./adapters";
import { freightStepped } from "./pricing";
import { setupTime, inspectionTime } from "./quantities";
import { priceMatrixLookup } from "./pricing";
import { bandLookup, directLookup, mechLaborRate } from "./labor";

// Real shapes from the seeded data (duro-last-pricing.json / rdl-membrane.json), trimmed.
const membraneScreen = {
  columns: ["Description", "White", "Tan", "Gray", "Dark Gray", "Terra Cotta", "Rock-Ply"],
  rows: [
    {
      Description: "Duro-Last - 40mil Roll Goods",
      White: 1.23,
      Tan: 1.25,
      Gray: 1.25,
      "Dark Gray": 1.25,
      "Terra Cotta": null,
      "Rock-Ply": null,
    },
    {
      Description: 'Duro-Last - 40mil 28" Tabs',
      White: 1.35,
      Tan: 1.37,
      Gray: 1.37,
      "Dark Gray": 1.37,
      "Terra Cotta": null,
      "Rock-Ply": null,
    },
    {
      Description: "Duro-Last - 50mil Roll Goods",
      White: 1.36,
      Tan: 1.37,
      Gray: 1.37,
      "Dark Gray": 1.37,
      "Terra Cotta": 1.37,
      "Rock-Ply": 0,
    },
    {
      Description: "Duro-Fleece - 50mil",
      White: 1.39,
      Tan: null,
      Gray: null,
      "Dark Gray": null,
      "Terra Cotta": null,
      "Rock-Ply": null,
    }, // different family — skipped
  ],
};

const deckOrder = [
  "Wood",
  "Steel",
  "Retrofit",
  "Concrete",
  "Gypsum",
  "LWC/Steel",
  "LWC/Concrete",
  "LWC/Other",
  "Tectum",
  "Purlin",
];

const duroLastMechCombo: LaborCombo = {
  roof_system: "Duro-Last",
  attachment: "mechanical",
  base: { tab_value: 28, tab_multiplier: 1.5125 },
  deck_multipliers: {
    Wood: 1,
    Steel: 1.064,
    Retrofit: 1.25,
    Concrete: 2,
    Gypsum: 1.8,
    "LWC/Steel": 1.2,
    "LWC/Concrete": 2.3,
    "LWC/Other": 1.52,
    Tectum: 1.064,
    Purlin: 1.2,
  },
  fastener_spacing_multipliers: [
    { spacing_in: 24, multiplier: 0.91 },
    { spacing_in: 21, multiplier: 0.96 },
    { spacing_in: 18, multiplier: 1 },
    { spacing_in: 15, multiplier: 1.04 },
    { spacing_in: 12, multiplier: 1.1 },
    { spacing_in: 9, multiplier: 1.21 },
    { spacing_in: 6, multiplier: 1.41 },
  ],
  sheet_size_multipliers: [
    { label: "Roll Good", roof_section: 4, underlayment: 4 },
    { label: "1500 sf", roof_section: 1, underlayment: 1 },
    { label: "3000 sf", roof_section: 0.82, underlayment: 0.82 },
  ],
  thickness_multipliers: [
    { mil: 40, multiplier: 1 },
    { mil: 50, multiplier: 1.15 },
    { mil: 60, multiplier: 1.25 },
  ],
};

describe("membrane row parsing", () => {
  it("parses thickness and tier from the Description", () => {
    expect(parseMembraneRow("Duro-Last - 40mil Roll Goods")).toEqual({
      thickness: 40,
      tier: "rollGoods",
    });
    expect(parseMembraneRow('Duro-Last - 60mil 120" Tabs')).toEqual({
      thickness: 60,
      tier: "tab120",
    });
    expect(parseMembraneRow("Duro-Last - 50mil Parapets")).toEqual({
      thickness: 50,
      tier: "parapet",
    });
  });
  it("returns null for non-Duro-Last families", () => {
    expect(parseMembraneRow("Duro-Fleece - 50mil")).toBeNull();
    expect(parseMembraneRow("Duro-Bond - 40")).toBeNull();
  });
});

describe("buildPriceMatrix (from the seeded membrane screen)", () => {
  const matrix = buildPriceMatrix(membraneScreen);
  it("maps thickness × tier × color to $/sqft", () => {
    expect(priceMatrixLookup(matrix, 40, "rollGoods", "White")).toBe(1.23);
    expect(priceMatrixLookup(matrix, 40, "rollGoods", "Tan")).toBe(1.25);
    expect(priceMatrixLookup(matrix, 40, "tab28", "White")).toBe(1.35);
    expect(priceMatrixLookup(matrix, 50, "rollGoods", "Terra Cotta")).toBe(1.37);
  });
  it("skips null cells and non-Duro-Last families", () => {
    expect(priceMatrixLookup(matrix, 40, "rollGoods", "Terra Cotta")).toBeNull(); // null cell
    expect(matrix[50]?.rollGoods?.["Rock-Ply"]).toBe(0); // an editable 0 is kept
    // Duro-Fleece row never created a stray thickness entry beyond the DL 40/50
    expect(Object.keys(matrix).sort()).toEqual(["40", "50"]);
  });
});

describe("buildLaborTables (from a Roof Deck Labor combo)", () => {
  const t = buildLaborTables(duroLastMechCombo, deckOrder);

  it("deck multipliers keyed by column-order id; Wood = id 0 = ×1", () => {
    expect(t.deckTypeIds["Wood"]).toBe(0);
    expect(directLookup(t.deckTypeMulti, 0)).toBe(1);
    expect(directLookup(t.deckTypeMulti, t.deckTypeIds["Concrete"]!)).toBe(2);
  });

  it("on-center bands, single tab band, sheet-size and thickness maps", () => {
    expect(bandLookup(t.onCenterBands, 18)).toBe(1);
    expect(bandLookup(t.onCenterBands, 6)).toBe(1.41);
    expect(bandLookup(t.tabBands, 28)).toBe(1.5125);
    expect(t.sheetSizeMultiByLabel["1500 sf"]).toBe(1);
    expect(t.thicknessLaborByMil[40]).toBe(1);
    expect(t.thicknessLaborByMil[60]).toBe(1.25);
  });

  it("END-TO-END: seeded admin data → adapter → engine reproduces the §9 field-labor anchor", () => {
    // Wood deck, 28" tab (×1.5125), 18" OC (×1), 1500sf sheet (×1), no complexity.
    const rate = mechLaborRate({
      deckMulti: directLookup(t.deckTypeMulti, t.deckTypeIds["Wood"]!),
      tabMulti: bandLookup(t.tabBands, duroLastMechCombo.base!.tab_value),
      ocMulti: bandLookup(t.onCenterBands, 18),
      sheetSizeMulti: t.sheetSizeMultiByLabel["1500 sf"]!,
      complexity: 1,
    });
    expect(rate * 2500).toBeCloseTo(15.125, 6); // engine-truth §9: 10 × 1 × 1.5125 × 1
  });
});

describe("buildTearOffLookup (from the seeded Tearoff Times grid)", () => {
  const data = {
    deck_columns: ["Wood", "Structural Metal", "Concrete"],
    rows: [
      {
        tearoff_type: 'BUR < 2"',
        by_deck: { Wood: 2.4876, "Structural Metal": 1.2438, Concrete: 1.2438 },
      },
      { tearoff_type: "Ballasted Single", by_deck: { Wood: 1.2438 } },
    ],
  };
  it("keys by [tearoff deck][type] and divides the Hours/100SqFt grid by 100", () => {
    const t = buildTearOffLookup(data);
    expect(t.tearoffTypes).toEqual(['BUR < 2"', "Ballasted Single"]);
    expect(t.lookup["Wood"]!['BUR < 2"']).toBeCloseTo(0.024876, 9);
    expect(t.lookup["Structural Metal"]!['BUR < 2"']).toBeCloseTo(0.012438, 9);
  });
  it("the labor→tearoff deck-name map bridges the two taxonomies", () => {
    expect(TEAROFF_DECK_BY_LABOR_DECK["Steel"]).toBe("Structural Metal");
    expect(TEAROFF_DECK_BY_LABOR_DECK["Retrofit"]).toBe("Metal Retrofit");
    expect(TEAROFF_DECK_BY_LABOR_DECK["Wood"]).toBe("Wood");
  });
});

describe("buildUnderlaymentPrices (from the seeded Underlayment screen)", () => {
  it("maps board Name → Cost/Sq. Ft.", () => {
    const prices = buildUnderlaymentPrices({
      columns: ["Name", "Cost/Sq. Ft."],
      rows: [
        { Name: '1/2" ISO', "Cost/Sq. Ft.": 0.85 },
        { Name: "Duro-Fold", "Cost/Sq. Ft.": 0.3 },
        { Name: "", "Cost/Sq. Ft.": 1 }, // blank name skipped
      ],
    });
    expect(prices['1/2" ISO']).toBe(0.85);
    expect(prices["Duro-Fold"]).toBe(0.3);
    expect(Object.keys(prices)).toEqual(['1/2" ISO', "Duro-Fold"]);
  });
});

describe("buildAccessoryCatalog (flatten price screens incl. color/box variants)", () => {
  it("single-Price screen → one base item, no variant suffix (existing behavior preserved)", () => {
    const items = buildAccessoryCatalog([
      {
        id: "duro_last:vents",
        category: "Vents",
        data: {
          columns: ["Description", "Part #", "Price"],
          rows: [{ Description: "White Vent", "Part #": "1231", Price: 25.75 }],
        },
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      category: "Vents",
      description: "White Vent",
      price: 25.75,
      variant: "",
    });
    expect(items[0]!.key).toBe("duro_last:vents::White Vent");
  });

  it("color-priced screens → one variant per color column (bare and ' Price'-suffixed)", () => {
    const items = buildAccessoryCatalog([
      {
        id: "duro_last:corners",
        category: "Corners",
        data: {
          columns: ["Description", "Part #", "White", "Tan"], // bare color columns
          rows: [{ Description: 'Inside 6" x 6"', "Part #": "1311", White: 4.4, Tan: 5.4 }],
        },
      },
      {
        id: "duro_last:drip_edge",
        category: "Drip Edge",
        data: {
          columns: ["Description", "Part #", "White Price", "Gray Price"], // ' Price' suffix
          rows: [{ Description: 'Drip Edge 2"', "White Price": 8.4, "Gray Price": 9.98 }],
        },
      },
    ]);
    const white = items.find((i) => i.key === 'duro_last:corners::Inside 6" x 6"::White');
    expect(white).toMatchObject({
      description: 'Inside 6" x 6" — White',
      price: 4.4,
      variant: "White",
    });
    expect(
      items.find((i) => i.key.startsWith("duro_last:corners") && i.variant === "Tan"),
    ).toMatchObject({
      price: 5.4,
    });
    // ' Price' suffix stripped to the color name
    expect(
      items.find((i) => i.key.startsWith("duro_last:drip_edge") && i.variant === "Gray"),
    ).toMatchObject({ description: 'Drip Edge 2" — Gray', price: 9.98 });
    expect(items).toHaveLength(4); // corners ×2 + drip edge ×2
  });

  it("box-priced screen: 'Price/Box' is the price; the 'Fasteners/Box' count is not", () => {
    const items = buildAccessoryCatalog([
      {
        id: "duro_last:fasteners_and_bits",
        category: "Fasteners & Bits",
        data: {
          columns: ["Part #", "Subtype", "Description", "Price/Box", "Fasteners/Box"],
          rows: [
            {
              "Part #": "1241",
              Subtype: "",
              Description: "Metal Anchors",
              "Price/Box": 255,
              "Fasteners/Box": 1000,
            },
          ],
        },
      },
    ]);
    expect(items).toHaveLength(1); // Fasteners/Box excluded → not a second item
    expect(items[0]).toMatchObject({ description: "Metal Anchors", price: 255, variant: "" });
  });

  it("skips screens with no price column (e.g. a Multiplier-only usages screen)", () => {
    const items = buildAccessoryCatalog([
      {
        id: "x:usages",
        category: "Pipe Stack Usages",
        data: {
          columns: ["Description", "Multiplier"],
          rows: [{ Description: "Plumbing", Multiplier: 0.5 }],
        },
      },
    ]);
    expect(items).toHaveLength(0);
  });
});

describe("buildAccessoryLaborLookup (best-effort per-unit hours prefill)", () => {
  it("maps single-'Labor(Hrs)' screens; skips multi-column screens; drops ambiguous keys", () => {
    const lookup = buildAccessoryLaborLookup([
      {
        id: "acc:corners",
        category: "Corners",
        data: {
          columns: ["Description", "Labor(Hrs)"],
          rows: [
            { Description: 'Inside 6" x 6"', "Labor(Hrs)": 0.1667 },
            { Description: 'Outside 18" x 12"', "Labor(Hrs)": 0.3333 },
          ],
        },
      },
      {
        id: "acc:fascia_bars",
        category: "Fascia Bars",
        data: {
          // multi-column drill screen → skipped entirely (which column applies is unknown)
          columns: ["Description", "PreDrill Labor(Hrs)", "NoDrill Labor (Hrs)"],
          rows: [
            {
              Description: '4" Fascia Bar',
              "PreDrill Labor(Hrs)": 0.0395,
              "NoDrill Labor (Hrs)": 0.0197,
            },
          ],
        },
      },
      {
        id: "acc:conflict",
        category: "Other",
        data: {
          // same description, different hours as an earlier screen → ambiguous → dropped
          columns: ["Description", "Labor (Hrs)"],
          rows: [{ Description: 'Inside 6" x 6"', "Labor (Hrs)": 0.9 }],
        },
      },
    ]);
    expect(lookup['Outside 18" x 12"']).toBe(0.3333);
    expect(lookup['4" Fascia Bar']).toBeUndefined(); // drill screen skipped
    expect(lookup['Inside 6" x 6"']).toBeUndefined(); // 0.1667 vs 0.9 → ambiguous, dropped
  });
});

describe("buildNonDlCatalog (non-DL price + labor screens)", () => {
  it("maps Description / Price / LaborPerUnit / Labor Rate per row; missing numerics → 0", () => {
    const items = buildNonDlCatalog([
      {
        id: "non_dl:sheet_metal_work",
        category: "Sheet Metal Work",
        data: {
          columns: ["Description", "Price", "LaborPerUnit", "Labor Rate"],
          rows: [
            {
              Description: "Curb Counter Flashing",
              Price: 4,
              LaborPerUnit: 0.0167,
              "Labor Rate": 45,
            },
          ],
        },
      },
      {
        id: "non_dl:subcontractors",
        category: "Subcontractors",
        data: {
          columns: ["Description", "Price", "LaborPerUnit", "Labor Rate"],
          rows: [{ Description: "HVAC", Price: 0, LaborPerUnit: 0, "Labor Rate": 45 }],
        },
      },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      category: "Sheet Metal Work",
      description: "Curb Counter Flashing",
      price: 4,
      laborPerUnit: 0.0167,
      laborRate: 45,
    });
    expect(items[0]!.key).toBe("non_dl:sheet_metal_work::Curb Counter Flashing");
  });
});

describe("buildShippingSteps (from the seeded shipping_steps rows)", () => {
  it("coerces string numerics, sorts ascending, and feeds the lower-bound freight lookup", () => {
    // Real seeded shape: Supabase returns numeric columns as strings, out of sort order.
    const steps = buildShippingSteps([
      { material_threshold: "7500", shipping_cost: "1050" },
      { material_threshold: "0", shipping_cost: "800" },
      { material_threshold: "5001", shipping_cost: "975" },
    ]);
    expect(steps.map((s) => s.fromThreshold)).toEqual([0, 5001, 7500]);
    expect(freightStepped(6000, steps)).toBe(975);
    expect(freightStepped(0, steps)).toBe(800);
  });
});

describe("buildSetupTable / buildInspectionTable (from the seeded labor tables)", () => {
  it("setup: multiplier bands floored to the Minimum row, feeding the §2.4 setup lookup", () => {
    // Real seeded shape (all-string numerics, out of order): minimum 16, all bands ×0.003.
    const table = buildSetupTable({ minimum_hours: "16" }, [
      { sqft: "100000", multiplier: "0.003" },
      { sqft: "6000", multiplier: "0.003" },
      { sqft: "20000", multiplier: "0.003" },
    ]);
    expect(table.minimum).toBe(16);
    expect(table.bands.map((b) => b.upTo)).toEqual([6000, 20000, 100000]);
    expect(setupTime(2500, table, 0)).toBeCloseTo(16, 6); // 2500×0.003=7.5 → floored to 16
    expect(setupTime(10000, table, 0)).toBeCloseTo(30, 6); // 10000×0.003=30 > min
  });
  it("inspection: flat bands, lowest edge doubles as the Minimum, feeding the §2.5 lookup", () => {
    const table = buildInspectionTable([
      { sqft: "5001", hours: "7" },
      { sqft: "0", hours: "5" },
      { sqft: "10001", hours: "10" },
    ]);
    expect(table.minimum).toBe(5);
    expect(table.bands.map((b) => b.edge)).toEqual([0, 5001, 10001]);
    expect(inspectionTime(2500, table, 0)).toBeCloseTo(5, 6); // < 5001 → 5
    expect(inspectionTime(8000, table, 0)).toBeCloseTo(7, 6); // [5001,10001) → 7
  });
});

describe("assembleEngineAdminData (whole-catalog transform)", () => {
  const raw = {
    membraneScreen,
    combos: [{ roof_system: "Duro-Last", attachment: "mechanical", data: duroLastMechCombo }],
    settings: {
      hours_per_man_day: 9,
      master_elite: true,
      sales_tax_rate: 0.0625,
      only_tax_material: true,
      shipping_method: "stepped",
      shipping_percent: 0,
    },
  };

  it("assembles price matrix, labor-by-combo, and settings from the raw rows", () => {
    const d = assembleEngineAdminData(raw);
    expect(d.priceMatrix[40]?.rollGoods?.["White"]).toBe(1.23);
    expect(d.labor["Duro-Last|mechanical"]?.deckTypeIds["Wood"]).toBe(0);
    expect(d.settings.hoursPerDay).toBe(9);
    expect(d.settings.salesTax).toBe(0.0625);
    expect(d.settings.taxMaterialOnly).toBe(true);
    expect(d.deckOrder[0]).toBe("Wood");
  });

  it("falls back to sane defaults when settings are missing", () => {
    const d = assembleEngineAdminData({ ...raw, settings: null });
    expect(d.settings.hoursPerDay).toBe(9);
    expect(d.settings.masterEliteCont).toBe(true);
    expect(d.settings.salesTax).toBe(0);
  });
});

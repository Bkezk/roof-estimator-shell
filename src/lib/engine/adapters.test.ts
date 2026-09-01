import { describe, it, expect } from "vitest";

import {
  buildPriceMatrix,
  buildLaborTables,
  parseMembraneRow,
  assembleEngineAdminData,
  buildTearOffLookup,
  TEAROFF_DECK_BY_LABOR_DECK,
  type LaborCombo,
} from "./adapters";
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

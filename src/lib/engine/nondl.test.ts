/**
 * §14 Non-Duro-Last Items — vectors transcribed from the DataAccess.dll IL extraction
 * (NDLItem money, the per-collection RecalcParents auto quantities, NonDL aggregates and
 * the ReviewCalc routing; docs/legacy-money-parity.md §14).
 */
import { describe, expect, it } from "vitest";

import {
  buildNonDlRefData,
  computeNonDl,
  edgeBlockingCalcQty,
  emptyNonDlState,
  nonDlCalcQuantities,
  normalizeNonDlState,
  parseInches,
  type NonDlGeometry,
} from "./nondl";

const row = (
  Description: string,
  Price: number,
  LaborPerUnit: number,
  rate: number,
  extra: Record<string, unknown> = {},
) => ({ Description, Price, LaborPerUnit, "Labor Rate": rate, ...extra });

const SCREENS = [
  {
    id: "non_dl:roof_edge_blocking",
    data: {
      rows: [
        row('½" Wood Blocking', 1, 0.01, 45),
        row('¾" Wood Blocking', 1.5, 0.01, 45),
        row('5/4" Wood Blocking', 2, 0.01, 45),
        row('2" Wood Blocking', 3, 0.01, 45),
        row('2" x 6" x 12\'', 8.99, 0.25, 45),
      ],
    },
  },
  {
    id: "non_dl:parapet_wall_blocking",
    data: { rows: [row('2" x 4" W/ 8" ISO', 0.57, 0.04, 40), row("Tear Off", 0, 0, 0)] },
  },
  {
    id: "non_dl:structural_deck_materials",
    data: { rows: [row('Plywood Deck ¾"', 21.89, 0.35, 45)] },
  },
  {
    id: "non_dl:sheet_metal_work",
    data: {
      rows: [row("Curb Counter Flashing", 4, 0.0167, 45), row("White 4 X 10 Sheet", 209.2, 0, 0)],
    },
  },
  {
    id: "non_dl:masonry",
    data: {
      rows: [
        row("Remove Only", 0, 0.1, 45),
        row("Mortar Mix", 0, 0.3, 45),
        row("Replace Capstones", 0, 0, 45),
      ],
    },
  },
  {
    id: "non_dl:3rd_party_services",
    data: {
      rows: [row("Crane", 0, 0, 150), row("Landfill", 0, 1, 85), row("Dumpster", 850, 0, 45)],
      extras: { yardage: 30 },
    },
  },
  {
    id: "non_dl:subcontractors",
    data: { rows: [row("HVAC", 0, 0, 45), row("Guttering", 8.5, 0, 45)] },
  },
  {
    id: "non_dl:preset_custom_applications",
    data: { rows: [row("Standard Roof Hatch", 978.75, 10, 45)] },
  },
  {
    id: "non_dl:others",
    data: {
      rows: [
        row("DL Approved Slipsheet", 0, 0, 0, { _uncaptured: true }),
        row("ISO (Curb Insulation Sq Ft)", 0, 0, 0, { _uncaptured: true }),
      ],
    },
  },
];

const noGeometry: NonDlGeometry = {
  sections: [],
  parapetBlockingLinealFt: 0,
  curbCounterflashFt: 0,
  capstoneRemoveLf: 0,
  capstoneReplaceLf: 0,
  disposalUnits: 0,
  polyethyleneSqFt: 0,
  curbIsoSqFt: 0,
};

describe("parseInches", () => {
  it("reads the leading inch dimension of board / blocking names", () => {
    expect(parseInches('1/4" Dens Deck')).toBe(0.25);
    expect(parseInches("1 1/2\" ISO 4'x 4'")).toBe(1.5);
    expect(parseInches('2.7" Rigid')).toBe(2.7);
    expect(parseInches('2" ISO')).toBe(2);
    expect(parseInches('½" Wood Blocking')).toBe(0.5);
    expect(parseInches('¾" Wood Blocking')).toBe(0.75);
    expect(parseInches('5/4" Wood Blocking')).toBe(1.25);
    expect(parseInches("Duro-Blue Slipsheet")).toBe(0);
  });
});

describe("buildNonDlRefData", () => {
  const ref = buildNonDlRefData(SCREENS);
  it("keys rows by seed order (RefID) and carries blocking thickness + dumpster yardage", () => {
    expect(ref.rows.roofEdgeBlocking?.map((r) => r.thicknessIn)).toEqual([0.5, 0.75, 1.25, 2, 2]);
    expect(ref.rows.masonry?.[1]).toMatchObject({ description: "Mortar Mix", refId: 2 });
    expect(ref.rows.services?.[2]).toMatchObject({ description: "Dumpster", refId: 3 });
    expect(ref.dumpsterYardage).toBe(30);
    expect(ref.rows.others?.[0]?.uncaptured).toBe(true);
  });
});

describe("edgeBlockingCalcQty (EdgeBlockings.RecalcParents greedy fill)", () => {
  const ref = buildNonDlRefData(SCREENS);
  const rows = ref.rows.roofEdgeBlocking!;
  it('2.75 in over 100 LF → one 2" + one ¾" per foot: Ceil(100 × 1.03) each', () => {
    // t = 2.75 → 2" fits (t=0.75) → 0.75 > 0.6 → ¾" fits (t=0) → done.
    const calc = edgeBlockingCalcQty(rows, [
      { blockingLinealFt: 100, underlaymentThicknessIn: 2.75 },
    ]);
    expect(calc).toEqual([0, 103, 0, 103, 0]);
  });
  it('remainder in [0.5, 0.6] adds one ½" board; under 0.5 is dropped', () => {
    // t = 1.5 → 5/4" (t = 0.25) → dropped.
    expect(
      edgeBlockingCalcQty(rows, [{ blockingLinealFt: 10, underlaymentThicknessIn: 1.5 }]),
    ).toEqual([0, 0, 11, 0, 0]);
    // t = 2.5 → 2" (t = 0.5) → not > 0.6 → 0.5 ≥ 0.5 → one ½".
    expect(
      edgeBlockingCalcQty(rows, [{ blockingLinealFt: 10, underlaymentThicknessIn: 2.5 }]),
    ).toEqual([11, 0, 0, 11, 0]);
  });
  it("sums per section (each section ceiled separately) and ignores zero thickness", () => {
    const calc = edgeBlockingCalcQty(rows, [
      { blockingLinealFt: 10, underlaymentThicknessIn: 2 },
      { blockingLinealFt: 10, underlaymentThicknessIn: 2 },
      { blockingLinealFt: 50, underlaymentThicknessIn: 0 },
    ]);
    expect(calc).toEqual([0, 0, 0, 22, 0]);
  });
});

describe("nonDlCalcQuantities", () => {
  const ref = buildNonDlRefData(SCREENS);
  it("routes every geometry hook to its RefID row", () => {
    const calc = nonDlCalcQuantities(ref, {
      ...noGeometry,
      parapetBlockingLinealFt: 100, // Ceil(103)
      curbCounterflashFt: 7,
      capstoneRemoveLf: 33, // Ceil(16.5) = 17 on Remove Only
      capstoneReplaceLf: 40, // 20 on Mortar Mix (RefID 2)
      disposalUnits: 3,
      polyethyleneSqFt: 120.4, // 121
      curbIsoSqFt: 6.1, // 7
    });
    expect(calc.wallBlocking).toEqual([103, 0]);
    expect(calc.sheetMetal).toEqual([7, 0]);
    expect(calc.masonry).toEqual([17, 20, 0]);
    expect(calc.services).toEqual([0, 0, 3]);
    expect(calc.others).toEqual([121, 7]);
  });
});

describe("computeNonDl", () => {
  const ref = buildNonDlRefData(SCREENS);

  it("NDLItem money: Round4 material/labor at the row's own rate; crew rate when the ref rate is 0", () => {
    const state = emptyNonDlState();
    state.rows.deckMaterials = { 'Plywood Deck ¾"': { extra: 3 } };
    state.rows.sheetMetal = { "White 4 X 10 Sheet": { extra: 2 } };
    const r = computeNonDl({ state, ref, geometry: noGeometry, crewRate: 52 });
    const ply = r.lines.find((l) => l.item === 'Plywood Deck ¾"')!;
    expect(ply.materialCost).toBeCloseTo(65.67, 4);
    expect(ply.hours).toBeCloseTo(1.05, 5);
    expect(ply.laborCost).toBeCloseTo(47.25, 4);
    const sheet = r.lines.find((l) => l.item === "White 4 X 10 Sheet")!;
    expect(sheet.laborRate).toBe(52); // ref rate 0 → estimate crew rate
    expect(sheet.materialCost).toBeCloseTo(418.4, 4);
    expect(r.otherMaterial).toBeCloseTo(65.67 + 418.4, 3);
    expect(r.ownRateLaborHours).toBeCloseTo(1.05, 5);
    expect(r.ownRateLaborCost).toBeCloseTo(47.25, 4);
  });

  it("qty = extra + calc; a typed Hours override bills verbatim", () => {
    const state = emptyNonDlState();
    state.rows.sheetMetal = { "Curb Counter Flashing": { extra: 3, laborHours: 2.5 } };
    const r = computeNonDl({
      state,
      ref,
      geometry: { ...noGeometry, curbCounterflashFt: 7 },
      crewRate: 45,
    });
    const cf = r.lines.find((l) => l.item === "Curb Counter Flashing")!;
    expect(cf).toMatchObject({ calcQty: 7, extraQty: 3, qty: 10 });
    expect(cf.materialCost).toBeCloseTo(40, 4);
    expect(cf.hours).toBe(2.5);
    expect(cf.laborCost).toBeCloseTo(112.5, 4);
  });

  it("subcontractors / services bill material + labor into LaborSubtotal2, not OtherMaterial", () => {
    const state = emptyNonDlState();
    state.rows.subcontractors = { Guttering: { extra: 10 } };
    state.rows.services = { Landfill: { extra: 2 } };
    const r = computeNonDl({
      state,
      ref,
      geometry: { ...noGeometry, disposalUnits: 2 },
      crewRate: 45,
    });
    expect(r.otherMaterial).toBe(0);
    expect(r.ownRateLaborHours).toBe(0);
    expect(r.subsCost).toBeCloseTo(85, 4);
    // Landfill 2 × 1 h × $85 = 170; Dumpster auto 2 × $850 = 1700.
    expect(r.servicesCost).toBeCloseTo(170 + 1700, 3);
    expect(r.servicesHours).toBeCloseTo(2, 5);
    // Summary Totals row: services MATERIAL joins (1700), subs material never does.
    expect(r.totalMaterialIncludingServices).toBeCloseTo(1700, 3);
  });

  it("wall blocking bills its material (ReviewCalc group 1), custom rows bill like items", () => {
    const state = emptyNonDlState();
    state.custom.customApps = [
      { description: "Skylight cricket", qty: 2, unitCost: 100, laborPerUnit: 1.5, laborRate: 50 },
    ];
    const r = computeNonDl({
      state,
      ref,
      geometry: { ...noGeometry, parapetBlockingLinealFt: 100 },
      crewRate: 45,
    });
    const wb = r.lines.find((l) => l.group === "wallBlocking")!;
    expect(wb.qty).toBe(103);
    expect(wb.materialCost).toBeCloseTo(58.71, 4);
    expect(wb.hours).toBeCloseTo(4.12, 5);
    expect(wb.laborCost).toBeCloseTo(164.8, 4);
    const custom = r.lines.find((l) => l.isCustom)!;
    expect(custom).toMatchObject({ item: "Skylight cricket", qty: 2, materialCost: 200 });
    expect(custom.laborCost).toBeCloseTo(150, 4);
    expect(r.otherMaterial).toBeCloseTo(258.71, 3);
  });

  it("flags auto quantities on uncaptured Others rows instead of billing $0 silently", () => {
    const r = computeNonDl({
      state: emptyNonDlState(),
      ref,
      geometry: { ...noGeometry, polyethyleneSqFt: 50 },
      crewRate: 45,
    });
    const slip = r.lines.find((l) => l.group === "others")!;
    expect(slip).toMatchObject({ qty: 50, unpriced: true, materialCost: 0 });
    expect(r.warnings).toHaveLength(1);
  });

  it("empty state / no geometry → no lines", () => {
    const r = computeNonDl({ state: emptyNonDlState(), ref, geometry: noGeometry, crewRate: 45 });
    expect(r.lines).toHaveLength(0);
    expect(r.otherMaterial).toBe(0);
  });
});

describe("normalizeNonDlState", () => {
  it("round-trips and drops junk", () => {
    const st = emptyNonDlState();
    st.rows.masonry = { "Remove Only": { extra: 2, laborRate: 50 } };
    st.custom.sheetMetal = [
      { description: "Cap", qty: 1, unitCost: 5, laborPerUnit: 0.2, laborRate: 45 },
    ];
    expect(normalizeNonDlState(JSON.parse(JSON.stringify(st)))).toEqual(st);
    expect(
      normalizeNonDlState({ rows: { bogus: { x: { extra: 1 } }, masonry: { a: { extra: -1 } } } }),
    ).toEqual(emptyNonDlState());
  });
});

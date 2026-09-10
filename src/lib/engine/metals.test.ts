/**
 * §13 EXCEPTIONAL Metals — vectors transcribed from the DataAccess.dll IL extraction
 * (Gutter/DownSpout increment10 + get_Qty, the qty-row money getters, and the collection
 * roll-ups; docs/legacy-money-parity.md §13).
 */
import { describe, expect, it } from "vitest";

import type { MetalsScreenData } from "./adapters";
import {
  buildMetalsRefData,
  computeMetals,
  emptyMetalsState,
  increment10,
  lengthQty,
  normalizeMetalsState,
} from "./metals";

const f32 = Math.fround;

describe("increment10 (legacy Gutter/DownSpout.increment10)", () => {
  it("returns 0 at or below zero", () => {
    expect(increment10(0)).toBe(0);
    expect(increment10(-5)).toBe(0);
  });
  it("bills lengths under 10 ft as 1 ft (legacy quirk — literal 1.0 in the IL)", () => {
    expect(increment10(1)).toBe(1);
    expect(increment10(6.5)).toBe(1);
    expect(increment10(9.99)).toBe(1);
  });
  it("keeps exact multiples of 10", () => {
    expect(increment10(10)).toBe(10);
    expect(increment10(30)).toBe(30);
  });
  it("rounds up to the next multiple of 10 otherwise", () => {
    expect(increment10(11)).toBe(20);
    expect(increment10(25)).toBe(30);
    expect(increment10(99)).toBe(100);
  });
});

describe("lengthQty (legacy get_Qty — bars display count, banker's ToInt32)", () => {
  it("0 length → 0; up to 10 ft → 1 bar", () => {
    expect(lengthQty(0)).toBe(0);
    expect(lengthQty(5)).toBe(1);
    expect(lengthQty(10)).toBe(1);
  });
  it("Convert.ToInt32(len/10) — half rounds to even", () => {
    expect(lengthQty(25)).toBe(2); // 2.5 → 2
    expect(lengthQty(35)).toBe(4); // 3.5 → 4
    expect(lengthQty(40)).toBe(4);
    expect(lengthQty(44)).toBe(4); // 4.4 → 4
    expect(lengthQty(46)).toBe(5); // 4.6 → 5
  });
});

// Mini ref screen mirroring the live seeded shape.
const SCREEN: MetalsScreenData = {
  kind: "metals",
  subscreens: {
    gutters: {
      styles: ["D-Style", "DX-Style"],
      sizes_by_style: { "DX-Style": ['A = 6" B = 4" C = 4"', 'A = 7" B = 5" C = 5"'] },
      rows: [
        { description: 'DX-4 (A=6" B=4" C=4") — Gutter per LF', unit_cost: 4.69 },
        { description: 'DX-4 (A=6" B=4" C=4") — End Caps (Left)', unit_cost: 14.38 },
        { description: 'DX-4 (A=6" B=4" C=4") — Splice Plates', unit_cost: 4.04 },
        { description: "Gutter Sealant", unit_cost: 7.95 },
        { description: "Rivets (250 count)", unit_cost: 50.0 },
      ],
    },
    downspouts: {
      sizes: ['4"X4"', '6"X6"'],
      size_grid: {
        rows_by_size: {
          '6"X6"': [
            {
              description: '6"X6" Downspout - Open (OFD-66)',
              unit_cost: 6.08,
              labor_per_unit_lf: 0.06,
              labor_rate: 42.25,
            },
            { description: "Drop/Outlet", unit_cost: 10.39 },
            { description: null, unit_cost: 99 }, // null-description rows are dropped
          ],
        },
      },
      general_downspout: {
        rows: [
          {
            description: "Downspout Straps",
            unit_cost: 2.2,
            labor_per_unit_lf: 0.1,
            labor_rate: 45.0,
          },
        ],
      },
    },
    pitch_pans: {
      rows: [
        {
          description: 'Pitch Pan 6"X6"X8"',
          unit_cost: 102.31,
          labor_per_unit_lf: 1,
          labor_rate: 45.0,
        },
      ],
    },
    collection_boxes: {
      options: ["Without Scupper", "With Scupper"],
      rows_by_option: {
        "With Scupper": [
          {
            description: '8"X15"X24" Collection Box',
            unit_cost: 550.0,
            labor_per_unit_lf: 1.5,
            labor_rate: 40.0,
          },
        ],
      },
    },
  },
};

describe("buildMetalsRefData", () => {
  const ref = buildMetalsRefData(SCREEN);
  it("groups gutter rows by style+size and splits gutter vs accessories", () => {
    const entry = ref.gutters.byStyleSize['DX-Style|A = 6" B = 4" C = 4"'];
    expect(entry?.gutter?.unitCost).toBe(4.69);
    expect(entry?.accessories.map((r) => r.description)).toEqual([
      "End Caps (Left)",
      "Splice Plates",
    ]);
    expect(ref.gutters.shared.map((r) => r.description)).toEqual([
      "Gutter Sealant",
      "Rivets (250 count)",
    ]);
  });
  it("splits downspout rows into length-based spouts vs qty accessories, dropping null rows", () => {
    const six = ref.downspouts.bySize['6"X6"'];
    expect(six?.spouts.map((r) => r.description)).toEqual(['6"X6" Downspout - Open (OFD-66)']);
    expect(six?.accessories.map((r) => r.description)).toEqual(["Drop/Outlet"]);
    expect(ref.downspouts.general).toHaveLength(1);
  });
});

describe("computeMetals", () => {
  const ref = buildMetalsRefData(SCREEN);

  it("gutter run: increment10(LF) × $/LF material; accessory qty rows; itemized lines", () => {
    const state = emptyMetalsState();
    state.gutters.push({
      style: "DX-Style",
      size: 'A = 6" B = 4" C = 4"',
      lengthFt: 25,
      accQty: { "End Caps (Left)": 2, "Gutter Sealant": 1 },
    });
    const r = computeMetals(state, ref);
    // 25 ft → increment10 = 30 ft × $4.69 (float32)
    const gutterMat = f32(30 * f32(4.69));
    expect(r.lines[0]).toMatchObject({
      category: "Gutters",
      qtyOrLf: 25,
      isLength: true,
      materialCost: gutterMat,
    });
    // seed labor columns are 0 → no hours
    expect(r.laborHours).toBe(0);
    expect(r.materialCost).toBeCloseTo(gutterMat + 2 * 14.38 + 7.95, 4);
    expect(r.lines.map((l) => l.item)).toContain(
      'End Caps (Left) for DX Gutter (A = 6" B = 4" C = 4")',
    );
  });

  it("gutter run under 10 ft bills 1 ft of material (legacy quirk)", () => {
    const state = emptyMetalsState();
    state.gutters.push({
      style: "DX-Style",
      size: 'A = 6" B = 4" C = 4"',
      lengthFt: 6,
      accQty: {},
    });
    const r = computeMetals(state, ref);
    expect(r.materialCost).toBe(f32(1 * f32(4.69)));
  });

  it("downspout: length money + hours at the row's own rate; general accessories", () => {
    const state = emptyMetalsState();
    state.downspouts.push({
      size: '6"X6"',
      lengthByDesc: { '6"X6" Downspout - Open (OFD-66)': 25 },
      accQty: { "Drop/Outlet": 2 },
    });
    state.generalAccQty["Downspout Straps"] = 3;
    const r = computeMetals(state, ref);
    const mat = f32(30 * f32(6.08)); // 182.4
    const hours = f32(25 * f32(0.06)); // 1.5
    const laborCost = f32(hours * f32(42.25)); // 63.375
    expect(r.lines[0]).toMatchObject({ category: "Downspouts", materialCost: mat, hours });
    expect(r.lines[0]!.laborCost).toBeCloseTo(laborCost, 4);
    // drops: 2 × 10.39; straps: 3 × 2.2 mat + 0.3 h × $45
    expect(r.materialCost).toBeCloseTo(mat + 2 * 10.39 + 3 * 2.2, 3);
    expect(r.laborHours).toBeCloseTo(1.5 + 0.3, 5);
    expect(r.laborCost).toBeCloseTo(63.375 + 0.3 * 45, 3);
  });

  it("pitch pans and collection boxes are qty rows at their own rates", () => {
    const state = emptyMetalsState();
    state.pitchPanQty['Pitch Pan 6"X6"X8"'] = 2;
    state.collectionBoxQty["With Scupper"] = { '8"X15"X24" Collection Box': 1 };
    const r = computeMetals(state, ref);
    expect(r.materialCost).toBeCloseTo(2 * 102.31 + 550, 3);
    expect(r.laborHours).toBeCloseTo(2 * 1 + 1.5, 5);
    expect(r.laborCost).toBeCloseTo(2 * 45 + 1.5 * 40, 3);
  });

  it("zero state produces no lines and zero totals", () => {
    const r = computeMetals(emptyMetalsState(), ref);
    expect(r.lines).toHaveLength(0);
    expect(r.materialCost).toBe(0);
    expect(r.laborCost).toBe(0);
    expect(r.laborHours).toBe(0);
  });
});

describe("normalizeMetalsState", () => {
  it("round-trips a valid state and drops junk", () => {
    const st = emptyMetalsState();
    st.gutters.push({ style: "DX-Style", size: "s", lengthFt: 25, accQty: { A: 2 } });
    st.pitchPanQty["p"] = 1;
    const n = normalizeMetalsState(JSON.parse(JSON.stringify(st)));
    expect(n).toEqual(st);
    expect(normalizeMetalsState(null)).toEqual(emptyMetalsState());
    expect(
      normalizeMetalsState({ gutters: [{ style: 1 }], pitchPanQty: { a: -3, b: "x" } }),
    ).toEqual(emptyMetalsState());
  });
});

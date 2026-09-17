import { describe, it, expect } from "vitest";

import {
  areaTotal,
  roofSqFootage,
  areaWithEdgeOverlap,
  rollGoodsMembraneCalc,
  sheetsMembraneCalc,
  numSheetsReq,
  sheetRollsFromLabel,
  legacyMembraneWithOverlap,
  duroTuffMembraneCalc,
  arpSqFt,
  sqFtTotalMembrane,
  setupTime,
  inspectionTime,
  tearOffLaborForSection,
  tearOffLaborTotal,
  dumpsterYards,
  tearOffVolume,
  type SetupBandTable,
  type InspectionBandTable,
} from "./quantities";

describe("roof area (§2.1)", () => {
  it("AreaTotal = L × W; RoofSqFootage sums present sections", () => {
    expect(areaTotal(10, 20)).toBe(200);
    expect(
      roofSqFootage([
        { length: 10, width: 20 },
        { length: 5, width: 5 },
      ]),
    ).toBe(225);
  });
});

describe("membrane area with overlap (§2.2)", () => {
  it("AreaWithEdgeOverlap is version-branched (+1 ft ≥4.0.223, +0.5 ft older)", () => {
    expect(areaWithEdgeOverlap(1, 1, "4.0.230")).toBe(4); // (1+1)(1+1)
    expect(areaWithEdgeOverlap(1, 1, "4.0.223")).toBe(4);
    expect(areaWithEdgeOverlap(1, 1, "4.0.222")).toBe(2.25); // (1+0.5)(1+0.5)
    expect(areaWithEdgeOverlap(10, 20, "4.0.230")).toBe(11 * 21);
  });

  it('RollGoodsMembraneCalc reproduces the Show Calculations 1×1 trace: 4 + 1 × 0.5 = 4.5 at a 60" lap', () => {
    const base = {
      length: 1,
      width: 1,
      overlapWidthIn: 6,
      customFieldLapFt: 0,
      customPerimeterLapIn: 0,
      perimEnhancementWidthFt: 3,
      sides: [],
      isQuickBid: true,
      rolls: 1,
    };
    // lap = ToInteger(In2Ft(60)) = 5 → overlapLength = Ceil(2/5 × 2) = 1 → 4 + 1 × In2Ft(6)
    expect(rollGoodsMembraneCalc({ ...base, fieldLapIn: 60 }, "4.0.237")).toBe(4.5);
    // 28" lap → ToInteger(2.33) = 2 → Ceil(2/2 × 2) = 2 → 4 + 2 × 0.5 = 5 (integer-lap quirk)
    expect(rollGoodsMembraneCalc({ ...base, fieldLapIn: 28 }, "4.0.237")).toBe(5);
    // 50×50 at 64": Ceil(51/5 × 51) = 521 seam-ft → 2601 + 260.5
    expect(
      rollGoodsMembraneCalc({ ...base, length: 50, width: 50, fieldLapIn: 64 }, "4.0.237"),
    ).toBe(2861.5);
    // Duro-Fleece LapOver 3": the same seam length × In2Ft(3) = 0.25
    expect(
      rollGoodsMembraneCalc(
        { ...base, length: 50, width: 50, fieldLapIn: 28, overlapWidthIn: 3 },
        "4.0.237",
      ),
    ).toBe(2601 + 1301 * 0.25);
  });

  it("RollGoodsMembraneCalc: perimeter rows only narrow the field run (the per-side sums are overwritten in the IL)", () => {
    // 100×50, CustomPerimeterLap 60" on the two length sides (A, C), enhancement 3 ft:
    // rows = Round(Ceil(3 / In2Ft(60 − 6) = 4.5)) = 1; pw = 4.5 ft on sides 0 and 2 (they trim
    // the WIDTH run); lap 60 → 5: overlapLength = Ceil((51 − 4.5 − 4.5) / 5 × 101) = Ceil(848.4)
    const q = rollGoodsMembraneCalc(
      {
        length: 100,
        width: 50,
        overlapWidthIn: 6,
        fieldLapIn: 60,
        customFieldLapFt: 0,
        customPerimeterLapIn: 60,
        perimEnhancementWidthFt: 3,
        sides: [
          { isPerim: true, perimLengthFt: 100 },
          { isPerim: false, perimLengthFt: 0 },
          { isPerim: true, perimLengthFt: 100 },
          { isPerim: false, perimLengthFt: 0 },
        ],
        isQuickBid: true,
        rolls: 1,
      },
      "4.0.237",
    );
    expect(q).toBe(101 * 51 + 849 * 0.5);
  });

  it("SheetsMembraneCalc: AreaWithEdgeOverlap + Floor(2n − 2√n) × √(area / n), n from NumSheetsReq", () => {
    const s = {
      length: 50,
      width: 50,
      overlapWidthIn: 6,
      fieldLapIn: 60,
      customFieldLapFt: 0,
      customPerimeterLapIn: 0,
      perimEnhancementWidthFt: 3,
      sides: [],
      isQuickBid: true,
      rolls: 15, // "1500 sf"
    };
    expect(numSheetsReq(s, "4.0.237")).toBe(2); // Ceil(2601 / 1500)
    expect(sheetsMembraneCalc(s, "4.0.237")).toBeCloseTo(2601 + 1 * Math.sqrt(2601 / 2), 9);
    expect(numSheetsReq({ ...s, rolls: 5 }, "4.0.237")).toBe(6); // 500 sf
    expect(sheetsMembraneCalc({ ...s, rolls: 5 }, "4.0.237")).toBeCloseTo(
      2601 + 7 * Math.sqrt(2601 / 6),
      9,
    );
    // Non-quick-bid: one derived sheet, no overlaps → bare AreaWithEdgeOverlap.
    expect(numSheetsReq({ ...s, isQuickBid: false }, "4.0.237")).toBe(1);
    expect(sheetsMembraneCalc({ ...s, isQuickBid: false }, "4.0.237")).toBe(2601);
  });

  it("sheetRollsFromLabel / legacyMembraneWithOverlap dispatch per roof system", () => {
    expect(sheetRollsFromLabel("Roll Good")).toBe(1);
    expect(sheetRollsFromLabel("1500 sf")).toBe(15);
    expect(sheetRollsFromLabel("1000 sf ")).toBe(10);
    expect(sheetRollsFromLabel("")).toBe(0);
    const s = {
      length: 50,
      width: 50,
      overlapWidthIn: 6,
      fieldLapIn: 64,
      customFieldLapFt: 0,
      customPerimeterLapIn: 0,
      perimEnhancementWidthFt: 3,
      sides: [],
      isQuickBid: true,
      rolls: 1,
    };
    const v = "4.0.237";
    const sheets2 = 2601 + Math.sqrt(1300.5);
    expect(legacyMembraneWithOverlap(1, s, v)).toBe(2861.5); // Duro-Last roll goods
    expect(legacyMembraneWithOverlap(4, { ...s, rolls: 15 }, v)).toBeCloseTo(sheets2, 9); // Duro-Roof sheets
    expect(legacyMembraneWithOverlap(2, s, v)).toBe(2601); // Duro-Bond: rolls 1 → area
    expect(legacyMembraneWithOverlap(2, { ...s, rolls: 15 }, v)).toBeCloseTo(sheets2, 9);
    // Duro-Fleece: always roll goods (LapOver 3")
    expect(legacyMembraneWithOverlap(5, { ...s, rolls: 0, overlapWidthIn: 3 }, v)).toBe(
      2601 + 521 * 0.25,
    );
    expect(legacyMembraneWithOverlap(3, s, v)).toBe(2601); // Duro-Tuff: dispatched by the builder
    expect(legacyMembraneWithOverlap(1, { ...s, rolls: 0 }, v)).toBe(2601);
  });
});

describe("Duro-Tuff membrane layout (DuroTuffSystem.CalculateMembraneQty, §21.4)", () => {
  const base = {
    length: 50,
    width: 50,
    overlapWidthIn: 6,
    fieldLapIn: 30,
    customFieldLapIn: -1,
    mechanical: true,
    useCustomSettings: false,
    customRows: [0, 0] as [number, number],
    customPerimLapIn: [-1, -1] as [number, number],
    customCornerLapIn: [-1, -1] as [number, number],
    sides: [0, 1, 2, 3].map(() => ({ isPerim: false, perimLengthFt: 0, has2ftWall: false })),
    corners: [false, false, false, false] as [boolean, boolean, boolean, boolean],
    rollLengthFt: 100,
    rollWidthsIn: [30, 60, 120],
  };

  it('no perimeter sides: the 51×51 field fills with 30" strips lapped 6", ½ ft butt joint per roll, partial strip at its width', () => {
    // 612" of width / 24" per strip → 25 full strips (rem 12"): 25 × 51 = 1275 ft + Ceil(12.75)
    // × 0.5 = 1281.5 ft × 2.5 ft = 3203.75; + 51 × In2Ft(12) = 51 → 3254.75
    const r = duroTuffMembraneCalc(base);
    expect(r.qty).toBeCloseTo(3254.75, 9);
    // BA-default written-back laps for a mechanical section: 30" outer, 30" inner (lap ≤ 30").
    expect(r.rows).toEqual([1, 2]);
    expect(r.perimLapIn).toEqual([30, 30]);
    expect(r.cornerLapIn).toEqual([30, 30]);
    expect(r.customFieldLapIn).toBe(-1);
    // A 60" field lap → 60" inner rows; adhered (not durotuffmech) → no rows, same field fill.
    expect(duroTuffMembraneCalc({ ...base, fieldLapIn: 60 }).perimLapIn).toEqual([30, 60]);
    const adhered = duroTuffMembraneCalc({ ...base, mechanical: false });
    expect(adhered.rows).toEqual([0, 0]);
    expect(adhered.qty).toBeCloseTo(3254.75, 9);
  });

  it('perimeter sides A and C on a 100×50 at a 60" lap: 30" outer row, two 60" inner rows, field between', () => {
    // outerW = 24" on A/C; innerW = 108" on A/C; OP = 2 × 101 = 202 + 1 (butt) = 203 ft × 2.5;
    // IP = 2 × 101 × 2 = 404 + 2 = 406 ft × 5; field 101 ft × (50 − 11 − 11 + 1 = 29 ft →
    // 348" / 54" → 6 strips, rem 24") = 606 + 3.5 = 609.5 ft × 5 + 101 × 2 → total 5787.
    const r = duroTuffMembraneCalc({
      ...base,
      length: 100,
      fieldLapIn: 60,
      sides: [
        { isPerim: true, perimLengthFt: 100, has2ftWall: false },
        { isPerim: false, perimLengthFt: 0, has2ftWall: false },
        { isPerim: true, perimLengthFt: 100, has2ftWall: false },
        { isPerim: false, perimLengthFt: 0, has2ftWall: false },
      ],
    });
    expect(r.qty).toBeCloseTo(5787, 9);
    // A 2 ft wall on side A drops that side's outer row (BA-default mode only).
    const wall = duroTuffMembraneCalc({
      ...base,
      length: 100,
      fieldLapIn: 60,
      sides: [
        { isPerim: true, perimLengthFt: 100, has2ftWall: true },
        { isPerim: false, perimLengthFt: 0, has2ftWall: false },
        { isPerim: true, perimLengthFt: 100, has2ftWall: false },
        { isPerim: false, perimLengthFt: 0, has2ftWall: false },
      ],
    });
    // outerW[A] = 0, OP = 101 (C only) + 0.5 = 101.5 ft × 2.5; IP unchanged 406 × 5;
    // fieldWidth = 50 − In2Ft(108)=9 − 11 + 1 = 31 ft → 372" / 54" → 6 strips, rem 48":
    // 606 + 3.5 = 609.5 × 5 + 101 × In2Ft(48)=4 → 253.75 + 2030 + 3047.5 + 404 = 5735.25
    expect(wall.qty).toBeCloseTo(5735.25, 9);
  });

  it("perimeter overflow drops the rows and writes the row width as the field lap", () => {
    // 4 ft wide section, A and C perimeter: outerW 24" each → In2Ft(48) = 4 > 4? no; inner 108"
    // each → In2Ft(48 + 216) = 22 > length 10 → inner rows dropped, CustomFieldLap ← 60.
    const r = duroTuffMembraneCalc({
      ...base,
      length: 10,
      width: 4,
      fieldLapIn: 60,
      sides: [
        { isPerim: true, perimLengthFt: 10, has2ftWall: false },
        { isPerim: false, perimLengthFt: 0, has2ftWall: false },
        { isPerim: true, perimLengthFt: 10, has2ftWall: false },
        { isPerim: false, perimLengthFt: 0, has2ftWall: false },
      ],
    });
    expect(r.rows).toEqual([1, 0]);
    expect(r.customFieldLapIn).toBe(60);
  });
});

describe("ARP area & bid membrane total (§2.3)", () => {
  it("ARPSqFt applies +6 in weld loss and ×1.03 waste", () => {
    // size 0, one 100-ft side: 1.03 × ((0+6)/12 × 100) = 1.03 × 50 = 51.5
    expect(arpSqFt(0, [100])).toBeCloseTo(51.5, 6);
  });

  it("SqFtTotalMembrane subtracts ARP then ceilings to whole ft²", () => {
    expect(sqFtTotalMembrane([{ membraneWithOverlap: 4.5, arpSqFt: 0 }])).toBe(5);
    expect(
      sqFtTotalMembrane([
        { membraneWithOverlap: 4.5, arpSqFt: 0.5 },
        { membraneWithOverlap: 10, arpSqFt: 0 },
      ]),
    ).toBe(14); // 4.0 + 10 = 14 → ceil 14
  });
});

describe("setup & inspection band lookups (§2.4/§2.5)", () => {
  const setup: SetupBandTable = {
    minimum: 2,
    bands: [
      { upTo: 1000, value: 2, multiply: false }, // flat Minimum band
      { upTo: 100000, value: 0.001, multiply: true }, // SqFt × multiplier
    ],
  };

  it("setup: multiply band = Ceiling(sqft) × mult, floored to Minimum, ×(1+adj/100)", () => {
    expect(setupTime(5000, setup, 0)).toBe(5); // ceil(5000)*0.001 = 5
    expect(setupTime(5000, setup, 25)).toBeCloseTo(6.25, 6); // ×1.25
    expect(setupTime(100, setup, 0)).toBe(2); // ceil(100)*0.001 = 0.1 → floored to min 2
    expect(setupTime(500, setup, 0)).toBe(2); // flat band value
    expect(setupTime(0, setup, 0)).toBe(0); // zero sqft ⇒ 0
  });

  const insp: InspectionBandTable = {
    minimum: 0.5,
    bands: [
      { edge: 1000, value: 1 },
      { edge: 5000, value: 2 },
      { edge: 20000, value: 3 },
    ],
  };

  it("inspection: flat hours per band, minimum below first edge, top value at/above top edge", () => {
    expect(inspectionTime(500, insp, 0)).toBe(0.5); // below first edge → minimum
    expect(inspectionTime(3000, insp, 0)).toBe(1); // [1000,5000) → 1
    expect(inspectionTime(10000, insp, 0)).toBe(2); // [5000,20000) → 2
    expect(inspectionTime(25000, insp, 0)).toBe(3); // ≥ top edge → 3
    expect(inspectionTime(10000, insp, 50)).toBeCloseTo(3, 6); // 2 × 1.5
    expect(inspectionTime(0, insp, 0)).toBe(0);
  });
});

describe("tear-off labor (§2.6)", () => {
  const sec = {
    length: 10,
    width: 10,
    tearOff: true,
    laborLookup: 0.012438, // hrs/100sqft ÷ 100
    additionalPct: 0,
  };

  it("per-section: (W×L)×lookup, 3-dp round, then +additional%", () => {
    expect(tearOffLaborForSection(sec)).toBeCloseTo(1.244, 6); // 100×0.012438=1.2438 → 1.244
    expect(tearOffLaborForSection({ ...sec, additionalPct: 10 })).toBeCloseTo(1.3684, 6);
    expect(tearOffLaborForSection({ ...sec, tearOff: false })).toBe(0);
    expect(tearOffLaborForSection({ ...sec, width: 0 })).toBe(0);
    // sheet + complexity multiplier
    expect(tearOffLaborForSection({ ...sec, sheetComplexityMulti: 2 })).toBeCloseTo(2.488, 6);
  });

  it("bid total rounds UP to the cent: Ceiling(Σ×100)/100", () => {
    expect(tearOffLaborTotal([sec])).toBe(1.25); // ceil(1.244×100)/100 = 125/100
  });
});

describe("disposal units (§2.7)", () => {
  const sec = { length: 10, width: 10, tearOff: true, toThicknessInches: 4 };

  it("per-section cubic yards = (thick/36)(area/9)/fillFraction", () => {
    expect(dumpsterYards(sec, 1)).toBeCloseTo((4 / 36) * (100 / 9), 6);
    expect(dumpsterYards({ ...sec, tearOff: false }, 1)).toBe(0);
    expect(dumpsterYards({ ...sec, toThicknessInches: 0 }, 1)).toBe(0);
  });

  it("fill fraction < 1 multiplies effective yardage (rock-only ×6)", () => {
    const normal = dumpsterYards(sec, 1);
    const rock = dumpsterYards(sec, 1 / 6);
    expect(rock).toBeCloseTo(normal * 6, 6);
  });

  it("bid units = Ceiling(Σ yards / unitYardage)", () => {
    expect(tearOffVolume([sec], 1, 30)).toBe(1); // ~1.23 yd / 30 → ceil = 1
    const big = { length: 90, width: 100, tearOff: true, toThicknessInches: 4 };
    expect(tearOffVolume([big], 1, 30)).toBe(4); // (4/36)(9000/9)=111.11 /30=3.70 → ceil 4
  });
});

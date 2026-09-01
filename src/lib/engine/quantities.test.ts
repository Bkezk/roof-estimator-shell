import { describe, it, expect } from "vitest";

import {
  areaTotal,
  roofSqFootage,
  areaWithEdgeOverlap,
  composeMembraneQty,
  rollGoodsOverlapLength,
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
  type RollGoodsSection,
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

  it('ANCHOR (§9): roll-goods return line — 1×1 section, 6" overlap → 4 + 1×0.5 = 4.5', () => {
    expect(composeMembraneQty(4, 1, 6)).toBe(4.5);
  });

  it("rollGoodsOverlapLength computes the documented field-term arithmetic (structure, not a bid anchor)", () => {
    // L=W=1, corners 0, fieldLap 6\" ⇒ fieldLapFt 0.5; run=(2/0.5)=4; term=ceil(4×2)=8; no perim rows.
    const s: RollGoodsSection = {
      length: 1,
      width: 1,
      overlapWidthInches: 6,
      fieldLapInches: 6,
      customFieldLapFt: 0,
      customPerimeterLapInches: 0,
      perimEnhancementWidth: 0,
      corners: [0, 0, 0, 0],
      sides: [
        { isPerim: false, length: 1, cornerAdj: 0 },
        { isPerim: false, length: 1, cornerAdj: 0 },
        { isPerim: false, length: 1, cornerAdj: 0 },
        { isPerim: false, length: 1, cornerAdj: 0 },
      ],
    };
    expect(rollGoodsOverlapLength(s)).toBe(8);
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

import { describe, it, expect } from "vitest";

import {
  feetPerPx,
  rotatePoints,
  rotateScale,
  slopeFactor,
  slopeFactorLabel,
  takeoffQuantities,
  type TakeoffObject,
  type TakeoffPage,
} from "./model";

// 10 px per foot: a 100 ft dimension drawn as 1000 px.
const page = (over: Partial<TakeoffPage> = {}): TakeoffPage => ({
  index: 0,
  name: "A1",
  rotation: 0,
  width: 2000,
  height: 1500,
  scale: { ax: 100, ay: 100, bx: 1100, by: 100, feet: 100 },
  ...over,
});

describe("scale", () => {
  it("feetPerPx from the calibration line; null without one", () => {
    expect(feetPerPx(page().scale)).toBeCloseTo(0.1, 12);
    expect(feetPerPx(null)).toBeNull();
    expect(feetPerPx({ ax: 0, ay: 0, bx: 0, by: 0, feet: 10 })).toBeNull();
  });

  it("rotatePoints turns the page clockwise in quarter turns and comes back after four", () => {
    const pts: Array<[number, number]> = [[10, 20]];
    // one turn clockwise in a 2000 × 1500 page: (x, y) → (height − y, x)
    expect(rotatePoints(pts, 2000, 1500, 1)).toEqual([[1480, 10]]);
    expect(rotatePoints(pts, 2000, 1500, 2)).toEqual([[1990, 1480]]);
    expect(rotatePoints(pts, 2000, 1500, 3)).toEqual([[20, 1990]]);
    expect(rotatePoints(pts, 2000, 1500, 4)).toEqual([[10, 20]]);
    // a scale line keeps its length and feet through a rotation
    const s = rotateScale(page().scale!, 2000, 1500, 1);
    expect(feetPerPx(s)).toBeCloseTo(0.1, 12);
  });
});

describe("takeoffQuantities", () => {
  const rectPx: Array<[number, number]> = [
    [200, 200],
    [1200, 200],
    [1200, 600],
    [200, 600],
  ];
  const objects: TakeoffObject[] = [
    {
      id: "a1",
      kind: "area",
      page: 0,
      points: rectPx,
      attrs: { name: "Main roof", edges: rectPx.map(() => ({ isPerimeter: true })) },
    },
    {
      id: "l1",
      kind: "linear",
      page: 0,
      points: [
        [200, 200],
        [1200, 200],
        [1200, 600],
      ],
      attrs: { name: "North + east wall", role: "parapet", heightIn: 24 },
    },
    {
      id: "c1",
      kind: "count",
      page: 0,
      points: [[500, 400]],
      attrs: { name: "4in drain", role: "drain", sizeIn: 4 },
    },
    {
      id: "c2",
      kind: "count",
      page: 0,
      points: [[700, 400]],
      attrs: { name: "4in drain", role: "drain", sizeIn: 4 },
    },
    {
      id: "c3",
      kind: "count",
      page: 0,
      points: [[900, 400]],
      attrs: { name: "Pipe", role: "pipe", sizeIn: 3 },
    },
  ];

  it("a 100 × 40 area, a 140 ft parapet run and grouped counts", () => {
    const q = takeoffQuantities([page()], objects);
    expect(q.sections).toHaveLength(1);
    const s = q.sections[0]!;
    expect(s.areaSqFt).toBeCloseTo(4000, 9);
    expect(s.perimeterFt).toBeCloseTo(280, 9);
    expect(s.edgeLengthsFt.map((x) => Math.round(x))).toEqual([100, 40, 100, 40]);
    expect([s.section.length, s.section.width].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([
      100, 40,
    ]);
    expect(s.section.edges.map((e) => e.side)).toEqual(["A", "B", "C", "D"]);
    expect(q.linears[0]).toMatchObject({ role: "parapet", heightIn: 24 });
    expect(q.linears[0]!.lengthFt).toBeCloseTo(140, 9);
    expect(q.counts).toEqual([
      { name: "4in drain", role: "drain", qty: 2, sizeIn: 4, objectIds: ["c1", "c2"] },
      { name: "Pipe", role: "pipe", qty: 1, sizeIn: 3, objectIds: ["c3"] },
    ]);
    expect(q.totals).toEqual({
      roofAreaSqFt: 4000,
      planAreaSqFt: 4000,
      perimeterFt: 280,
      slopedPerimeterFt: 280,
      parapetFt: 140,
      cutoutWallFt: 0,
    });
    expect(s).toMatchObject({ planAreaSqFt: 4000, slopeFactor: 1 });
    expect(s.pitch).toBeUndefined();
    expect(q.unscaled).toEqual([]);
  });

  it("a cut-out reduces the area but keeps the outer edges; the layout rectangle follows", () => {
    const withWell: TakeoffObject = {
      ...(objects[0] as Extract<TakeoffObject, { kind: "area" }>),
      attrs: {
        name: "Main roof",
        cutouts: [
          [
            [400, 300],
            [600, 300],
            [600, 500],
            [400, 500],
          ],
        ],
      },
    };
    const q = takeoffQuantities([page()], [withWell]);
    const s = q.sections[0]!;
    expect(s.areaSqFt).toBeCloseTo(4000 - 400, 9);
    expect(s.perimeterFt).toBeCloseTo(280, 9);
    expect(Math.abs(s.section.length * s.section.width - 3600) / 3600).toBeLessThan(1e-4);
    expect(2 * (s.section.length + s.section.width)).toBeCloseTo(280, 1);
  });

  it("the layout rectangle and the side lengths carry two decimals (an eighth of an inch)", () => {
    // A 100 × 40 outline less a 20 × 20 well: the equivalent rectangle's sides are irrational
    // (70 ± √(4900 − 3600))/… — without rounding they carry 13+ decimals.
    const withWell: TakeoffObject = {
      ...(objects[0] as Extract<TakeoffObject, { kind: "area" }>),
      attrs: {
        name: "Main roof",
        pitch: 4,
        cutouts: [
          [
            [400, 300],
            [600, 300],
            [600, 500],
            [400, 500],
          ],
        ],
      },
    };
    const s = takeoffQuantities([page()], [withWell]).sections[0]!;
    const decimals = (x: number) => (String(x).split(".")[1] ?? "").length;
    expect(decimals(s.section.length)).toBeLessThanOrEqual(2);
    expect(decimals(s.section.width)).toBeLessThanOrEqual(2);
    for (const e of s.section.edges) {
      expect(decimals(e.lengthFt)).toBeLessThanOrEqual(2);
      if (e.perimLengthFt !== undefined) expect(decimals(e.perimLengthFt)).toBeLessThanOrEqual(2);
    }
    // The sloped rakes (B, D at 4:12: 40 × 1.0541 = 42.16) are rounded too, and the true
    // measured area and perimeter stay exact.
    expect(s.section.edges.map((e) => e.lengthFt)).toEqual([100, 42.16, 100, 42.16]);
    expect(s.areaSqFt).toBeCloseTo(3600 * s.slopeFactor, 9);
    expect(s.perimeterFt).toBeCloseTo(280, 9);
  });

  it("objects on an uncalibrated page are reported, not measured; counts still count", () => {
    const q = takeoffQuantities([page({ scale: null })], objects);
    expect(q.sections).toEqual([]);
    expect(q.linears).toEqual([]);
    expect(q.unscaled.map((u) => u.objectId)).toEqual(["a1", "l1"]);
    expect(q.counts.map((c) => c.qty)).toEqual([2, 1]);
  });
});

describe("slope factor (pitch, rise per 12)", () => {
  it("4:12 → 1.0541; 0, blank, negative or junk → flat (1)", () => {
    expect(slopeFactor(4)).toBeCloseTo(1.0541, 4);
    expect(slopeFactor(6)).toBeCloseTo(1.118, 4);
    expect(slopeFactor(12)).toBeCloseTo(Math.SQRT2, 12);
    expect(slopeFactor(0)).toBe(1);
    expect(slopeFactor(undefined)).toBe(1);
    expect(slopeFactor(null)).toBe(1);
    expect(slopeFactor(-3)).toBe(1);
    expect(slopeFactor(Number.NaN)).toBe(1);
    expect(slopeFactorLabel(4)).toBe("×1.054");
    expect(slopeFactorLabel(undefined)).toBe("");
  });

  // 1,000 px per 100 ft: a 1,000 × 100 px outline is 100 ft × 10 ft = 1,000 sq ft on plan.
  const plan: Array<[number, number]> = [
    [0, 0],
    [1000, 0],
    [1000, 100],
    [0, 100],
  ];
  const pg: TakeoffPage = {
    index: 0,
    name: "A1",
    rotation: 0,
    scale: { ax: 0, ay: 0, bx: 1000, by: 0, feet: 100 },
  };

  it("a 1,000 sq ft plan area at 6:12 is 1,118 sq ft of roof; the perimeter is not scaled", () => {
    const q = takeoffQuantities(
      [pg],
      [{ id: "a", kind: "area", page: 0, points: plan, attrs: { name: "Gable", pitch: 6 } }],
    );
    const s = q.sections[0]!;
    expect(s.planAreaSqFt).toBeCloseTo(1000, 9);
    expect(Math.round(s.areaSqFt)).toBe(1118);
    expect(s.pitch).toBe(6);
    expect(s.slopeFactor).toBeCloseTo(1.118034, 6);
    expect(s.perimeterFt).toBeCloseTo(220, 9);
    expect(s.edgeLengthsFt.map((x) => Math.round(x))).toEqual([100, 10, 100, 10]);
    // The layout rectangle is the sloped surface: length stays, width grows by the factor.
    expect(s.section.length).toBeCloseTo(100, 6);
    expect(s.section.width).toBe(Math.round(10 * s.slopeFactor * 100) / 100);
    expect(Math.abs(s.section.length * s.section.width - s.areaSqFt) / s.areaSqFt).toBeLessThan(
      1e-4,
    );
    expect(s.section.measured.areaSqFt).toBeCloseTo(s.areaSqFt, 9);
    expect(s.section.measured.perimeterFt).toBeCloseTo(220, 9);
    expect(q.totals.roofAreaSqFt).toBeCloseTo(1118.034, 3);
    expect(q.totals.planAreaSqFt).toBeCloseTo(1000, 9);
    expect(q.totals.perimeterFt).toBeCloseTo(220, 9);
  });

  it("cut-outs are scaled the same (net plan area × factor); a 0 pitch is flat", () => {
    const hole: Array<[number, number]> = [
      [100, 20],
      [200, 20],
      [200, 70],
      [100, 70],
    ]; // 10 ft × 5 ft = 50 sq ft
    const q = takeoffQuantities(
      [pg],
      [
        {
          id: "a",
          kind: "area",
          page: 0,
          points: plan,
          attrs: { name: "Gable", pitch: 4, cutouts: [hole] },
        },
        { id: "b", kind: "area", page: 0, points: plan, attrs: { name: "Flat", pitch: 0 } },
      ],
    );
    const [a, b] = q.sections;
    expect(a!.planAreaSqFt).toBeCloseTo(950, 9);
    expect(a!.areaSqFt).toBeCloseTo(950 * slopeFactor(4), 9);
    expect(Math.abs(a!.section.length * a!.section.width - a!.areaSqFt) / a!.areaSqFt).toBeLessThan(
      1e-4,
    );
    expect(b!.areaSqFt).toBeCloseTo(1000, 9);
    expect(b!.slopeFactor).toBe(1);
    expect(b!.pitch).toBeUndefined();
  });
});

describe("rotateScale keeps the sheet tag", () => {
  it("carries source and note through a quarter turn", () => {
    const r = rotateScale(
      { ax: 10, ay: 20, bx: 82, by: 20, feet: 8, source: "sheet", note: '1/8" = 1\'-0"' },
      600,
      400,
      1,
    );
    expect(r.feet).toBe(8);
    expect(r.source).toBe("sheet");
    expect(r.note).toBe('1/8" = 1\'-0"');
    expect([r.ax, r.ay, r.bx, r.by]).not.toEqual([10, 20, 82, 20]);
  });
});

import { describe, it, expect } from "vitest";

import {
  feetPerPx,
  rotatePoints,
  rotateScale,
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
    expect(q.totals).toEqual({ roofAreaSqFt: 4000, perimeterFt: 280, parapetFt: 140 });
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
    expect(s.section.length * s.section.width).toBeCloseTo(3600, 6);
    expect(2 * (s.section.length + s.section.width)).toBeCloseTo(280, 6);
  });

  it("objects on an uncalibrated page are reported, not measured; counts still count", () => {
    const q = takeoffQuantities([page({ scale: null })], objects);
    expect(q.sections).toEqual([]);
    expect(q.linears).toEqual([]);
    expect(q.unscaled.map((u) => u.objectId)).toEqual(["a1", "l1"]);
    expect(q.counts.map((c) => c.qty)).toEqual([2, 1]);
  });
});

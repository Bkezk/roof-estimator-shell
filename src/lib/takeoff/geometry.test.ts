import { describe, it, expect } from "vitest";

import {
  convexCorners,
  drawnSideLabels,
  edgeLengths,
  equivalentRect,
  polygonArea,
  polygonPerimeter,
  sectionFromOutline,
} from "./geometry";
import { resolveSectionZones } from "@/lib/engine/edges";

const rect: Array<[number, number]> = [
  [0, 0],
  [100, 0],
  [100, 40],
  [0, 40],
];
// An L: 100 × 40 with a 40 × 30 wing hanging off the right end (total 100×40 + 40×30).
const ell: Array<[number, number]> = [
  [0, 0],
  [100, 0],
  [100, 70],
  [60, 70],
  [60, 40],
  [0, 40],
];

describe("polygon maths", () => {
  it("area, perimeter and edge lengths of a rectangle and an L", () => {
    expect(polygonArea(rect)).toBe(4000);
    expect(polygonPerimeter(rect)).toBe(280);
    expect(edgeLengths(rect)).toEqual([100, 40, 100, 40]);
    expect(polygonArea(ell)).toBe(5200);
    expect(polygonPerimeter(ell)).toBe(340);
    // reversed winding gives the same magnitudes
    expect(polygonArea([...ell].reverse())).toBe(5200);
  });

  it("convexCorners flags the inside corner of an L, in either winding", () => {
    // corner i sits at vertex i+1: the re-entrant vertex (60,40) is vertex 4 → corner 3.
    expect(convexCorners(ell)).toEqual([true, true, true, false, true, true]);
    // reversed, (60,40) is vertex 1 → corner 0.
    expect(convexCorners([...ell].reverse())).toEqual([false, true, true, true, true, true]);
    expect(convexCorners(rect)).toEqual([true, true, true, true]);
  });

  it("equivalentRect: a rectangle maps to itself; an L to the rectangle of equal area + perimeter", () => {
    expect(equivalentRect(4000, 280)).toEqual({ length: 100, width: 40 });
    const r = equivalentRect(5200, 340);
    expect(r.length * r.width).toBeCloseTo(5200, 9);
    expect(2 * (r.length + r.width)).toBeCloseTo(340, 9);
    // a rounder-than-square pair falls back to the square
    expect(equivalentRect(100, 10)).toEqual({ length: 10, width: 10 });
  });
});

describe("drawnSideLabels", () => {
  it("labels a four-sided outline A–D from its longest side, in drawing order, and others 1..N", () => {
    // drawn starting on a short side: the long side drawn second is A
    const drawn: Array<[number, number]> = [
      [100, 0],
      [100, 40],
      [0, 40],
      [0, 0],
    ];
    expect(drawnSideLabels(drawn)).toEqual(["D", "A", "B", "C"]);
    const s = sectionFromOutline(drawn, [{ termination: '4" Fascia' }]);
    // the drawn edge 0 (labelled D above) is the one carrying the fascia in the section
    expect(s.edges.find((e) => e.termination === '4" Fascia')!.side).toBe("D");
    expect(drawnSideLabels(rect)).toEqual(["A", "B", "C", "D"]);
    expect(drawnSideLabels(ell)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });
});

describe("sectionFromOutline", () => {
  it("a drawn rectangle becomes the typed rectangle: A–D from the longest side, A/C = length", () => {
    // drawn starting on a SHORT side, clockwise on screen
    const drawn: Array<[number, number]> = [
      [100, 0],
      [100, 40],
      [0, 40],
      [0, 0],
    ];
    const s = sectionFromOutline(
      drawn,
      drawn.map(() => ({ isPerimeter: true })),
    );
    expect([s.length, s.width]).toEqual([100, 40]);
    expect(s.edges.map((e) => e.side)).toEqual(["A", "B", "C", "D"]);
    expect(s.edges.map((e) => e.lengthFt)).toEqual([100, 40, 100, 40]);
    expect(s.edges.every((e) => e.isPerimeter && e.perimLengthFt === e.lengthFt)).toBe(true);
    expect(s.perimCorners).toEqual([true, true, true, true]);
    expect(s.measured).toMatchObject({ areaSqFt: 4000, perimeterFt: 280, source: "takeoff" });
  });

  it("per-edge options follow their drawn edge through the start rotation", () => {
    const drawn: Array<[number, number]> = [
      [100, 0],
      [100, 40],
      [0, 40],
      [0, 0],
    ];
    // drawn edge 0 is the short right side (100,0→100,40) with a 4" Fascia
    const s = sectionFromOutline(drawn, [{ termination: '4" Fascia', blockingFt: 40 }]);
    const fascia = s.edges.find((e) => e.termination === '4" Fascia')!;
    expect(fascia.side).toBe("D"); // rotation: longest side first → the right side becomes D
    expect(fascia.lengthFt).toBe(40);
    expect(fascia.blockingFt).toBe(40);
  });

  it("an L keeps its six real sides, marks only outside corners, and prices on the equal rectangle", () => {
    const s = sectionFromOutline(
      ell,
      ell.map(() => ({ isPerimeter: true })),
    );
    expect(s.edges.map((e) => e.side)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(s.edges.map((e) => e.lengthFt)).toEqual([100, 70, 40, 30, 60, 40]);
    expect(s.perimCorners).toEqual([true, true, true, false, true, true]);
    expect(s.length * s.width).toBeCloseTo(5200, 9);
    // zone lengths come from the real edges: 340 ft of perimeter minus 3 ft per marked corner on
    // each of its two sides (5 corners × 2 × 3 = 30), corner length 5 × 3.
    const zones = resolveSectionZones({
      ...s,
      perimLengthFt: 0,
      cornerLengthFt: 0,
      enhancementWidthFt: 3,
    });
    expect(zones.perimLengthFt).toBe(340 - 30);
    expect(zones.cornerLengthFt).toBe(15);
  });

  it("an edge not marked perimeter contributes no corner", () => {
    const s = sectionFromOutline(rect, [{ isPerimeter: true }, {}, { isPerimeter: true }, {}]);
    expect(s.perimCorners).toEqual([false, false, false, false]);
  });
});

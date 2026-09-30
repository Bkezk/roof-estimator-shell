import { describe, expect, it } from "vitest";

import type { PagePoint } from "@/lib/takeoff/model";

import {
  DRAW_OPS,
  IDENTITY,
  PDF_OPS,
  buildPlanIndex,
  cellKey,
  multiply,
  nearestPlanLine,
  nearestPlanPoint,
  pickSnap,
  projectOnSegment,
  runSync,
  segmentCells,
  segmentIntersection,
  walkOperatorList,
  type Matrix,
  type PlanGeometry,
  type Segment,
} from "./plan-lines";

const O = PDF_OPS;
const D = DRAW_OPS;
const walk = (fn: number[], args: unknown[], base: Matrix = IDENTITY) =>
  runSync(walkOperatorList(fn, args, base));
const index = (segments: Segment[], curveEnds: PagePoint[] = []) =>
  runSync(buildPlanIndex({ segments, curveEnds } satisfies PlanGeometry));
const seg = (ax: number, ay: number, bx: number, by: number): Segment => ({ ax, ay, bx, by });
const round = (s: Segment) => ({
  ax: Math.round(s.ax * 1e6) / 1e6,
  ay: Math.round(s.ay * 1e6) / 1e6,
  bx: Math.round(s.bx * 1e6) / 1e6,
  by: Math.round(s.by * 1e6) / 1e6,
});

describe("walkOperatorList", () => {
  it("reads pdf.js v6 constructPath (DrawOPS moveTo / lineTo / closePath) with a transform", () => {
    // save; cm 2 0 0 2 10 20; a stroked triangle; restore; then a line at identity.
    const tri = new Float32Array([D.moveTo, 0, 0, D.lineTo, 10, 0, D.lineTo, 10, 5, D.closePath]);
    const line = new Float32Array([D.moveTo, 0, 100, D.lineTo, 50, 100]);
    const g = walk(
      [O.save, O.transform, O.constructPath, O.restore, O.constructPath],
      [null, [2, 0, 0, 2, 10, 20], [20, [tri], null], null, [20, [line], null]],
    );
    expect(g.segments.map(round)).toEqual([
      seg(10, 20, 30, 20),
      seg(30, 20, 30, 30),
      seg(30, 30, 10, 20),
      seg(0, 100, 50, 100),
    ]);
  });

  it("maps into the viewport: a PDF-style flip (y up → y down) as the base transform", () => {
    // pdf.js viewport at scale 1 for a 612 × 792 page: [1, 0, 0, -1, 0, 792].
    const base: Matrix = [1, 0, 0, -1, 0, 792];
    const g = walk([O.constructPath], [[20, [[D.moveTo, 0, 0, D.lineTo, 100, 0]], null]], base);
    expect(g.segments).toEqual([seg(0, 792, 100, 792)]);
  });

  it("reads the older encodings: ops + coords (rectangle) and bare moveTo / lineTo", () => {
    const g = walk(
      [O.transform, O.constructPath, O.moveTo, O.lineTo],
      [
        [1, 0, 0, 1, 5, 5],
        [[O.rectangle], [0, 0, 20, 10], null],
        [0, 50],
        [30, 50],
      ],
    );
    expect(g.segments).toEqual([
      seg(5, 5, 25, 5),
      seg(25, 5, 25, 15),
      seg(25, 15, 5, 15),
      seg(5, 15, 5, 5),
      seg(5, 55, 35, 55),
    ]);
  });

  it("skips clip-only paths, short segments and curves (keeping curve ends), and duplicates", () => {
    const path = [
      D.moveTo,
      0,
      0,
      D.lineTo,
      1,
      0,
      D.lineTo,
      40,
      0,
      D.curveTo,
      50,
      0,
      60,
      10,
      60,
      20,
    ];
    const g = walk(
      [O.constructPath, O.constructPath, O.constructPath],
      [
        [28, [[D.moveTo, 0, 0, D.lineTo, 500, 0]], null], // endPath: a clip, not drawn
        [20, [path], null],
        [22, [[D.moveTo, 40, 0, D.lineTo, 1, 0]], null], // the same line again, reversed
      ],
    );
    expect(g.segments).toEqual([seg(1, 0, 40, 0)]); // 0→1 is under 2 units
    expect(g.curveEnds).toEqual([
      [40, 0],
      [60, 20],
    ]);
  });

  it("follows form XObjects and keeps the longest segments past the cap", () => {
    const fn = [O.paintFormXObjectBegin, O.constructPath, O.paintFormXObjectEnd, O.constructPath];
    const args = [
      [[1, 0, 0, 1, 100, 0], null],
      [20, [[D.moveTo, 0, 0, D.lineTo, 3, 0]], null],
      null,
      [20, [[D.moveTo, 0, 10, D.lineTo, 50, 10]], null],
    ];
    expect(walk(fn, args).segments).toEqual([seg(100, 0, 103, 0), seg(0, 10, 50, 10)]);
    const capped = runSync(walkOperatorList(fn, args, IDENTITY, PDF_OPS, 2, 1));
    expect(capped.segments).toEqual([seg(0, 10, 50, 10)]);
  });

  it("multiply applies the right-hand matrix first", () => {
    const scale: Matrix = [2, 0, 0, 2, 0, 0];
    const move: Matrix = [1, 0, 0, 1, 10, 0];
    expect(multiply(scale, move)).toEqual([2, 0, 0, 2, 20, 0]); // move, then scale
    expect(multiply(move, scale)).toEqual([2, 0, 0, 2, 10, 0]);
  });
});

describe("segment geometry", () => {
  it("segmentIntersection: a real crossing, not a shared end, a T or parallel lines", () => {
    expect(segmentIntersection(seg(0, 0, 10, 10), seg(0, 10, 10, 0))).toEqual([5, 5]);
    expect(segmentIntersection(seg(0, 0, 10, 0), seg(10, 0, 10, 10))).toBeNull(); // shared end
    expect(segmentIntersection(seg(0, 0, 10, 0), seg(5, 0, 5, 10))).toBeNull(); // T (end on line)
    expect(segmentIntersection(seg(0, 0, 10, 0), seg(0, 5, 10, 5))).toBeNull(); // parallel
    expect(segmentIntersection(seg(0, 0, 10, 0), seg(20, -5, 20, 5))).toBeNull(); // apart
  });
  it("projectOnSegment: the foot of the perpendicular, clamped to the ends", () => {
    expect(projectOnSegment(seg(0, 0, 100, 0), [40, 7])).toEqual([40, 0]);
    expect(projectOnSegment(seg(0, 0, 100, 0), [-20, 3])).toEqual([0, 0]);
    expect(projectOnSegment(seg(0, 0, 10, 10), [10, 0])).toEqual([5, 5]);
  });
  it("segmentCells: every cell the segment passes through, and no others", () => {
    expect(segmentCells(seg(1, 1, 100, 1), 32)).toEqual([0, 1, 2, 3].map((c) => cellKey(c, 0)));
    expect(segmentCells(seg(5, 5, 5, 70), 32)).toEqual([0, 1, 2].map((r) => cellKey(0, r)));
    // (1,0) → (63,62) leaves row 0 at x = 33, so it crosses cells (0,0), (1,0) and (1,1) only.
    expect(segmentCells(seg(1, 0, 63, 62), 32)).toEqual([
      cellKey(0, 0),
      cellKey(1, 0),
      cellKey(1, 1),
    ]);
  });
});

describe("plan index and snapping", () => {
  // A 200 × 100 box and a diagonal across it.
  const box = [
    seg(0, 0, 200, 0),
    seg(200, 0, 200, 100),
    seg(200, 100, 0, 100),
    seg(0, 100, 0, 0),
    seg(0, 0, 200, 100),
    seg(0, 100, 200, 0),
  ];
  const idx = index(box);

  it("collects the ends once and the crossing of the two diagonals", () => {
    expect(idx.points).toHaveLength(5);
    expect(idx.intersections).toBe(1);
    expect(idx.points).toContainEqual([100, 50]);
  });

  it("grid lookup: finds the nearest point within the radius only", () => {
    expect(nearestPlanPoint(idx, [196, 3], 8)?.p).toEqual([200, 0]);
    expect(nearestPlanPoint(idx, [103, 52], 8)?.p).toEqual([100, 50]);
    expect(nearestPlanPoint(idx, [150, 20], 8)).toBeNull();
    // Across a cell boundary (cell 32): the point at (200, 0) from (194, -5).
    expect(nearestPlanPoint(idx, [194, -5], 8)?.p).toEqual([200, 0]);
  });

  it("finds the nearest point ON a line (a long wall), via the cells it crosses", () => {
    const on = nearestPlanLine(idx, [120, 4], 8);
    expect(on?.p).toEqual([120, 0]);
    expect(on?.d).toBeCloseTo(4, 9);
    expect(nearestPlanLine(idx, [120, 30], 8)).toBeNull();
  });

  it("pickSnap: own corner or plan point, nearest wins; then a point on a line; zoom-aware", () => {
    const own: PagePoint[] = [[98, 51]];
    expect(pickSnap([97, 52], own, idx, 1, 8)).toEqual({ p: [98, 51], kind: "object" });
    expect(pickSnap([101, 50], own, idx, 1, 8)).toEqual({ p: [100, 50], kind: "plan" });
    expect(pickSnap([60, 3], [], idx, 1, 8)).toEqual({ p: [60, 0], kind: "planLine" });
    expect(pickSnap([60, 3], [], idx, 4, 8)).toBeNull(); // 12 screen px at 400%
    expect(pickSnap([60, 3], [], null, 1, 8)).toBeNull(); // plan snapping off
  });

  it("does not add a crossing point twice when the pair shares several cells", () => {
    const two = index([seg(0, 0, 64, 64), seg(0, 64, 64, 0)]);
    expect(two.intersections).toBe(1);
  });
});

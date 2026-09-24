/**
 * Takeoff geometry — pure helpers (no I/O). Docs: docs/planswift-research.md §4.5.
 *
 * A drawn roof outline becomes an estimator section through `sectionFromOutline`:
 *  - `length` × `width` = the rectangle with the SAME area and perimeter as the outline (for a
 *    rectilinear outline — every corner 90° — such a rectangle always exists, since the outline's
 *    perimeter is at least its bounding box's and its area at most the box's). The engine's
 *    sheet / roll layout maths reads these; every `length × width` area term is the true area.
 *  - `edges` = the outline's real sides, one per drawn segment, carrying the per-edge options
 *    (perimeter, termination, blocking, ARP, tall wall) exactly as a typed section's A–D do.
 *  - `perimCorners` = one flag per side: auto-marked where BOTH adjacent sides are perimeter and
 *    the corner is an OUTSIDE (convex) corner — the legacy Sections screen auto-marks corners the
 *    same way; an inside (re-entrant) corner never gets an enhancement square.
 *  A four-sided outline is labelled A–D starting on its longest side (so A/C are the length run,
 *  like a typed rectangle) and prices IDENTICALLY to the same rectangle typed by hand — the
 *  parity test in bid-builder.test.ts holds the engine to that. Other outlines label "1".."N".
 */

import type { EdgeInput } from "@/lib/engine/edges";
import { EDGE_SIDES } from "@/lib/engine/edges";
import type { MeasuredOutline } from "@/lib/engine/bid-builder";

/** A point in feet on the drawing plane (x east, y south — screen orientation). */
export type Pt = readonly [number, number];

/** Signed shoelace area: positive for one winding, negative for the other. */
export function signedArea(points: readonly Pt[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % n]!;
    acc += x1 * y2 - x2 * y1;
  }
  return acc / 2;
}

export function polygonArea(points: readonly Pt[]): number {
  return Math.abs(signedArea(points));
}

/** Edge i runs points[i] → points[i+1] (the last closes back to points[0]). */
export function edgeLengths(points: readonly Pt[]): number[] {
  const n = points.length;
  return points.map((p, i) => {
    const q = points[(i + 1) % n]!;
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
}

export function polygonPerimeter(points: readonly Pt[]): number {
  return edgeLengths(points).reduce((s, l) => s + l, 0);
}

/**
 * Corner i (between edge i and edge i+1, i.e. at vertex points[i+1]) is an OUTSIDE corner when
 * the turn there has the same sense as the polygon's winding. A straight-through vertex
 * (collinear) counts as outside — it adds nothing to the geometry either way.
 */
export function convexCorners(points: readonly Pt[]): boolean[] {
  const n = points.length;
  const wind = Math.sign(signedArea(points)) || 1;
  return points.map((_, i) => {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const c = points[(i + 2) % n]!;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    return Math.sign(cross) * wind >= 0;
  });
}

/** Rectangle with the given area and perimeter (exact, no rounding); a square when none exists. */
export function equivalentRect(
  areaSqFt: number,
  perimeterFt: number,
): { length: number; width: number } {
  const a = Math.max(0, areaSqFt);
  if (a === 0) return { length: 0, width: 0 };
  const half = perimeterFt / 2;
  const disc = half * half - 4 * a;
  if (!(perimeterFt > 0) || disc < 0) {
    const side = Math.sqrt(a);
    return { length: side, width: side };
  }
  const root = Math.sqrt(disc);
  return { length: (half + root) / 2, width: (half - root) / 2 };
}

/** Per-edge options for `sectionFromOutline` (everything a typed section's edge panel offers). */
export type OutlineEdgeOptions = Partial<
  Pick<EdgeInput, "isPerimeter" | "termination" | "blockingFt" | "arpSizeIn" | "hasTallWall">
>;

export interface OutlineSection {
  length: number;
  width: number;
  edges: EdgeInput[];
  perimCorners: boolean[];
  measured: MeasuredOutline;
}

/**
 * Rotate a four-sided outline so edge 0 is its longest side; other outlines are returned as
 * drawn. (A typed rectangle's A/C carry the LENGTH — this keeps a drawn rectangle identical.)
 */
export function normalizeStart<T>(
  points: readonly Pt[],
  perEdge: readonly T[],
): { points: Pt[]; perEdge: T[] } {
  if (points.length !== 4) return { points: [...points], perEdge: [...perEdge] };
  const lens = edgeLengths(points);
  let start = 0;
  for (let i = 1; i < 4; i++) if (lens[i]! > lens[start]! + 1e-9) start = i;
  const rot = <U>(arr: readonly U[]) => arr.map((_, i) => arr[(i + start) % arr.length]!);
  return { points: rot(points), perEdge: rot(perEdge) };
}

/**
 * The side label of each DRAWN edge (index i = points[i] → points[i+1]), exactly as
 * `sectionFromOutline` will name it: A–D for a four-sided outline (A = the longest side, then
 * clockwise in drawing order), "1".."N" otherwise. The drawing, the Objects tab and the bid's
 * Sections screen all show these same labels.
 */
export function drawnSideLabels(points: readonly Pt[]): string[] {
  const n = points.length;
  if (n !== 4) return points.map((_, i) => String(i + 1));
  const lens = edgeLengths(points);
  let start = 0;
  for (let i = 1; i < 4; i++) if (lens[i]! > lens[start]! + 1e-9) start = i;
  const labels = new Array<string>(4);
  for (let k = 0; k < 4; k++) labels[(start + k) % 4] = EDGE_SIDES[k]!;
  return labels;
}

/**
 * Turn a drawn outline into the section fields the estimator needs. `edgeOptions[i]` applies to
 * edge i as drawn (before any start rotation); absent = an inert edge, like a fresh typed section.
 */
export function sectionFromOutline(
  drawn: readonly Pt[],
  edgeOptions: readonly OutlineEdgeOptions[] = [],
  source: MeasuredOutline["source"] = "takeoff",
): OutlineSection {
  const opts: OutlineEdgeOptions[] = drawn.map((_, i) => edgeOptions[i] ?? {});
  const { points, perEdge } = normalizeStart(drawn, opts);
  const n = points.length;
  const areaSqFt = polygonArea(points);
  const perimeterFt = polygonPerimeter(points);
  const rect = equivalentRect(areaSqFt, perimeterFt);
  const lens = edgeLengths(points);
  const edges: EdgeInput[] = points.map((_, i) => {
    const o = perEdge[i]!;
    const isPerimeter = o.isPerimeter ?? false;
    const lengthFt = lens[i]!;
    const e: EdgeInput = {
      side: n === 4 ? EDGE_SIDES[i]! : String(i + 1),
      lengthFt,
      isPerimeter,
      termination: o.termination ?? "No Termination",
      blockingFt: o.blockingFt ?? 0,
      arpSizeIn: o.arpSizeIn ?? 0,
    };
    if (isPerimeter) e.perimLengthFt = lengthFt;
    if (o.hasTallWall) e.hasTallWall = true;
    return e;
  });
  const convex = convexCorners(points);
  const perimCorners = edges.map(
    (e, i) => e.isPerimeter && (edges[(i + 1) % n]?.isPerimeter ?? false) && convex[i]!,
  );
  return {
    length: rect.length,
    width: rect.width,
    edges,
    perimCorners,
    measured: { points: points.map((p) => [p[0], p[1]]), areaSqFt, perimeterFt, source },
  };
}

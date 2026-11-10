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

const roundTo = (x: number, places: number) => {
  const k = 10 ** places;
  return Math.round(x * k) / k;
};

/**
 * The bid's Width for a section of `areaSqFt` whose Length is already rounded for the reader
 * (two decimals). The bid prices length × width, so the width carries the area: the area over
 * the length, to four decimals, which keeps the product within 0.005 sq ft for a length up to
 * 100 ft. A longer section takes six decimals, so the product stays within 0.01 sq ft of the
 * measured area whatever the size (audit, Nov 10: two rounded sides priced a 9,100 sq ft roof as
 * 9,099.47, and a 139.37 sq ft PlanSwift area as 139.48). Used by a drawn section
 * (./model.ts `roundSectionDims`) and by a PlanSwift one (lib/planswift/to-seed.ts).
 */
export function layoutWidthForArea(areaSqFt: number, lengthFt: number): number {
  if (!(lengthFt > 0) || !(areaSqFt > 0)) return 0;
  const w4 = roundTo(areaSqFt / lengthFt, 4);
  return Math.abs(lengthFt * w4 - areaSqFt) <= 0.005 ? w4 : roundTo(areaSqFt / lengthFt, 6);
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

// ── Outline checks (takeoff audit, Nov 10, findings 4 and 5) ───────────────────────────────
// A crossed outline has no honest area (corners clicked in a crossing order read 0 sq ft, or a
// believable wrong number), and a cut-out outside its roof or on top of another one took off
// membrane that is not there. These tell the editor (which refuses them as they are drawn) and
// the quantities (which flag one already in a drawing). Any unit: page px or feet.

const cross = (o: Pt, a: Pt, b: Pt) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const spanOf = (pts: readonly Pt[]) => {
  let m = 1;
  for (const p of pts) m = Math.max(m, Math.abs(p[0]), Math.abs(p[1]));
  return m;
};
/** The two segments cross at a point inside both (touching ends and running along do not count). */
function properCross(a: Pt, b: Pt, c: Pt, d: Pt, eps: number): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  );
}
const sidesOf = (pts: readonly Pt[]): Array<[Pt, Pt]> =>
  pts.map((p, i) => [p, pts[(i + 1) % pts.length]!] as [Pt, Pt]);

/** True when two sides of the outline cross each other (a bowtie, corners clicked out of order). */
export function outlineCrossesItself(points: readonly Pt[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  const eps = 1e-9 * spanOf(points) ** 2;
  const sides = sidesOf(points);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // neighbours share a corner
      if (properCross(sides[i]![0], sides[i]![1], sides[j]![0], sides[j]![1], eps)) return true;
    }
  return false;
}

/** "in", "on" (the boundary, within a hair) or "out" of the outline. */
function whereIs(p: Pt, outline: readonly Pt[]): "in" | "on" | "out" {
  const tol = 1e-7 * spanOf(outline);
  let inside = false;
  for (const [a, b] of sidesOf(outline)) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > 0) {
      const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len);
      const u = Math.max(0, Math.min(1, t));
      if (Math.hypot(p[0] - (a[0] + u * (b[0] - a[0])), p[1] - (a[1] + u * (b[1] - a[1]))) <= tol)
        return "on";
    }
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = a[0] + ((p[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      if (x > p[0]) inside = !inside;
    }
  }
  return inside ? "in" : "out";
}
const anyProperCross = (a: readonly Pt[], b: readonly Pt[]): boolean => {
  const eps = 1e-9 * Math.max(spanOf(a), spanOf(b)) ** 2;
  for (const [p, q] of sidesOf(a))
    for (const [r, s] of sidesOf(b)) if (properCross(p, q, r, s, eps)) return true;
  return false;
};
const middleOf = (pts: readonly Pt[]): Pt => [
  pts.reduce((t, p) => t + p[0], 0) / pts.length,
  pts.reduce((t, p) => t + p[1], 0) / pts.length,
];

/** The ring sits wholly inside the outline (touching its edge is allowed: a well at the wall). */
export function ringInsideOutline(ring: readonly Pt[], outline: readonly Pt[]): boolean {
  if (ring.some((p) => whereIs(p, outline) === "out")) return false;
  return !anyProperCross(ring, outline);
}

/** The two rings cover some of the same ground (sharing an edge or a corner is not overlap). */
export function ringsOverlap(a: readonly Pt[], b: readonly Pt[]): boolean {
  if (anyProperCross(a, b)) return true;
  if (a.some((p) => whereIs(p, b) === "in") || b.some((p) => whereIs(p, a) === "in")) return true;
  // One on top of the other, corner for corner: no corner is strictly inside, the middle is.
  return whereIs(middleOf(a), b) === "in" || whereIs(middleOf(b), a) === "in";
}

export type CutoutProblem = "crossed" | "outside" | "overlap";
/**
 * What is wrong with `ring` as a cut-out of `outline` next to the cut-outs it already has
 * (`others`): it crosses itself, it is not wholly inside the roof, or it lies over another
 * cut-out. Null when it is fine.
 */
export function cutoutProblem(
  outline: readonly Pt[],
  others: ReadonlyArray<readonly Pt[]>,
  ring: readonly Pt[],
): CutoutProblem | null {
  if (ring.length < 3) return null;
  if (outlineCrossesItself(ring)) return "crossed";
  if (!ringInsideOutline(ring, outline)) return "outside";
  if (others.some((o) => o.length >= 3 && ringsOverlap(o, ring))) return "overlap";
  return null;
}

/** The words for a refused cut-out. */
export const CUTOUT_PROBLEM_TEXT: Record<CutoutProblem, string> = {
  crossed: "That cut-out crosses itself. Click its corners in order, going around it.",
  outside:
    "A cut-out has to sit inside its roof area. That one reaches outside it, so it was not added.",
  overlap:
    "That cut-out lies over another cut-out of this area, which would take the same roof off twice. It was not added.",
};
/** The words for a refused outline. */
export const CROSSED_OUTLINE_TEXT =
  "This outline crosses itself, so its area would be wrong. Click the corners in order, going around the roof (Backspace takes the last corner back).";

/**
 * What is wrong with an area already in a drawing (its outline and cut-outs), in plain words
 * for the Quantities tab and the bid notice; null when nothing is.
 */
export function areaProblem(
  outline: readonly Pt[],
  cutouts: ReadonlyArray<readonly Pt[]> = [],
): string | null {
  if (outlineCrossesItself(outline))
    return "its outline crosses itself, so its area is wrong. Delete it and draw it again, clicking the corners in order";
  const rings = cutouts.filter((c) => c.length >= 3);
  for (let i = 0; i < rings.length; i++) {
    const p = cutoutProblem(outline, rings.slice(0, i), rings[i]!);
    if (p === "outside")
      return "a cut-out reaches outside the roof, so too much is taken off. Move it inside or delete it";
    if (p === "overlap")
      return "two cut-outs lie over each other, so the same roof is taken off twice. Delete one";
    if (p === "crossed")
      return "a cut-out crosses itself, so the area taken off is wrong. Delete it and draw it again";
  }
  return null;
}

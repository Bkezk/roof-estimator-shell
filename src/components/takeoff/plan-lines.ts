/**
 * Snap to the plan's own lines (owner, Sep 30: "if togglable go ahead and add it"). Pure (no
 * React, no pdf.js import): the loader in ./underlay hands in the page's operator list and its
 * viewport transform.
 *
 * - `walkOperatorList` follows the drawing operators of one PDF page (pdf.js v6 packs each path
 *   into `constructPath` as DrawOPS data; older builds used an ops + coords pair, or bare
 *   moveTo / lineTo / rectangle ops — all three are read), tracking the current transform through
 *   save / restore / transform and form XObjects, so every straight segment lands in the same
 *   page units the underlay is drawn in (pdf.js viewport at scale 1, 72 per paper inch, with the
 *   page's rotation). Curves are not traced: only their end points are kept as snap points.
 *   Segments under MIN_SEGMENT page units are dropped; past MAX_SEGMENTS the longest are kept.
 * - `buildPlanIndex` collects the snap points (segment ends, curve ends, and where two segments
 *   really cross, up to MAX_INTERSECTIONS) and files points and segments in a uniform grid of
 *   PLAN_CELL page units, so a lookup under the cursor only looks at a few cells.
 * - `pickSnap` is the cursor snap: the nearest own-object corner or plan point within the snap
 *   radius (own objects win a tie), else the nearest point ON a plan line within it.
 *
 * Both walks are generators that yield every so often, so the viewer runs them in slices
 * (`runChunked`) and the page stays responsive without a web worker; tests run them in one go
 * (`runSync`).
 */
import type { PagePoint } from "@/lib/takeoff/model";

/** A 2-D affine transform [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

/** A straight plan line in page units (a → b). */
export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** The pdf.js operator codes the walker reads (pdf.js `OPS`; values stable since v2). */
export interface OpCodes {
  save: number;
  restore: number;
  transform: number;
  moveTo: number;
  lineTo: number;
  curveTo: number;
  curveTo2: number;
  curveTo3: number;
  closePath: number;
  rectangle: number;
  endPath: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  constructPath: number;
}
export const PDF_OPS: OpCodes = {
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  endPath: 28,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  constructPath: 91,
};
/** pdf.js v5+ path data opcodes inside `constructPath` (pdf.js `DrawOPS`). */
export const DRAW_OPS = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };

/** Page units: shorter plan segments are ignored (hatching, text drawn as outlines). */
export const MIN_SEGMENT = 2;
/** At most this many plan segments per page (the longest are kept). */
export const MAX_SEGMENTS = 20_000;
/** At most this many crossings are added as snap points. */
export const MAX_INTERSECTIONS = 20_000;
/** At most this many snap points per page in all (ends, curve ends, crossings). */
export const MAX_PLAN_POINTS = 60_000;
/** Grid cell size in page units. */
export const PLAN_CELL = 32;
/** Walk this many operators / segments between yields. */
const SLICE = 2000;

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m · n: apply n first, then m (pdf.js `Util.transform`, canvas `ctx.transform`). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Matrix, x: number, y: number): PagePoint {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** What the walker found: straight segments, and the end points of curves. */
export interface PlanGeometry {
  segments: Segment[];
  curveEnds: PagePoint[];
}

type NumList = ArrayLike<number>;

const isNumList = (v: unknown): v is NumList =>
  Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView));

const toMatrix = (v: NumList): Matrix => [v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!];

/**
 * Walk a page's operator list (`fnArray` / `argsArray` from pdf.js `page.getOperatorList()`),
 * starting from `base` (the viewport transform), and collect its straight segments in page
 * units. A generator: it yields every SLICE operators; see `runSync` / `runChunked`.
 */
export function* walkOperatorList(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  base: Matrix,
  ops: OpCodes = PDF_OPS,
  minLength = MIN_SEGMENT,
  maxSegments = MAX_SEGMENTS,
): Generator<void, PlanGeometry, void> {
  const segments: Segment[] = [];
  const curveEnds: PagePoint[] = [];
  const seen = new Set<string>();
  const stack: Matrix[] = [];
  let ctm: Matrix = base;
  // The path being built from the old encodings: current point and sub-path start (user space).
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;

  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const [ax, ay] = apply(ctm, x0, y0);
    const [bx, by] = apply(ctm, x1, y1);
    if (!(Math.hypot(bx - ax, by - ay) >= minLength)) return;
    // The same line drawn twice (fill + stroke, duplicate layers) counts once.
    const r = (v: number) => Math.round(v * 4);
    const k1 = `${r(ax)},${r(ay)},${r(bx)},${r(by)}`;
    const k2 = `${r(bx)},${r(by)},${r(ax)},${r(ay)}`;
    if (seen.has(k1) || seen.has(k2)) return;
    seen.add(k1);
    segments.push({ ax, ay, bx, by });
  };
  const curveEnd = (x: number, y: number) => {
    if (curveEnds.length < MAX_PLAN_POINTS) curveEnds.push(apply(ctm, x, y));
  };

  /** One path op in the old encodings (a bare op, or ops + coords); returns the coords used. */
  const pathOp = (op: number, a: NumList, i: number): number => {
    if (op === ops.moveTo) {
      cx = sx = a[i]!;
      cy = sy = a[i + 1]!;
      return 2;
    }
    if (op === ops.lineTo) {
      add(cx, cy, a[i]!, a[i + 1]!);
      cx = a[i]!;
      cy = a[i + 1]!;
      return 2;
    }
    if (op === ops.rectangle) {
      const x = a[i]!;
      const y = a[i + 1]!;
      const w = a[i + 2]!;
      const h = a[i + 3]!;
      add(x, y, x + w, y);
      add(x + w, y, x + w, y + h);
      add(x + w, y + h, x, y + h);
      add(x, y + h, x, y);
      cx = sx = x;
      cy = sy = y;
      return 4;
    }
    if (op === ops.curveTo) {
      curveEnd(cx, cy);
      cx = a[i + 4]!;
      cy = a[i + 5]!;
      curveEnd(cx, cy);
      return 6;
    }
    if (op === ops.curveTo2 || op === ops.curveTo3) {
      curveEnd(cx, cy);
      cx = a[i + 2]!;
      cy = a[i + 3]!;
      curveEnd(cx, cy);
      return 4;
    }
    if (op === ops.closePath) {
      add(cx, cy, sx, sy);
      cx = sx;
      cy = sy;
    }
    return 0;
  };

  /** pdf.js v5+ DrawOPS path data (moveTo / lineTo / curveTo / quadraticCurveTo / closePath). */
  const drawOps = (d: NumList) => {
    let x = 0;
    let y = 0;
    let x0 = 0;
    let y0 = 0;
    for (let i = 0; i < d.length;) {
      switch (d[i++]) {
        case DRAW_OPS.moveTo:
          x = x0 = d[i++]!;
          y = y0 = d[i++]!;
          break;
        case DRAW_OPS.lineTo: {
          const nx = d[i++]!;
          const ny = d[i++]!;
          add(x, y, nx, ny);
          x = nx;
          y = ny;
          break;
        }
        case DRAW_OPS.curveTo:
          curveEnd(x, y);
          x = d[i + 4]!;
          y = d[i + 5]!;
          i += 6;
          curveEnd(x, y);
          break;
        case DRAW_OPS.quadraticCurveTo:
          curveEnd(x, y);
          x = d[i + 2]!;
          y = d[i + 3]!;
          i += 4;
          curveEnd(x, y);
          break;
        case DRAW_OPS.closePath:
          add(x, y, x0, y0);
          x = x0;
          y = y0;
          break;
        default:
          return; // an unknown opcode: the rest of this path cannot be read
      }
    }
  };

  for (let k = 0; k < fnArray.length; k++) {
    if (k % SLICE === SLICE - 1) yield;
    const fn = fnArray[k]!;
    const args = argsArray[k];
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? ctm;
    else if (fn === ops.transform) {
      if (isNumList(args) && args.length >= 6) ctm = multiply(ctm, toMatrix(args));
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = Array.isArray(args) ? (args[0] as unknown) : null;
      if (isNumList(m) && m.length >= 6) ctm = multiply(ctm, toMatrix(m));
    } else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === ops.constructPath && Array.isArray(args)) {
      const [first, second] = args as unknown[];
      if (typeof first === "number") {
        // v5+: [paint op, [path data], minMax]. A clip-only path (endPath) draws nothing.
        if (first === ops.endPath) continue;
        const data: unknown = Array.isArray(second) ? second[0] : null;
        if (isNumList(data)) drawOps(data);
      } else if (isNumList(first) && isNumList(second)) {
        // Older builds: [ops, coords, minMax].
        let j = 0;
        for (let o = 0; o < first.length; o++) j += pathOp(first[o]!, second, j);
      }
    } else if (
      fn === ops.moveTo ||
      fn === ops.lineTo ||
      fn === ops.rectangle ||
      fn === ops.curveTo ||
      fn === ops.curveTo2 ||
      fn === ops.curveTo3 ||
      fn === ops.closePath
    ) {
      pathOp(fn, isNumList(args) ? args : [], 0);
    }
  }
  if (segments.length > maxSegments) {
    segments.sort((p, q) => segLength(q) - segLength(p));
    segments.length = maxSegments;
  }
  return { segments, curveEnds };
}

export const segLength = (s: Segment): number => Math.hypot(s.bx - s.ax, s.by - s.ay);

/** Numeric key of grid cell (cx, cy); unique for |cx|, |cy| < 32768. */
export const cellKey = (cx: number, cy: number): number => (cx + 32768) * 65536 + (cy + 32768);

/** Every grid cell a segment passes through (row by row: exact, no bounding-box waste). */
export function segmentCells(s: Segment, cell = PLAN_CELL): number[] {
  const x0 = s.ax / cell;
  const y0 = s.ay / cell;
  const x1 = s.bx / cell;
  const y1 = s.by / cell;
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  const out: number[] = [];
  for (let r = Math.floor(lo); r <= Math.floor(hi); r++) {
    let xa = x0;
    let xb = x1;
    if (y1 !== y0) {
      const ya = Math.max(r, lo);
      const yb = Math.min(r + 1, hi);
      xa = x0 + ((x1 - x0) * (ya - y0)) / (y1 - y0);
      xb = x0 + ((x1 - x0) * (yb - y0)) / (y1 - y0);
    }
    for (let c = Math.floor(Math.min(xa, xb)); c <= Math.floor(Math.max(xa, xb)); c++)
      out.push(cellKey(c, r));
  }
  return out;
}

/** Where two segments cross inside both (not at an end, not parallel), else null. */
export function segmentIntersection(p: Segment, q: Segment): PagePoint | null {
  const rx = p.bx - p.ax;
  const ry = p.by - p.ay;
  const sx = q.bx - q.ax;
  const sy = q.by - q.ay;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) <= 1e-12 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) return null;
  const qpx = q.ax - p.ax;
  const qpy = q.ay - p.ay;
  const t = (qpx * sy - qpy * sx) / den;
  const u = (qpx * ry - qpy * rx) / den;
  const eps = 1e-9;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return [p.ax + t * rx, p.ay + t * ry];
}

/** The point of segment `s` nearest to `p` (its projection, clamped to the ends). */
export function projectOnSegment(s: Segment, p: PagePoint): PagePoint {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-18) return [s.ax, s.ay];
  const t = Math.max(0, Math.min(1, ((p[0] - s.ax) * dx + (p[1] - s.ay) * dy) / l2));
  return [s.ax + t * dx, s.ay + t * dy];
}

/** The plan's snap targets filed in a uniform grid. */
export interface PlanIndex {
  cell: number;
  segments: Segment[];
  points: PagePoint[];
  /** How many of `points` are crossings. */
  intersections: number;
  pointGrid: Map<number, number[]>;
  segGrid: Map<number, number[]>;
}

const push = (grid: Map<number, number[]>, key: number, i: number) => {
  const list = grid.get(key);
  if (list) list.push(i);
  else grid.set(key, [i]);
};

/**
 * File the segments and their snap points (ends, curve ends, crossings) in a grid of `cell`
 * page units. A point within half a page unit of one already filed is dropped. A generator that
 * yields every so often; see `runSync` / `runChunked`.
 */
export function* buildPlanIndex(
  geometry: PlanGeometry,
  cell = PLAN_CELL,
  maxIntersections = MAX_INTERSECTIONS,
): Generator<void, PlanIndex, void> {
  const { segments } = geometry;
  const points: PagePoint[] = [];
  const pointGrid = new Map<number, number[]>();
  const segGrid = new Map<number, number[]>();
  const addPoint = (x: number, y: number): boolean => {
    if (points.length >= MAX_PLAN_POINTS) return false;
    const key = cellKey(Math.floor(x / cell), Math.floor(y / cell));
    for (const i of pointGrid.get(key) ?? []) {
      const q = points[i]!;
      if (Math.abs(q[0] - x) < 0.5 && Math.abs(q[1] - y) < 0.5) return false;
    }
    push(pointGrid, key, points.length);
    points.push([x, y]);
    return true;
  };

  for (let i = 0; i < segments.length; i++) {
    if (i % SLICE === SLICE - 1) yield;
    const s = segments[i]!;
    addPoint(s.ax, s.ay);
    addPoint(s.bx, s.by);
    for (const key of segmentCells(s, cell)) push(segGrid, key, i);
  }
  for (const [x, y] of geometry.curveEnds) addPoint(x, y);

  // Crossings: test the pairs that share a cell; a crossing counts only in the cell it lies in,
  // so a pair sharing several cells is found once.
  let intersections = 0;
  let work = 0;
  outer: for (const [key, list] of segGrid) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        if (++work % (SLICE * 10) === 0) yield;
        const x = segmentIntersection(segments[list[a]!]!, segments[list[b]!]!);
        if (!x) continue;
        if (cellKey(Math.floor(x[0] / cell), Math.floor(x[1] / cell)) !== key) continue;
        if (addPoint(x[0], x[1]) && ++intersections >= maxIntersections) break outer;
      }
    }
  }
  return { cell, segments, points, intersections, pointGrid, segGrid };
}

/** The keys of every cell within `radius` of `p`. */
function cellsAround(index: PlanIndex, p: PagePoint, radius: number): number[] {
  const c = index.cell;
  const x0 = Math.floor((p[0] - radius) / c);
  const x1 = Math.floor((p[0] + radius) / c);
  const y0 = Math.floor((p[1] - radius) / c);
  const y1 = Math.floor((p[1] + radius) / c);
  const out: number[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(cellKey(x, y));
  return out;
}

/** The nearest plan snap point within `radius` page units of `p`, or null. */
export function nearestPlanPoint(
  index: PlanIndex,
  p: PagePoint,
  radius: number,
): { p: PagePoint; d: number } | null {
  let best: PagePoint | null = null;
  let bestD = radius;
  for (const key of cellsAround(index, p, radius)) {
    for (const i of index.pointGrid.get(key) ?? []) {
      const q = index.points[i]!;
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= bestD) {
        bestD = d;
        best = q;
      }
    }
  }
  return best ? { p: best, d: bestD } : null;
}

/** The nearest point ON a plan line within `radius` page units of `p`, or null. */
export function nearestPlanLine(
  index: PlanIndex,
  p: PagePoint,
  radius: number,
): { p: PagePoint; d: number } | null {
  let best: PagePoint | null = null;
  let bestD = radius;
  const tried = new Set<number>();
  for (const key of cellsAround(index, p, radius)) {
    for (const i of index.segGrid.get(key) ?? []) {
      if (tried.has(i)) continue;
      tried.add(i);
      const q = projectOnSegment(index.segments[i]!, p);
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= bestD) {
        bestD = d;
        best = q;
      }
    }
  }
  return best ? { p: best, d: bestD } : null;
}

/** Where the cursor snapped: an own object's corner, a plan point, or a point on a plan line. */
export type SnapKind = "object" | "plan" | "planLine";
export interface SnapHit {
  p: PagePoint;
  kind: SnapKind;
}

/**
 * The cursor snap within `maxPx` screen px (page units × zoom): the nearest own-object corner /
 * scale end or plan point (own objects win a tie), else the nearest point on a plan line; null
 * when nothing is that close. `plan` null = plan snapping off, or the plan not read (yet).
 */
export function pickSnap(
  p: PagePoint,
  own: readonly PagePoint[],
  plan: PlanIndex | null,
  zoom: number,
  maxPx: number,
): SnapHit | null {
  const radius = maxPx / zoom;
  let best: SnapHit | null = null;
  let bestD = radius;
  for (const c of own) {
    const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
    if (d <= bestD) {
      bestD = d;
      best = { p: c, kind: "object" };
    }
  }
  if (!plan) return best;
  const pt = nearestPlanPoint(plan, p, radius);
  if (pt && (!best || pt.d < bestD)) best = { p: pt.p, kind: "plan" };
  if (best) return best;
  const on = nearestPlanLine(plan, p, radius);
  return on ? { p: on.p, kind: "planLine" } : null;
}

/** Run a sliced generator to the end at once. */
export function runSync<T>(g: Generator<void, T, void>): T {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

/**
 * Run a sliced generator, handing the thread back to the browser whenever a slice has taken
 * over `budgetMs`. Throws "cancelled" when `cancelled()` turns true between slices.
 */
export async function runChunked<T>(
  g: Generator<void, T, void>,
  cancelled: () => boolean = () => false,
  budgetMs = 12,
): Promise<T> {
  let t = Date.now();
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
    if (Date.now() - t > budgetMs) {
      await new Promise((res) => setTimeout(res, 0));
      if (cancelled()) throw new Error("cancelled");
      t = Date.now();
    }
  }
}

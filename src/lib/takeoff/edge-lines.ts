/**
 * "Edge from this area" lines and the area they run along — pure, no I/O.
 *
 * A linear made with "Edge from this area" keeps `attrs.fromArea` (the area's id) and copies the
 * area's corners as its points. Everything here matches such a line to the area's sides
 * GEOMETRICALLY (a line segment coincides with side i when its two ends sit on the side's two
 * corners, either way round, within `SIDE_MATCH_TOL_PX`), never by name:
 *  - `lineSides` — which sides of the area each segment of a line runs along;
 *  - `areaSideRoles` — per side of an area, the role of the edge line along it (parapet / gutter
 *    / …), which the bid seed turns into that side's edge details;
 *  - `followAreaEdits` — when an area's points change (vertex drag, move, edit), its edge lines
 *    that ran along its sides are re-derived on the same sides (by index); if the side count
 *    changed they are left alone and reported as stale. A side's blocking that ran its whole
 *    old length follows the new length.
 */

import type { LinearRole, PagePoint, TakeoffObject } from "./model";

/** Page px (at zoom 1) within which a line's end and an area corner are the same point. */
export const SIDE_MATCH_TOL_PX = 1;

const near = (a: PagePoint, b: PagePoint, tol: number) =>
  Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

/** How many sides a closed outline of `n` points has (a two-point "outline" has one). */
const sideCount = (n: number) => (n < 2 ? 0 : n === 2 ? 1 : n);

export interface SegmentSide {
  /** Side i of the area runs area[i] → area[i + 1] (the last back to area[0]). */
  side: number;
  /** True when the segment runs the side backwards (area[i + 1] → area[i]). */
  reversed: boolean;
}

/**
 * Per segment of `line` (segment k runs line[k] → line[k + 1]): the area side it coincides with,
 * or null when it runs along none.
 */
export function lineSides(
  line: readonly PagePoint[],
  area: readonly PagePoint[],
  tol = SIDE_MATCH_TOL_PX,
): Array<SegmentSide | null> {
  const n = area.length;
  const sides = sideCount(n);
  const out: Array<SegmentSide | null> = [];
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k]!;
    const b = line[k + 1]!;
    let hit: SegmentSide | null = null;
    for (let i = 0; i < sides && !hit; i++) {
      const p = area[i]!;
      const q = area[(i + 1) % n]!;
      if (near(a, p, tol) && near(b, q, tol)) hit = { side: i, reversed: false };
      else if (near(a, q, tol) && near(b, p, tol)) hit = { side: i, reversed: true };
    }
    out.push(hit);
  }
  return out;
}

/** The linears drawn with "Edge from this area" from `areaId`, on the area's page. */
export function edgeLinesOf(
  objects: readonly TakeoffObject[],
  area: { id: string; page: number },
): Array<Extract<TakeoffObject, { kind: "linear" }>> {
  return objects.filter(
    (o): o is Extract<TakeoffObject, { kind: "linear" }> =>
      o.kind === "linear" && o.page === area.page && o.attrs.fromArea === area.id,
  );
}

export interface AreaSideRoles {
  /** Per drawn side of the area: the role of the edge line along it, or null. */
  roles: Array<LinearRole | null>;
  /** Per drawn side: the wall height (in) of the parapet line along it, when typed. */
  heightIn: Array<number | undefined>;
}

/**
 * Per side of `area` (in drawing order), the role of the "Edge from this area" line that runs
 * along it. A line counts only where its segments coincide with the side (a line left behind by
 * a later edit to the area marks nothing). When two lines claim a side, the later one wins.
 */
export function areaSideRoles(
  area: { id: string; page: number; points: readonly PagePoint[] },
  objects: readonly TakeoffObject[],
): AreaSideRoles {
  const n = sideCount(area.points.length);
  const roles: Array<LinearRole | null> = Array.from({ length: n }, () => null);
  const heightIn: Array<number | undefined> = Array.from({ length: n }, () => undefined);
  for (const l of edgeLinesOf(objects, area)) {
    for (const hit of lineSides(l.points, area.points)) {
      if (!hit) continue;
      roles[hit.side] = l.attrs.role;
      heightIn[hit.side] = l.attrs.role === "parapet" ? l.attrs.heightIn : undefined;
    }
  }
  return { roles, heightIn };
}

/**
 * The sides of its area an edge line runs along (sorted), or undefined when the line has no
 * `fromArea`, the area is gone, or no segment coincides with a side.
 */
export function edgeLineSides(
  line: Extract<TakeoffObject, { kind: "linear" }>,
  objects: readonly TakeoffObject[],
): { areaId: string; sides: number[] } | undefined {
  const areaId = line.attrs.fromArea;
  if (!areaId) return undefined;
  const area = objects.find((o) => o.id === areaId && o.kind === "area" && o.page === line.page);
  if (!area) return undefined;
  const sides = lineSides(line.points, area.points)
    .filter((h): h is SegmentSide => h !== null)
    .map((h) => h.side);
  if (!sides.length) return undefined;
  return { areaId, sides: [...new Set(sides)].sort((a, b) => a - b) };
}

const samePoints = (a: readonly PagePoint[], b: readonly PagePoint[]) =>
  a.length === b.length && a.every((p, i) => p[0] === b[i]![0] && p[1] === b[i]![1]);

const sideLengthsPx = (pts: readonly PagePoint[]) =>
  pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });

/**
 * After an edit (`prev` → `next`): every area whose points changed takes its edge lines along.
 * A line that ran along the OLD outline (every segment on a side) is re-derived on the same
 * sides of the new outline, by index. When the side count changed the lines cannot be mapped:
 * they are left as they are and the area's name is listed in `stale`. Lines that were edited in
 * the same step, or did not coincide with the old sides, are left alone.
 */
export function followAreaEdits(
  prev: readonly TakeoffObject[],
  next: readonly TakeoffObject[],
  /** Feet per page px of a page (null = no scale): lets whole-side blocking follow the side. */
  fppOf?: (page: number) => number | null,
): { objects: TakeoffObject[]; stale: string[] } {
  const before = new Map(prev.map((o) => [o.id, o] as const));
  const stale: string[] = [];
  let out = next as TakeoffObject[];
  for (const area of next) {
    if (area.kind !== "area") continue;
    const old = before.get(area.id);
    if (!old || old.kind !== "area" || old.page !== area.page) continue;
    if (old.points === area.points || samePoints(old.points, area.points)) continue;
    const n = area.points.length;
    let staleHere = false;
    const replaced = new Map<string, PagePoint[]>();
    for (const l of edgeLinesOf(out, area)) {
      const was = before.get(l.id);
      if (!was || was.kind !== "linear" || !samePoints(was.points, l.points)) continue;
      const hits = lineSides(l.points, old.points);
      if (!hits.length || hits.some((h) => h === null)) continue;
      if (old.points.length !== n) {
        staleHere = true;
        continue;
      }
      const at = (i: number) => {
        const p = area.points[((i % n) + n) % n]!;
        return [p[0], p[1]] as PagePoint;
      };
      const segs = hits as SegmentSide[];
      const first = segs[0]!;
      const pts: PagePoint[] = [first.reversed ? at(first.side + 1) : at(first.side)];
      for (const s of segs) pts.push(s.reversed ? at(s.side) : at(s.side + 1));
      replaced.set(l.id, pts);
    }
    if (staleHere) stale.push(area.attrs.name);
    if (replaced.size)
      out = out.map((o) => (replaced.has(o.id) ? { ...o, points: replaced.get(o.id)! } : o));
    // Blocking set to a side's whole length (the setup's "blocking" answer, or "All sides")
    // follows the side's new length.
    const fpp = fppOf?.(area.page) ?? null;
    const edges = area.attrs.edges;
    if (fpp && edges?.length && old.points.length === n && old.attrs.edges === edges) {
      const was = sideLengthsPx(old.points);
      const now = sideLengthsPx(area.points);
      let changed = false;
      const nextEdges = edges.map((e, i) => {
        const b = e.blockingFt ?? 0;
        const oldFt = Math.round((was[i] ?? 0) * fpp * 100) / 100;
        const newFt = Math.round((now[i] ?? 0) * fpp * 100) / 100;
        if (!(b > 0) || Math.abs(b - oldFt) > 0.011 || newFt === oldFt) return e;
        changed = true;
        return { ...e, blockingFt: newFt };
      });
      if (changed)
        out = out.map((o) =>
          o.id === area.id && o.kind === "area"
            ? { ...o, attrs: { ...o.attrs, edges: nextEdges } }
            : o,
        );
    }
  }
  return { objects: out, stale };
}

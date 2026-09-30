/**
 * An area's edge table shows the parapet and gutter lines along its sides (owner, Sep 30: "do
 * any of the bids have section terminations and parapet walls? if so the takeoff should have both
 * too") — pure, no I/O.
 *
 * `syncSideTags` runs on every edit in the editor (`settleEdit`, after `followAreaEdits`) and
 * keeps, per side of every area, a tag on `attrs.edges[i]`:
 *  - `alongRole` ("parapet" | "gutter") and `alongLineId`: the line that runs exactly along the
 *    side — made with "Edge from this area" from THIS area, or drawn by hand (no `fromArea`) and
 *    snapped onto the side's two corners; matched geometrically (./edge-lines.ts
 *    `areaSideRoles`, the later line winning a side two lines claim);
 *  - the side's details as the role sets them: a parapet side has no termination and no blocking
 *    (the wall carries its own flashing; the table shows "Parapet wall", locked); a gutter side
 *    has the drip edge the bid seed uses (`edgeOptionsForRole`), still editable;
 *  - `beforeRole`: the side's own termination (and a parapet side's blocking) from before, put
 *    back when the line is deleted, stops running along the side, or takes another role.
 * The bid seed reads the tag first and matches geometrically where there is none
 * (./edge-lines.ts `sideRolesOf`), so a tagged and an untagged drawing seed the same bid.
 */
import { areaSideRoles, followAreaEdits } from "./edge-lines";
import type { OutlineEdgeOptions } from "./geometry";
import {
  edgeOptionsForRole,
  sideEdgeOptions,
  type AreaEdge,
  type LinearRole,
  type SideTagRole,
  type TakeoffObject,
} from "./model";

const tagRole = (r: LinearRole | null | undefined): SideTagRole | null =>
  r === "parapet" || r === "gutter" ? r : null;

/** Set or clear one key without writing `undefined` into the saved JSON. */
function put<T extends object, K extends keyof T>(o: T, k: K, v: T[K] | undefined): void {
  if (v === undefined) delete o[k];
  else o[k] = v;
}

/** A tagged side back to its own details (its `beforeRole`), with no tag. */
export function untagSide(e: AreaEdge): AreaEdge {
  const o: AreaEdge = { ...e };
  delete o.alongRole;
  delete o.alongLineId;
  delete o.beforeRole;
  if (e.alongRole && e.beforeRole) {
    put(o, "termination", e.beforeRole.termination);
    if (e.alongRole === "parapet") put(o, "blockingFt", e.beforeRole.blockingFt);
  }
  return o;
}

/** An untagged side tagged with `role` (the line `lineId` runs along it). */
export function tagSide(base: AreaEdge, role: SideTagRole, lineId: string | null): AreaEdge {
  const before: NonNullable<AreaEdge["beforeRole"]> = {};
  put(before, "termination", base.termination);
  let o: AreaEdge;
  if (role === "parapet") {
    put(before, "blockingFt", base.blockingFt);
    o = { ...base, termination: "No Termination", blockingFt: 0 };
  } else {
    o = { ...base, termination: edgeOptionsForRole(base, "gutter").termination! };
  }
  o.alongRole = role;
  if (lineId) o.alongLineId = lineId;
  o.beforeRole = before;
  return o;
}

/**
 * Every area's side tags brought in line with the lines along its sides (see the file comment).
 * A side whose tag already names the same role keeps its details (the estimator's edits to a
 * gutter side stay); only the line id is refreshed. Returns `objects` itself when nothing changed.
 */
export function syncSideTags(objects: readonly TakeoffObject[]): TakeoffObject[] {
  let changed = false;
  const out = objects.map((o) => {
    if (o.kind !== "area" || o.points.length < 3) return o;
    const want = areaSideRoles(o, objects, { handDrawn: true });
    const cur = o.attrs.edges ?? [];
    let edges: AreaEdge[] | null = null;
    for (let i = 0; i < o.points.length; i++) {
      const e = cur[i] ?? {};
      const role = tagRole(want.roles[i]);
      const lineId = role ? (want.lineIds[i] ?? null) : null;
      const had = e.alongRole ?? null;
      if (had === role && (role === null || (e.alongLineId ?? null) === lineId)) continue;
      edges ??= o.points.map((_, j) => cur[j] ?? {});
      if (had !== null && had === role) {
        const ne = { ...e };
        put(ne, "alongLineId", lineId ?? undefined);
        edges[i] = ne;
        continue;
      }
      const base = had ? untagSide(e) : e;
      edges[i] = role ? tagSide(base, role, lineId) : base;
    }
    if (!edges) return o;
    changed = true;
    return { ...o, attrs: { ...o.attrs, edges } };
  });
  return changed ? out : (objects as TakeoffObject[]);
}

/**
 * The editor's edit step (editor.tsx `commit`): an area's "Edge from this area" lines follow its
 * points (`followAreaEdits`), then every side's tag follows the lines (`syncSideTags`).
 */
export function settleEdit(
  prev: readonly TakeoffObject[],
  edited: readonly TakeoffObject[],
  fppOf?: (page: number) => number | null,
): { objects: TakeoffObject[]; stale: string[] } {
  const followed = followAreaEdits(prev, edited, fppOf);
  return { objects: syncSideTags(followed.objects), stale: followed.stale };
}

/** One row of an area's edge table: what the side shows and whether a line sets it. */
export interface SideRow {
  /** The side's details as the bid takes them (what the table shows). */
  shown: OutlineEdgeOptions;
  /** The parapet / gutter line along the side, or null. */
  role: SideTagRole | null;
  /** That line's id and name, when there is one. */
  lineId: string | null;
  lineName: string | null;
  /** A parapet line's wall height (in), when typed. */
  heightIn: number | undefined;
  /** Termination, blocking and tall wall are set by a parapet wall: not editable here. */
  locked: boolean;
}

/** Per drawn side of `area`, the edge table's row (the same details the bid seed uses). */
export function areaSideRows(
  area: Extract<TakeoffObject, { kind: "area" }>,
  objects: readonly TakeoffObject[],
): SideRow[] {
  const s = sideEdgeOptions(area, objects);
  return area.points.map((_, i) => {
    const role = tagRole(s.roles[i]);
    const lineId = role ? (s.lineIds[i] ?? null) : null;
    const line = lineId ? objects.find((o) => o.id === lineId) : undefined;
    return {
      shown: s.opts[i]!,
      role,
      lineId,
      lineName: line?.attrs.name ?? null,
      heightIn: role === "parapet" ? s.heightIn[i] : undefined,
      locked: role === "parapet",
    };
  });
}

/**
 * "Reset to setup defaults" on an area: the setup's edge defaults become each side's own details;
 * a tagged side keeps its tag with the defaults as its `beforeRole` (the role re-applied on top).
 * Tall-wall marks are kept, as before.
 */
export function resetEdgesToDefaults(
  cur: readonly (AreaEdge | undefined)[],
  defaults: readonly AreaEdge[],
): AreaEdge[] {
  return defaults.map((d, j) => {
    const e = cur[j];
    const base: AreaEdge = e?.hasTallWall ? { ...d, hasTallWall: true } : { ...d };
    return e?.alongRole ? tagSide(base, e.alongRole, e.alongLineId ?? null) : base;
  });
}

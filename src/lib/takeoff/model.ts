/**
 * Takeoff data model — pure (no I/O). Docs: docs/planswift-research.md §4.
 *
 * A takeoff is one underlay file (a plan-set PDF or an aerial screenshot), its pages (each with
 * its own scale calibration, like PlanSwift), the material answers given up front, and the
 * objects drawn on the pages. `takeoffQuantities` turns the drawing into the numbers the
 * estimator needs (sections via `sectionFromOutline`, linears, counts); phase 2's "Create bid"
 * maps those plus the setup answers onto a new bid.
 *
 * Coordinates: object points are page pixels at zoom 1 in the page's DISPLAYED frame (after its
 * rotation). Rotating a page rotates its points with `rotatePoints`, so a scale line and the
 * objects always agree with what is on screen.
 */

import type { UnderlaymentLayer } from "@/lib/engine/bid-builder";
import type { Attachment } from "@/lib/engine/estimate";
import { edgeLineSides, sideRolesOf, type SideRoles } from "./edge-lines";
import {
  drawnSideLabels,
  edgeLengths,
  equivalentRect as equivalentRectangleOf,
  polygonArea,
  polygonPerimeter,
  sectionFromOutline,
  type OutlineEdgeOptions,
  type OutlineSection,
  type Pt,
} from "./geometry";

export type PagePoint = [number, number];

/** Two clicked points a known distance apart: the page's scale (PlanSwift "Calculate Scale"). */
export interface PageScale {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** The real distance between a and b, in feet (decimal; 20 ft 6 in = 20.5). */
  feet: number;
  /** Read off the sheet's scale note ("sheet") or drawn by hand ("drawn"); absent = drawn. */
  source?: "sheet" | "drawn";
  /** The sheet's scale note as printed, when `source` is "sheet". */
  note?: string;
}

export interface TakeoffPage {
  /** 0-based page index in the PDF; an image underlay has the single page 0. */
  index: number;
  name: string;
  /** Quarter turns clockwise applied when displaying the page (0..3). */
  rotation: 0 | 1 | 2 | 3;
  /** Displayed size at zoom 1 (px), recorded once the page has rendered; used to rotate points. */
  width?: number;
  height?: number;
  scale: PageScale | null;
}

export type ObjectKind = "area" | "linear" | "count";

export const LINEAR_ROLES = ["parapet", "gutter", "expansion_joint", "walkway", "other"] as const;
export type LinearRole = (typeof LINEAR_ROLES)[number];
export const LINEAR_ROLE_LABELS: Record<LinearRole, string> = {
  parapet: "Parapet wall",
  gutter: "Gutter",
  expansion_joint: "Expansion joint",
  walkway: "Walkway pad",
  other: "Other",
};

export const COUNT_ROLES = ["drain", "pipe", "vent", "curb", "scupper", "other"] as const;
export type CountRole = (typeof COUNT_ROLES)[number];
export const COUNT_ROLE_LABELS: Record<CountRole, string> = {
  drain: "Drain",
  pipe: "Pipe stack",
  vent: "Vent",
  curb: "Curb",
  scupper: "Scupper",
  other: "Other",
};

/** The line roles an area side is tagged with in its edge table (a wall or a gutter along it). */
export type SideTagRole = "parapet" | "gutter";
/**
 * One side of an area: its edge details, plus the tag kept by `syncSideTags` (./side-tags.ts)
 * while a parapet or gutter line runs exactly along it — the line's role and id, and the side's
 * own details from before the role applied (restored when the line goes or changes role).
 */
export type AreaEdge = OutlineEdgeOptions & {
  alongRole?: SideTagRole;
  alongLineId?: string;
  beforeRole?: { termination?: string; blockingFt?: number };
};

export interface AreaAttrs {
  name: string;
  /** Per drawn edge i (points[i] → points[i+1]); missing = inert edge. */
  edges?: AreaEdge[];
  /** Inner outlines subtracted from the area (wells, penthouses), page px. */
  cutouts?: PagePoint[][];
  /**
   * Roof pitch as rise (in) per 12 in of run: 4 = a 4:12 slope. Absent (or 0) = flat. The plan
   * view shows the roof's horizontal projection, so its area is multiplied by `slopeFactor`.
   */
  pitch?: number;
}
export interface LinearAttrs {
  name: string;
  role: LinearRole;
  /** Parapet wall height (in), when known from the plan. */
  heightIn?: number;
  /**
   * Set by "Edge from this area": the area the line was made along. Its sides that the line
   * still coincides with take the line's role in the bid (./edge-lines.ts).
   */
  fromArea?: string;
}
export interface CountAttrs {
  name: string;
  role: CountRole;
  /** Pipe / drain size (in). A pipe with a size becomes a Pipe Stacks row in the bid. */
  sizeIn?: number;
  /** Curb footprint (in); blank = not measured (the bid gets a blank-size curb and a notice). */
  widthIn?: number;
  lengthIn?: number;
  /** Curb height (in) — the curb's wrap dim C in the bid. */
  heightIn?: number;
  /**
   * Drain picks (the estimator's Roof Drains & Boots entry needs them): existing roof type,
   * reuse the existing rings, boot and ring descriptions from the reference lists. Prefilled
   * from `TakeoffSetup.drain`; a drain without a boot and ring stays "place by hand".
   */
  roofType?: string;
  reuseRings?: boolean;
  bootSize?: string;
  ringSize?: string;
}

interface ObjectBase {
  id: string;
  page: number;
  points: PagePoint[];
  color?: string;
}
export type TakeoffObject =
  | (ObjectBase & { kind: "area"; attrs: AreaAttrs })
  | (ObjectBase & { kind: "linear"; attrs: LinearAttrs })
  | (ObjectBase & { kind: "count"; attrs: CountAttrs });

/**
 * The material answers asked BEFORE drawing (owner, Sep 24): the new bid's defaults, in the
 * estimator's own names so phase 2 can copy them straight across.
 */
export interface TakeoffSetup {
  roofSystem?: string;
  attachment?: Attachment;
  membraneAdhesiveName?: string;
  thickness?: number;
  color?: string;
  sheetSizeLabel?: string;
  deckType?: string;
  designTable?: number;
  pullTest?: number;
  fieldLap?: number;
  layers?: UnderlaymentLayer[];
  /** Defaults for every outer edge of a drawn area (each edge can still be changed). */
  edge?: {
    isPerimeter?: boolean;
    termination?: string;
    blocking?: boolean;
    arpSizeIn?: number;
  };
  parapet?: {
    roofSystem?: string;
    attachment?: Attachment;
    membraneAdhesiveName?: string;
    heightBand?: string;
    deckType?: string;
  };
  /** Defaults for every drain placed (each drain can still be changed). */
  drain?: {
    roofType?: string;
    reuseRings?: boolean;
    bootSize?: string;
    ringSize?: string;
  };
  notes?: string;
  /**
   * Lock bookkeeping (./lock.ts), not material answers: where an "Edit a copy" copy came from,
   * and when this takeoff built its bid. Never copied by "Use the setup from …".
   */
  copiedFrom?: { takeoffId: string; bidId: string | null; at: string };
  lockedAt?: string;
}

/** Feet per displayed pixel for a calibrated page; null when the page has no scale yet. */
export function feetPerPx(scale: PageScale | null | undefined): number | null {
  if (!scale || !(scale.feet > 0)) return null;
  const px = Math.hypot(scale.bx - scale.ax, scale.by - scale.ay);
  return px > 0 ? scale.feet / px : null;
}

/** Common pipe sizes (in) offered as quick picks on a pipe count. */
export const PIPE_SIZE_PICKS = [2, 3, 4, 6] as const;

/** Rotate page points by `quarterTurns` clockwise inside a page displayed at width × height. */
export function rotatePoints(
  points: readonly PagePoint[],
  width: number,
  height: number,
  quarterTurns: number,
): PagePoint[] {
  const t = ((quarterTurns % 4) + 4) % 4;
  return points.map(([x, y]) => {
    switch (t) {
      case 1:
        return [height - y, x];
      case 2:
        return [width - x, height - y];
      case 3:
        return [y, width - x];
      default:
        return [x, y];
    }
  });
}

/** Rotate a scale line with its page. */
export function rotateScale(
  scale: PageScale,
  width: number,
  height: number,
  quarterTurns: number,
): PageScale {
  const [[ax, ay], [bx, by]] = rotatePoints(
    [
      [scale.ax, scale.ay],
      [scale.bx, scale.by],
    ],
    width,
    height,
    quarterTurns,
  ) as [PagePoint, PagePoint];
  // Keep the sheet-read tag and note: a rotation moves the line, it does not change its origin.
  return { ...scale, ax, ay, bx, by };
}

/**
 * Sloped-surface area per plan area for a pitch of `pitch` in 12: sqrt(1 + (pitch / 12)^2). A
 * blank, zero, negative or non-numeric pitch is flat (1). 4:12 -> 1.0541; 6:12 -> 1.1180.
 */
export function slopeFactor(pitch: number | null | undefined): number {
  if (typeof pitch !== "number" || !Number.isFinite(pitch) || pitch <= 0) return 1;
  return Math.sqrt(1 + (pitch / 12) ** 2);
}

/** "×1.054" for a sloped area; "" when flat. */
export function slopeFactorLabel(pitch: number | null | undefined): string {
  const f = slopeFactor(pitch);
  return f === 1 ? "" : `×${f.toFixed(3)}`;
}

const toFeet = (pts: readonly PagePoint[], fpp: number): Pt[] =>
  pts.map(([x, y]) => [x * fpp, y * fpp]);

export interface SectionQuantity {
  objectId: string;
  name: string;
  page: number;
  /** The roof surface: plan area (less cut-outs) × the slope factor. What the bid prices. */
  areaSqFt: number;
  /** The horizontal (plan) area less cut-outs, as measured on the sheet. */
  planAreaSqFt: number;
  /** Rise per 12 when the area has a pitch; absent = flat. */
  pitch?: number;
  /** sqrt(1 + (pitch/12)^2); 1 when flat. */
  slopeFactor: number;
  /** The plan perimeter (the outline as drawn, no slope). */
  perimeterFt: number;
  /** Outer edge lengths (ft) on plan, one per drawn side. */
  edgeLengthsFt: number[];
  /**
   * The same sides as built: a pitched area's rakes (the sides running up the slope) are
   * × the slope factor, eaves keep their plan length. Equal to `edgeLengthsFt` when flat. The
   * takeoff has no eave direction, so the rakes are ASSUMED (`rakeNote` says how): a rectangle's
   * two shorter sides, any other outline's every side but the longest.
   */
  slopedEdgeLengthsFt: number[];
  /** Σ `slopedEdgeLengthsFt`: the roof edge the bid orders metal / blocking for. */
  slopedPerimeterFt: number;
  /** Drawn side indexes treated as rakes (empty when flat). */
  rakeSides: number[];
  /** How the rakes were picked, for the section's note (absent when flat). */
  rakeNote?: string;
  /**
   * Per bid edge (the order of `section.edges`): the role of the "Edge from this area" line
   * that runs along that side (parapet / gutter / …), or null.
   */
  edgeRoles: Array<LinearRole | null>;
  /** The outline's own area (before cut-outs), plan. */
  outlineAreaSqFt: number;
  /** Area of the cut-outs (wells, penthouses) taken out, plan. */
  cutoutAreaSqFt: number;
  /** The wall around each cut-out (its perimeter, ft): penthouse / well walls, not seeded. */
  cutoutPerimetersFt: number[];
  section: OutlineSection;
}
export interface LinearQuantity {
  objectId: string;
  name: string;
  page: number;
  role: LinearRole;
  lengthFt: number;
  heightIn?: number;
  /**
   * An "Edge from this area" line: its area and the sides (drawn indexes) it coincides with.
   * Lets the bid recognise a wall re-made along the same sides.
   */
  edgeOf?: { areaId: string; sides: number[] };
}
export interface CountQuantity {
  name: string;
  role: CountRole;
  qty: number;
  sizeIn?: number;
  widthIn?: number;
  lengthIn?: number;
  heightIn?: number;
  roofType?: string;
  reuseRings?: boolean;
  bootSize?: string;
  ringSize?: string;
  objectIds: string[];
}
export interface TakeoffQuantities {
  sections: SectionQuantity[];
  linears: LinearQuantity[];
  counts: CountQuantity[];
  /** Objects on a page with no scale yet: they have no real-world size. */
  unscaled: Array<{ objectId: string; page: number; name: string }>;
  /**
   * `roofAreaSqFt` is the sloped surface; `planAreaSqFt` the same areas as drawn (flat).
   * `perimeterFt` is the plan perimeter, `slopedPerimeterFt` the roof edge with rakes sloped;
   * `cutoutWallFt` the walls around cut-outs (penthouses, wells).
   */
  totals: {
    roofAreaSqFt: number;
    planAreaSqFt: number;
    perimeterFt: number;
    slopedPerimeterFt: number;
    parapetFt: number;
    cutoutWallFt: number;
  };
}

/**
 * Everything measurable from the drawing, in feet. Counts group by (role, name, size) so ten
 * clicks named "4in drain" become one row of ten.
 */
export function takeoffQuantities(
  pages: readonly TakeoffPage[],
  objects: readonly TakeoffObject[],
): TakeoffQuantities {
  const fppByPage = new Map<number, number | null>();
  for (const p of pages) fppByPage.set(p.index, feetPerPx(p.scale));
  const out: TakeoffQuantities = {
    sections: [],
    linears: [],
    counts: [],
    unscaled: [],
    totals: {
      roofAreaSqFt: 0,
      planAreaSqFt: 0,
      perimeterFt: 0,
      slopedPerimeterFt: 0,
      parapetFt: 0,
      cutoutWallFt: 0,
    },
  };
  const countGroups = new Map<string, CountQuantity>();
  for (const o of objects) {
    const fpp = fppByPage.get(o.page) ?? null;
    if (o.kind === "count") {
      const a = o.attrs;
      const key = [
        a.role,
        a.name.trim().toLowerCase(),
        a.sizeIn ?? "",
        a.widthIn ?? "",
        a.lengthIn ?? "",
        a.heightIn ?? "",
        a.roofType ?? "",
        a.reuseRings ? "reuse" : "",
        a.bootSize ?? "",
        a.ringSize ?? "",
      ].join("|");
      const g =
        countGroups.get(key) ??
        (() => {
          const n: CountQuantity = { name: a.name, role: a.role, qty: 0, objectIds: [] };
          if (a.sizeIn !== undefined) n.sizeIn = a.sizeIn;
          if (a.widthIn !== undefined) n.widthIn = a.widthIn;
          if (a.lengthIn !== undefined) n.lengthIn = a.lengthIn;
          if (a.heightIn !== undefined) n.heightIn = a.heightIn;
          if (a.roofType !== undefined) n.roofType = a.roofType;
          if (a.reuseRings !== undefined) n.reuseRings = a.reuseRings;
          if (a.bootSize !== undefined) n.bootSize = a.bootSize;
          if (a.ringSize !== undefined) n.ringSize = a.ringSize;
          countGroups.set(key, n);
          return n;
        })();
      g.qty += Math.max(1, o.points.length);
      g.objectIds.push(o.id);
      continue;
    }
    if (fpp === null) {
      out.unscaled.push({ objectId: o.id, page: o.page, name: o.attrs.name });
      continue;
    }
    if (o.kind === "linear") {
      const pts = toFeet(o.points, fpp);
      let len = 0;
      for (let i = 1; i < pts.length; i++)
        len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
      const q: LinearQuantity = {
        objectId: o.id,
        name: o.attrs.name,
        page: o.page,
        role: o.attrs.role,
        lengthFt: len,
      };
      if (o.attrs.heightIn !== undefined) q.heightIn = o.attrs.heightIn;
      const edgeOf = edgeLineSides(o, objects);
      if (edgeOf) q.edgeOf = edgeOf;
      out.linears.push(q);
      if (o.attrs.role === "parapet") out.totals.parapetFt += len;
      continue;
    }
    if (o.points.length < 3) continue;
    const outer = toFeet(o.points, fpp);
    const cutoutRings = (o.attrs.cutouts ?? []).map((c) => toFeet(c, fpp));
    const cutoutArea = cutoutRings.reduce((s, c) => s + polygonArea(c), 0);
    const cutoutPerimetersFt = cutoutRings.filter((c) => c.length >= 3).map(polygonPerimeter);
    // The parapet / gutter lines along this outline set their sides' edge details: the side's
    // tag when it has one, else matched geometrically, side by side (`sideEdgeOptions`).
    const { opts: edgeOpts, ...sideRoles } = sideEdgeOptions(o, objects);
    const section = sectionFromOutline(outer, edgeOpts);
    const outlineAreaSqFt = section.measured.areaSqFt;
    if (cutoutArea > 0) {
      // A well or penthouse: less membrane, same outer edges. Re-derive the layout rectangle for
      // the reduced area on the unchanged outer perimeter (the bid section has no deduction
      // field, so length × width must carry the net area; the edges stay the true sides).
      const areaSqFt = Math.max(0, section.measured.areaSqFt - cutoutArea);
      const { length, width } = equivalentRectangleOf(areaSqFt, section.measured.perimeterFt);
      section.length = length;
      section.width = width;
      section.measured = { ...section.measured, areaSqFt };
    }
    const planAreaSqFt = section.measured.areaSqFt;
    const factor = slopeFactor(o.attrs.pitch);
    const planLens = edgeLengths(outer);
    // Bid edge k is drawn side `drawnOf[k]` (a four-sided outline is re-labelled from its
    // longest side, like a typed rectangle).
    const labels = drawnSideLabels(outer);
    const drawnOf = section.edges.map((e) => labels.indexOf(e.side));
    const rakes: { sides: number[]; note?: string } =
      factor !== 1 ? rakeSidesOf(outer) : { sides: [] };
    if (factor !== 1) {
      // A pitched roof: the drawing is its plan (horizontal) projection. The slope runs across
      // the layout rectangle's width (the shorter run, like rafters on a gable), so the width
      // grows by the factor and length × width stays the true surface area. The rakes (the
      // sides that run up the slope) grow by the same factor, with their perimeter run and
      // blocking; the eaves keep their plan length.
      section.width *= factor;
      section.measured = { ...section.measured, areaSqFt: planAreaSqFt * factor };
      section.edges = section.edges.map((e, k) => {
        if (!rakes.sides.includes(drawnOf[k]!)) return e;
        const ne = { ...e, lengthFt: e.lengthFt * factor };
        if (e.perimLengthFt !== undefined) ne.perimLengthFt = e.perimLengthFt * factor;
        if (e.blockingFt > 0) ne.blockingFt = Math.round(e.blockingFt * factor * 100) / 100;
        return ne;
      });
    }
    const slopedEdgeLengthsFt = planLens.map((l, i) => (rakes.sides.includes(i) ? l * factor : l));
    const slopedPerimeterFt = slopedEdgeLengthsFt.reduce((t, l) => t + l, 0);
    const sq: SectionQuantity = {
      objectId: o.id,
      name: o.attrs.name,
      page: o.page,
      areaSqFt: section.measured.areaSqFt,
      planAreaSqFt,
      slopeFactor: factor,
      perimeterFt: polygonPerimeter(outer),
      edgeLengthsFt: planLens,
      slopedEdgeLengthsFt,
      slopedPerimeterFt,
      rakeSides: rakes.sides,
      edgeRoles: drawnOf.map((i) => sideRoles.roles[i] ?? null),
      outlineAreaSqFt,
      cutoutAreaSqFt: cutoutArea,
      cutoutPerimetersFt,
      section,
    };
    if (factor !== 1) sq.pitch = o.attrs.pitch!;
    if (rakes.note) sq.rakeNote = rakes.note;
    out.sections.push(sq);
    out.totals.roofAreaSqFt += section.measured.areaSqFt;
    out.totals.planAreaSqFt += planAreaSqFt;
    out.totals.perimeterFt += polygonPerimeter(outer);
    out.totals.slopedPerimeterFt += slopedPerimeterFt;
    out.totals.cutoutWallFt += cutoutPerimetersFt.reduce((t, l) => t + l, 0);
  }
  out.counts = [...countGroups.values()];
  return out;
}

/** A side's edge details without the tag bookkeeping (`alongRole`, `alongLineId`, `beforeRole`). */
export function edgeDetails(e: AreaEdge): OutlineEdgeOptions {
  const o: AreaEdge = { ...e };
  delete o.alongRole;
  delete o.alongLineId;
  delete o.beforeRole;
  return o;
}

/**
 * Per drawn side of `area`: the role of the line along it (`sideRolesOf`: the side's tag when it
 * has one, else geometry) and the edge details the bid takes for it. A side tagged gutter keeps
 * its termination as the estimator left it (the tag pre-set the drip edge; it stays editable);
 * any other side goes through `edgeOptionsForRole`. What the Objects tab shows is exactly this.
 */
export function sideEdgeOptions(
  area: { id: string; page: number; points: readonly PagePoint[]; attrs: { edges?: AreaEdge[] } },
  objects: readonly TakeoffObject[],
): SideRoles & { opts: OutlineEdgeOptions[] } {
  const r = sideRolesOf(area, objects);
  const opts = area.points.map((_, i) => {
    const base = edgeDetails(area.attrs.edges?.[i] ?? {});
    const role = r.roles[i] ?? null;
    if (r.tagged[i] && role === "gutter") return base;
    return edgeOptionsForRole(base, role, r.heightIn[i]);
  });
  return { ...r, opts };
}

/**
 * The Quantities tab's side-role line for a section: "parapet sides: B, C, D (220 ft) · gutter:
 * A (100 ft)" — the bid's side letters and lengths (rakes sloped); null when no side has either.
 */
export function sectionSideRolesText(
  s: Pick<SectionQuantity, "edgeRoles" | "section">,
): string | null {
  const parts: string[] = [];
  for (const role of ["parapet", "gutter"] as const) {
    const edges = s.section.edges.filter((_, k) => s.edgeRoles[k] === role);
    if (!edges.length) continue;
    const ft = Math.round(edges.reduce((t, e) => t + e.lengthFt, 0) * 10) / 10;
    const label = role === "parapet" ? `parapet side${edges.length === 1 ? "" : "s"}` : "gutter";
    parts.push(
      `${label}: ${edges.map((e) => e.side).join(", ")} (${ft.toLocaleString("en-US")} ft)`,
    );
  }
  return parts.length ? parts.join(" · ") : null;
}

/** The termination a gutter side takes: the setup's own drip edge, else a 4" drip edge. */
export const GUTTER_SIDE_TERMINATION = '4" Drip Edge';

/**
 * A side's edge options given the role of the "Edge from this area" line along it (`base` =
 * the side's own options, from the setup's edge answers or the Objects tab):
 *  - parapet: no termination and no blocking (the wall carries its own flashing on the Parapets
 *    screen — the same fix an estimator makes by hand on the Sections screen), "w/ Wall > 2ft"
 *    when the wall is taller than 24 in; the perimeter flag and ARP stay (the wind zone runs
 *    along a walled edge too);
 *  - gutter: the drip edge a gutter hangs from (the setup's drip edge when it names one);
 *  - expansion joint / walkway / other / none: the side as it is.
 */
export function edgeOptionsForRole(
  base: OutlineEdgeOptions,
  role: LinearRole | null,
  wallHeightIn?: number,
): OutlineEdgeOptions {
  if (role === "parapet") {
    const o: OutlineEdgeOptions = { ...base, termination: "No Termination", blockingFt: 0 };
    delete o.hasTallWall;
    if ((base.isPerimeter ?? false) && (wallHeightIn ?? 0) > 24) o.hasTallWall = true;
    return o;
  }
  if (role === "gutter") {
    const t = base.termination ?? "";
    return { ...base, termination: /drip edge/i.test(t) ? t : GUTTER_SIDE_TERMINATION };
  }
  return base;
}

/**
 * The sides of a pitched outline that run up the slope. The takeoff records no eave direction,
 * so: a rectangle's two shorter sides (the gable ends; for a square, the two sides after and
 * before the first), any other outline's every side but the longest.
 */
export function rakeSidesOf(points: readonly Pt[]): { sides: number[]; note: string } {
  const n = points.length;
  const lens = edgeLengths(points);
  const labels = drawnSideLabels(points);
  let longest = 0;
  for (let i = 1; i < n; i++) if (lens[i]! > lens[longest]! + 1e-9) longest = i;
  const isRect =
    n === 4 &&
    points.every((_, i) => {
      const a = points[i]!;
      const b = points[(i + 1) % n]!;
      const c = points[(i + 2) % n]!;
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const vx = c[0] - b[0];
      const vy = c[1] - b[1];
      return Math.abs(ux * vx + uy * vy) <= 1e-3 * Math.hypot(ux, uy) * Math.hypot(vx, vy);
    });
  if (isRect) {
    const sides = [(longest + 1) % 4, (longest + 3) % 4].sort((a, b) => a - b);
    return {
      sides,
      note: `rakes assumed: the two shorter sides (${sides.map((i) => labels[i]).join(", ")}) run up the slope`,
    };
  }
  const sides = lens.map((_, i) => i).filter((i) => i !== longest);
  return {
    sides,
    note: `rakes assumed: every side but the longest (${labels[longest]}) runs up the slope`,
  };
}

/** A new object's colour, cycling a small legible palette per kind (PlanSwift colours items). */
export const OBJECT_COLORS: Record<ObjectKind, string[]> = {
  area: ["#16a34a", "#dc2626", "#0d9488", "#7c3aed", "#ca8a04"],
  linear: ["#1d4ed8", "#c026d3", "#0891b2", "#b45309"],
  count: ["#db2777", "#2563eb", "#65a30d", "#ea580c"],
};
export function nextColor(kind: ObjectKind, existing: readonly TakeoffObject[]): string {
  const used = existing.filter((o) => o.kind === kind).length;
  const list = OBJECT_COLORS[kind];
  return list[used % list.length]!;
}

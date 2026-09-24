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
import {
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

export interface AreaAttrs {
  name: string;
  /** Per drawn edge i (points[i] → points[i+1]); missing = inert edge. */
  edges?: OutlineEdgeOptions[];
  /** Inner outlines subtracted from the area (wells, penthouses), page px. */
  cutouts?: PagePoint[][];
}
export interface LinearAttrs {
  name: string;
  role: LinearRole;
  /** Parapet wall height (in), when known from the plan. */
  heightIn?: number;
}
export interface CountAttrs {
  name: string;
  role: CountRole;
  /** Pipe / drain size (in). */
  sizeIn?: number;
  /** Curb footprint (in). */
  widthIn?: number;
  lengthIn?: number;
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
}

/** Feet per displayed pixel for a calibrated page; null when the page has no scale yet. */
export function feetPerPx(scale: PageScale | null | undefined): number | null {
  if (!scale || !(scale.feet > 0)) return null;
  const px = Math.hypot(scale.bx - scale.ax, scale.by - scale.ay);
  return px > 0 ? scale.feet / px : null;
}

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
  return { ax, ay, bx, by, feet: scale.feet };
}

const toFeet = (pts: readonly PagePoint[], fpp: number): Pt[] =>
  pts.map(([x, y]) => [x * fpp, y * fpp]);

export interface SectionQuantity {
  objectId: string;
  name: string;
  page: number;
  areaSqFt: number;
  perimeterFt: number;
  /** Outer edge lengths (ft), one per drawn side. */
  edgeLengthsFt: number[];
  section: OutlineSection;
}
export interface LinearQuantity {
  objectId: string;
  name: string;
  page: number;
  role: LinearRole;
  lengthFt: number;
  heightIn?: number;
}
export interface CountQuantity {
  name: string;
  role: CountRole;
  qty: number;
  sizeIn?: number;
  widthIn?: number;
  lengthIn?: number;
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
  totals: { roofAreaSqFt: number; perimeterFt: number; parapetFt: number };
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
    totals: { roofAreaSqFt: 0, perimeterFt: 0, parapetFt: 0 },
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
      out.linears.push(q);
      if (o.attrs.role === "parapet") out.totals.parapetFt += len;
      continue;
    }
    if (o.points.length < 3) continue;
    const outer = toFeet(o.points, fpp);
    const cutoutArea = (o.attrs.cutouts ?? []).reduce((s, c) => s + polygonArea(toFeet(c, fpp)), 0);
    const section = sectionFromOutline(outer, o.attrs.edges ?? []);
    if (cutoutArea > 0) {
      // A well or penthouse: less membrane, same outer edges. Re-derive the layout rectangle for
      // the reduced area on the unchanged outer perimeter.
      const areaSqFt = Math.max(0, section.measured.areaSqFt - cutoutArea);
      const { length, width } = equivalentRectangleOf(areaSqFt, section.measured.perimeterFt);
      section.length = length;
      section.width = width;
      section.measured = { ...section.measured, areaSqFt };
    }
    out.sections.push({
      objectId: o.id,
      name: o.attrs.name,
      page: o.page,
      areaSqFt: section.measured.areaSqFt,
      perimeterFt: polygonPerimeter(outer),
      edgeLengthsFt: edgeLengths(outer),
      section,
    });
    out.totals.roofAreaSqFt += section.measured.areaSqFt;
    out.totals.perimeterFt += polygonPerimeter(outer);
  }
  out.counts = [...countGroups.values()];
  return out;
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

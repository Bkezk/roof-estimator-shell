/**
 * The ticket's Aerial markup (owner, Sep 30): the tech's annotations on the property's aerial —
 * measured areas, tags (a pin with a label and a note) and text — as vector JSON that
 * is stored on the aerial photo row (service_job_photos.annotations) and re-opened for editing,
 * plus the canvas painter that draws the same picture into the saved PNG. Pure: no I/O, no DOM.
 *
 * Positions are lng/lat, so a saved markup redraws on the roof at any zoom and screen size.
 * Nothing here creates repairs or bids: a tag marks what the tech saw, nothing more.
 *
 * Owner, Oct 1: the Area tool (src/lib/aerial-area.ts, the takeoff's area drawer) replaced Draw
 * and Line. An `area` mark is a closed outline whose sq ft is measured with the imagery's own
 * Web Mercator scale (aerial-geo's metresPerPixel). `free` and `line` marks stay in the schema so
 * markups saved before then still load, draw and save; no tool makes new ones.
 */
import { z } from "zod";

import { areaLabel, labelAt, type Pt } from "@/lib/aerial-area";
import {
  MAX_VIEW_ZOOM,
  footprintAreaSqFt,
  footprintLabel,
  footprintPolygons,
  lngLatAreaSqFt,
  project,
  unproject,
  type AerialView,
  type LngLat,
} from "@/lib/aerial-geo";

/** The fixed colour set (readable on aerial imagery). */
export const MARKUP_COLORS = [
  { id: "red", hex: "#ef4444", label: "Red" },
  { id: "yellow", hex: "#facc15", label: "Yellow" },
  { id: "blue", hex: "#3b82f6", label: "Blue" },
  { id: "green", hex: "#22c55e", label: "Green" },
  { id: "white", hex: "#ffffff", label: "White" },
] as const;
export type MarkupColor = (typeof MARKUP_COLORS)[number]["id"];
const COLOR_IDS = MARKUP_COLORS.map((c) => c.id) as [MarkupColor, ...MarkupColor[]];
export const colorHex = (id: string): string =>
  MARKUP_COLORS.find((c) => c.id === id)?.hex ?? MARKUP_COLORS[0].hex;
/** A colour of the set at `alpha` (an area's fill). */
export function colorFill(id: string, alpha: number): string {
  const h = colorHex(id);
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return `rgba(${n(1)},${n(3)},${n(5)},${alpha})`;
}
/** An area's fill opacity, on screen and in the PNG. */
export const AREA_FILL_ALPHA = 0.25;

/** Quick labels for a tag; free text is always allowed. */
export const TAG_PRESETS = [
  "Ponding",
  "Open seam",
  "Blister",
  "Puncture",
  "Flashing",
  "Drain / scupper",
  "Debris",
  "Previous repair",
  "Leak area",
] as const;

export const TAG_LABEL_MAX = 40;
export const TAG_NOTE_MAX = 500;
export const TEXT_MAX = 80;

const lngLat = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const idSchema = z.string().min(1).max(40);
const colorSchema = z.enum(COLOR_IDS);

export const annotationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("free"),
    id: idSchema,
    color: colorSchema,
    points: z.array(lngLat).min(2).max(2000),
  }),
  z.object({
    kind: z.literal("line"),
    id: idSchema,
    color: colorSchema,
    points: z.array(lngLat).length(2),
  }),
  z.object({
    kind: z.literal("area"),
    id: idSchema,
    color: colorSchema,
    /** Corners in order, closed implicitly (the last joins the first). */
    points: z.array(lngLat).min(3).max(500),
  }),
  z.object({
    kind: z.literal("pin"),
    id: idSchema,
    color: colorSchema,
    at: lngLat,
    label: z.string().trim().min(1).max(TAG_LABEL_MAX),
    note: z.string().trim().max(TAG_NOTE_MAX).default(""),
  }),
  z.object({
    kind: z.literal("text"),
    id: idSchema,
    color: colorSchema,
    at: lngLat,
    text: z.string().trim().min(1).max(TEXT_MAX),
  }),
]);
export type Annotation = z.output<typeof annotationSchema>;

/** GeoJSON Polygon / MultiPolygon coordinates (checked in depth by footprintPolygons). */
type FootprintCoordinates = number[][][] | number[][][][];
const footprintSchema = z.object({
  type: z.enum(["Polygon", "MultiPolygon"]),
  coordinates: z.custom<FootprintCoordinates>((v) => Array.isArray(v) && v.length > 0),
});

/** The building the aerial is of: from the address match, the tech's pick, or none. */
export const aerialBuildingSchema = z.object({
  /** buildings.id; null for an outline read straight off the state layer (not stored). */
  id: z.string().uuid().nullable(),
  footprint: footprintSchema.nullable(),
  address: z.string().max(300).nullable(),
  state: z.enum(["KY", "TN"]).nullable(),
  how: z.enum(["address", "picked", "photo_gps", "none"]),
});
export type AerialBuilding = z.output<typeof aerialBuildingSchema>;

export const MARKUP_VERSION = 1;
export const markupSchema = z.object({
  v: z.literal(MARKUP_VERSION),
  center: lngLat,
  zoom: z.number().int().min(3).max(22),
  building: aerialBuildingSchema.nullable(),
  annotations: z.array(annotationSchema).max(300),
});
export type AerialMarkup = z.output<typeof markupSchema>;

/** A stored markup, or null when it is missing or not one this code can read. */
export function parseMarkup(raw: unknown): AerialMarkup | null {
  const r = markupSchema.safeParse(raw);
  return r.success ? r.data : null;
}

const r7 = (n: number) => Math.round(n * 1e7) / 1e7;
const roundLL = (p: LngLat): LngLat => [r7(p[0]), r7(p[1])];
const r8 = (n: number) => Math.round(n * 1e8) / 1e8;
const roundLL8 = (p: LngLat): LngLat => [r8(p[0]), r8(p[1])];

/**
 * The JSON stored for a markup: validated, positions rounded to 1 cm (7 decimals); an area's
 * corners to 1 mm (8 decimals), so its sq ft reads the same after saving as while drawing (1 cm
 * on each side of a 23 × 18 m box moves it by about a sq ft).
 */
export function serializeMarkup(m: AerialMarkup): AerialMarkup {
  const out: AerialMarkup = {
    v: MARKUP_VERSION,
    center: roundLL(m.center),
    zoom: m.zoom,
    building: m.building,
    annotations: m.annotations.map((a) =>
      a.kind === "area"
        ? { ...a, points: a.points.map(roundLL8) }
        : a.kind === "free" || a.kind === "line"
          ? { ...a, points: a.points.map(roundLL) }
          : { ...a, at: roundLL(a.at) },
    ),
  };
  return markupSchema.parse(out);
}

// ── Editing: add / remove / undo / clear ───────────────────────────────────────────────────

export interface MarkupHistory {
  annotations: Annotation[];
  /** Earlier states, newest last; Undo pops one. Clear is undoable too. */
  past: Annotation[][];
}
export type MarkupAction =
  | { type: "add"; annotation: Annotation }
  | { type: "remove"; id: string }
  | { type: "undo" }
  | { type: "clear" }
  | { type: "load"; annotations: Annotation[] };

const PAST_MAX = 100;
export const emptyHistory = (annotations: Annotation[] = []): MarkupHistory => ({
  annotations,
  past: [],
});

export function markupReducer(s: MarkupHistory, a: MarkupAction): MarkupHistory {
  const push = (next: Annotation[]): MarkupHistory => ({
    annotations: next,
    past: [...s.past, s.annotations].slice(-PAST_MAX),
  });
  switch (a.type) {
    case "add":
      return push([...s.annotations, a.annotation]);
    case "remove":
      return s.annotations.some((x) => x.id === a.id)
        ? push(s.annotations.filter((x) => x.id !== a.id))
        : s;
    case "clear":
      return s.annotations.length ? push([]) : s;
    case "undo": {
      if (!s.past.length) return s;
      return { annotations: s.past[s.past.length - 1]!, past: s.past.slice(0, -1) };
    }
    case "load":
      return emptyHistory(a.annotations);
  }
}

// ── Freehand strokes ───────────────────────────────────────────────────────────────────────

/** Ramer–Douglas–Peucker: drop points within `tol` px of the line through their neighbours. */
export function simplifyStroke(pts: [number, number][], tol = 1.5): [number, number][] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const [ax, ay] = pts[i0]!;
    const [bx, by] = pts[i1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let far = -1;
    let farD = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const [px, py] = pts[i]!;
      const d =
        len === 0
          ? Math.hypot(px - ax, py - ay)
          : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far > 0) {
      keep[far] = true;
      stack.push([i0, far], [far, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** An SVG path through view-pixel points ("M x y L x y …"), one decimal. */
export function pathD(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
}

// ── Tags: numbering and the legend ─────────────────────────────────────────────────────────

/** Tags are numbered 1, 2, … in the order they were placed (the number is drawn on the pin). */
export function tagNumbers(annotations: Annotation[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of annotations) if (a.kind === "pin") out.set(a.id, out.size + 1);
  return out;
}

export type TagMark = Extract<Annotation, { kind: "pin" }>;
export type TextMark = Extract<Annotation, { kind: "text" }>;

/**
 * The Tags list under the picture (owner, Oct 1) and the PNG legend: one row per tag, numbered
 * as on the picture, with "1. Ponding — 3 in. deep at the NE drain".
 */
export function tagRows(annotations: Annotation[]): { mark: TagMark; n: number; line: string }[] {
  const n = tagNumbers(annotations);
  return annotations.flatMap((a) => {
    if (a.kind !== "pin") return [];
    const k = n.get(a.id)!;
    return [{ mark: a, n: k, line: `${k}. ${a.label}${a.note ? ` — ${a.note}` : ""}` }];
  });
}

/** The Text list under the picture (owner, Oct 1): every text mark's words, in drawing order. */
export function textRows(annotations: Annotation[]): { mark: TextMark; text: string }[] {
  return annotations.flatMap((a) => (a.kind === "text" ? [{ mark: a, text: a.text }] : []));
}

// ── Areas: numbering, sq ft and the total ──────────────────────────────────────────────────

export type AreaMark = Extract<Annotation, { kind: "area" }>;
export const isAreaMark = (a: Annotation): a is AreaMark => a.kind === "area";

/**
 * An area mark's sq ft, rounded: its corners in Web Mercator pixels × (metres per pixel at its
 * latitude)². `zoom` is the view's; the result is the same at any zoom (see lngLatAreaSqFt).
 */
export const areaMarkSqFt = (a: AreaMark, zoom: number = MAX_VIEW_ZOOM): number =>
  Math.round(lngLatAreaSqFt(a.points, zoom));

/** Every area, numbered 1, 2, … in the order drawn, with its sq ft; and the total. */
export function areaRows(
  annotations: Annotation[],
  zoom: number = MAX_VIEW_ZOOM,
): { rows: { mark: AreaMark; n: number; sqft: number }[]; total: number } {
  const rows = annotations.filter(isAreaMark).map((mark, i) => ({
    mark,
    n: i + 1,
    sqft: areaMarkSqFt(mark, zoom),
  }));
  return { rows, total: rows.reduce((s, r) => s + r.sqft, 0) };
}

/**
 * The saved areas' corners projected onto `view` (view px): what a new area's corners link to
 * (src/lib/aerial-area.ts, linkPoint).
 */
export function areaLinkPolys(annotations: Annotation[], view: AerialView): Pt[][] {
  return annotations.filter(isAreaMark).map((a) => a.points.map((p) => project(view, p)));
}

/** View px this close count as the same point (float noise from projecting / re-projecting). */
const SAME_PX = 1e-6;

/**
 * A finished area's corners (view px) as lng/lat. A corner that sits on a saved area's corner
 * (linked) takes that corner's stored lng/lat exactly, so the two areas share the corner — and a
 * side between two linked corners is the same edge — to the last digit, not merely close.
 */
export function areaCornersLngLat(
  view: AerialView,
  points: Pt[],
  annotations: Annotation[],
): LngLat[] {
  const corners = annotations
    .filter(isAreaMark)
    .flatMap((a) => a.points.map((ll) => ({ ll, px: project(view, ll) })));
  return points.map(([x, y]) => {
    const hit = corners.find(
      (c) => Math.abs(c.px[0] - x) <= SAME_PX && Math.abs(c.px[1] - y) <= SAME_PX,
    );
    return hit ? hit.ll : unproject(view, x, y);
  });
}

/**
 * The PNG's legend: "1. Ponding — 3 in. deep at the NE drain" per tag, then
 * "Area 1 — 2,340 sq ft" per area and "Areas total — 4,680 sq ft".
 */
export function legendLines(annotations: Annotation[], zoom: number = MAX_VIEW_ZOOM): string[] {
  const tags = tagRows(annotations).map((r) => r.line);
  const { rows, total } = areaRows(annotations, zoom);
  const areas = rows.map((r) => `Area ${r.n} — ${areaLabel(r.sqft)}`);
  if (rows.length) areas.push(`Areas total — ${areaLabel(total)}`);
  return [...tags, ...areas];
}

/** One-line summary for the section header. */
export function markupSummary(annotations: Annotation[]): string {
  const tags = annotations.filter((a) => a.kind === "pin").length;
  const areas = annotations.filter((a) => a.kind === "area").length;
  const marks = annotations.length - tags - areas;
  const parts = [
    tags ? `${tags} ${tags === 1 ? "tag" : "tags"}` : null,
    areas ? `${areas} ${areas === 1 ? "area" : "areas"}` : null,
    marks ? `${marks} ${marks === 1 ? "mark" : "marks"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "no marks";
}

// ── Canvas painter (the saved PNG) ─────────────────────────────────────────────────────────

/** The part of CanvasRenderingContext2D the painter uses (a test passes a recorder). */
export interface Paint2D {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  stroke(): void;
  fill(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

export const FOOTPRINT_STROKE = "#22d3ee";
const STROKE_W = 4;
const AREA_STROKE_W = 3;
const PIN_R = 13;
const LEGEND_LINE = 22;
const LEGEND_PAD = 10;
const LEGEND_MAX_LINES = 12;

/** Extra pixels under the picture for the legend (tags, areas) in the PNG. */
export function legendHeight(annotations: Annotation[]): number {
  const n = Math.min(LEGEND_MAX_LINES, legendLines(annotations).length);
  return n ? n * LEGEND_LINE + 2 * LEGEND_PAD : 0;
}

/** Text in the given colour with a dark outline, so it reads on any roof. */
function outlinedText(ctx: Paint2D, text: string, x: number, y: number, color: string) {
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * Draw the footprint outline, the annotations, a caption (address and footprint area) and the
 * tags' legend over imagery already on the canvas. `view` is the picture's own view; the legend
 * goes below it (legendHeight).
 */
export function paintOverlay(
  ctx: Paint2D,
  view: AerialView,
  markup: Pick<AerialMarkup, "annotations" | "building">,
  opts: { caption?: string | null } = {},
): void {
  const at = (p: LngLat) => project(view, p);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // The matched building's outline is not drawn (owner, Oct 1: "we don't need the box around
  // the property, it just muddles the picture"); its footprint area stays in the caption.

  // Areas at the bottom, then lines, then text, then tags on top.
  const order = { area: -1, free: 0, line: 0, text: 1, pin: 2 } as const;
  const sorted = [...markup.annotations].sort((a, b) => order[a.kind] - order[b.kind]);
  const numbers = tagNumbers(markup.annotations);
  for (const a of sorted) {
    const color = colorHex(a.color);
    if (a.kind === "area") {
      const pts = a.points.map(at);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = colorFill(a.color, AREA_FILL_ALPHA);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = AREA_STROKE_W + 3;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = AREA_STROKE_W;
      ctx.stroke();
      const [lx, ly] = labelAt(pts);
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      outlinedText(ctx, areaLabel(areaMarkSqFt(a, view.zoom)), lx, ly, "#ffffff");
    } else if (a.kind === "free" || a.kind === "line") {
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = STROKE_W + 3;
      ctx.beginPath();
      a.points.forEach((p, i) => {
        const [x, y] = at(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = STROKE_W;
      ctx.stroke();
    } else if (a.kind === "text") {
      const [x, y] = at(a.at);
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      outlinedText(ctx, a.text, x, y, color);
    } else {
      const [x, y] = at(a.at);
      ctx.beginPath();
      ctx.arc(x, y, PIN_R, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#000000";
      ctx.stroke();
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = a.color === "white" || a.color === "yellow" ? "#000000" : "#ffffff";
      ctx.fillText(String(numbers.get(a.id) ?? ""), x, y + 0.5);
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "left";
      outlinedText(ctx, a.label, x + PIN_R + 4, y, "#ffffff");
    }
  }

  // Caption, top left (the footprint's area stays in words; the outline itself is not drawn).
  const area = footprintLabel(
    footprintAreaSqFt(footprintPolygons(markup.building?.footprint ?? null)),
  );
  const caption = [opts.caption, area].filter(Boolean).join(" · ");
  if (caption) {
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const w = ctx.measureText(caption).width;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(8, 8, w + 16, 26);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(caption, 16, 13);
  }

  // Legend under the picture.
  const lines = legendLines(markup.annotations, view.zoom);
  if (lines.length) {
    const top = view.height;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, top, view.width, legendHeight(markup.annotations));
    ctx.fillStyle = "#111111";
    ctx.font = "15px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const shown = lines.slice(0, LEGEND_MAX_LINES);
    if (lines.length > LEGEND_MAX_LINES)
      shown[LEGEND_MAX_LINES - 1] = `… and ${lines.length - LEGEND_MAX_LINES + 1} more`;
    shown.forEach((t, i) => {
      const max = view.width - 2 * LEGEND_PAD;
      let s = t;
      while (s.length > 4 && ctx.measureText(s).width > max) s = `${s.slice(0, -2)}…`;
      ctx.fillText(s, LEGEND_PAD, top + LEGEND_PAD + i * LEGEND_LINE + 3);
    });
  }
  ctx.restore();
}

/** A short unique id for an annotation. */
export const newAnnotationId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

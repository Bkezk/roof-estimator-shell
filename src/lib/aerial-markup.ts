/**
 * The ticket's Aerial markup (owner, Sep 30): the tech's annotations on the property's aerial —
 * freehand, straight lines, tags (a pin with a label and a note) and text — as vector JSON that
 * is stored on the aerial photo row (service_job_photos.annotations) and re-opened for editing,
 * plus the canvas painter that draws the same picture into the saved PNG. Pure: no I/O, no DOM.
 *
 * Positions are lng/lat, so a saved markup redraws on the roof at any zoom and screen size.
 * Nothing here creates repairs or bids: a tag marks what the tech saw, nothing more.
 */
import { z } from "zod";

import {
  footprintAreaSqFt,
  footprintLabel,
  footprintPolygons,
  project,
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

/** The JSON stored for a markup: validated, positions rounded to 1 cm (7 decimals). */
export function serializeMarkup(m: AerialMarkup): AerialMarkup {
  const out: AerialMarkup = {
    v: MARKUP_VERSION,
    center: roundLL(m.center),
    zoom: m.zoom,
    building: m.building,
    annotations: m.annotations.map((a) =>
      a.kind === "free" || a.kind === "line"
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

/** "1. Ponding — 3 in. deep at the NE drain" per tag, for the list and the PNG's legend. */
export function legendLines(annotations: Annotation[]): string[] {
  const n = tagNumbers(annotations);
  return annotations.flatMap((a) =>
    a.kind === "pin" ? [`${n.get(a.id)}. ${a.label}${a.note ? ` — ${a.note}` : ""}`] : [],
  );
}

/** One-line summary for the section header. */
export function markupSummary(annotations: Annotation[]): string {
  const tags = annotations.filter((a) => a.kind === "pin").length;
  const marks = annotations.length - tags;
  const parts = [
    tags ? `${tags} ${tags === 1 ? "tag" : "tags"}` : null,
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
const PIN_R = 13;
const LEGEND_LINE = 22;
const LEGEND_PAD = 10;
const LEGEND_MAX_LINES = 12;

/** Extra pixels under the picture for the tags' legend in the PNG. */
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

  // The footprint.
  const polys = footprintPolygons(markup.building?.footprint ?? null);
  ctx.strokeStyle = FOOTPRINT_STROKE;
  ctx.lineWidth = 3;
  for (const poly of polys)
    for (const ring of poly) {
      ctx.beginPath();
      ring.forEach((p, i) => {
        const [x, y] = at(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }

  // Lines first, then text, then tags on top.
  const order = { free: 0, line: 0, text: 1, pin: 2 } as const;
  const sorted = [...markup.annotations].sort((a, b) => order[a.kind] - order[b.kind]);
  const numbers = tagNumbers(markup.annotations);
  for (const a of sorted) {
    const color = colorHex(a.color);
    if (a.kind === "free" || a.kind === "line") {
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

  // Caption, top left.
  const area = footprintLabel(footprintAreaSqFt(polys));
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
  const lines = legendLines(markup.annotations);
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
      shown[LEGEND_MAX_LINES - 1] = `… and ${lines.length - LEGEND_MAX_LINES + 1} more tags`;
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

/**
 * Marks on a ticket photo (owner, Oct 1: "Ticket pictures need to be able to be annotated like
 * issues circled, text added etc, and those pictures need to be able to be exported if so
 * desired. This helps show what was wrong before on a repair job, and the pictures should be
 * able to be added to the invoice.").
 *
 * The marks — circle / ellipse, arrow, box, text and a numbered tag — are vector JSON stored on
 * the photo's row (service_job_photos.annotations, `{ v: 1, kind: "photo", marks: [...] }`).
 * The photo itself is never altered. Every position is normalized: 0..1 of the image's width
 * (u) and height (v) from its top-left corner, so the same marks draw on a thumbnail, in the
 * lightbox, on the exported PNG (canvas, natural size) and on the invoice PDF (pdf-lib, the
 * photo's box) — each render scales the stroke and the lettering to the picture's own size.
 *
 * An aerial row (role "aerial") keeps its own markup in the same column (aerial-markup.ts,
 * lng/lat); it is not a photo markup and parses to no marks here.
 *
 * Pure: no I/O, no DOM. The editor is components/service/photo-markup.tsx; the save is
 * savePhotoAnnotations (service-field.functions.ts); the PDF is invoices.server.ts.
 */
import { z } from "zod";

import { MARKUP_COLORS, TAG_LABEL_MAX, TAG_NOTE_MAX, TEXT_MAX } from "@/lib/aerial-markup";

export { TAG_LABEL_MAX, TAG_NOTE_MAX, TEXT_MAX };

// ── Schema ───────────────────────────────────────────────────────────────────────────────────

export const PHOTO_MARKS_VERSION = 1;

/** Red (the default), yellow and white: they read on a roof in sun or shade. */
export const PHOTO_COLORS = MARKUP_COLORS.filter(
  (c) => c.id === "red" || c.id === "yellow" || c.id === "white",
);
export type PhotoColor = "red" | "yellow" | "white";
export const DEFAULT_PHOTO_COLOR: PhotoColor = "red";
export const photoColorHex = (id: string): string =>
  PHOTO_COLORS.find((c) => c.id === id)?.hex ?? PHOTO_COLORS[0]!.hex;
/** [r, g, b] in 0..1 (the PDF's colour). */
export function photoColorRgb(id: string): [number, number, number] {
  const h = photoColorHex(id);
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(1), n(3), n(5)];
}

/** The roles that can be marked up (not a signature, not the aerial's own markup). */
export const ANNOTATABLE_ROLES = ["before", "after", "other"] as const;
export const isAnnotatableRole = (role: string): boolean =>
  (ANNOTATABLE_ROLES as readonly string[]).includes(role);

export const PHOTO_MARKS_MAX = 200;

const unit = z.number().finite().min(0).max(1);
const pt = z.tuple([unit, unit]);
const idSchema = z.string().min(1).max(40);
const colorSchema = z.enum(["red", "yellow", "white"]);

export const photoMarkSchema = z.discriminatedUnion("kind", [
  /** An ellipse (a circle when drawn square) inside the box from corner a to corner b. */
  z.object({ kind: z.literal("ellipse"), id: idSchema, color: colorSchema, a: pt, b: pt }),
  /** A box from corner a to corner b. */
  z.object({ kind: z.literal("rect"), id: idSchema, color: colorSchema, a: pt, b: pt }),
  /** An arrow from its tail a to its tip b (the head is at b). */
  z.object({ kind: z.literal("arrow"), id: idSchema, color: colorSchema, a: pt, b: pt }),
  /** Words starting at `at` (left edge, vertically centred). */
  z.object({
    kind: z.literal("text"),
    id: idSchema,
    color: colorSchema,
    at: pt,
    text: z.string().trim().min(1).max(TEXT_MAX),
  }),
  /** A numbered pin with a label (and a note, listed under the picture). */
  z.object({
    kind: z.literal("tag"),
    id: idSchema,
    color: colorSchema,
    at: pt,
    label: z.string().trim().min(1).max(TAG_LABEL_MAX),
    note: z.string().trim().max(TAG_NOTE_MAX).default(""),
  }),
]);
export type PhotoMark = z.output<typeof photoMarkSchema>;
export type PhotoMarkKind = PhotoMark["kind"];
export type Pt = [number, number];

export const photoMarksSchema = z.object({
  v: z.literal(PHOTO_MARKS_VERSION),
  kind: z.literal("photo"),
  marks: z.array(photoMarkSchema).max(PHOTO_MARKS_MAX),
});
export type PhotoMarks = z.output<typeof photoMarksSchema>;

/** The marks stored on a photo row; [] when there are none or the JSON is not a photo markup. */
export function parsePhotoMarks(raw: unknown): PhotoMark[] {
  const r = photoMarksSchema.safeParse(raw);
  return r.success ? r.data.marks : [];
}

/** Has this photo row any marks? (the thumbnail's "Marked" badge). */
export const isMarked = (raw: unknown): boolean => parsePhotoMarks(raw).length > 0;

/** 1e-4 of the width: under half a pixel on a 4,000 px photo. */
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const roundPt = (p: Pt): Pt => [r4(clamp01(p[0])), r4(clamp01(p[1]))];

/** One mark with its positions clamped to the picture and rounded (what is stored). */
export function roundMark(m: PhotoMark): PhotoMark {
  if (m.kind === "text" || m.kind === "tag") return { ...m, at: roundPt(m.at) };
  return { ...m, a: roundPt(m.a), b: roundPt(m.b) };
}

/** The JSON stored for the marks: validated and rounded; null when there are none. */
export function serializePhotoMarks(marks: PhotoMark[]): PhotoMarks | null {
  if (!marks.length) return null;
  return photoMarksSchema.parse({
    v: PHOTO_MARKS_VERSION,
    kind: "photo",
    marks: marks.map(roundMark),
  });
}

// ── Normalized ↔ image px ────────────────────────────────────────────────────────────────────

/** Image px (from the top-left) → normalized, clamped to the picture and rounded. */
export const toNorm = (p: Pt, w: number, h: number): Pt =>
  w > 0 && h > 0 ? roundPt([p[0] / w, p[1] / h]) : [0, 0];
/** Normalized → image px. */
export const fromNorm = (p: Pt, w: number, h: number): Pt => [p[0] * w, p[1] * h];

// ── Sizes: everything scales with the picture ────────────────────────────────────────────────

/** The line width: 0.6 % of the picture's long side (12 px on a 2,048 px photo). */
export const STROKE_FRAC = 0.006;
/** The lettering's height: 4 % of the long side. */
export const TEXT_FRAC = 0.04;
/** A tag's pin radius: 2.2 % of the long side. */
export const TAG_R_FRAC = 0.022;
/** A tap with the Circle or Box tool draws one this size (radius / half side, of the long side). */
export const TAP_SHAPE_FRAC = 0.06;

const longSide = (w: number, h: number) => Math.max(w, h);
export const strokeFor = (w: number, h: number) => Math.max(1.5, STROKE_FRAC * longSide(w, h));
export const textSizeFor = (w: number, h: number) => Math.max(8, TEXT_FRAC * longSide(w, h));
export const tagRadiusFor = (w: number, h: number) => Math.max(6, TAG_R_FRAC * longSide(w, h));

// ── Geometry (image px, origin top-left) ─────────────────────────────────────────────────────

type BoxMark = Extract<PhotoMark, { kind: "ellipse" | "rect" | "arrow" }>;
type AtMark = Extract<PhotoMark, { kind: "text" | "tag" }>;
export type TagMark = Extract<PhotoMark, { kind: "tag" }>;

export function ellipseGeom(m: BoxMark, w: number, h: number) {
  const [x0, y0] = fromNorm(m.a, w, h);
  const [x1, y1] = fromNorm(m.b, w, h);
  return {
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    rx: Math.abs(x1 - x0) / 2,
    ry: Math.abs(y1 - y0) / 2,
  };
}

export function rectGeom(m: BoxMark, w: number, h: number) {
  const [x0, y0] = fromNorm(m.a, w, h);
  const [x1, y1] = fromNorm(m.b, w, h);
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** The head's length in strokes, and its half-angle. */
const HEAD_LEN = 4.5;
const HEAD_HALF_ANGLE = (28 * Math.PI) / 180;

/**
 * An arrow in image px: the shaft from the tail to the head's base, and the head (a filled
 * triangle: the tip and its two back corners). The head is HEAD_LEN strokes long, or 60 % of a
 * short arrow; the shaft stops at the head's base so the tip stays sharp.
 */
export function arrowGeom(m: BoxMark, w: number, h: number, stroke = strokeFor(w, h)) {
  const tail = fromNorm(m.a, w, h);
  const tip = fromNorm(m.b, w, h);
  const dx = tip[0] - tail[0];
  const dy = tip[1] - tail[1];
  const len = Math.hypot(dx, dy);
  const ux = len ? dx / len : 1;
  const uy = len ? dy / len : 0;
  const head = Math.min(HEAD_LEN * stroke, len * 0.6);
  const back = head * Math.cos(HEAD_HALF_ANGLE);
  const half = head * Math.sin(HEAD_HALF_ANGLE);
  const base: Pt = [tip[0] - ux * back, tip[1] - uy * back];
  const left: Pt = [base[0] + uy * half, base[1] - ux * half];
  const right: Pt = [base[0] - uy * half, base[1] + ux * half];
  return { tail, tip, base, left, right, length: len };
}

/** An SVG path through image px ("M x y L x y …"), one decimal; `close` adds Z. */
export function pathD(pts: Pt[], close = false): string {
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
  return close ? `${d.join(" ")} Z` : d.join(" ");
}

/** The arrow's head as an SVG path (a closed triangle). */
export function arrowHeadPath(m: BoxMark, w: number, h: number): string {
  const g = arrowGeom(m, w, h);
  return pathD([g.tip, g.left, g.right], true);
}

/** About how wide bold sans lettering is per character, in heights. */
export const CHAR_W = 0.6;

/** A text mark's box (image px): from `at`, vertically centred, about CHAR_W per character. */
export function textBox(m: Extract<PhotoMark, { kind: "text" }>, w: number, h: number) {
  const size = textSizeFor(w, h);
  const [x, y] = fromNorm(m.at, w, h);
  return { x, y: y - size / 2, w: Math.max(size, m.text.length * size * CHAR_W), h: size };
}

/** A tag's pin centre and radius, and its label's box to the right of the pin (image px). */
export function tagGeom(m: TagMark, w: number, h: number) {
  const r = tagRadiusFor(w, h);
  const size = textSizeFor(w, h) * 0.8;
  const [x, y] = fromNorm(m.at, w, h);
  return {
    x,
    y,
    r,
    labelSize: size,
    label: { x: x + r * 1.3, y: y - size / 2, w: m.label.length * size * CHAR_W, h: size },
  };
}

// ── Hit-testing ──────────────────────────────────────────────────────────────────────────────

const inBox = (p: Pt, b: { x: number; y: number; w: number; h: number }, pad: number) =>
  p[0] >= b.x - pad && p[0] <= b.x + b.w + pad && p[1] >= b.y - pad && p[1] <= b.y + b.h + pad;

/** Distance from p to the segment a–b. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Is p on the mark's line (outline, shaft, words, pin) within `tol` image px? */
function onOutline(m: PhotoMark, p: Pt, w: number, h: number, tol: number): boolean {
  const sw = strokeFor(w, h);
  switch (m.kind) {
    case "ellipse": {
      const g = ellipseGeom(m, w, h);
      const rx = Math.max(g.rx, 1e-6);
      const ry = Math.max(g.ry, 1e-6);
      const k = Math.hypot((p[0] - g.cx) / rx, (p[1] - g.cy) / ry);
      // Radial distance from the outline, in px along the nearer axis (exact on a circle).
      return Math.abs(k - 1) * Math.min(rx, ry) <= tol + sw / 2;
    }
    case "rect": {
      const g = rectGeom(m, w, h);
      const c: Pt[] = [
        [g.x, g.y],
        [g.x + g.w, g.y],
        [g.x + g.w, g.y + g.h],
        [g.x, g.y + g.h],
      ];
      return c.some((q, i) => distToSegment(p, q, c[(i + 1) % 4]!) <= tol + sw / 2);
    }
    case "arrow": {
      const g = arrowGeom(m, w, h, sw);
      return distToSegment(p, g.tail, g.tip) <= tol + sw;
    }
    case "text":
      return inBox(p, textBox(m, w, h), tol);
    case "tag": {
      const g = tagGeom(m, w, h);
      return Math.hypot(p[0] - g.x, p[1] - g.y) <= g.r + tol || inBox(p, g.label, tol);
    }
  }
}

/** Is p inside a closed shape (ellipse, box)? */
function inside(m: PhotoMark, p: Pt, w: number, h: number): boolean {
  if (m.kind === "ellipse") {
    const g = ellipseGeom(m, w, h);
    if (g.rx <= 0 || g.ry <= 0) return false;
    return ((p[0] - g.cx) / g.rx) ** 2 + ((p[1] - g.cy) / g.ry) ** 2 <= 1;
  }
  if (m.kind === "rect") return inBox(p, rectGeom(m, w, h), 0);
  return false;
}

/**
 * The mark under the pointer `p` (image px), or null. The topmost (last drawn) wins; a mark's
 * own line beats the inside of a circle or a box drawn over it, so an arrow inside a circle is
 * still the arrow. `tol` is in image px (the editor passes about 10 screen px).
 */
export function hitTest(
  marks: PhotoMark[],
  p: Pt,
  w: number,
  h: number,
  tol: number,
): string | null {
  for (let i = marks.length - 1; i >= 0; i--)
    if (onOutline(marks[i]!, p, w, h, tol)) return marks[i]!.id;
  for (let i = marks.length - 1; i >= 0; i--) if (inside(marks[i]!, p, w, h)) return marks[i]!.id;
  return null;
}

// ── Editing: add / move / remove / undo / clear ─────────────────────────────────────────────

const markPoints = (m: PhotoMark): Pt[] =>
  m.kind === "text" || m.kind === "tag" ? [m.at] : [m.a, m.b];

/** The mark moved by (du, dv), held inside the picture (its points never leave 0..1). */
export function moveMark(m: PhotoMark, du: number, dv: number): PhotoMark {
  const pts = markPoints(m);
  const minU = Math.min(...pts.map((p) => p[0]));
  const maxU = Math.max(...pts.map((p) => p[0]));
  const minV = Math.min(...pts.map((p) => p[1]));
  const maxV = Math.max(...pts.map((p) => p[1]));
  const cu = Math.min(1 - maxU, Math.max(-minU, du));
  const cv = Math.min(1 - maxV, Math.max(-minV, dv));
  const sh = (p: Pt): Pt => [p[0] + cu, p[1] + cv];
  return roundMark(
    m.kind === "text" || m.kind === "tag"
      ? { ...m, at: sh(m.at) }
      : { ...m, a: sh(m.a), b: sh(m.b) },
  );
}

export interface PhotoMarksHistory {
  marks: PhotoMark[];
  /** Earlier states, newest last; Undo pops one. Clear and moves are undoable too. */
  past: PhotoMark[][];
}
export type PhotoMarksAction =
  | { type: "add"; mark: PhotoMark }
  | { type: "move"; id: string; du: number; dv: number }
  | { type: "remove"; id: string }
  | { type: "undo" }
  | { type: "clear" }
  | { type: "load"; marks: PhotoMark[] };

const PAST_MAX = 100;
export const emptyPhotoHistory = (marks: PhotoMark[] = []): PhotoMarksHistory => ({
  marks,
  past: [],
});

export function photoMarksReducer(s: PhotoMarksHistory, a: PhotoMarksAction): PhotoMarksHistory {
  const push = (next: PhotoMark[]): PhotoMarksHistory => ({
    marks: next,
    past: [...s.past, s.marks].slice(-PAST_MAX),
  });
  switch (a.type) {
    case "add":
      if (s.marks.length >= PHOTO_MARKS_MAX) return s;
      return push([...s.marks, roundMark(a.mark)]);
    case "move": {
      if (!a.du && !a.dv) return s;
      const i = s.marks.findIndex((m) => m.id === a.id);
      if (i < 0) return s;
      const moved = moveMark(s.marks[i]!, a.du, a.dv);
      return push(s.marks.map((m, k) => (k === i ? moved : m)));
    }
    case "remove":
      return s.marks.some((m) => m.id === a.id) ? push(s.marks.filter((m) => m.id !== a.id)) : s;
    case "clear":
      return s.marks.length ? push([]) : s;
    case "undo":
      if (!s.past.length) return s;
      return { marks: s.past[s.past.length - 1]!, past: s.past.slice(0, -1) };
    case "load":
      return emptyPhotoHistory(a.marks);
  }
}

/**
 * A finished drag of the Circle / Box / Arrow tool (normalized corners), or null when it was a
 * tap: then a circle or a box of TAP_SHAPE_FRAC around the point (a thumb on a phone cannot
 * drag a neat circle), and no arrow (an arrow needs a direction). `minPx` is the drag in image
 * px below which it counts as a tap.
 */
export function shapeFromDrag(
  kind: "ellipse" | "rect" | "arrow",
  a: Pt,
  b: Pt,
  w: number,
  h: number,
  minPx: number,
): { a: Pt; b: Pt } | null {
  const [ax, ay] = fromNorm(a, w, h);
  const [bx, by] = fromNorm(b, w, h);
  if (Math.hypot(bx - ax, by - ay) >= minPx) return { a: roundPt(a), b: roundPt(b) };
  if (kind === "arrow") return null;
  const r = TAP_SHAPE_FRAC * longSide(w, h);
  return { a: toNorm([ax - r, ay - r], w, h), b: toNorm([ax + r, ay + r], w, h) };
}

// ── Lists and labels ─────────────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<PhotoMarkKind, string> = {
  ellipse: "Circle",
  rect: "Box",
  arrow: "Arrow",
  text: "Text",
  tag: "Tag",
};
export const markKindLabel = (k: PhotoMarkKind) => KIND_LABEL[k];

/** Tags are numbered 1, 2, … in the order they were placed (the number is on the pin). */
export function photoTagNumbers(marks: PhotoMark[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of marks) if (m.kind === "tag") out.set(m.id, out.size + 1);
  return out;
}

/** The list under the picture: one row per mark, in drawing order. */
export function markRows(marks: PhotoMark[]): { mark: PhotoMark; text: string }[] {
  const tags = photoTagNumbers(marks);
  const count: Partial<Record<PhotoMarkKind, number>> = {};
  return marks.map((m) => {
    const n = (count[m.kind] = (count[m.kind] ?? 0) + 1);
    if (m.kind === "text") return { mark: m, text: `“${m.text}”` };
    if (m.kind === "tag")
      return { mark: m, text: `${tags.get(m.id)}. ${m.label}${m.note ? ` — ${m.note}` : ""}` };
    return { mark: m, text: `${KIND_LABEL[m.kind]} ${n}` };
  });
}

/** "3 marks" / "1 mark" / "no marks". */
export function marksSummary(marks: PhotoMark[]): string {
  const n = marks.length;
  return n ? `${n} ${n === 1 ? "mark" : "marks"}` : "no marks";
}

/** A short unique id for a mark. */
export const newMarkId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ── Zoom and pan (the editor's view: a part of the picture, image px) ───────────────────────

export interface PhotoView {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const PHOTO_MAX_ZOOM = 6;
export const fullView = (w: number, h: number): PhotoView => ({ x: 0, y: 0, w, h });
/** How far in the view is (1 = the whole picture). */
export const viewZoom = (v: PhotoView, w: number): number => (v.w > 0 ? w / v.w : 1);

function clampView(v: PhotoView, w: number, h: number): PhotoView {
  const vw = Math.min(w, Math.max(w / PHOTO_MAX_ZOOM, v.w));
  const vh = (vw * h) / w;
  return {
    x: Math.min(w - vw, Math.max(0, v.x)),
    y: Math.min(h - vh, Math.max(0, v.y)),
    w: vw,
    h: vh,
  };
}

/** Zoom by `factor` (2 = in, 0.5 = out) about `at` (image px; the view's centre by default). */
export function zoomPhotoView(
  v: PhotoView,
  w: number,
  h: number,
  factor: number,
  at?: Pt,
): PhotoView {
  const [cx, cy] = at ?? [v.x + v.w / 2, v.y + v.h / 2];
  const nw = v.w / factor;
  const nh = v.h / factor;
  // The point under `at` stays where it was on screen.
  const fx = v.w ? (cx - v.x) / v.w : 0.5;
  const fy = v.h ? (cy - v.y) / v.h : 0.5;
  return clampView({ x: cx - fx * nw, y: cy - fy * nh, w: nw, h: nh }, w, h);
}

/** Move the view by (dx, dy) image px (a drag of the picture moves the view the other way). */
export const panPhotoView = (v: PhotoView, w: number, h: number, dx: number, dy: number) =>
  clampView({ ...v, x: v.x - dx, y: v.y - dy }, w, h);

// ── Export: file names and the canvas painter ────────────────────────────────────────────────

/** Each photo's number among the ticket's photos of its role (1, 2, …, oldest first). */
export function photoOrdinals(
  photos: { id: string; role: string; created_at: string }[],
): Map<string, number> {
  const seen: Record<string, number> = {};
  const out = new Map<string, number>();
  for (const p of [...photos].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    seen[p.role] = (seen[p.role] ?? 0) + 1;
    out.set(p.id, seen[p.role]!);
  }
  return out;
}

/** "6012-before-1.png": the ticket number, the role and the photo's number. */
export function photoFileName(
  ticket: string | number | null | undefined,
  role: string,
  n: number,
  ext = "png",
): string {
  const t = String(ticket ?? "").replace(/[^A-Za-z0-9.-]/g, "") || "ticket";
  const r = role.replace(/[^a-z]/gi, "").toLowerCase() || "photo";
  const e = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
  return `${t}-${r}-${n}.${e}`;
}

/** The extension of a stored object ("…/123-abc.jpeg" → "jpg"), for an unmarked download. */
export function photoExt(storagePath: string): string {
  const e = (storagePath.split(".").pop() ?? "").toLowerCase();
  return e === "jpeg" ? "jpg" : /^(jpg|png|webp|heic)$/.test(e) ? e : "jpg";
}

/** The part of CanvasRenderingContext2D the painter uses (a test passes a recorder). */
export interface PhotoPaint2D {
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
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  stroke(): void;
  fill(): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
}

/** The dark edge under every line and letter, so red, yellow and white read on any roof. */
export const HALO = "rgba(0,0,0,0.6)";

/** Draw the marks over a picture already on the canvas, which is `w` × `h` px. */
export function paintPhotoMarks(ctx: PhotoPaint2D, marks: PhotoMark[], w: number, h: number) {
  const sw = strokeFor(w, h);
  const tags = photoTagNumbers(marks);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const strokeTwice = (color: string) => {
    ctx.strokeStyle = HALO;
    ctx.lineWidth = sw * 1.8;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = sw;
    ctx.stroke();
  };
  const words = (text: string, x: number, y: number, size: number, color: string) => {
    ctx.font = `bold ${Math.round(size)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(2, size * 0.18);
    ctx.strokeStyle = HALO;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  for (const m of marks) {
    const color = photoColorHex(m.color);
    if (m.kind === "ellipse") {
      const g = ellipseGeom(m, w, h);
      ctx.beginPath();
      ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, Math.PI * 2);
      strokeTwice(color);
    } else if (m.kind === "rect") {
      const g = rectGeom(m, w, h);
      ctx.beginPath();
      ctx.rect(g.x, g.y, g.w, g.h);
      strokeTwice(color);
    } else if (m.kind === "arrow") {
      const g = arrowGeom(m, w, h, sw);
      ctx.beginPath();
      ctx.moveTo(g.tail[0], g.tail[1]);
      ctx.lineTo(g.base[0], g.base[1]);
      strokeTwice(color);
      ctx.beginPath();
      ctx.moveTo(g.tip[0], g.tip[1]);
      ctx.lineTo(g.left[0], g.left[1]);
      ctx.lineTo(g.right[0], g.right[1]);
      ctx.closePath();
      ctx.strokeStyle = HALO;
      ctx.lineWidth = sw * 0.8;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fill();
    } else if (m.kind === "text") {
      const [x, y] = fromNorm(m.at, w, h);
      words(m.text, x, y, textSizeFor(w, h), color);
    } else {
      const g = tagGeom(m, w, h);
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(1, sw / 3);
      ctx.stroke();
      ctx.font = `bold ${Math.round(g.r * 1.1)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = m.color === "red" ? "#ffffff" : "#000000";
      ctx.fillText(String(tags.get(m.id) ?? ""), g.x, g.y);
      words(m.label, g.label.x, g.y, g.labelSize, "#ffffff");
    }
  }
  ctx.restore();
}

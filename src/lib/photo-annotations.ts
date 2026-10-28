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
 * Rotation (owner, Oct 28: "allow rotation of photos on markup"): `rotation` on the same JSON
 * (0 / 90 / 180 / 270, clockwise; written only when it is not 0) says which way the picture is
 * shown. The marks stay in the unturned picture's own space, so old marks keep their place; every
 * render turns the picture and the marks together (rotatedBox, rotationMatrix /
 * rotationTransform for SVG and canvas, pdfImagePlacement for pdf-lib) and the editor maps a
 * pointer in the turned view back into the picture (unrotatePoint). The file is still never
 * altered; Download flattens the turned picture and its marks.
 *
 * Owner, Oct 28, later that day: two more colours (blue, black — PHOTO_COLORS, with a light halo
 * under black: haloFor), a mark's own turn (`rot`, whole clockwise degrees about its centre, on a
 * circle, a box or a text; markCentre, rotateAbout, rotatedBounds, toMarkFrame; the editor's
 * rotate handle snaps to 15°: snapRot) and a text's background (`fill`: a solid rounded box,
 * textFillBox / textFillColor). Both are optional on the JSON and left out when 0 / off, so an
 * older mark is unchanged and draws as it did.
 *
 * An aerial row (role "aerial") keeps its own markup in the same column (aerial-markup.ts,
 * lng/lat); it is not a photo markup and parses to no marks here.
 *
 * Pure: no I/O, no DOM. The editor is components/service/photo-markup.tsx; the save is
 * savePhotoAnnotations (service-field.functions.ts); the PDF is invoices.server.ts.
 */
import { z } from "zod";

import { TAG_LABEL_MAX, TAG_NOTE_MAX, TEXT_MAX } from "@/lib/aerial-markup";

export { TAG_LABEL_MAX, TAG_NOTE_MAX, TEXT_MAX };

// ── Schema ───────────────────────────────────────────────────────────────────────────────────

export const PHOTO_MARKS_VERSION = 1;

/**
 * Red (the default), yellow and white read on a roof in sun or shade; blue and black (owner,
 * Oct 28: "we need two more colors a blue and a black") joined them. Red, yellow, white and blue
 * are the Aerial's hexes (aerial-markup.ts MARKUP_COLORS); black is the photo markup's own, so
 * the Aerial's swatches are untouched.
 */
export const PHOTO_COLORS = [
  { id: "red", hex: "#ef4444", label: "Red" },
  { id: "yellow", hex: "#facc15", label: "Yellow" },
  { id: "white", hex: "#ffffff", label: "White" },
  { id: "blue", hex: "#3b82f6", label: "Blue" },
  { id: "black", hex: "#000000", label: "Black" },
] as const;
export type PhotoColor = (typeof PHOTO_COLORS)[number]["id"];
const PHOTO_COLOR_IDS = PHOTO_COLORS.map((c) => c.id) as [PhotoColor, ...PhotoColor[]];
export const DEFAULT_PHOTO_COLOR: PhotoColor = "red";
export const photoColorHex = (id: string): string =>
  PHOTO_COLORS.find((c) => c.id === id)?.hex ?? PHOTO_COLORS[0].hex;
/** "#rrggbb" → [r, g, b] in 0..1 (the PDF's colour). */
export function hexRgb(h: string): [number, number, number] {
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(1), n(3), n(5)];
}
/** [r, g, b] in 0..1 (the PDF's colour). */
export const photoColorRgb = (id: string): [number, number, number] => hexRgb(photoColorHex(id));

// ── Readability: the halo, the tag's number, the text's background ──────────────────────────

/** The dark edge under every line and letter, so red, yellow, white and blue read on any roof. */
export const HALO = "rgba(0,0,0,0.6)";
/** The light edge under a black mark (a dark halo would swallow it). */
export const LIGHT_HALO = "rgba(255,255,255,0.75)";
/** Does this colour take the light halo (black does; every other colour the dark one)? */
export const isLightHalo = (color: string): boolean => color === "black";
/** The halo (CSS rgba) behind a mark of this colour: light under black, dark under the rest. */
export const haloFor = (color: string): string => (isLightHalo(color) ? LIGHT_HALO : HALO);
/** The same halo for pdf-lib: its colour in 0..1 and its opacity. */
export const haloPdf = (color: string): { rgb: [number, number, number]; alpha: number } =>
  isLightHalo(color) ? { rgb: [1, 1, 1], alpha: 0.75 } : { rgb: [0, 0, 0], alpha: 0.6 };
/** The number on a tag's pin: white on red, blue and black; black on yellow and white. */
export const tagNumberColor = (color: string): "#ffffff" | "#000000" =>
  color === "yellow" || color === "white" ? "#000000" : "#ffffff";
/** A text's background when it has one: black behind white and yellow words, white behind the rest. */
export const textFillColor = (color: string): "#ffffff" | "#000000" =>
  color === "yellow" || color === "white" ? "#000000" : "#ffffff";
/** The background's padding around the words, and its corner radius, in font sizes. */
export const TEXT_FILL_PAD = 0.25;

/** The roles that can be marked up (not a signature, not the aerial's own markup). */
export const ANNOTATABLE_ROLES = ["before", "after", "other"] as const;
export const isAnnotatableRole = (role: string): boolean =>
  (ANNOTATABLE_ROLES as readonly string[]).includes(role);

export const PHOTO_MARKS_MAX = 200;

const unit = z.number().finite().min(0).max(1);
const pt = z.tuple([unit, unit]);
const idSchema = z.string().min(1).max(40);
const colorSchema = z.enum(PHOTO_COLOR_IDS);
/**
 * A shape's or a text's own turn (owner, Oct 28: "rotate the shapes/textboxes"): whole degrees
 * clockwise about the mark's centre; absent (an older mark, or never turned) means 0. Arrows
 * point any way already and a tag's pin is round, so neither takes one (a `rot` on them is
 * dropped by the parse).
 */
const rotSchema = z.number().int().min(0).max(359).optional();

export const photoMarkSchema = z.discriminatedUnion("kind", [
  /** An ellipse (a circle when drawn square) inside the box from corner a to corner b. */
  z.object({
    kind: z.literal("ellipse"),
    id: idSchema,
    color: colorSchema,
    a: pt,
    b: pt,
    rot: rotSchema,
  }),
  /** A box from corner a to corner b. */
  z.object({
    kind: z.literal("rect"),
    id: idSchema,
    color: colorSchema,
    a: pt,
    b: pt,
    rot: rotSchema,
  }),
  /** An arrow from its tail a to its tip b (the head is at b). */
  z.object({ kind: z.literal("arrow"), id: idSchema, color: colorSchema, a: pt, b: pt }),
  /**
   * Words starting at `at` (left edge, vertically centred); `fill` (owner, Oct 28: "fill the
   * textboxes with a background") puts a solid box behind them (textFillColor), absent = off.
   */
  z.object({
    kind: z.literal("text"),
    id: idSchema,
    color: colorSchema,
    at: pt,
    text: z.string().trim().min(1).max(TEXT_MAX),
    rot: rotSchema,
    fill: z.boolean().optional(),
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
/** The marks that turn about their centre (the rotate handle): a circle, a box, a text. */
export type TurnableMark = Extract<PhotoMark, { kind: "ellipse" | "rect" | "text" }>;
export const canTurn = (m: PhotoMark): m is TurnableMark =>
  m.kind === "ellipse" || m.kind === "rect" || m.kind === "text";
/** A mark's own turn in clockwise degrees; 0 for an older mark, an arrow or a tag. */
export const markRot = (m: PhotoMark): number => (canTurn(m) ? (m.rot ?? 0) : 0);
/** Has this text a background behind its words? (false for an older text, and for anything else). */
export const markFill = (m: PhotoMark): boolean => m.kind === "text" && m.fill === true;
/** Any number of degrees → a whole 0..359 (an older mark's absent `rot` is 0). */
export const normalizeRot = (deg: number): number =>
  ((Math.round(Number.isFinite(deg) ? deg : 0) % 360) + 360) % 360;
/** The rotate handle's snap: the nearest multiple of 15° when within 4° of it, else the degree itself. */
export const ROT_SNAP_STEP = 15;
export const ROT_SNAP_WITHIN = 4;
export function snapRot(deg: number): number {
  const d = normalizeRot(deg);
  const near = Math.round(d / ROT_SNAP_STEP) * ROT_SNAP_STEP;
  return normalizeRot(Math.abs(d - near) <= ROT_SNAP_WITHIN ? near : d);
}

/** Which way the picture is shown: turned clockwise by 0, 90, 180 or 270 degrees. */
export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];
const rotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);

export const photoMarksSchema = z.object({
  v: z.literal(PHOTO_MARKS_VERSION),
  kind: z.literal("photo"),
  marks: z.array(photoMarkSchema).max(PHOTO_MARKS_MAX),
  /** Clockwise degrees the picture is shown turned by; absent when 0 (serializePhotoMarks). */
  rotation: rotationSchema.optional(),
});
export type PhotoMarks = z.output<typeof photoMarksSchema>;

/** What a photo row's JSON holds: its marks and its rotation. */
export interface PhotoMarkup {
  marks: PhotoMark[];
  rotation: Rotation;
}
/** The marks and the rotation stored on a photo row; none / 0 when the JSON is not a photo markup. */
export function parsePhotoMarkup(raw: unknown): PhotoMarkup {
  const r = photoMarksSchema.safeParse(raw);
  return r.success
    ? { marks: r.data.marks, rotation: r.data.rotation ?? 0 }
    : { marks: [], rotation: 0 };
}
/** The marks stored on a photo row; [] when there are none or the JSON is not a photo markup. */
export const parsePhotoMarks = (raw: unknown): PhotoMark[] => parsePhotoMarkup(raw).marks;
/** How the photo is shown turned; 0 when it is not (or the JSON is not a photo markup). */
export const parsePhotoRotation = (raw: unknown): Rotation => parsePhotoMarkup(raw).rotation;

/** Has this photo row any marks? (the thumbnail's "Marked" badge). */
export const isMarked = (raw: unknown): boolean => parsePhotoMarks(raw).length > 0;

/** 1e-4 of the width: under half a pixel on a 4,000 px photo. */
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const roundPt = (p: Pt): Pt => [r4(clamp01(p[0])), r4(clamp01(p[1]))];

/**
 * One mark with its positions clamped to the picture and rounded (what is stored). A turn of 0
 * and a background that is off are left out (no key), so a mark that was never turned or filled
 * is stored exactly as before these existed.
 */
export function roundMark(m: PhotoMark): PhotoMark {
  if (m.kind === "tag") return { ...m, at: roundPt(m.at) };
  if (m.kind === "arrow") return { ...m, a: roundPt(m.a), b: roundPt(m.b) };
  const { rot: rawRot, ...rest } = m;
  const rot = normalizeRot(rawRot ?? 0);
  const turned = rot ? { ...rest, rot } : rest;
  if (turned.kind === "text") {
    const { fill, ...t } = turned;
    return { ...(fill ? { ...t, fill: true } : t), at: roundPt(t.at) };
  }
  return { ...turned, a: roundPt(turned.a), b: roundPt(turned.b) };
}

/**
 * The JSON stored for the marks and the rotation: validated and rounded; null when there are no
 * marks and the picture is not turned. `rotation` is written only when it is not 0 (no key, not
 * an undefined one), so an unturned photo's JSON is exactly what it was before rotation existed.
 */
export function serializePhotoMarks(marks: PhotoMark[], rotation: Rotation = 0): PhotoMarks | null {
  if (!marks.length && !rotation) return null;
  return photoMarksSchema.parse({
    v: PHOTO_MARKS_VERSION,
    kind: "photo",
    marks: marks.map(roundMark),
    ...(rotation ? { rotation } : {}),
  });
}

// ── Rotation: the picture turned, the marks still in its own space ──────────────────────────

/** A quarter turn from `r`: to the right (by 1, clockwise) or to the left (by -1). */
export const turnRotation = (r: Rotation, by: 1 | -1): Rotation =>
  ((((r + by * 90) % 360) + 360) % 360) as Rotation;

/** The box a w × h picture takes once turned: the sides swap at 90 and 270. */
export const rotatedBox = (w: number, h: number, rotation: Rotation): { w: number; h: number } =>
  rotation === 90 || rotation === 270 ? { w: h, h: w } : { w, h };

/**
 * The transform that turns the w × h picture (its own px, top-left origin, y down) into its
 * rotated box (rotatedBox): a shift, then a clockwise turn about the origin — SVG
 * `translate(tx ty) rotate(deg)`, canvas `translate(tx, ty); rotate(deg)`. The picture is drawn
 * at (0, 0) inside it, and so are its marks (the same geometry as unturned).
 */
export function rotationMatrix(
  w: number,
  h: number,
  rotation: Rotation,
): { tx: number; ty: number; deg: Rotation } {
  switch (rotation) {
    case 90:
      return { tx: h, ty: 0, deg: 90 };
    case 180:
      return { tx: w, ty: h, deg: 180 };
    case 270:
      return { tx: 0, ty: w, deg: 270 };
    default:
      return { tx: 0, ty: 0, deg: 0 };
  }
}

/** rotationMatrix as an SVG `transform` attribute; "" when the picture is not turned. */
export function rotationTransform(w: number, h: number, rotation: Rotation): string {
  if (!rotation) return "";
  const m = rotationMatrix(w, h, rotation);
  return `translate(${m.tx} ${m.ty}) rotate(${m.deg})`;
}

/** A point of the turned view (px of rotatedBox(w, h)) → the same spot in the picture's own px. */
export function unrotatePoint(p: Pt, w: number, h: number, rotation: Rotation): Pt {
  const [x, y] = p;
  switch (rotation) {
    case 90:
      return [y, h - x];
    case 180:
      return [w - x, h - y];
    case 270:
      return [w - y, x];
    default:
      return [x, y];
  }
}

/** A point in the picture's own px → where it shows in the turned view (the inverse of unrotatePoint). */
export function rotatePoint(p: Pt, w: number, h: number, rotation: Rotation): Pt {
  const [x, y] = p;
  switch (rotation) {
    case 90:
      return [h - y, x];
    case 180:
      return [w - x, h - y];
    case 270:
      return [y, w - x];
    default:
      return [x, y];
  }
}

/**
 * Where pdf-lib draws the turned picture so it fills `box` (points; x, y its bottom-left, w × h
 * the turned box, i.e. rotatedBox of the picture scaled): drawImage's x, y, width and height
 * (the picture's own sides) and `rotate` in degrees — counter-clockwise as pdf-lib counts on
 * its y-up page, about the image's (x, y). The same shift and turn, as a transformation
 * matrix, put the marks over it (drawPhoto, invoices.server.ts).
 */
export function pdfImagePlacement(
  box: { x: number; y: number; w: number; h: number },
  rotation: Rotation,
): { x: number; y: number; width: number; height: number; rotate: number } {
  switch (rotation) {
    case 90:
      return { x: box.x, y: box.y + box.h, width: box.h, height: box.w, rotate: -90 };
    case 180:
      return { x: box.x + box.w, y: box.y + box.h, width: box.w, height: box.h, rotate: 180 };
    case 270:
      return { x: box.x + box.w, y: box.y, width: box.h, height: box.w, rotate: 90 };
    default:
      return { x: box.x, y: box.y, width: box.w, height: box.h, rotate: 0 };
  }
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

/**
 * A text's background box (image px): textBox padded by TEXT_FILL_PAD of the font size on every
 * side, its corners rounded by the same; `textScale` draws it for lettering that much larger
 * (the editor on a phone), growing from the left edge like the words.
 */
export function textFillBox(
  m: Extract<PhotoMark, { kind: "text" }>,
  w: number,
  h: number,
  textScale = 1,
) {
  const b = textBox(m, w, h);
  const size = b.h * textScale;
  const pad = size * TEXT_FILL_PAD;
  const grow = b.h * (textScale - 1);
  return {
    x: b.x - pad,
    y: b.y - grow / 2 - pad,
    w: b.w * textScale + 2 * pad,
    h: size + 2 * pad,
    r: pad,
  };
}

// ── A mark's own turn: about its centre ──────────────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The point a turnable mark turns about (image px): a circle's or a box's centre, a text's box
 * centre (the box as drawn, `textScale` larger on a phone). Null for an arrow or a tag.
 */
export function markCentre(m: PhotoMark, w: number, h: number, textScale = 1): Pt | null {
  if (m.kind === "ellipse" || m.kind === "rect") {
    const g = rectGeom(m, w, h);
    return [g.x + g.w / 2, g.y + g.h / 2];
  }
  if (m.kind === "text") {
    const b = textBox(m, w, h);
    return [b.x + (b.w * textScale) / 2, b.y + b.h / 2];
  }
  return null;
}

/** `p` turned by `deg` (clockwise, y down) about `c`. */
export function rotateAbout(p: Pt, c: Pt, deg: number): Pt {
  if (!deg) return p;
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos];
}

/** The box that holds `b` once turned by `deg` about `c` (its four corners' bounds). */
export function rotatedBounds(b: Box, c: Pt, deg: number): Box {
  if (!deg) return b;
  const corners: Pt[] = (
    [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h],
      [b.x, b.y + b.h],
    ] as Pt[]
  ).map((p) => rotateAbout(p, c, deg));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * The pointer `p` carried into the mark's own, unturned frame (turned back about the mark's
 * centre), so the unturned outline test tells whether it is on the turned mark. `p` itself for
 * a mark that is not turned.
 */
export function toMarkFrame(m: PhotoMark, p: Pt, w: number, h: number): Pt {
  const rot = markRot(m);
  if (!rot) return p;
  const c = markCentre(m, w, h);
  return c ? rotateAbout(p, c, -rot) : p;
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

/**
 * Is p on the mark's line (outline, shaft, words, pin) within `tol` image px? A turned mark is
 * tested in its own frame (toMarkFrame), so the hit follows the turned outline.
 */
function onOutline(m: PhotoMark, at: Pt, w: number, h: number, tol: number): boolean {
  const sw = strokeFor(w, h);
  const p = toMarkFrame(m, at, w, h);
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

/** Is p inside a closed shape (ellipse, box)? A turned one is tested in its own frame. */
function inside(m: PhotoMark, at: Pt, w: number, h: number): boolean {
  const p = toMarkFrame(m, at, w, h);
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

/** The mark moved by (du, dv), held inside the picture (its points never leave 0..1); its turn and background stay. */
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
  /** Which way the picture is shown turned (the marks stay in its own space). */
  rotation: Rotation;
  /**
   * Earlier states, newest last; Undo pops one. Clear, moves, a mark's turn or background and
   * the picture's turns are undoable too.
   */
  past: PhotoMarkup[];
}
export type PhotoMarksAction =
  | { type: "add"; mark: PhotoMark }
  | { type: "move"; id: string; du: number; dv: number }
  | { type: "remove"; id: string }
  | { type: "undo" }
  | { type: "clear" }
  /** A quarter turn of the picture: by 1 to the right (clockwise), by -1 to the left. */
  | { type: "rotate"; by: 1 | -1 }
  /** One mark's own turn (a circle, a box, a text), to `rot` clockwise degrees about its centre. */
  | { type: "turn"; id: string; rot: number }
  /** A text's background on or off. */
  | { type: "fill"; id: string; fill: boolean }
  | { type: "load"; marks: PhotoMark[]; rotation?: Rotation | undefined };

const PAST_MAX = 100;
export const emptyPhotoHistory = (
  marks: PhotoMark[] = [],
  rotation: Rotation = 0,
): PhotoMarksHistory => ({
  marks,
  rotation,
  past: [],
});

export function photoMarksReducer(s: PhotoMarksHistory, a: PhotoMarksAction): PhotoMarksHistory {
  const push = (next: PhotoMark[], rotation: Rotation = s.rotation): PhotoMarksHistory => ({
    marks: next,
    rotation,
    past: [...s.past, { marks: s.marks, rotation: s.rotation }].slice(-PAST_MAX),
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
    case "rotate":
      return push(s.marks, turnRotation(s.rotation, a.by));
    case "turn": {
      const i = s.marks.findIndex((m) => m.id === a.id);
      const m = s.marks[i];
      if (!m || !canTurn(m)) return s;
      const rot = normalizeRot(a.rot);
      if (rot === markRot(m)) return s;
      return push(s.marks.map((x, k) => (k === i ? roundMark({ ...m, rot }) : x)));
    }
    case "fill": {
      const i = s.marks.findIndex((m) => m.id === a.id);
      const m = s.marks[i];
      if (!m || m.kind !== "text" || markFill(m) === a.fill) return s;
      return push(s.marks.map((x, k) => (k === i ? roundMark({ ...m, fill: a.fill }) : x)));
    }
    case "undo": {
      if (!s.past.length) return s;
      const last = s.past[s.past.length - 1]!;
      return { marks: last.marks, rotation: last.rotation, past: s.past.slice(0, -1) };
    }
    case "load":
      return emptyPhotoHistory(a.marks, a.rotation ?? 0);
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
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
}

/**
 * The picture turned by `rotation` with its marks over it, onto a canvas sized rotatedBox(w, h)
 * (w × h the picture's natural size): one shift and turn (rotationMatrix) for the picture and
 * the marks alike, so the saved file is what the screen shows.
 */
export function paintPhoto(
  ctx: PhotoPaint2D,
  picture: CanvasImageSource,
  w: number,
  h: number,
  marks: PhotoMark[],
  rotation: Rotation,
) {
  ctx.save();
  if (rotation) {
    const m = rotationMatrix(w, h, rotation);
    ctx.translate(m.tx, m.ty);
    ctx.rotate((m.deg * Math.PI) / 180);
  }
  ctx.drawImage(picture, 0, 0);
  paintPhotoMarks(ctx, marks, w, h);
  ctx.restore();
}

/**
 * Draw the marks over a picture already on the canvas, which is `w` × `h` px. Every line and
 * letter sits on its halo (haloFor: dark, light under black); a turned mark (rot) is drawn
 * inside a translate / rotate / translate back about its centre; a text with `fill` gets its
 * solid rounded box (textFillBox) before its words.
 */
export function paintPhotoMarks(ctx: PhotoPaint2D, marks: PhotoMark[], w: number, h: number) {
  const sw = strokeFor(w, h);
  const tags = photoTagNumbers(marks);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const strokeTwice = (color: string, halo: string) => {
    ctx.strokeStyle = halo;
    ctx.lineWidth = sw * 1.8;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = sw;
    ctx.stroke();
  };
  const words = (
    text: string,
    x: number,
    y: number,
    size: number,
    color: string,
    halo: string | null,
  ) => {
    ctx.font = `bold ${Math.round(size)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    if (halo) {
      ctx.lineWidth = Math.max(2, size * 0.18);
      ctx.strokeStyle = halo;
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  /** A rounded box as a path (moveTo / lineTo / arc: the corners are quarter circles). */
  const roundedBox = (b: { x: number; y: number; w: number; h: number; r: number }) => {
    const r = Math.min(b.r, b.w / 2, b.h / 2);
    ctx.beginPath();
    ctx.moveTo(b.x + r, b.y);
    ctx.lineTo(b.x + b.w - r, b.y);
    ctx.arc(b.x + b.w - r, b.y + r, r, -Math.PI / 2, 0);
    ctx.lineTo(b.x + b.w, b.y + b.h - r);
    ctx.arc(b.x + b.w - r, b.y + b.h - r, r, 0, Math.PI / 2);
    ctx.lineTo(b.x + r, b.y + b.h);
    ctx.arc(b.x + r, b.y + b.h - r, r, Math.PI / 2, Math.PI);
    ctx.lineTo(b.x, b.y + r);
    ctx.arc(b.x + r, b.y + r, r, Math.PI, Math.PI * 1.5);
    ctx.closePath();
  };
  /** Draw `paint` turned by the mark's own rot about its centre (nothing extra when not turned). */
  const turned = (m: PhotoMark, paint: () => void) => {
    const rot = markRot(m);
    const c = rot ? markCentre(m, w, h) : null;
    if (!rot || !c) return paint();
    ctx.save();
    ctx.translate(c[0], c[1]);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.translate(-c[0], -c[1]);
    paint();
    ctx.restore();
  };
  for (const m of marks) {
    const color = photoColorHex(m.color);
    const halo = haloFor(m.color);
    if (m.kind === "ellipse") {
      const g = ellipseGeom(m, w, h);
      turned(m, () => {
        ctx.beginPath();
        ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, Math.PI * 2);
        strokeTwice(color, halo);
      });
    } else if (m.kind === "rect") {
      const g = rectGeom(m, w, h);
      turned(m, () => {
        ctx.beginPath();
        ctx.rect(g.x, g.y, g.w, g.h);
        strokeTwice(color, halo);
      });
    } else if (m.kind === "arrow") {
      const g = arrowGeom(m, w, h, sw);
      ctx.beginPath();
      ctx.moveTo(g.tail[0], g.tail[1]);
      ctx.lineTo(g.base[0], g.base[1]);
      strokeTwice(color, halo);
      ctx.beginPath();
      ctx.moveTo(g.tip[0], g.tip[1]);
      ctx.lineTo(g.left[0], g.left[1]);
      ctx.lineTo(g.right[0], g.right[1]);
      ctx.closePath();
      ctx.strokeStyle = halo;
      ctx.lineWidth = sw * 0.8;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fill();
    } else if (m.kind === "text") {
      const [x, y] = fromNorm(m.at, w, h);
      const fill = markFill(m);
      turned(m, () => {
        if (fill) {
          roundedBox(textFillBox(m, w, h));
          ctx.fillStyle = textFillColor(m.color);
          ctx.fill();
        }
        words(m.text, x, y, textSizeFor(w, h), color, fill ? null : halo);
      });
    } else {
      const g = tagGeom(m, w, h);
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = isLightHalo(m.color) ? "#ffffff" : "#000000";
      ctx.lineWidth = Math.max(1, sw / 3);
      ctx.stroke();
      ctx.font = `bold ${Math.round(g.r * 1.1)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = tagNumberColor(m.color);
      ctx.fillText(String(tags.get(m.id) ?? ""), g.x, g.y);
      words(m.label, g.label.x, g.y, g.labelSize, "#ffffff", HALO);
    }
  }
  ctx.restore();
}

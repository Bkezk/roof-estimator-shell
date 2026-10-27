/**
 * Takeoff › "Export marked-up PDF" (owner, Sep 30: "yes add this please"). One LANDSCAPE page
 * per takeoff page that has objects: the underlay rendered to a canvas, the drawing on top (areas
 * filled at low opacity with their outline, cut-outs hatched red, linears in their colour, count
 * pins numbered), every object labelled with its name and quantity, and the page's scale line;
 * then (owner, Oct 27) a "Deficiencies" page or pages — each deficiency's number, name, note and
 * its pictures embedded — and a summary page (takeoff, customer, date, who exported, the
 * quantities grouped like the Quantities tab, with totals). Built in the browser with pdf-lib,
 * imported lazily. Deficiency pins are red and carry their number; the pictures are fetched by
 * signed URL in the browser (editor-extras.tsx) and passed in as bytes.
 *
 * Split so the parts can be tested without a browser:
 *  - pure: `markupRenderScale`, `objectLabelText`, `layoutLabels`, `markupSummary`,
 *    `wrapText`, `layoutDeficiencyPages`, `markupFileName`;
 *  - canvas 2D: `drawMarkup` (any CanvasRenderingContext2D, e.g. @napi-rs/canvas in a test);
 *  - pdf-lib: `assembleMarkupPdf` (encoded sheet images + the summary → PDF bytes);
 *  - `buildMarkupPdf` runs them all with an injected page renderer and image encoder (the
 *    editor passes the underlay's `renderUnderlayPage` and canvas.toBlob).
 */
import type { Color, PDFDocument, PDFFont, PDFPage } from "pdf-lib";

import { clean } from "@/lib/bid-summary-pdf";
import {
  COUNT_ROLES,
  COUNT_ROLE_LABELS,
  DEFICIENCY_COLOR,
  LINEAR_ROLES,
  LINEAR_ROLE_LABELS,
  feetPerPx,
  type PageScale,
  takeoffQuantities,
  type PagePoint,
  type TakeoffObject,
  type TakeoffPage,
  type TakeoffQuantities,
} from "./model";
import {
  centroid,
  feetInches,
  fmtNum,
  fmtSqFt,
  polylineMidpoint,
} from "@/components/takeoff/shapes";
import {
  aerialScaleChipText,
  isScaleLineDrawn,
  scaleOrigin,
} from "@/components/takeoff/sheet-scale";

// ─────────────────────────────────────────────────────────────────────────────
// Pure parts
// ─────────────────────────────────────────────────────────────────────────────

/** Most pixels one rendered sheet may hold (keeps the PDF and the browser's memory sane). */
export const MARKUP_MAX_PIXELS = 4_000_000;

/**
 * Device px per page px for a sheet `width` × `height` (page px at zoom 1): as sharp as the
 * pixel budget allows, never above `maxScale` (a small aerial image is not blown up past 3×).
 */
export function markupRenderScale(
  width: number,
  height: number,
  maxPixels = MARKUP_MAX_PIXELS,
  maxScale = 3,
): number {
  const area = Math.max(1, width * height);
  return Math.max(0.05, Math.min(maxScale, Math.sqrt(maxPixels / area)));
}

/**
 * The label drawn beside an object on the sheet: name and quantity. Areas are the roof surface
 * (plan × slope factor, as the Quantities tab and the bid use), with the pitch; linears in LF;
 * counts as "× n". Objects on a page with no scale say so.
 */
export function objectLabelText(o: TakeoffObject, q: TakeoffQuantities): string {
  if (o.kind === "count" && o.attrs.role === "deficiency") {
    const d = q.deficiencies.find((x) => x.objectId === o.id);
    return `Deficiency ${d ? `${d.number}: ` : ""}${o.attrs.name}`;
  }
  if (o.kind === "count") return `${o.attrs.name} × ${Math.max(1, o.points.length)}`;
  if (q.unscaled.some((u) => u.objectId === o.id)) return `${o.attrs.name}: no scale`;
  if (o.kind === "linear") {
    const l = q.linears.find((x) => x.objectId === o.id);
    const material = l?.material ? ` · ${l.material.description}` : "";
    return `${o.attrs.name}: ${l ? fmtNum(l.lengthFt) : "0"} LF${material}`;
  }
  const s = q.sections.find((x) => x.objectId === o.id);
  if (!s) return o.attrs.name;
  const slope =
    s.slopeFactor !== 1 && s.pitch !== undefined
      ? ` (${fmtNum(s.pitch)}:12, ×${s.slopeFactor.toFixed(3)})`
      : "";
  return `${o.attrs.name}: ${fmtSqFt(s.areaSqFt)}${slope}`;
}

/** Where an object's label is centred (page px): an area's centroid, a line's midpoint, a pin. */
export function labelAnchor(o: TakeoffObject): PagePoint {
  if (o.kind === "area") return centroid(o.points);
  if (o.kind === "linear") return polylineMidpoint(o.points);
  return o.points[0] ?? [0, 0];
}

export interface LabelRequest {
  id: string;
  /** Anchor (the label's preferred centre). */
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PlacedLabel {
  id: string;
  /** Top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlap = (a: PlacedLabel, b: PlacedLabel, gap: number): number => {
  const ox = Math.min(a.x + a.w + gap, b.x + b.w + gap) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h + gap, b.y + b.h + gap) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? ox * oy : 0;
};

/**
 * Place labels near their anchors without covering each other: each label tries its anchor, then
 * steps below / above / right / left of it (growing), and takes the first spot clear of every
 * label already placed; when none is clear it takes the spot with the least overlap. Every label
 * stays inside `bounds`. Order matters: earlier labels keep their preferred spot.
 */
export function layoutLabels(
  items: readonly LabelRequest[],
  bounds: { width: number; height: number },
  gap = 2,
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const clampBox = (b: PlacedLabel): PlacedLabel => ({
    ...b,
    x: Math.max(0, Math.min(b.x, bounds.width - b.w)),
    y: Math.max(0, Math.min(b.y, bounds.height - b.h)),
  });
  for (const it of items) {
    const base = { id: it.id, w: it.w, h: it.h, x: it.x - it.w / 2, y: it.y - it.h / 2 };
    const stepY = it.h + gap;
    const stepX = it.w / 2 + gap;
    const offsets: Array<[number, number]> = [[0, 0]];
    for (let k = 1; k <= 6; k++)
      offsets.push([0, k * stepY], [0, -k * stepY], [k * stepX, 0], [-k * stepX, 0]);
    let best: PlacedLabel | null = null;
    let bestCost = Infinity;
    for (const [dx, dy] of offsets) {
      const cand = clampBox({ ...base, x: base.x + dx, y: base.y + dy });
      const cost = placed.reduce((s, p) => s + overlap(cand, p, gap), 0);
      if (cost === 0) {
        best = cand;
        break;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = cand;
      }
    }
    placed.push(best!);
  }
  return placed;
}

export interface SummaryGroup {
  title: string;
  columns: string[];
  /** Columns (by index) that hold numbers: right-aligned. */
  numeric: number[];
  rows: string[][];
  /** The group's total row (bold), when it has one. */
  total: string[] | null;
}
export interface MarkupSummary {
  groups: SummaryGroup[];
  /** The headline totals, as label / value pairs. */
  totals: Array<[string, string]>;
  /** Objects that could not be measured (no scale on their page). */
  unscaled: string[];
}

/**
 * The summary page's tables, grouped like the Quantities tab: areas (pitch, plan and roof area,
 * perimeter), linears per role, counts per role — each with its total — plus the headline totals.
 */
export function markupSummary(
  q: TakeoffQuantities,
  pageName: (index: number) => string,
): MarkupSummary {
  const groups: SummaryGroup[] = [];
  if (q.sections.length) {
    const plan = q.sections.reduce((s, x) => s + x.planAreaSqFt, 0);
    const roof = q.sections.reduce((s, x) => s + x.areaSqFt, 0);
    const perim = q.sections.reduce((s, x) => s + x.perimeterFt, 0);
    groups.push({
      title: "Areas",
      columns: ["Name", "Page", "Pitch", "Plan sq ft", "Roof sq ft", "Perimeter ft", "Sides"],
      numeric: [3, 4, 5, 6],
      rows: q.sections.map((s) => [
        s.name,
        pageName(s.page),
        s.pitch !== undefined ? `${fmtNum(s.pitch)}:12 (×${s.slopeFactor.toFixed(3)})` : "flat",
        fmtNum(s.planAreaSqFt, 0),
        fmtNum(s.areaSqFt, 0),
        fmtNum(s.perimeterFt),
        String(s.edgeLengthsFt.length),
      ]),
      total: ["Total", "", "", fmtNum(plan, 0), fmtNum(roof, 0), fmtNum(perim), ""],
    });
  }
  for (const role of LINEAR_ROLES) {
    const ls = q.linears.filter((l) => l.role === role);
    if (!ls.length) continue;
    const len = ls.reduce((s, l) => s + l.lengthFt, 0);
    groups.push({
      title: `Linears: ${LINEAR_ROLE_LABELS[role]}`,
      columns: ["Name", "Page", "Length (LF)", "Height (in)", "Material"],
      numeric: [2, 3],
      rows: ls.map((l) => [
        l.name,
        pageName(l.page),
        fmtNum(l.lengthFt),
        l.heightIn !== undefined ? fmtNum(l.heightIn) : "",
        l.material?.description ?? "",
      ]),
      total: [`Total ${LINEAR_ROLE_LABELS[role].toLowerCase()}`, "", fmtNum(len), "", ""],
    });
  }
  for (const role of COUNT_ROLES) {
    const cs = q.counts.filter((c) => c.role === role);
    if (!cs.length) continue;
    const n = cs.reduce((s, c) => s + c.qty, 0);
    groups.push({
      title: `Penetrations: ${COUNT_ROLE_LABELS[role]}`,
      columns: ["Name", "Qty", "Size", "Detail"],
      numeric: [1],
      rows: cs.map((c) => [
        c.name,
        String(c.qty),
        [
          c.sizeIn !== undefined ? `${fmtNum(c.sizeIn)} in` : "",
          c.widthIn !== undefined || c.lengthIn !== undefined
            ? `${c.widthIn ?? "?"} × ${c.lengthIn ?? "?"} in`
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
        c.role === "drain"
          ? [c.roofType, c.bootSize, c.ringSize, c.reuseRings ? "reuse rings" : ""]
              .filter(Boolean)
              .join(" · ")
          : "",
      ]),
      total: [`Total ${COUNT_ROLE_LABELS[role].toLowerCase()}`, String(n), "", ""],
    });
  }
  if (q.deficiencies.length)
    groups.push({
      title: "Deficiencies (see the Deficiencies pages for the pictures)",
      columns: ["#", "Name", "Page", "Note", "Pictures"],
      numeric: [0, 4],
      rows: q.deficiencies.map((d) => [
        String(d.number),
        d.name,
        pageName(d.page),
        d.note ?? "",
        String(d.photoCount),
      ]),
      total: null,
    });
  const t = q.totals;
  const totals: Array<[string, string]> = [["Roof area", `${fmtNum(t.roofAreaSqFt, 0)} sq ft`]];
  if (Math.abs(t.roofAreaSqFt - t.planAreaSqFt) > 0.005)
    totals.push(["Plan area", `${fmtNum(t.planAreaSqFt, 0)} sq ft`]);
  totals.push(
    ["Perimeter", `${fmtNum(t.perimeterFt)} ft`],
    ["Parapet", `${fmtNum(t.parapetFt)} ft`],
    ["Penetrations", String(q.counts.reduce((s, c) => s + c.qty, 0))],
  );
  if (q.deficiencies.length) totals.push(["Deficiencies", String(q.deficiencies.length)]);
  return {
    groups,
    totals,
    unscaled: q.unscaled.map((u) => `${u.name} (${pageName(u.page)})`),
  };
}

/**
 * Break `text` into lines no wider than `maxWidth` (by `measure`): on its own newlines, then
 * between words; a single word wider than the line is cut by characters. Blank input → [].
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, "\n").split("\n")) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      if (out.length) out.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (measure(cand) <= maxWidth) {
        line = cand;
        continue;
      }
      if (line) out.push(line);
      line = "";
      // A word too wide on its own: cut it by characters.
      let piece = "";
      for (const ch of w) {
        if (measure(piece + ch) > maxWidth && piece) {
          out.push(piece);
          piece = "";
        }
        piece += ch;
      }
      line = piece;
    }
    if (line) out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

/** One deficiency as the Deficiencies pages lay it out (pure; the pictures are counted only). */
export interface DeficiencyLayoutItem {
  number: number;
  name: string;
  note: string;
  pageName: string;
  photoCount: number;
}
export interface DeficiencyLayoutOptions {
  /** The content box (pt): pictures and text stay inside its width; entries break by height. */
  width: number;
  height: number;
  /** A picture cell and the gap between cells. */
  cellW: number;
  cellH: number;
  gap: number;
  /** The heading line's height and a note line's height (pt). */
  headH: number;
  lineH: number;
  /** Space under an entry. */
  pad: number;
  /** Note text → lines that fit the width (`wrapText` with the font). */
  wrap: (text: string, maxWidth: number) => string[];
}
export interface PlacedDeficiency {
  /** Index into the items. */
  index: number;
  /** Top of the entry, from the top of the content box (pt). */
  y: number;
  height: number;
  noteLines: string[];
  /** Picture cells (top-left, from the box's top-left), in picture order; fewer than photoCount
   * when the rest did not fit the page (the assembler says "+ n more"). */
  photos: Array<{ x: number; y: number; w: number; h: number }>;
}

/**
 * The Deficiencies pages: entries one under another, each its heading, the note's lines and its
 * pictures in rows of cells; an entry that does not fit what is left of the page starts a new
 * page; one taller than a whole page stands alone and keeps only the picture rows that fit.
 * Returns one array of placed entries per page (none when there are no items).
 */
export function layoutDeficiencyPages(
  items: readonly DeficiencyLayoutItem[],
  o: DeficiencyLayoutOptions,
): PlacedDeficiency[][] {
  const perRow = Math.max(1, Math.floor((o.width + o.gap) / (o.cellW + o.gap)));
  const pages: PlacedDeficiency[][] = [];
  let page: PlacedDeficiency[] = [];
  let y = 0;
  const build = (i: number, top: number, maxBottom: number): PlacedDeficiency => {
    const it = items[i]!;
    const noteLines = it.note.trim() ? o.wrap(it.note, o.width) : [];
    let cy = top + o.headH + noteLines.length * o.lineH;
    const photos: PlacedDeficiency["photos"] = [];
    for (let k = 0; k < it.photoCount; k++) {
      const col = k % perRow;
      if (col === 0 && k > 0) cy += o.cellH + o.gap;
      if (cy + o.cellH > maxBottom) break;
      photos.push({ x: col * (o.cellW + o.gap), y: cy, w: o.cellW, h: o.cellH });
    }
    const bottom = photos.length
      ? photos[photos.length - 1]!.y + o.cellH
      : top + o.headH + noteLines.length * o.lineH;
    return { index: i, y: top, height: bottom - top + o.pad, noteLines, photos };
  };
  for (let i = 0; i < items.length; i++) {
    // Measure it whole (every picture row); break the page when that does not fit what is left.
    const whole = build(i, 0, Infinity);
    if (y > 0 && y + whole.height > o.height) {
      pages.push(page);
      page = [];
      y = 0;
    }
    const placed = build(i, y, o.height);
    page.push(placed);
    y += placed.height;
  }
  if (page.length) pages.push(page);
  return pages;
}

/**
 * The sheet's footer line about its scale: the drawn line's length; for a scale set from the
 * aerial imagery (no line on the picture) the imagery note and feet per pixel; or "no scale".
 */
export function markupScaleText(scale: PageScale | null | undefined): string {
  const fpp = feetPerPx(scale);
  if (!scale || fpp === null) return "No scale on this page: its areas and lines are not measured.";
  const origin = scaleOrigin(scale);
  if (!isScaleLineDrawn(scale) && origin?.source === "sheet")
    return `${aerialScaleChipText(origin.note, fpp)}. Areas are roof surface: plan × pitch factor.`;
  return `Scale line: ${feetInches(scale.feet)} (shown dashed orange). Areas are roof surface: plan × pitch factor.`;
}

/** "<takeoff name> – takeoff.pdf", without characters a file system refuses. */
export function markupFileName(name: string): string {
  const base = [...name]
    .map((ch) => (ch.charCodeAt(0) < 32 ? " " : ch))
    .join("")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${base || "Untitled"} – takeoff.pdf`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas drawing
// ─────────────────────────────────────────────────────────────────────────────

const CUT_RED = "#dc2626";
const SCALE_ORANGE = "#ea580c";
const INK_HEX = "#111827";

/**
 * Draw one page's objects, their labels and the scale line onto `ctx`, whose canvas already holds
 * the underlay rendered at `s` device px per page px. Line widths and text scale with the sheet
 * so a big plan and a small aerial read alike.
 */
export function drawMarkup(
  ctx: CanvasRenderingContext2D,
  opts: {
    /** Device px per page px. */
    s: number;
    canvasWidth: number;
    canvasHeight: number;
    page: TakeoffPage;
    objects: readonly TakeoffObject[];
    quantities: TakeoffQuantities;
  },
): void {
  const defNumber = new Map(opts.quantities.deficiencies.map((d) => [d.objectId, d.number]));
  const { s, page, objects } = opts;
  const k = Math.max(0.6, Math.max(opts.canvasWidth, opts.canvasHeight) / 1600);
  const P = (p: PagePoint): [number, number] => [p[0] * s, p[1] * s];
  const ring = (pts: readonly PagePoint[]) => {
    pts.forEach((p, i) => {
      const [x, y] = P(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Areas first (fills under the lines), then linears, then pins on top.
  for (const o of objects) {
    if (o.kind !== "area" || o.points.length < 2) continue;
    const color = o.color ?? "#16a34a";
    const cuts = o.attrs.cutouts ?? [];
    ctx.beginPath();
    ring(o.points);
    for (const c of cuts) ring(c);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    ctx.fill("evenodd");
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 * k;
    ctx.beginPath();
    ring(o.points);
    ctx.stroke();
    for (const c of cuts) {
      if (c.length < 3) continue;
      // Hatch the cut-out red (clipped to it), with a dashed red outline.
      ctx.save();
      ctx.beginPath();
      ring(c);
      ctx.clip();
      const xs = c.map((p) => p[0] * s);
      const ys = c.map((p) => p[1] * s);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      ctx.strokeStyle = CUT_RED;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.2 * k;
      const step = 10 * k;
      ctx.beginPath();
      for (let d = -(y1 - y0); d < x1 - x0; d += step) {
        ctx.moveTo(x0 + d, y1);
        ctx.lineTo(x0 + d + (y1 - y0), y0);
      }
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = CUT_RED;
      ctx.lineWidth = 1.8 * k;
      ctx.setLineDash([6 * k, 4 * k]);
      ctx.beginPath();
      ring(c);
      ctx.stroke();
      ctx.restore();
    }
  }
  for (const o of objects) {
    if (o.kind !== "linear" || o.points.length < 2) continue;
    ctx.strokeStyle = o.color ?? "#1d4ed8";
    ctx.lineWidth = 3.5 * k;
    ctx.beginPath();
    o.points.forEach((p, i) => {
      const [x, y] = P(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  const pinR = 9 * k;
  for (const o of objects) {
    if (o.kind !== "count") continue;
    // A deficiency pin is red and carries its number across the takeoff; any other pin its
    // click number within its penetration.
    const deficiency = o.attrs.role === "deficiency";
    o.points.forEach((p, i) => {
      const [x, y] = P(p);
      ctx.beginPath();
      ctx.arc(x, y, pinR, 0, Math.PI * 2);
      ctx.fillStyle = deficiency ? DEFICIENCY_COLOR : (o.color ?? "#db2777");
      ctx.fill();
      ctx.lineWidth = 1.5 * k;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(10 * k)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(deficiency ? String(defNumber.get(o.id) ?? "!") : String(i + 1), x, y);
    });
  }

  // The scale line (the page's calibration), dashed orange with end ticks. Not for a scale set
  // from the aerial imagery (owner, Oct 27): that one is a record, not a line on the picture.
  const sc = page.scale;
  const scaleDrawn = !!sc && feetPerPx(sc) !== null && isScaleLineDrawn(sc);
  if (sc && scaleDrawn) {
    const [ax, ay] = P([sc.ax, sc.ay]);
    const [bx, by] = P([sc.bx, sc.by]);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / len) * 7 * k;
    const ny = ((bx - ax) / len) * 7 * k;
    ctx.save();
    ctx.strokeStyle = SCALE_ORANGE;
    ctx.lineWidth = 2.5 * k;
    ctx.setLineDash([8 * k, 5 * k]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const [x, y] of [
      [ax, ay],
      [bx, by],
    ] as const) {
      ctx.moveTo(x - nx, y - ny);
      ctx.lineTo(x + nx, y + ny);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Labels: measured, laid out clear of each other, drawn on a white box.
  const fontPx = Math.round(15 * k);
  const padX = 4 * k;
  const boxH = fontPx + 6 * k;
  ctx.font = `bold ${fontPx}px sans-serif`;
  const texts = new Map<string, { text: string; color: string }>();
  const reqs: LabelRequest[] = [];
  const addLabel = (id: string, text: string, color: string, at: [number, number]) => {
    texts.set(id, { text, color });
    reqs.push({ id, x: at[0], y: at[1], w: ctx.measureText(text).width + 2 * padX, h: boxH });
  };
  if (sc && scaleDrawn) {
    const [mx, my] = P([(sc.ax + sc.bx) / 2, (sc.ay + sc.by) / 2]);
    addLabel("__scale", `Scale ${feetInches(sc.feet)}`, "#c2410c", [mx, my - boxH]);
  }
  for (const o of objects) {
    const [x, y] = P(labelAnchor(o));
    const at: [number, number] =
      o.kind === "count"
        ? [x, y - pinR - boxH / 2 - 2 * k]
        : o.kind === "linear"
          ? [x, y - boxH]
          : [x, y];
    addLabel(o.id, objectLabelText(o, opts.quantities), o.color ?? INK_HEX, at);
  }
  const placed = layoutLabels(reqs, { width: opts.canvasWidth, height: opts.canvasHeight }, 2 * k);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const b of placed) {
    const t = texts.get(b.id)!;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.2 * k;
    ctx.strokeStyle = t.color;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = INK_HEX;
    ctx.fillText(t.text, b.x + padX, b.y + b.h / 2);
    // A colour tick on the left edge ties the label to its object.
    ctx.fillStyle = t.color;
    ctx.fillRect(b.x, b.y, 2.5 * k, b.h);
  }
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF assembly
// ─────────────────────────────────────────────────────────────────────────────

// 11 × 17 (ledger) landscape, points: plan sheets read far better than on Letter.
const PW = 1224;
const PH = 792;
const M = 30;
const CW = PW - 2 * M;
const HEAD_Y = PH - M - 12;
const FOOT_Y = M;
const IMG_TOP = HEAD_Y - 12;
const IMG_BOTTOM = FOOT_Y + 16;

type Rgb = readonly [number, number, number];
const INK: Rgb = [0.12, 0.12, 0.14];
const MUTED: Rgb = [0.42, 0.42, 0.46];
const RULE: Rgb = [0.72, 0.72, 0.75];
const HEAD_FILL: Rgb = [0.87, 0.89, 0.92];
const ACCENT: Rgb = [0.1, 0.27, 0.5];

export interface MarkupSheet {
  /** "A1 — Roof plan". */
  pageName: string;
  /** e.g. "Scale line 100'", or "No scale on this page". */
  scaleText: string;
  image: Uint8Array;
  imageKind: "jpeg" | "png";
}
/** A deficiency for its page: number, name, note, the sheet it is on, its pictures as bytes. */
export interface MarkupDeficiency {
  number: number;
  name: string;
  note: string;
  pageName: string;
  photos: Array<{ bytes: Uint8Array; kind: "jpeg" | "png" }>;
  /** Pictures that could not be fetched (named on the page, not silently dropped). */
  missing: number;
}
export interface MarkupPdfInput {
  takeoffName: string;
  customer: string | null;
  exportedBy: string | null;
  /** Display date, e.g. "Sep 30, 2026, 3:12 PM". */
  exportedAt: string;
  sheets: MarkupSheet[];
  /** The Deficiencies pages come after the sheets (none when empty). */
  deficiencies?: MarkupDeficiency[];
  summary: MarkupSummary;
}

/** The Deficiencies pages' picture cell (pt), 4 across the ledger sheet's content width. */
export const DEF_CELL_W = 282;
export const DEF_CELL_H = 212;
export const DEF_GAP = 12;

interface PdfCtx {
  pdf: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  rgb: (r: number, g: number, b: number) => Color;
  page: PDFPage;
  y: number;
}
const colr = (c: PdfCtx, t: Rgb) => c.rgb(t[0], t[1], t[2]);
/** One line of text as the standard fonts take it (no line breaks: a note's go to spaces). */
const oneLine = (s: string) => clean(s).replace(/\n+/g, " ");
function txt(c: PdfCtx, s: string, x: number, y: number, size: number, bold = false, color = INK) {
  const t = oneLine(s);
  if (t) c.page.drawText(t, { x, y, size, font: bold ? c.bold : c.font, color: colr(c, color) });
}
function fit(f: PDFFont, s: string, size: number, w: number): string {
  let t = oneLine(s);
  if (f.widthOfTextAtSize(t, size) <= w) return t;
  while (t.length > 1 && f.widthOfTextAtSize(`${t}…`, size) > w) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
function rule(c: PdfCtx, y: number, color = RULE, t = 0.6) {
  c.page.drawLine({
    start: { x: M, y },
    end: { x: PW - M, y },
    thickness: t,
    color: colr(c, color),
  });
}
function header(c: PdfCtx, input: MarkupPdfInput, left: string) {
  txt(c, fit(c.bold, left, 11, CW * 0.6), M, HEAD_Y, 11, true, ACCENT);
  const right = fit(
    c.font,
    [input.takeoffName, input.customer].filter(Boolean).join("  ·  "),
    9,
    CW * 0.38,
  );
  txt(c, right, PW - M - c.font.widthOfTextAtSize(right, 9), HEAD_Y + 1, 9, false, MUTED);
  rule(c, HEAD_Y - 5);
}

/** The sheet pages (image fitted, header, scale note), then the summary page; returns the bytes. */
export async function assembleMarkupPdf(input: MarkupPdfInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const c: PdfCtx = {
    pdf,
    font: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    rgb,
    page: null as unknown as PDFPage,
    y: 0,
  };
  pdf.setTitle(clean(`${input.takeoffName} – takeoff`));
  pdf.setSubject(clean(`Marked-up takeoff sheets for ${input.takeoffName}`));
  pdf.setCreator("JBK Portal");
  pdf.setProducer("JBK Portal");
  /** Deficiency pictures to embed once their cells are laid out. */
  const placedImages: Array<{
    photo: MarkupDeficiency["photos"][number];
    cx: number;
    cyTop: number;
    w: number;
    h: number;
    page: PDFPage;
  }> = [];

  for (const sh of input.sheets) {
    c.page = pdf.addPage([PW, PH]);
    header(c, input, sh.pageName);
    const img =
      sh.imageKind === "png" ? await pdf.embedPng(sh.image) : await pdf.embedJpg(sh.image);
    const boxH = IMG_TOP - IMG_BOTTOM;
    const sc = Math.min(CW / img.width, boxH / img.height);
    const w = img.width * sc;
    const h = img.height * sc;
    const x = M + (CW - w) / 2;
    const y = IMG_BOTTOM + (boxH - h) / 2;
    c.page.drawImage(img, { x, y, width: w, height: h });
    c.page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      borderColor: colr(c, RULE),
      borderWidth: 0.5,
    });
    txt(c, sh.scaleText, M, FOOT_Y, 8, false, MUTED);
  }

  // ── Deficiencies (owner, Oct 27): number, name, note, pictures; after the sheets ──
  const defs = input.deficiencies ?? [];
  if (defs.length) {
    const TOP = HEAD_Y - 24;
    const HEAD_H = 18;
    const LINE_H = 12;
    const layout = layoutDeficiencyPages(
      defs.map((d) => ({
        number: d.number,
        name: d.name,
        note: d.note,
        pageName: d.pageName,
        photoCount: d.photos.length + (d.missing > 0 ? 1 : 0),
      })),
      {
        width: CW,
        height: TOP - IMG_BOTTOM,
        cellW: DEF_CELL_W,
        cellH: DEF_CELL_H,
        gap: DEF_GAP,
        headH: HEAD_H,
        lineH: LINE_H,
        pad: 16,
        wrap: (text, w) => wrapText(clean(text), w, (s) => c.font.widthOfTextAtSize(s, 9)),
      },
    );
    for (const [pi, page] of layout.entries()) {
      c.page = pdf.addPage([PW, PH]);
      header(
        c,
        input,
        layout.length > 1 ? `Deficiencies (${pi + 1} of ${layout.length})` : "Deficiencies",
      );
      for (const placed of page) {
        const d = defs[placed.index]!;
        const top = TOP - placed.y; // PDF y of the entry's top edge
        // The red numbered badge and the name, then the sheet it is on.
        c.page.drawCircle({ x: M + 8, y: top - 8, size: 8, color: c.rgb(0.86, 0.15, 0.15) });
        const num = String(d.number);
        txt(c, num, M + 8 - c.bold.widthOfTextAtSize(num, 9) / 2, top - 11.2, 9, true, [1, 1, 1]);
        txt(c, fit(c.bold, d.name, 12, CW * 0.6), M + 22, top - 12, 12, true);
        const where = `Sheet ${d.pageName}`;
        txt(c, where, PW - M - c.font.widthOfTextAtSize(where, 8), top - 11, 8, false, MUTED);
        placed.noteLines.forEach((line, li) => {
          txt(c, line, M + 22, top - HEAD_H - (li + 1) * LINE_H + 3, 9);
        });
        placed.photos.forEach((cell, k) => {
          const photo = d.photos[k];
          const cx = M + cell.x;
          const cyTop = TOP - cell.y;
          if (!photo) {
            // The "missing" cell: pictures that could not be fetched.
            c.page.drawRectangle({
              x: cx,
              y: cyTop - cell.h,
              width: cell.w,
              height: cell.h,
              borderColor: colr(c, RULE),
              borderWidth: 0.6,
            });
            txt(
              c,
              `${d.missing} picture${d.missing === 1 ? "" : "s"} could not be loaded`,
              cx + 8,
              cyTop - cell.h / 2,
              9,
              false,
              MUTED,
            );
            return;
          }
          placedImages.push({ photo, cx, cyTop, w: cell.w, h: cell.h, page: c.page });
        });
        const extra = Math.max(0, d.photos.length - placed.photos.length);
        if (extra > 0) {
          const line = `+ ${extra} more picture${extra === 1 ? "" : "s"} (did not fit this page)`;
          txt(c, line, M + 22, top - placed.height + 6, 8, false, MUTED);
        }
      }
    }
    // Embed and draw the pictures (async, so outside the layout loop), fitted in their cells.
    for (const im of placedImages) {
      const img =
        im.photo.kind === "png"
          ? await pdf.embedPng(im.photo.bytes)
          : await pdf.embedJpg(im.photo.bytes);
      const sc = Math.min(im.w / img.width, im.h / img.height);
      const w = img.width * sc;
      const h = img.height * sc;
      const x = im.cx + (im.w - w) / 2;
      const y = im.cyTop - im.h + (im.h - h) / 2;
      im.page.drawImage(img, { x, y, width: w, height: h });
      im.page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        borderColor: colr(c, RULE),
        borderWidth: 0.5,
      });
    }
  }

  // ── Summary ──
  const newSummaryPage = () => {
    c.page = pdf.addPage([PW, PH]);
    header(c, input, "Takeoff summary");
    c.y = HEAD_Y - 24;
  };
  const ensure = (h: number) => {
    if (c.y - h < IMG_BOTTOM) {
      newSummaryPage();
      return true;
    }
    return false;
  };
  newSummaryPage();
  txt(c, fit(c.bold, input.takeoffName, 22, CW), M, c.y - 20, 22, true);
  c.y -= 36;
  const meta: Array<[string, string]> = [
    ["Customer", input.customer || "Not linked to a customer"],
    ["Exported", input.exportedAt],
    ["Exported by", input.exportedBy || "—"],
    ["Sheets", String(input.sheets.length)],
  ];
  for (const [k, v] of meta) {
    txt(c, k, M, c.y - 11, 10, true, MUTED);
    txt(c, fit(c.font, v, 11, CW - 110), M + 110, c.y - 11, 11);
    c.y -= 16;
  }
  c.y -= 8;
  // Headline totals in one row of boxes.
  const boxW = Math.min(180, CW / Math.max(1, input.summary.totals.length) - 8);
  input.summary.totals.forEach(([k, v], i) => {
    const bx = M + i * (boxW + 8);
    c.page.drawRectangle({
      x: bx,
      y: c.y - 38,
      width: boxW,
      height: 38,
      borderColor: colr(c, RULE),
      borderWidth: 0.6,
    });
    txt(c, k, bx + 6, c.y - 13, 8, false, MUTED);
    txt(c, fit(c.bold, v, 13, boxW - 12), bx + 6, c.y - 30, 13, true);
  });
  c.y -= 54;

  const SIZE = 9;
  const ROW = 14;
  for (const g of input.summary.groups) {
    // Name column gets the most room; the rest share what is left.
    const n = g.columns.length;
    const nameW = Math.min(360, CW * 0.34);
    const restW = (CW - nameW) / Math.max(1, n - 1);
    const xs = g.columns.map((_, i) => (i === 0 ? M : M + nameW + (i - 1) * restW));
    const ws = g.columns.map((_, i) => (i === 0 ? nameW : restW));
    const drawRow = (cells: string[], bold: boolean) => {
      cells.forEach((v, i) => {
        const f = bold ? c.bold : c.font;
        const t = fit(f, v, SIZE, ws[i]! - 8);
        const x = g.numeric.includes(i)
          ? xs[i]! + ws[i]! - 4 - f.widthOfTextAtSize(t, SIZE)
          : xs[i]! + 4;
        txt(c, t, x, c.y - ROW + 4, SIZE, bold);
      });
      c.y -= ROW;
    };
    const drawHead = () => {
      c.page.drawRectangle({
        x: M,
        y: c.y - ROW,
        width: CW,
        height: ROW,
        color: colr(c, HEAD_FILL),
      });
      drawRow(g.columns, true);
    };
    ensure(18 + ROW * 2);
    txt(c, g.title, M, c.y - 12, 11, true, ACCENT);
    c.y -= 18;
    drawHead();
    for (const r of g.rows) {
      if (ensure(ROW)) {
        txt(c, `${g.title} (continued)`, M, c.y - 10, 9, false, MUTED);
        c.y -= 14;
        drawHead();
      }
      drawRow(r, false);
    }
    if (g.total) {
      ensure(ROW);
      c.page.drawLine({
        start: { x: M, y: c.y },
        end: { x: PW - M, y: c.y },
        thickness: 0.6,
        color: colr(c, INK),
      });
      drawRow(g.total, true);
    }
    c.y -= 12;
  }
  if (input.summary.unscaled.length) {
    ensure(30);
    txt(c, "Not measured (no scale on their page)", M, c.y - 11, 10, true, MUTED);
    c.y -= 16;
    for (const u of input.summary.unscaled) {
      ensure(14);
      txt(c, fit(c.font, `• ${u}`, 9, CW), M + 8, c.y - 10, 9);
      c.y -= 13;
    }
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    c.page = p;
    const label = `Page ${i + 1} of ${pages.length}`;
    txt(c, label, PW - M - c.font.widthOfTextAtSize(label, 8), FOOT_Y, 8, false, MUTED);
  });
  return pdf.save();
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────────────

/** A rendered underlay page: the canvas at some device scale and the page's zoom-1 size. */
export interface RenderedSheet {
  canvas: { width: number; height: number; getContext(kind: "2d"): unknown };
  width: number;
  height: number;
}

/**
 * Everything together: for each page with objects, render the underlay (≤ MARKUP_MAX_PIXELS),
 * draw the markup, encode it, then assemble the PDF. `render` and `encode` are injected (the
 * browser's pdf.js / canvas.toBlob in the editor, @napi-rs/canvas in a test).
 */
export async function buildMarkupPdf(args: {
  takeoffName: string;
  customer: string | null;
  exportedBy: string | null;
  exportedAt: string;
  pages: readonly TakeoffPage[];
  objects: readonly TakeoffObject[];
  render: (page: TakeoffPage, scale: number) => Promise<RenderedSheet>;
  encode: (canvas: RenderedSheet["canvas"]) => Promise<{ bytes: Uint8Array; kind: "jpeg" | "png" }>;
  /**
   * A deficiency picture's bytes by its storage path (the browser fetches it by signed URL);
   * null when it cannot be had — the page then says so. Absent: no pictures are embedded.
   */
  photo?: (path: string) => Promise<{ bytes: Uint8Array; kind: "jpeg" | "png" } | null>;
}): Promise<{ bytes: Uint8Array; sheetCount: number; deficiencyCount: number }> {
  const q = takeoffQuantities(args.pages, args.objects);
  const pageName = (i: number) => args.pages.find((p) => p.index === i)?.name ?? `Page ${i + 1}`;
  const deficiencies: MarkupDeficiency[] = [];
  for (const d of q.deficiencies) {
    const o = args.objects.find((x) => x.id === d.objectId);
    const paths = o?.kind === "count" ? (o.attrs.photos ?? []).map((p) => p.path) : [];
    const photos: MarkupDeficiency["photos"] = [];
    let missing = 0;
    for (const path of paths) {
      const got = args.photo ? await args.photo(path) : null;
      if (got) photos.push(got);
      else missing += 1;
    }
    deficiencies.push({
      number: d.number,
      name: d.name,
      note: d.note ?? "",
      pageName: pageName(d.page),
      photos,
      missing,
    });
  }
  const sheets: MarkupSheet[] = [];
  for (const page of args.pages) {
    const objs = args.objects.filter((o) => o.page === page.index);
    if (!objs.length) continue;
    const scale = page.width && page.height ? markupRenderScale(page.width, page.height) : 1;
    const r = await args.render(page, scale);
    const ctx = r.canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!ctx) throw new Error("This browser could not draw the sheet (no 2D canvas).");
    drawMarkup(ctx, {
      s: r.canvas.width / r.width,
      canvasWidth: r.canvas.width,
      canvasHeight: r.canvas.height,
      page,
      objects: objs,
      quantities: q,
    });
    const img = await args.encode(r.canvas);
    sheets.push({
      pageName: pageName(page.index),
      scaleText: markupScaleText(page.scale),
      image: img.bytes,
      imageKind: img.kind,
    });
  }
  if (!sheets.length) throw new Error("Nothing is drawn on any page yet.");
  const bytes = await assembleMarkupPdf({
    takeoffName: args.takeoffName,
    customer: args.customer,
    exportedBy: args.exportedBy,
    exportedAt: args.exportedAt,
    sheets,
    deficiencies,
    summary: markupSummary(q, pageName),
  });
  return { bytes, sheetCount: sheets.length, deficiencyCount: deficiencies.length };
}

/** A deficiency picture fetched by its signed URL, as bytes pdf-lib can embed. */
export async function fetchPhotoBytes(
  url: string,
): Promise<{ bytes: Uint8Array; kind: "jpeg" | "png" } | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Sniff the kind from the bytes (the bucket holds JPEG and PNG only).
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { bytes, kind: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, kind: "jpeg" };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser
// ─────────────────────────────────────────────────────────────────────────────

/** A browser canvas as JPEG bytes (plan sheets compress far better than as PNG). */
export function canvasToJpeg(
  canvas: RenderedSheet["canvas"],
  quality = 0.85,
): Promise<{ bytes: Uint8Array; kind: "jpeg" }> {
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("The browser could not encode the sheet image."));
          return;
        }
        blob
          .arrayBuffer()
          .then((ab) => resolve({ bytes: new Uint8Array(ab), kind: "jpeg" }), reject);
      },
      "image/jpeg",
      quality,
    );
  });
}

/** Save PDF bytes as a file in the browser. */
export function downloadPdf(fileName: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has handed the URL to the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

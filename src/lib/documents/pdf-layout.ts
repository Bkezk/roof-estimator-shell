/**
 * The document PDF's layout, pure (owner, Oct 26: the CenterPoint-style document generator).
 * document-pdf.server.ts only draws what this file lays out: it hands in the page's width, a
 * text-measuring callback (pdf-lib's widthOfTextAtSize) and the pictures' sizes, and gets back
 * PIECES — one text line, a picture, a table row, a signature row, a rule, a gap, or a row of
 * columns — each with its height, and PAGES of pieces with their y offsets (paginate). A piece is
 * never cut: a text line, a picture or a table row moves whole to the next page, a table repeats
 * its header row there, a heading stays with the line after it, and a row of columns (two
 * columns, a photo beside text, the letterhead) is split by lines when it must cross a page.
 *
 * Rich text (ProseMirror JSON, model.ts) is flattened to blocks (paragraph, heading, list item,
 * blank) of styled runs, then wrapped word by word with the measure callback; a variable node
 * prints its value, or "[Label]" when the document has none (variables.ts variableLabel).
 * Tested in pdf-layout.test.ts with a fake measure.
 */
import {
  type DocModule,
  type ImageRef,
  type PdfModule,
  type PhotoGridModule,
  type RepairListModule,
  type RichDoc,
  type RichNode,
  type TextAlign,
  PAGE,
  PT_PER_IN,
  resolveCellText,
  VARIABLE_NODE,
} from "./model";
import { type DocumentSource, pricingRows } from "./variables";

// ------------------------------------------------------------------------------- constants

export const CONTENT_WIDTH = PAGE.widthPt - 2 * PAGE.marginPt;
export const CONTENT_HEIGHT = PAGE.heightPt - 2 * PAGE.marginPt;
/** CenterPoint's page break (5–10.5 in from the top, with Footer on): the printed page breaks there too. */
export const PAGE_BREAK_MIN_IN = 5;
export const PAGE_BREAK_MAX_IN = 10.5;
/**
 * The content height a page offers: with the footer on, the page-break setting (inches from the
 * top of the page, the editor's dotted line — owner, Oct 26: "the page breaks should start a new
 * page") minus the top margin; otherwise the full margin-to-margin height. The screen sheet
 * (editor-helpers.ts sheetContentLimit) uses the same rule, so both break in the same place.
 */
export function contentHeightFor(options: { footer: boolean; pageBreakIn: number }): number {
  if (!options.footer) return CONTENT_HEIGHT;
  const inches = Number.isFinite(options.pageBreakIn)
    ? Math.min(PAGE_BREAK_MAX_IN, Math.max(PAGE_BREAK_MIN_IN, options.pageBreakIn))
    : 8.8;
  return Math.min(CONTENT_HEIGHT, Math.round(inches * 72) - PAGE.marginPt);
}
export const BODY_SIZE = 10.5;
export const LINE_HEIGHT = 1.35;
export const HEADING_SIZES: Record<1 | 2 | 3, number> = { 1: 18, 2: 14, 3: 12 };
export const LIST_INDENT = 18;
export const BLANK_PARAGRAPH = 6;
export const PARAGRAPH_GAP = 4;
export const MODULE_GAP = 10;
export const CAPTION_SIZE = 8.5;
export const TABLE_SIZE = 9.5;
export const CELL_PAD = 4;
export const GUTTER = 0.3 * PT_PER_IN;
export const PHOTO_COLUMN = 0.45;
export const SIGNATURE_RULE = 2.6 * PT_PER_IN;
export const SIGNATURE_SPACE = 30;
export const LOGO_WIDTH = 1.6 * PT_PER_IN;
export const FOOTER_SIZE = 8.5;
export const PLACEHOLDER_HEIGHT = 72;
export const PLACEHOLDER_TEXT = "picture not printable";
/** The tallest a picture prints when its height is not given (room left for a caption). */
export const MAX_IMAGE_HEIGHT = CONTENT_HEIGHT - 40;

// ----------------------------------------------------------------------------------- types

export type FontKey = "regular" | "bold" | "italic" | "boldItalic";
export type Measure = (text: string, font: FontKey, size: number) => number;
export type Color = "body" | "muted";

export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}
export interface Segment {
  text: string;
  font: FontKey;
  size: number;
  underline: boolean;
  /** From the line's left edge (after align). */
  x: number;
  width: number;
}
export interface LaidLine {
  segments: Segment[];
  width: number;
  size: number;
  /** "•" or "1." drawn before the first line of a list item. */
  marker?: string | undefined;
  /** Where the marker is drawn, from the piece's x. */
  markerX?: number | undefined;
  color: Color;
}

export interface TableCell {
  lines: string[];
  align: TextAlign;
  x: number;
  width: number;
}

export type Piece =
  | {
      kind: "text";
      x: number;
      width: number;
      height: number;
      line: LaidLine;
      keepWithNext?: boolean | undefined;
    }
  | { kind: "gap"; height: number }
  | { kind: "rule"; x: number; width: number; height: number; thickness: number }
  | {
      kind: "image";
      x: number;
      width: number;
      height: number;
      ref: ImageRef;
      /** `${module id}:${slot}` — the server loaded the picture under this key. */
      key: string;
      keepWithNext?: boolean | undefined;
    }
  | { kind: "placeholder"; x: number; width: number; height: number; text: string }
  | {
      kind: "tableRow";
      x: number;
      width: number;
      height: number;
      cells: TableCell[];
      header: boolean;
      shade: boolean;
      bold: boolean;
      size: number;
      /** The header row to draw again when this row starts a new page. */
      repeat?: Piece | undefined;
      /** The header row itself: it moves to the next page with the first row. */
      keepWithNext?: boolean | undefined;
    }
  | {
      kind: "signature";
      height: number;
      entries: Array<{ x: number; width: number; label: string }>;
    }
  | { kind: "columns"; height: number; columns: Column[] };

export interface Column {
  x: number;
  width: number;
  pieces: Piece[];
}

export interface Placed {
  piece: Piece;
  /** From the content box's top. */
  y: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface LayoutContext {
  /** The content width (CONTENT_WIDTH on a Letter page). */
  width: number;
  measure: Measure;
  /** The document's variables (text values only). */
  vars: Record<string, string>;
  labelOf: (key: string) => string;
  /** The picture's natural size, or null when it cannot be printed. */
  image: (ref: ImageRef, key: string) => ImageSize | null;
  /** What the Pricing Table is built from (server-pure.ts pricingSource). */
  pricing: Pick<DocumentSource, "bid">;
}

export const fontKey = (bold: boolean, italic: boolean): FontKey =>
  bold ? (italic ? "boldItalic" : "bold") : italic ? "italic" : "regular";
export const lineHeightOf = (size: number) => Math.round(size * LINE_HEIGHT * 100) / 100;

// ---------------------------------------------------------------------------- word wrap

interface Token {
  kind: "word" | "space" | "break";
  text: string;
  run: Run;
}

function tokenise(runs: readonly Run[]): Token[] {
  const out: Token[] = [];
  for (const run of runs) {
    for (const m of run.text.matchAll(/(\n)|([^\S\n]+)|([^\s]+)/g)) {
      if (m[1]) out.push({ kind: "break", text: "\n", run });
      else if (m[2]) out.push({ kind: "space", text: m[2], run });
      else out.push({ kind: "word", text: m[3]!, run });
    }
  }
  return out;
}

/** Consecutive segments in one style become one (fewer draw calls, cleaner underlines). */
function mergeSegments(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.font === s.font && last.underline === s.underline && last.size === s.size) {
      last.text += s.text;
      last.width += s.width;
    } else out.push({ ...s });
  }
  return out;
}

/** Break one word wider than the line into pieces that fit (a URL, a long number). */
function breakWord(
  word: string,
  run: Run,
  size: number,
  maxWidth: number,
  measure: Measure,
): string[] {
  const font = fontKey(run.bold, run.italic);
  const parts: string[] = [];
  let cur = "";
  for (const ch of word) {
    const t = cur + ch;
    if (cur && measure(t, font, size) > maxWidth) {
      parts.push(cur);
      cur = ch;
    } else cur = t;
  }
  if (cur) parts.push(cur);
  return parts;
}

/**
 * Word-wrap styled runs into lines no wider than `maxWidth`: words are never cut (a word wider
 * than the line is the one exception — it is broken so it prints at all), spaces at a line's
 * ends are dropped, "\n" (a hard break) forces a line. Lines come back without x offsets
 * (placeLine). Empty runs give no lines.
 */
export function wrapRuns(
  runs: readonly Run[],
  maxWidth: number,
  size: number,
  measure: Measure,
): Array<{ segments: Segment[]; width: number }> {
  const lines: Array<{ segments: Segment[]; width: number }> = [];
  let cur: Segment[] = [];
  let curWidth = 0;
  let pending: Segment | null = null;
  const seg = (text: string, run: Run): Segment => {
    const font = fontKey(run.bold, run.italic);
    return { text, font, size, underline: run.underline, x: 0, width: measure(text, font, size) };
  };
  const flush = () => {
    lines.push({ segments: mergeSegments(cur), width: curWidth });
    cur = [];
    curWidth = 0;
    pending = null;
  };
  const push = (s: Segment) => {
    cur.push(s);
    curWidth += s.width;
  };
  for (const t of tokenise(runs)) {
    if (t.kind === "break") {
      flush();
      continue;
    }
    if (t.kind === "space") {
      if (cur.length) pending = pending ? seg(pending.text + t.text, t.run) : seg(t.text, t.run);
      continue;
    }
    const s = seg(t.text, t.run);
    const need = curWidth + (pending ? pending.width : 0) + s.width;
    // The word does not fit after what the line holds: the line ends, the word starts the next.
    if (cur.length && need > maxWidth) flush();
    if (s.width > maxWidth) {
      // Wider than the line on its own: broken so it prints at all.
      const parts = breakWord(t.text, t.run, size, maxWidth, measure);
      for (let i = 0; i < parts.length; i++) {
        push(seg(parts[i]!, t.run));
        if (i < parts.length - 1) flush();
      }
      continue;
    }
    if (pending && cur.length) push(pending);
    pending = null;
    push(s);
  }
  if (cur.length) flush();
  return lines;
}

/** The segments' x offsets for the alignment inside `width` (after `indent` on the left). */
export function placeLine(
  line: { segments: Segment[]; width: number },
  width: number,
  indent: number,
  align: TextAlign,
): Segment[] {
  const free = Math.max(0, width - indent - line.width);
  let x = align === "center" ? indent + free / 2 : align === "right" ? indent + free : indent;
  return line.segments.map((s) => {
    const placed = { ...s, x };
    x += s.width;
    return placed;
  });
}

// ---------------------------------------------------------------------- rich text → blocks

export type Block =
  | {
      kind: "text";
      runs: Run[];
      size: number;
      align: TextAlign;
      indent: number;
      marker?: string | undefined;
      spaceBefore: number;
      spaceAfter: number;
      keepWithNext: boolean;
    }
  | { kind: "blank"; height: number }
  | { kind: "rule" };

const alignOf = (n: RichNode): TextAlign => {
  const a = n.attrs?.["textAlign"];
  return a === "center" || a === "right" ? a : "left";
};
const headingLevel = (n: RichNode): 1 | 2 | 3 => {
  const l = Number(n.attrs?.["level"] ?? 1);
  return l <= 1 ? 1 : l === 2 ? 2 : 3;
};

/** The styled runs inside one block node (text, variables, hard breaks; marks inherited). */
export function inlineRuns(
  node: RichNode,
  vars: Record<string, string>,
  labelOf: (key: string) => string,
  inherited: { bold: boolean; italic: boolean; underline: boolean } = {
    bold: false,
    italic: false,
    underline: false,
  },
): Run[] {
  const out: Run[] = [];
  const walk = (n: RichNode, style: typeof inherited) => {
    const marks = n.marks ?? [];
    const s = {
      bold: style.bold || marks.some((m) => m.type === "bold"),
      italic: style.italic || marks.some((m) => m.type === "italic"),
      underline: style.underline || marks.some((m) => m.type === "underline"),
    };
    if (n.type === "text") {
      if (n.text) out.push({ text: n.text, ...s });
      return;
    }
    if (n.type === VARIABLE_NODE) {
      const key = String(n.attrs?.["key"] ?? "");
      out.push({ text: key in vars ? vars[key]! : `[${labelOf(key)}]`, ...s });
      return;
    }
    if (n.type === "hardBreak") {
      out.push({ text: "\n", ...s });
      return;
    }
    for (const c of n.content ?? []) walk(c, s);
  };
  for (const c of node.content ?? []) walk(c, inherited);
  return out;
}

/** The blocks of a rich doc, lists flattened with their markers and indents. */
export function richBlocks(
  doc: RichDoc | RichNode | null | undefined,
  vars: Record<string, string>,
  labelOf: (key: string) => string,
): Block[] {
  const out: Block[] = [];
  if (!doc) return out;
  const walk = (nodes: readonly RichNode[], indent: number, marker: string | null) => {
    let pendingMarker = marker;
    for (const n of nodes) {
      switch (n.type) {
        case "paragraph": {
          const runs = inlineRuns(n, vars, labelOf);
          if (!runs.some((r) => r.text.trim()) && !pendingMarker) {
            out.push({ kind: "blank", height: BLANK_PARAGRAPH });
            break;
          }
          out.push({
            kind: "text",
            runs,
            size: BODY_SIZE,
            align: alignOf(n),
            indent,
            marker: pendingMarker ?? undefined,
            spaceBefore: 0,
            spaceAfter: PARAGRAPH_GAP,
            keepWithNext: false,
          });
          pendingMarker = null;
          break;
        }
        case "heading": {
          const level = headingLevel(n);
          out.push({
            kind: "text",
            runs: inlineRuns(n, vars, labelOf, { bold: true, italic: false, underline: false }),
            size: HEADING_SIZES[level],
            align: alignOf(n),
            indent,
            marker: pendingMarker ?? undefined,
            spaceBefore: out.length ? 6 : 0,
            spaceAfter: 3,
            keepWithNext: true,
          });
          pendingMarker = null;
          break;
        }
        case "bulletList":
        case "orderedList": {
          const start = Number(n.attrs?.["start"] ?? 1) || 1;
          (n.content ?? []).forEach((item, i) => {
            const m = n.type === "bulletList" ? "•" : `${start + i}.`;
            if (item.type === "listItem") walk(item.content ?? [], indent + LIST_INDENT, m);
            else walk([item], indent + LIST_INDENT, m);
          });
          break;
        }
        case "listItem":
          walk(n.content ?? [], indent + LIST_INDENT, pendingMarker ?? "•");
          pendingMarker = null;
          break;
        case "blockquote":
          walk(n.content ?? [], indent + LIST_INDENT, null);
          break;
        case "horizontalRule":
          out.push({ kind: "rule" });
          break;
        case "hardBreak":
          out.push({ kind: "blank", height: BLANK_PARAGRAPH });
          break;
        default:
          if (n.content?.length) {
            if (n.content.some((c) => c.type === "text" || c.type === VARIABLE_NODE))
              out.push({
                kind: "text",
                runs: inlineRuns(n, vars, labelOf),
                size: BODY_SIZE,
                align: alignOf(n),
                indent,
                marker: pendingMarker ?? undefined,
                spaceBefore: 0,
                spaceAfter: PARAGRAPH_GAP,
                keepWithNext: false,
              });
            else walk(n.content, indent, pendingMarker);
            pendingMarker = null;
          }
      }
    }
  };
  walk((doc as RichNode).content ?? [], 0, null);
  return out;
}

/** Rich text as pieces in a column `width` wide at `x`. */
export function layoutRich(
  doc: RichDoc | RichNode | null | undefined,
  x: number,
  width: number,
  ctx: Pick<LayoutContext, "measure" | "vars" | "labelOf">,
  opts: { color?: Color; size?: number } = {},
): Piece[] {
  const out: Piece[] = [];
  const blocks = richBlocks(doc, ctx.vars, ctx.labelOf);
  blocks.forEach((b, bi) => {
    if (b.kind === "blank") {
      out.push({ kind: "gap", height: b.height });
      return;
    }
    if (b.kind === "rule") {
      out.push({ kind: "rule", x, width, height: 12, thickness: 0.75 });
      return;
    }
    const size = opts.size ?? b.size;
    if (b.spaceBefore && bi > 0) out.push({ kind: "gap", height: b.spaceBefore });
    const lines = wrapRuns(b.runs, width - b.indent, size, ctx.measure);
    const laid = lines.length ? lines : [{ segments: [], width: 0 }];
    laid.forEach((l, li) => {
      out.push({
        kind: "text",
        x,
        width,
        height: lineHeightOf(size),
        line: {
          segments: placeLine(l, width, b.indent, b.align),
          width: l.width,
          size,
          color: opts.color ?? "body",
          ...(li === 0 && b.marker
            ? { marker: b.marker, markerX: Math.max(0, b.indent - LIST_INDENT + 2) }
            : {}),
        },
        keepWithNext: b.keepWithNext,
      });
    });
    if (b.spaceAfter) out.push({ kind: "gap", height: b.spaceAfter });
  });
  // The last paragraph's gap is not wanted below a module.
  const last = out[out.length - 1];
  if (last && last.kind === "gap") out.pop();
  return out;
}

/** Plain lines (a caption, a signature label) as text pieces. */
export function layoutPlain(
  text: string,
  x: number,
  width: number,
  size: number,
  ctx: Pick<LayoutContext, "measure">,
  opts: { align?: TextAlign; color?: Color; bold?: boolean } = {},
): Piece[] {
  if (!text.trim()) return [];
  const runs: Run[] = [{ text, bold: !!opts.bold, italic: false, underline: false }];
  return wrapRuns(runs, width, size, ctx.measure).map((l) => ({
    kind: "text",
    x,
    width,
    height: lineHeightOf(size),
    line: {
      segments: placeLine(l, width, 0, opts.align ?? "left"),
      width: l.width,
      size,
      color: opts.color ?? "body",
    },
  }));
}

// ------------------------------------------------------------------------------- images

/** A picture scaled to fit a box, keeping its shape; no height = the width decides. */
export function fitImage(
  img: ImageSize,
  boxWidth: number,
  boxHeight: number | null,
): { width: number; height: number } {
  if (!(img.width > 0) || !(img.height > 0) || !(boxWidth > 0)) return { width: 0, height: 0 };
  let scale = boxWidth / img.width;
  if (boxHeight !== null && boxHeight > 0) scale = Math.min(scale, boxHeight / img.height);
  return { width: img.width * scale, height: img.height * scale };
}

/** A picture (or its placeholder) with its caption under it, centred in a column. */
function imageWithCaption(
  ref: ImageRef | null,
  key: string,
  caption: string,
  x: number,
  width: number,
  boxHeight: number | null,
  ctx: LayoutContext,
): Piece[] {
  if (!ref) return [];
  const out: Piece[] = [];
  const size = ctx.image(ref, key);
  if (size) {
    const fit = fitImage(size, width, boxHeight ?? MAX_IMAGE_HEIGHT);
    out.push({
      kind: "image",
      x: x + (width - fit.width) / 2,
      width: fit.width,
      height: fit.height,
      ref,
      key,
      keepWithNext: !!caption.trim(),
    });
  } else {
    out.push({
      kind: "placeholder",
      x,
      width,
      height: Math.min(PLACEHOLDER_HEIGHT, boxHeight ?? PLACEHOLDER_HEIGHT),
      text: PLACEHOLDER_TEXT,
    });
  }
  if (caption.trim()) {
    out.push({ kind: "gap", height: 3 });
    out.push(
      ...layoutPlain(caption, x, width, CAPTION_SIZE, ctx, { align: "center", color: "muted" }),
    );
  }
  return out;
}

// ------------------------------------------------------------------------------- tables

/** Column widths from the `width` weights (a missing weight counts 1); equal when none is set. */
export function tableColumnWidths(
  columns: ReadonlyArray<{ width?: number | undefined }>,
  total: number,
): number[] {
  if (!columns.length) return [];
  const weights = columns.map((c) => (c.width && c.width > 0 ? c.width : 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / sum) * total);
}

const wrapPlain = (text: string, width: number, size: number, bold: boolean, measure: Measure) =>
  wrapRuns([{ text, bold, italic: false, underline: false }], width, size, measure).map((l) =>
    l.segments.map((s) => s.text).join(""),
  );

/**
 * A table as row pieces: the header row (shaded, bold; none when every title is blank), then
 * the rows, zebra-shaded, cells wrapped inside their columns. Every row after the first carries
 * the header to repeat when a page break falls inside the table.
 */
export function layoutTable(
  table: {
    columns: ReadonlyArray<{ title: string; align: TextAlign; width?: number | undefined }>;
    rows: ReadonlyArray<ReadonlyArray<string>>;
    boldRow?: ((row: ReadonlyArray<string>, index: number) => boolean) | undefined;
  },
  x: number,
  width: number,
  ctx: Pick<LayoutContext, "measure" | "vars" | "labelOf">,
): Piece[] {
  const n = Math.max(table.columns.length, ...table.rows.map((r) => r.length));
  if (!n) return [];
  const columns = Array.from(
    { length: n },
    (_, i) => table.columns[i] ?? { title: "", align: "left" as TextAlign },
  );
  const widths = tableColumnWidths(columns, width);
  const xs: number[] = [];
  let cx = x;
  for (const w of widths) {
    xs.push(cx);
    cx += w;
  }
  const lineH = lineHeightOf(TABLE_SIZE);
  const row = (
    cells: ReadonlyArray<string>,
    header: boolean,
    shade: boolean,
    bold: boolean,
  ): Piece => {
    const laid: TableCell[] = columns.map((c, i) => ({
      lines: wrapPlain(
        resolveCellText(cells[i] ?? "", ctx.vars, ctx.labelOf),
        Math.max(1, widths[i]! - 2 * CELL_PAD),
        TABLE_SIZE,
        header || bold,
        ctx.measure,
      ),
      align: c.align,
      x: xs[i]!,
      width: widths[i]!,
    }));
    const lines = Math.max(1, ...laid.map((c) => c.lines.length));
    return {
      kind: "tableRow",
      x,
      width,
      height: lines * lineH + 2 * CELL_PAD,
      cells: laid,
      header,
      shade,
      bold: header || bold,
      size: TABLE_SIZE,
    };
  };
  const out: Piece[] = [];
  const hasHeader = columns.some((c) => c.title.trim());
  const headerPiece = hasHeader
    ? row(
        columns.map((c) => c.title),
        true,
        true,
        true,
      )
    : null;
  if (headerPiece) {
    // The header never ends a page on its own: it moves with the first row.
    if (headerPiece.kind === "tableRow") headerPiece.keepWithNext = true;
    out.push(headerPiece);
  }
  table.rows.forEach((r, i) => {
    const p = row(r, false, i % 2 === 1, table.boldRow?.(r, i) ?? false);
    if (p.kind === "tableRow" && headerPiece) p.repeat = headerPiece;
    out.push(p);
  });
  return out;
}

// ------------------------------------------------------------------------------- modules

/** The Pricing Table's columns and rows: the hand-edited rows when set, else the record's. */
export function pricingTableData(
  m: { mode: "total" | "none"; rows: string[][] | null; showSections: boolean },
  pricing: Pick<DocumentSource, "bid">,
): { columns: Array<{ title: string; align: TextAlign }>; rows: string[][] } {
  const built = pricingRows(pricing, m.mode, m.showSections);
  const rows = m.rows ?? built.rows;
  const aligns: TextAlign[] = ["left", "left", "right", "left"];
  const n = Math.max(built.columns.length, ...rows.map((r) => r.length));
  const columns = Array.from({ length: n }, (_, i) => ({
    title: built.columns[i] ?? "",
    align: aligns[i] ?? "left",
  }));
  return { columns, rows };
}

/** A signature module: two entries per row, a rule with its label under it. */
export function layoutSignature(lines: readonly string[], x: number, width: number): Piece[] {
  const labels = lines.map((l) => l.trim()).filter(Boolean);
  const out: Piece[] = [];
  for (let i = 0; i < labels.length; i += 2) {
    const pair = labels.slice(i, i + 2);
    const rule = Math.min(SIGNATURE_RULE, (width - GUTTER) / 2);
    out.push({
      kind: "signature",
      height: SIGNATURE_SPACE + 1 + lineHeightOf(CAPTION_SIZE) + 4,
      entries: pair.map((label, k) => ({
        x: k === 0 ? x : x + width - rule,
        width: rule,
        label,
      })),
    });
  }
  return out;
}

type ColumnsPiece = Extract<Piece, { kind: "columns" }>;
const columnsPiece = (columns: Column[]): ColumnsPiece => ({
  kind: "columns",
  height: Math.max(0, ...columns.map((c) => piecesHeight(c.pieces))),
  columns,
});

export const piecesHeight = (pieces: readonly Piece[]) => pieces.reduce((a, p) => a + p.height, 0);

/** One module as pieces at `x`, `width` wide. An inserted PDF is not a flow module (splitAtPdf). */
export function layoutModule(m: DocModule, x: number, width: number, ctx: LayoutContext): Piece[] {
  switch (m.type) {
    case "letterhead": {
      if (!m.logo) return layoutRich(m.text, x, width, ctx);
      const textX = x + LOGO_WIDTH + GUTTER;
      return [
        columnsPiece([
          {
            x,
            width: LOGO_WIDTH,
            pieces: imageWithCaption({ kind: "logo" }, `${m.id}:0`, "", x, LOGO_WIDTH, 90, ctx),
          },
          {
            x: textX,
            width: width - LOGO_WIDTH - GUTTER,
            pieces: layoutRich(m.text, textX, width - LOGO_WIDTH - GUTTER, ctx),
          },
        ]),
      ];
    }
    case "body":
      return layoutRich(m.text, x, width, ctx);
    case "twoColumns": {
      const colW = (width - GUTTER) / 2;
      const rx = x + colW + GUTTER;
      return [
        columnsPiece([
          { x, width: colW, pieces: layoutRich(m.left, x, colW, ctx) },
          { x: rx, width: colW, pieces: layoutRich(m.right, rx, colW, ctx) },
        ]),
      ];
    }
    case "fullPhoto": {
      const boxH = m.heightIn > 0 ? m.heightIn * PT_PER_IN : null;
      return imageWithCaption(m.image, `${m.id}:0`, m.caption, x, width, boxH, ctx);
    }
    case "photoLeft":
    case "photoRight": {
      const imgW = width * PHOTO_COLUMN;
      const textW = width - imgW - GUTTER;
      const imgX = m.type === "photoLeft" ? x : x + textW + GUTTER;
      const textX = m.type === "photoLeft" ? x + imgW + GUTTER : x;
      const image: Column = {
        x: imgX,
        width: imgW,
        pieces: imageWithCaption(
          m.image,
          `${m.id}:0`,
          m.caption,
          imgX,
          imgW,
          CONTENT_HEIGHT * 0.6,
          ctx,
        ),
      };
      const text: Column = {
        x: textX,
        width: textW,
        pieces: layoutRich(m.text, textX, textW, ctx),
      };
      return [columnsPiece(m.type === "photoLeft" ? [image, text] : [text, image])];
    }
    case "twoPhotos": {
      const colW = (width - GUTTER) / 2;
      const rx = x + colW + GUTTER;
      return [
        columnsPiece([
          {
            x,
            width: colW,
            pieces: imageWithCaption(
              m.images[0],
              `${m.id}:0`,
              m.captions[0],
              x,
              colW,
              4 * PT_PER_IN,
              ctx,
            ),
          },
          {
            x: rx,
            width: colW,
            pieces: imageWithCaption(
              m.images[1],
              `${m.id}:1`,
              m.captions[1],
              rx,
              colW,
              4 * PT_PER_IN,
              ctx,
            ),
          },
        ]),
      ];
    }
    case "table":
      return layoutTable({ columns: m.columns, rows: m.rows }, x, width, ctx);
    case "pricingTable": {
      const data = pricingTableData(m, ctx.pricing);
      if (!data.rows.length) return [];
      return layoutTable(
        { ...data, boldRow: (r) => (r[0] ?? "").trim().toLowerCase() === "total" },
        x,
        width,
        ctx,
      );
    }
    case "signature":
      return layoutSignature(m.lines, x, width);
    case "hr":
      return [{ kind: "rule", x, width, height: 12, thickness: 0.75 }];
    case "photoGrid":
      return layoutPhotoGrid(m, x, width, ctx);
    case "repairList":
      return layoutRepairList(m, x, width, ctx);
    case "pdf":
      return [];
  }
}

/** Phase 2 (built next): the Photo Grid prints its pictures in rows with captions. */
export function layoutPhotoGrid(
  _m: PhotoGridModule,
  _x: number,
  _width: number,
  _ctx: LayoutContext,
): Piece[] {
  return [];
}

/** Phase 2 (built next): the Repair List prints the inspection's issues with their pictures. */
export function layoutRepairList(
  _m: RepairListModule,
  _x: number,
  _width: number,
  _ctx: LayoutContext,
): Piece[] {
  return [];
}

/** A page's modules as one flow of pieces, a gap between modules. */
export function layoutModules(modules: readonly DocModule[], ctx: LayoutContext): Piece[] {
  const out: Piece[] = [];
  for (const m of modules) {
    const pieces = layoutModule(m, 0, ctx.width, ctx);
    if (!pieces.length) continue;
    if (out.length) out.push({ kind: "gap", height: MODULE_GAP });
    out.push(...pieces);
  }
  return out;
}

/** A page's modules cut at its inserted PDFs: flows of modules and whole PDFs, in order. */
export function splitAtPdf(
  modules: readonly DocModule[],
): Array<{ kind: "flow"; modules: DocModule[] } | { kind: "pdf"; module: PdfModule }> {
  const out: Array<{ kind: "flow"; modules: DocModule[] } | { kind: "pdf"; module: PdfModule }> =
    [];
  let cur: DocModule[] = [];
  for (const m of modules) {
    if (m.type === "pdf") {
      if (cur.length) out.push({ kind: "flow", modules: cur });
      cur = [];
      out.push({ kind: "pdf", module: m });
    } else cur.push(m);
  }
  if (cur.length) out.push({ kind: "flow", modules: cur });
  return out;
}

// ---------------------------------------------------------------------------- pagination

/**
 * Split a row of columns at `avail`: each column keeps the pieces that fit, the rest go to a
 * second row. Null when nothing fits (the row moves whole to the next page).
 */
export function splitColumns(
  group: Extract<Piece, { kind: "columns" }>,
  avail: number,
): [Extract<Piece, { kind: "columns" }>, Extract<Piece, { kind: "columns" }> | null] | null {
  const taken: Column[] = [];
  const rest: Column[] = [];
  let any = false;
  let remaining = false;
  for (const c of group.columns) {
    let h = 0;
    let i = 0;
    for (; i < c.pieces.length; i++) {
      const p = c.pieces[i]!;
      if (h + p.height > avail) break;
      // A piece that must stay with the next one does not end a part.
      const next = c.pieces[i + 1];
      if ("keepWithNext" in p && p.keepWithNext && next && h + p.height + next.height > avail)
        break;
      h += p.height;
    }
    // Drop a trailing gap from the part and a leading one from the rest.
    let end = i;
    while (end > 0 && c.pieces[end - 1]!.kind === "gap") end--;
    let start = i;
    while (start < c.pieces.length && c.pieces[start]!.kind === "gap") start++;
    if (end > 0) any = true;
    if (start < c.pieces.length) remaining = true;
    taken.push({ x: c.x, width: c.width, pieces: c.pieces.slice(0, end) });
    rest.push({ x: c.x, width: c.width, pieces: c.pieces.slice(start) });
  }
  if (!any) return null;
  return [columnsPiece(taken), remaining ? columnsPiece(rest) : null];
}

/**
 * Pieces onto pages `avail` tall: a piece that does not fit starts a new page (a row of columns
 * is split first; a table row brings its header along; a piece marked keepWithNext takes the
 * next piece with it). A piece taller than a whole page is placed alone and overflows rather
 * than vanish. No pieces = one empty page. A page never starts with a gap.
 */
export function paginate(pieces: readonly Piece[], avail = CONTENT_HEIGHT): Placed[][] {
  const pages: Placed[][] = [[]];
  let y = 0;
  const queue = [...pieces];
  const page = () => pages[pages.length - 1]!;
  const newPage = () => {
    pages.push([]);
    y = 0;
  };
  const place = (p: Piece) => {
    page().push({ piece: p, y });
    y += p.height;
  };
  // A table row starting a page draws its header first (when the two fit together).
  const placeWithHeader = (p: Piece) => {
    if (y === 0 && p.kind === "tableRow" && p.repeat && p.height + p.repeat.height <= avail)
      place(p.repeat);
    place(p);
  };
  // What a keepWithNext piece drags along: the gaps after it and the first real piece.
  const keepHeight = (p: Piece) => {
    if (!("keepWithNext" in p) || !p.keepWithNext) return 0;
    let h = 0;
    let k = 0;
    while (queue[k] && queue[k]!.kind === "gap") h += queue[k++]!.height;
    return queue[k] ? h + queue[k]!.height : 0;
  };
  while (queue.length) {
    const p = queue.shift()!;
    if (p.kind === "gap") {
      if (y > 0 && y + p.height <= avail) place(p);
      continue;
    }
    if (y + p.height + keepHeight(p) <= avail) {
      placeWithHeader(p);
      continue;
    }
    if (p.kind === "columns") {
      const split = splitColumns(p, avail - y);
      if (split) {
        place(split[0]);
        if (split[1]) queue.unshift(split[1]);
        if (queue.length) newPage();
        continue;
      }
    }
    if (y === 0) {
      // Nothing else on this page and still too tall: it goes here, overflowing.
      placeWithHeader(p);
      continue;
    }
    newPage();
    queue.unshift(p);
  }
  return pages;
}

// --------------------------------------------------------------------------------- footer

/** "JBK, Inc. · (606) 523-9000 · www.flatroofonline.com" from the Account variables. */
export function footerLine(vars: Record<string, string>): string {
  return [vars["account.name"], vars["account.phone"], vars["account.website"]]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}
export const pageLabel = (index: number, total: number) => `Page ${index} of ${total}`;

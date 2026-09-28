/**
 * Bid summary (PDF export) — the RENDER half. Lays a BidSummary model (bid-summary.ts) out as a
 * US-Letter LANDSCAPE PDF in the browser: a cover page, then one page run per estimator step,
 * every table through one generic drawer (auto column widths, right-aligned numbers, zebra
 * rows, wrapped / "…"-truncated text, page breaks that repeat the column header).
 *
 * pdf-lib is imported dynamically inside renderBidSummaryPdf so the estimator bundle only pays
 * for it when someone actually exports (the type imports below are erased at build time).
 * Drawing style follows the invoice renderer in invoices.server.ts (server-only, so not reused).
 */

import type { Color, PDFDocument, PDFFont, PDFPage } from "pdf-lib";

import type { BidSummary, SummaryTable } from "@/lib/bid-summary";

// US Letter landscape, points.
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 36;
const CONTENT_W = PAGE_W - 2 * MARGIN;
/** Header rule sits here; content starts below it. */
const HEADER_RULE_Y = PAGE_H - MARGIN - 14;
const CONTENT_TOP = HEADER_RULE_Y - 16;
/** Footer rule; content never goes below CONTENT_BOTTOM. */
const FOOTER_RULE_Y = MARGIN + 12;
const CONTENT_BOTTOM = FOOTER_RULE_Y + 10;

// Table metrics.
const CELL_SIZE = 7.5;
const LINE_H = 9.5;
const PAD_X = 3;
const PAD_TOP = 2.5;
const PAD_BOTTOM = 2.5;
/** A wrapped cell shows at most this many lines; the last one ends in "…" when cut. */
const MAX_CELL_LINES = 4;
/** Text columns are never squeezed below this (unless the table simply cannot fit). */
const MIN_TEXT_COL = 42;
/** Narrow tables are widened to this (not to the full page) so values stay near labels. */
const SMALL_TABLE_W = 400;

const ELLIPSIS = "…";

/**
 * pdf-lib's standard fonts encode WinAnsi only: keep Latin-1 plus the WinAnsi extras (dashes,
 * curly quotes, bullet, ellipsis…), swap the few symbols the app uses for ASCII, and replace
 * anything else so a stray character can never make drawText throw.
 */
const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function clean(s: string): string {
  return s
    .replace(/\u2032/g, "'")
    .replace(/\u2033/g, '"')
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .replace(/[\u2192\u21d2]/g, "->")
    .replace(/[\u00a0\u2007\u2009\u202f]/g, " ")
    .replace(/\t/g, " ")
    .replace(/[^\n\u0020-\u007e\u00a0-\u00ff]/g, (ch) => (WINANSI_EXTRA.includes(ch) ? ch : "?"));
}

interface Ctx {
  pdf: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  rgb: (r: number, g: number, b: number) => Color;
  page: PDFPage;
  y: number;
  model: BidSummary;
}

const INK = [0.12, 0.12, 0.14] as const;
const MUTED = [0.42, 0.42, 0.46] as const;
const RULE = [0.72, 0.72, 0.75] as const;
const HEAD_FILL = [0.87, 0.89, 0.92] as const;
const ZEBRA_FILL = [0.955, 0.96, 0.97] as const;
const ACCENT = [0.1, 0.27, 0.5] as const;

const col = (c: Ctx, t: readonly [number, number, number]) => c.rgb(t[0], t[1], t[2]);
const width = (f: PDFFont, s: string, size: number) => f.widthOfTextAtSize(s, size);

function text(
  c: Ctx,
  s: string,
  x: number,
  y: number,
  size: number,
  opts: { bold?: boolean; color?: readonly [number, number, number]; page?: PDFPage } = {},
) {
  if (!s) return;
  (opts.page ?? c.page).drawText(s, {
    x,
    y,
    size,
    font: opts.bold ? c.bold : c.font,
    color: col(c, opts.color ?? INK),
  });
}

function hline(
  c: Ctx,
  y: number,
  color: readonly [number, number, number] = RULE,
  t = 0.5,
  w = CONTENT_W,
) {
  c.page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + w, y },
    thickness: t,
    color: col(c, color),
  });
}

/** Cut `s` to fit `w`, ending in "…" when anything was dropped (or always, with `force`). */
function truncate(f: PDFFont, s: string, size: number, w: number, force = false): string {
  if (!force && width(f, s, size) <= w) return s;
  let lo = 0;
  let hi = s.length;
  // Binary search the longest prefix that still fits with the ellipsis.
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (width(f, s.slice(0, mid).trimEnd() + ELLIPSIS, size) <= w) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? s.slice(0, lo).trimEnd() + ELLIPSIS : "";
}

/** Word-wrap `s` (already cleaned) to `w`; words longer than a line are truncated. */
function wrap(f: PDFFont, s: string, size: number, w: number, maxLines: number): string[] {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const t = line ? `${line} ${word}` : word;
      if (width(f, t, size) <= w) line = t;
      else {
        if (line) out.push(line);
        line = width(f, word, size) <= w ? word : truncate(f, word, size, w);
      }
    }
    out.push(line);
  }
  if (out.length > maxLines) {
    // Too long for the cell: keep the first lines and mark the cut on the last one.
    out.length = maxLines;
    out[maxLines - 1] = truncate(f, out[maxLines - 1]!, size, w, true);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages
// ─────────────────────────────────────────────────────────────────────────────

function newPage(c: Ctx) {
  c.page = c.pdf.addPage([PAGE_W, PAGE_H]);
  c.y = CONTENT_TOP;
  // Header: fixed text, drawn now. Footers need the final page count, so they come last.
  const top = PAGE_H - MARGIN - 9;
  text(c, "JBK Portal — Bid summary", MARGIN, top, 9, { bold: true, color: ACCENT });
  const right = clean([c.model.bidName, c.model.customer].filter(Boolean).join("  ·  "));
  const r = truncate(c.font, right, 9, CONTENT_W / 2);
  text(c, r, PAGE_W - MARGIN - width(c.font, r, 9), top, 9, { color: MUTED });
  hline(c, HEADER_RULE_Y, RULE, 0.75);
}

/** Start a new page when fewer than `h` points remain. */
function ensure(c: Ctx, h: number): boolean {
  if (c.y - h < CONTENT_BOTTOM) {
    newPage(c);
    return true;
  }
  return false;
}

function paragraph(
  c: Ctx,
  s: string,
  size: number,
  opts: { bold?: boolean; color?: readonly [number, number, number]; x?: number; w?: number } = {},
) {
  const x = opts.x ?? MARGIN;
  const f = opts.bold ? c.bold : c.font;
  for (const line of wrap(f, clean(s), size, opts.w ?? CONTENT_W, 200)) {
    ensure(c, size + 3);
    text(c, line, x, c.y - size, size, opts);
    c.y -= size + 3;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Table drawer
// ─────────────────────────────────────────────────────────────────────────────

/** Column widths: natural widths when they fit, otherwise text columns give way first. */
function columnWidths(c: Ctx, t: SummaryTable, cells: string[][], heads: string[]): number[] {
  const n = t.columns.length;
  const cap = CONTENT_W * 0.45;
  let capped = false;
  const natural = t.columns.map((_, i) => {
    let w = width(c.bold, heads[i]!, CELL_SIZE);
    for (const r of cells) {
      for (const part of (r[i] ?? "").split("\n")) w = Math.max(w, width(c.font, part, CELL_SIZE));
    }
    // Cap so one long note cannot claim the whole row before wrapping kicks in.
    if (w > cap) capped = true;
    return Math.min(w, cap) + 2 * PAD_X + 1;
  });
  const isText = t.columns.map((cl) => cl.align !== "right");
  const total = natural.reduce((a, b) => a + b, 0);
  let widths: number[];
  if (total <= CONTENT_W) {
    // Room to spare: wide tables take the full width; small ones (label / value lists) only
    // grow to a readable width so their numbers stay near their labels. Text columns share
    // the growth (every column does, for all-numeric tables).
    const wide = capped || total >= CONTENT_W * 0.6;
    const target = wide ? CONTENT_W : Math.max(total, SMALL_TABLE_W);
    const extra = target - total;
    const pool = isText.some(Boolean) ? isText : natural.map(() => true);
    const poolW = natural.reduce((a, w, i) => a + (pool[i] ? w : 0), 0);
    widths = natural.map((w, i) => (pool[i] ? w + (extra * w) / poolW : w));
  } else {
    // Too wide: numbers keep their width, text columns shrink in proportion (with a floor).
    const fixed = natural.reduce((a, w, i) => a + (isText[i] ? 0 : w), 0);
    const textNat = total - fixed;
    const room = CONTENT_W - fixed;
    widths = natural.map((w, i) =>
      isText[i] ? Math.max(Math.min(w, MIN_TEXT_COL), (w * room) / textNat) : w,
    );
  }
  // Last resort (very many columns): scale everything to fit.
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum > CONTENT_W) widths = widths.map((w) => (w * CONTENT_W) / sum);
  return n ? widths : [];
}

function drawTable(c: Ctx, t: SummaryTable) {
  const heads = t.columns.map((cl) => clean(cl.label));
  const cells = t.rows.map((r) => t.columns.map((_, i) => clean(r[i] ?? "")));
  const widths = columnWidths(c, t, cells, heads);
  const tableW = widths.reduce((a, b) => a + b, 0);
  const xs: number[] = [];
  widths.reduce((x, w, i) => ((xs[i] = x), x + w), MARGIN);
  const totals = new Set(t.totalRows ?? []);

  const layoutRow = (row: string[], bold: boolean, maxLines = MAX_CELL_LINES) =>
    row.map((v, i) => {
      const f = bold ? c.bold : c.font;
      const inner = widths[i]! - 2 * PAD_X;
      // Numbers stay on one line (a wrapped amount misleads); text wraps.
      return t.columns[i]!.align === "right"
        ? [truncate(f, v.replace(/\n/g, " "), CELL_SIZE, inner)]
        : wrap(f, v, CELL_SIZE, inner, maxLines);
    });
  const rowHeight = (lines: string[][]) =>
    PAD_TOP + Math.max(1, ...lines.map((l) => l.length)) * LINE_H + PAD_BOTTOM;

  const drawCells = (lines: string[][], top: number, bold: boolean) => {
    lines.forEach((ls, i) => {
      const f = bold ? c.bold : c.font;
      ls.forEach((ln, k) => {
        const y = top - PAD_TOP - CELL_SIZE - k * LINE_H + 0.5;
        const x =
          t.columns[i]!.align === "right"
            ? xs[i]! + widths[i]! - PAD_X - width(f, ln, CELL_SIZE)
            : xs[i]! + PAD_X;
        text(c, ln, x, y, CELL_SIZE, { bold });
      });
    });
  };

  const headLines = layoutRow(heads, true, 3);
  const headH = rowHeight(headLines);
  const drawHead = () => {
    c.page.drawRectangle({
      x: MARGIN,
      y: c.y - headH,
      width: tableW,
      height: headH,
      color: col(c, HEAD_FILL),
    });
    drawCells(headLines, c.y, true);
    c.y -= headH;
  };

  // Keep the title, the header and the first row together.
  const firstH = cells.length ? rowHeight(layoutRow(cells[0]!, totals.has(0))) : 0;
  ensure(c, (t.title ? 16 : 0) + headH + firstH);
  if (t.title) {
    text(c, clean(t.title), MARGIN, c.y - 10, 10, { bold: true });
    c.y -= 15;
  }
  drawHead();

  cells.forEach((row, ri) => {
    const bold = totals.has(ri);
    const lines = layoutRow(row, bold);
    const h = rowHeight(lines);
    if (ensure(c, h)) {
      // Continued on a fresh page: say so and repeat the column header.
      if (t.title) {
        text(c, clean(`${t.title} (continued)`), MARGIN, c.y - 9, 8.5, { color: MUTED });
        c.y -= 13;
      }
      drawHead();
    }
    if (ri % 2 === 1 && !bold) {
      c.page.drawRectangle({
        x: MARGIN,
        y: c.y - h,
        width: tableW,
        height: h,
        color: col(c, ZEBRA_FILL),
      });
    }
    if (bold) hline(c, c.y, INK, 0.6, tableW);
    drawCells(lines, c.y, bold);
    c.y -= h;
  });
  hline(c, c.y, RULE, 0.5, tableW);
  c.y -= 14;
}

// ─────────────────────────────────────────────────────────────────────────────
// Document
// ─────────────────────────────────────────────────────────────────────────────

export async function renderBidSummaryPdf(model: BidSummary): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const c: Ctx = {
    pdf,
    font: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    rgb,
    page: undefined as unknown as PDFPage,
    y: 0,
    model,
  };
  pdf.setTitle(clean(model.title));
  pdf.setSubject(clean(`Bid summary for ${model.bidName}`));
  pdf.setCreator("JBK Portal");
  pdf.setProducer("JBK Portal");

  // ── Cover ──
  newPage(c);
  c.y -= 8;
  paragraph(c, model.bidName, 24, { bold: true });
  c.y -= 2;
  paragraph(c, `Bid summary — exported ${model.exportedAt}`, 11, { color: MUTED });
  c.y -= 14;
  const labelW = 120;
  for (const m of model.meta) {
    const lines = wrap(c.font, clean(m.value), 11, CONTENT_W - labelW, 6);
    ensure(c, lines.length * 15 + 4);
    text(c, clean(m.label), MARGIN, c.y - 11, 10, { bold: true, color: MUTED });
    lines.forEach((ln, i) => text(c, ln, MARGIN + labelW, c.y - 11 - i * 15, 11));
    c.y -= lines.length * 15 + 4;
  }
  c.y -= 12;
  ensure(c, 30);
  text(c, "Steps in this summary", MARGIN, c.y - 11, 11, { bold: true });
  c.y -= 20;
  // Step list; page numbers are filled in once the steps have been laid out.
  const tocSlots: Array<{ page: PDFPage; y: number }> = [];
  model.steps.forEach((s, i) => {
    ensure(c, 15);
    text(c, clean(`${i + 1}.  ${s.label}`), MARGIN + 8, c.y - 10, 10);
    tocSlots.push({ page: c.page, y: c.y - 10 });
    c.y -= 15;
  });

  // ── One section per step, each on its own page ──
  const stepPage: number[] = [];
  model.steps.forEach((s, i) => {
    newPage(c);
    stepPage.push(pdf.getPageCount());
    text(c, clean(`${i + 1}. ${s.label}`), MARGIN, c.y - 16, 16, { bold: true, color: ACCENT });
    c.y -= 28;
    for (const t of s.tables) drawTable(c, t);
    for (const n of s.notes ?? []) {
      paragraph(c, n, 9, { color: MUTED });
      c.y -= 2;
    }
  });

  tocSlots.forEach((slot, i) => {
    const label = `page ${stepPage[i]}`;
    text(c, label, MARGIN + 260 - width(c.font, label, 10), slot.y, 10, {
      color: MUTED,
      page: slot.page,
    });
  });

  // ── Footers (now that the page count is known) ──
  const pages = pdf.getPages();
  const date = clean(`Exported ${model.exportedAt}`);
  const total = clean(`Bid total ${model.grandTotal}`);
  pages.forEach((page, i) => {
    c.page = page;
    hline(c, FOOTER_RULE_Y, RULE, 0.5);
    const y = MARGIN;
    text(c, `Page ${i + 1} of ${pages.length}`, MARGIN, y, 8, { color: MUTED });
    text(c, date, (PAGE_W - width(c.font, date, 8)) / 2, y, 8, { color: MUTED });
    text(c, total, PAGE_W - MARGIN - width(c.bold, total, 8), y, 8, { bold: true });
  });

  return pdf.save();
}

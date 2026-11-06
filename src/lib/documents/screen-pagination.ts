/**
 * The editor's sheets from the PDF's own pagination (owner, Nov 6: "make the splits match
 * print" — the screen showed four sheets where the PDF printed three; the editor used to pack
 * modules by their measured heights on screen, which differ from the PDF's). The modules of a
 * page are laid out by pdf-layout.ts exactly as the server does it (the same text metrics, the
 * pictures' sizes reported by the editor, the same pricing and inspection sources), paginated
 * by the same `paginate`, and the result is read back as "which modules are on which sheet,
 * and where a module that runs over is cut" — in points from the module's top, plus for a text
 * cut the block and the wrapped line it falls on, so the canvas can find the same spot in the
 * box it draws. Pure: no DOM, no React; page-canvas.tsx turns the points into screen pixels.
 */
import type { DocModule } from "./model";
import {
  type LayoutContext,
  layoutModulesWithOwners,
  paginate,
  type Piece,
  splitAtPdf,
} from "./pdf-layout";

/** Where a module is cut: `pt` from its top, and for a text line the block and line it starts. */
export interface ModuleCut {
  pt: number;
  block?: number | undefined;
  line?: number | undefined;
}

/** A module, or the part of it from `from` to `to`, on one sheet (both absent = whole). */
export interface ModulePart {
  id: string;
  from?: ModuleCut | undefined;
  to?: ModuleCut | undefined;
  /** A part already in screen pixels (the canvas's fallback packing before the metrics load). */
  px?: { id: string; from?: number | undefined; to?: number | undefined } | undefined;
}

export interface ScreenSheet {
  parts: ModulePart[];
  /** An inserted PDF's own sheet: how many printed pages it takes. */
  pdfPages?: number | undefined;
}

export interface ScreenPagination {
  sheets: ScreenSheet[];
  /** Each module's laid-out height in points (0 for one that prints nothing). */
  totals: Record<string, number>;
}

/**
 * One flow of modules (no inserted PDF among them) onto sheets `avail` points tall, as the PDF
 * pages it. A module that prints nothing (an empty Pricing Table, a picture module with Photos
 * off) is shown on the sheet the module before it ends on, so it can still be edited.
 */
export function paginateFlow(
  modules: readonly DocModule[],
  ctx: LayoutContext,
  avail: number,
): ScreenPagination {
  const { pieces, owner } = layoutModulesWithOwners(modules, ctx);
  const totals: Record<string, number> = {};
  for (const m of modules) totals[m.id] = 0;
  for (const p of pieces) {
    const id = owner.get(p);
    if (id) totals[id] = (totals[id] ?? 0) + p.height;
  }
  const pages = paginate(pieces, avail);

  // Walk the placed pieces in order. A piece the paginator made while splitting a row of
  // columns is not in `owner`: it belongs to the original piece being split, the first owned
  // piece not placed yet (the pointer walks the original order as owned pieces land). Each
  // module's placed height runs up as its pieces land, so a continuation knows its offset.
  const index = new Map(pieces.map((p, i) => [p, i] as const));
  let pointer = 0;
  const ownerAhead = (): string | null => {
    let k = pointer;
    while (k < pieces.length && !owner.has(pieces[k]!)) k++;
    return owner.get(pieces[k]!) ?? null;
  };
  const placedPt: Record<string, number> = {};
  const seen = new Set<Piece>();
  const sheets: ScreenSheet[] = pages.map(() => ({ parts: [] }));
  const lastPartOf: Record<string, { sheet: number; part: ModulePart }> = {};
  // A continuation part waiting for its first fresh piece to say where the cut is (a repeated
  // table header at the top of the page is not that piece).
  const needCut = new Map<ModulePart, ModulePart>();
  pages.forEach((placed, si) => {
    const parts = sheets[si]!.parts;
    for (const { piece } of placed) {
      let id: string | null;
      if (owner.has(piece)) {
        id = owner.get(piece)!;
        const i = index.get(piece);
        if (i !== undefined && i >= pointer) pointer = i + 1;
      } else if (piece.kind === "gap" || piece.kind === "pageBreak") continue;
      else id = ownerAhead();
      if (!id) continue;
      // A table header drawn again at the top of a page is the same piece placed twice.
      const repeat = seen.has(piece);
      seen.add(piece);
      let part = parts[parts.length - 1];
      if (!part || part.id !== id) {
        part = { id };
        const earlier = lastPartOf[id];
        if (earlier) needCut.set(part, earlier.part);
        parts.push(part);
        lastPartOf[id] = { sheet: si, part };
      }
      if (repeat) continue;
      const earlier = needCut.get(part);
      if (earlier) {
        const cut: ModuleCut = {
          pt: placedPt[id] ?? 0,
          ...(piece.kind === "text" && piece.block !== undefined
            ? { block: piece.block, line: piece.lineIndex ?? 0 }
            : {}),
        };
        earlier.to = cut;
        part.from = cut;
        needCut.delete(part);
      }
      placedPt[id] = (placedPt[id] ?? 0) + piece.height;
    }
  });

  // Modules that print nothing: after the module before them, on its last sheet.
  let prev: string | null = null;
  for (const m of modules) {
    if (lastPartOf[m.id]) {
      prev = m.id;
      continue;
    }
    const at = prev ? lastPartOf[prev] : undefined;
    const sheet = at ? sheets[at.sheet]! : sheets[0]!;
    const part: ModulePart = { id: m.id };
    const k = at ? sheet.parts.indexOf(at.part) + 1 : 0;
    sheet.parts.splice(k, 0, part);
    lastPartOf[m.id] = { sheet: at ? at.sheet : 0, part };
    prev = m.id;
  }
  return { sheets, totals };
}

/**
 * A page's sheets: its modules cut at the inserted PDFs (splitAtPdf), each flow paginated on
 * fresh sheets as the PDF does, an inserted PDF on a sheet of its own that counts its pages in
 * the printed numbering. A page with no modules is one empty sheet.
 */
export function paginatePage(
  modules: readonly DocModule[],
  ctx: LayoutContext,
  avail: number,
): ScreenPagination {
  const sheets: ScreenSheet[] = [];
  const totals: Record<string, number> = {};
  for (const seg of splitAtPdf(modules)) {
    if (seg.kind === "pdf") {
      sheets.push({ parts: [{ id: seg.module.id }], pdfPages: Math.max(1, seg.module.pageCount) });
      totals[seg.module.id] = 0;
      continue;
    }
    const flow = paginateFlow(seg.modules, ctx, avail);
    sheets.push(...flow.sheets);
    Object.assign(totals, flow.totals);
  }
  if (!sheets.length) sheets.push({ parts: [] });
  return { sheets, totals };
}

/** How many printed pages a page's sheets take (an inserted PDF counts its own pages). */
export const printedPages = (sheets: readonly ScreenSheet[]): number =>
  sheets.reduce((n, s) => n + (s.pdfPages ?? 1), 0);

/**
 * The screen position of a cut inside a module `heightPx` tall on screen and `totalPt` tall in
 * print: by the same share of the height, unless the cut names a text line the caller located
 * (`linePx`, from the box it draws) or the module has rows that may start a sheet (`rowTops`,
 * the `[data-break]` rows: the nearest one is where the PDF cut between rows). Pure.
 */
export function cutPx(
  cut: ModuleCut,
  totalPt: number,
  heightPx: number,
  located: { linePx?: number | undefined; rowTops?: readonly number[] | undefined } = {},
): number {
  if (located.linePx !== undefined && Number.isFinite(located.linePx))
    return Math.max(0, Math.min(heightPx, located.linePx));
  const share = totalPt > 0 ? Math.max(0, Math.min(1, cut.pt / totalPt)) : 0;
  const estimate = share * heightPx;
  const rows = (located.rowTops ?? []).filter((t) => t > 0 && t < heightPx);
  if (rows.length) {
    let best = rows[0]!;
    for (const t of rows) if (Math.abs(t - estimate) < Math.abs(best - estimate)) best = t;
    return best;
  }
  return estimate;
}

/**
 * Owner, Nov 6: "please make the splits match print" — the editor showed four sheets where the
 * PDF printed three. The sheets now come from the PDF's own pagination (screen-pagination.ts):
 * the modules laid out by pdf-layout.ts and paginated by `paginate`, read back per module.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { type DocModule, newModule, newPdfModule, richFromText } from "./model";
import {
  BODY_SIZE,
  CONTENT_WIDTH,
  type LayoutContext,
  layoutModule,
  layoutModulesWithOwners,
  layoutRich,
  lineHeightOf,
  type Measure,
  MODULE_GAP,
  pdfSafeText,
} from "./pdf-layout";
import { cutPx, paginateFlow, paginatePage, printedPages } from "./screen-pagination";
import { variableLabel } from "./variables";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

const measure: Measure = (text, _font, size) => text.length * size * 0.5;
const ctx = (over: Partial<LayoutContext> = {}): LayoutContext => ({
  width: CONTENT_WIDTH,
  measure,
  vars: {},
  labelOf: variableLabel,
  image: () => ({ width: 400, height: 300 }),
  pricing: { bid: null },
  ...over,
});
const body = (lines: number, id = "b") =>
  ({
    ...newModule("body"),
    id,
    text: richFromText(Array.from({ length: lines }, (_, i) => `Line ${i + 1}`).join("\n")),
  }) as DocModule;
const LINE = lineHeightOf(BODY_SIZE);

describe("pdf-layout: what the editor reads back", () => {
  it("every rich-text line carries its block and its line within the block", () => {
    const doc = richFromText("one\n\ntwo words that wrap a lot a lot a lot a lot a lot");
    const pieces = layoutRich(doc, 0, 100, ctx());
    const texts = pieces.filter((p) => p.kind === "text");
    expect(texts[0]).toMatchObject({ block: 0, lineIndex: 0 });
    // Block 1 is the blank paragraph (a gap); block 2 wraps onto several lines.
    expect(texts[1]).toMatchObject({ block: 2, lineIndex: 0 });
    expect(texts[2]).toMatchObject({ block: 2, lineIndex: 1 });
  });
  it("layoutModulesWithOwners names each piece's module; the gaps between modules belong to none", () => {
    const a = body(2, "a");
    const b = body(1, "b");
    const { pieces, owner } = layoutModulesWithOwners([a, b], ctx());
    expect(pieces.map((p) => owner.get(p) ?? "-")).toEqual(["a", "a", "a", "-", "b"]);
    expect(pieces[3]).toEqual({ kind: "gap", height: MODULE_GAP });
  });
  it("pdfSafeText swaps the characters pdf-lib's Helvetica lacks, bullet kept", () => {
    expect(pdfSafeText("a – b — “c” ‘d’ • é ✓")).toBe("a - b - \"c\" 'd' • é ?");
  });
});

describe("paginateFlow", () => {
  it("modules that fit share one sheet, whole", () => {
    const r = paginateFlow([body(3, "a"), body(2, "b")], ctx(), 500);
    expect(r.sheets).toEqual([{ parts: [{ id: "a" }, { id: "b" }] }]);
    expect(r.totals).toEqual({ a: 3 * LINE + 2 * 4, b: 2 * LINE + 4 });
  });
  it("a text module that runs over is cut where the PDF cuts it: the line that starts the next page, in points and as block + line", () => {
    // 10 lines of LINE each with a 4 pt gap after each paragraph; the page takes 4 lines.
    const avail = 4 * LINE + 3 * 4 + 1;
    const r = paginateFlow([body(10, "a")], ctx(), avail);
    expect(r.sheets.length).toBeGreaterThan(1);
    const first = r.sheets[0]!.parts[0]!;
    const second = r.sheets[1]!.parts[0]!;
    expect(first.id).toBe("a");
    expect(first.from).toBeUndefined();
    // The paginator drops the gap that would not fit under line 4, so the offset is what was placed.
    expect(first.to).toEqual({ pt: 4 * LINE + 3 * 4, block: 4, line: 0 });
    expect(second.from).toEqual(first.to);
    expect(second.to?.block).toBe(8);
  });
  it("a module that prints nothing sits after the module before it, on that module's last sheet", () => {
    // Price lines with nothing typed print nothing (pdf-layout priceLinesEmpty).
    const empty = { ...newModule("priceLines"), id: "pt" } as DocModule;
    const r = paginateFlow([body(10, "a"), empty, body(1, "b")], ctx(), 4 * LINE + 3 * 4 + 1);
    const last = r.sheets[r.sheets.length - 1]!.parts.map((p) => p.id);
    expect(last).toEqual(["a", "pt", "b"]);
    expect(r.totals["pt"]).toBe(0);
    // Ahead of everything when it is first.
    const r2 = paginateFlow([empty, body(1, "b")], ctx(), 500);
    expect(r2.sheets[0]!.parts.map((p) => p.id)).toEqual(["pt", "b"]);
  });
  it("one empty sheet for no modules", () => {
    expect(paginateFlow([], ctx(), 500).sheets).toEqual([{ parts: [] }]);
  });
  it("a row of columns that is split keeps its offset: the second part starts where the first ended", () => {
    const two = {
      ...newModule("twoColumns"),
      id: "tc",
      left: richFromText(Array.from({ length: 10 }, (_, i) => `L${i}`).join("\n")),
      right: richFromText("R"),
    } as DocModule;
    const avail = 4 * LINE + 3 * 4 + 1;
    const r = paginateFlow([two], ctx(), avail);
    expect(r.sheets.length).toBe(3);
    const [p0, p1, p2] = r.sheets.map((s) => s.parts[0]!);
    expect(p0!.to?.pt).toBeGreaterThan(0);
    expect(p1!.from).toEqual(p0!.to);
    expect(p1!.to!.pt).toBeGreaterThan(p1!.from!.pt);
    expect(p2!.from).toEqual(p1!.to);
    expect(p2!.to).toBeUndefined();
    // No block/line on a columns cut: the canvas maps it by share of the height.
    expect(p1!.from?.block).toBeUndefined();
  });
});

describe("paginatePage and the printed numbering", () => {
  it("an inserted PDF is a sheet of its own that counts its pages; the flows around it start fresh sheets", () => {
    const pdf = { ...newPdfModule({ id: "as", name: "Spec", pageCount: 3 }), id: "pdf" };
    const r = paginatePage([body(1, "a"), pdf, body(1, "b")], ctx(), 500);
    expect(r.sheets).toEqual([
      { parts: [{ id: "a" }] },
      { parts: [{ id: "pdf" }], pdfPages: 3 },
      { parts: [{ id: "b" }] },
    ]);
    expect(printedPages(r.sheets)).toBe(5);
    expect(paginatePage([], ctx(), 500).sheets).toEqual([{ parts: [] }]);
  });
  it("matches layoutModule: a Full Photo's piece height is what the picture's reported size gives", () => {
    const photo = {
      ...newModule("fullPhoto"),
      id: "fp",
      image: { kind: "logo" },
      heightIn: 0,
    } as DocModule;
    const pieces = layoutModule(photo, 0, CONTENT_WIDTH, ctx());
    const r = paginateFlow([photo], ctx(), 900);
    expect(r.totals["fp"]).toBe(pieces.reduce((a, p) => a + p.height, 0));
  });
});

describe("cutPx", () => {
  it("a located text line wins; else the nearest row that may start a sheet; else the share of the height", () => {
    expect(cutPx({ pt: 50, block: 2, line: 1 }, 100, 400, { linePx: 123 })).toBe(123);
    expect(cutPx({ pt: 50 }, 100, 400, { rowTops: [90, 210, 300] })).toBe(210);
    expect(cutPx({ pt: 50 }, 100, 400)).toBe(200);
    expect(cutPx({ pt: 50 }, 0, 400)).toBe(0);
    expect(cutPx({ pt: 50 }, 100, 400, { linePx: 999 })).toBe(400);
  });
});

describe("the editor wires it", () => {
  const canvas = read("src/components/documents/editor/page-canvas.tsx");
  const route = read("src/routes/documents.tsx");
  const picker = read("src/components/documents/editor/photo-picker.tsx");
  const views = read("src/components/documents/editor/module-view.tsx");
  it("the canvas builds the server's layout context and draws the sheets from paginatePage", () => {
    expect(canvas).toContain(
      "paginatePage(props.page.modules, ctx, contentHeightFor(env.options))",
    );
    expect(canvas).toContain("vars: displayVariables(env.variables)");
    expect(canvas).toContain("image: (_ref, key) => env.imageSizes[key] ?? null");
    expect(canvas).toContain("pricingSource(env.variables)");
    expect(canvas).toContain("inspection: storedInspection(env.variables)");
    expect(canvas).toContain("onSheetCount(pageId, printed);");
    expect(canvas).toContain("· inserted PDF");
    // The cut: a text line located in the box, the rows, else the share (cutPx).
    expect(canvas).toContain('querySelectorAll<HTMLElement>("p, h1, h2, h3, hr")');
    expect(canvas).toContain(
      "return cutPx(cut, screen?.totals[id] ?? 0, h, el ? locateCut(el, cut, props.scale) : {});",
    );
  });
  it("the screen's text is set like the PDF's: 10.5 pt body, 18 / 14 / 12 pt headings, 1.35 line height, 4 pt paragraph gap, 18 pt list indent, 10 pt module gap", () => {
    expect(canvas).toContain("font-size: 10.5pt; line-height: 1.35;");
    expect(canvas).toContain(".doc-prose p { margin: 0 0 4pt;");
    // A blank line is 6 pt in print (BLANK_PARAGRAPH); on screen too, so a letter's blank lines
    // do not push its text past the page-break line.
    expect(canvas).toContain("p:has(> br:only-child) { min-height: 0; height: 6pt;");
    expect(read("src/components/documents/editor/photo-picker.tsx")).toContain(
      "prints nothing until a picture is chosen",
    );
    expect(canvas).toContain("h1 { font-size: 18pt;");
    expect(canvas).toContain("h2 { font-size: 14pt;");
    expect(canvas).toContain("h3 { font-size: 12pt;");
    expect(canvas).toContain("padding-left: 18pt;");
    expect(canvas).toContain("const MODULE_GAP_PX = (MODULE_GAP * 4) / 3;");
    expect(canvas).toContain("style={{ gap: MODULE_GAP_PX }}");
  });
  it("the PDF's Helvetica metrics load once in the browser; every picture reports its size under the layout's key", () => {
    const measureFile = read("src/components/documents/editor/screen-measure.ts");
    expect(measureFile).toContain('await import("pdf-lib")');
    expect(measureFile).toContain("StandardFonts.HelveticaBoldOblique");
    expect(measureFile).toContain("widthOfTextAtSize(pdfSafeText(text), size)");
    expect(route).toContain("const measure = usePdfMeasure();");
    expect(route).toContain("reportImageSize,");
    expect(picker).toContain("onNaturalSize={");
    expect(picker).toContain("report(sizeKey, { width: box.w, height: box.h });");
    expect(picker).toContain("if (sizeKey && (noSrc || failed)) report(sizeKey, null);");
    for (const key of [
      "sizeKey={`${m.id}:0`}",
      "sizeKey={`${m.id}:${i}`}",
      "sizeKey={photoGridKey(m.id, i)}",
      "sizeKey={repairListKey(m.id, r, pi)}",
      "sizeKey={repairItemKey(m.id, pi)}",
    ])
      expect(views).toContain(key);
    // The server's measure and drawer clean text the same way the browser's measure does.
    expect(read("src/lib/documents/document-pdf.server.ts")).toContain(
      "const clean = pdfSafeText;",
    );
  });
});

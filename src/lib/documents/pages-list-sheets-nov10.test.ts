/**
 * Nov 10: "when you import something as multiple pages it still only shows two pages total even
 * though there a lot more than 2 due to the import. also add a button at the bottom of the page
 * to the right that says save page as snippet so its easier to do and reuse".
 *
 * The Document tab's Pages list counted the editor's own pages only: a page holding an imported
 * three-page PDF was one row and one in the total. It now counts and lists every sheet the
 * canvas lays out, and each page has its own "Save page as snippet" button under it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PDF_PREVIEW_MAX_PAGES,
  pageSheetInfos,
  SHEET_OF_ATTR,
  sheetInfoLabel,
  sheetInfoPages,
  totalSheetPages,
} from "./editor-helpers";

const flat = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");
const route = flat("src/routes/documents.tsx");
const canvas = flat("src/components/documents/editor/page-canvas.tsx");
const pdf = flat("src/components/documents/editor/pdf-preview.tsx");

describe("the sheets of one page", () => {
  it("a plain page is one sheet; a page that runs over has continued sheets", () => {
    expect(pageSheetInfos([{}])).toEqual([{ kind: "page" }]);
    expect(pageSheetInfos([{}, {}, {}])).toEqual([
      { kind: "page" },
      { kind: "continued" },
      { kind: "continued" },
    ]);
  });

  it("an imported PDF is one sheet per PDF page", () => {
    const infos = pageSheetInfos([{}, { pdf: { name: "Plans", pageCount: 3 } }]);
    expect(infos).toEqual([
      { kind: "page" },
      { kind: "pdf", name: "Plans", n: 1, of: 3 },
      { kind: "pdf", name: "Plans", n: 2, of: 3 },
      { kind: "pdf", name: "Plans", n: 3, of: 3 },
    ]);
    expect(sheetInfoPages(infos)).toBe(4);
    expect(infos.slice(1).map(sheetInfoLabel)).toEqual([
      "Plans, page 1 of 3",
      "Plans, page 2 of 3",
      "Plans, page 3 of 3",
    ]);
  });

  it("text after the PDF is a continued sheet, not a second page", () => {
    expect(
      pageSheetInfos([{}, { pdf: { name: "A", pageCount: 1 } }, {}]).map((s) => s.kind),
    ).toEqual(["page", "pdf", "continued"]);
    expect(sheetInfoLabel({ kind: "pdf", name: "A", n: 1, of: 1 })).toBe("A");
    expect(sheetInfoLabel({ kind: "continued" })).toBe("continued");
  });

  it("a page that is only a PDF has no page sheet, and still counts every PDF page", () => {
    const infos = pageSheetInfos([{ pdf: { name: "Spec", pageCount: 2 } }]);
    expect(infos.map((s) => s.kind)).toEqual(["pdf", "pdf"]);
    expect(sheetInfoPages(infos)).toBe(2);
  });

  it("PDF pages the canvas does not draw are one line and count in full", () => {
    const long = PDF_PREVIEW_MAX_PAGES + 28;
    const infos = pageSheetInfos([{ pdf: { name: "Manual", pageCount: long } }]);
    expect(infos).toHaveLength(PDF_PREVIEW_MAX_PAGES + 1);
    expect(infos.at(-1)).toEqual({ kind: "more", name: "Manual", count: 28 });
    expect(sheetInfoLabel(infos.at(-1)!)).toBe("28 more pages of Manual");
    expect(sheetInfoLabel({ kind: "more", name: "Manual", count: 1 })).toBe(
      "1 more page of Manual",
    );
    expect(sheetInfoPages(infos)).toBe(long);
  });

  it("a PDF whose page count is not known yet is one sheet", () => {
    expect(sheetInfoPages(pageSheetInfos([{ pdf: { name: "X", pageCount: 0 } }]))).toBe(1);
  });
});

describe("the Pages total", () => {
  it("adds every sheet of every page; a page not laid out yet is one", () => {
    const byPage = {
      a: pageSheetInfos([{}]),
      b: pageSheetInfos([{}, { pdf: { name: "Plans", pageCount: 3 } }]),
    };
    // The owner's case: two editor pages, one holding a three-page import, read "Pages (2)".
    expect(totalSheetPages(["a", "b"], byPage)).toBe(5);
    expect(totalSheetPages(["a", "b", "new"], byPage)).toBe(6);
    expect(totalSheetPages(["a"], { a: [] })).toBe(1);
  });

  it("a deleted page's old sheets are not counted", () => {
    expect(
      totalSheetPages(["a"], { a: pageSheetInfos([{}]), gone: pageSheetInfos([{}, {}]) }),
    ).toBe(1);
  });
});

describe("the Pages list is wired to the canvas", () => {
  it("the canvas reports each page's sheets and marks them", () => {
    expect(canvas).toContain("const infos = pageSheetInfos(");
    expect(canvas).toContain("onSheets?.(pageId, JSON.parse(infoKey) as SheetInfo[]);");
    expect(canvas).toContain("{...{ [SHEET_OF_ATTR]: props.page.id }}");
    expect(pdf).toContain("{...{ [SHEET_OF_ATTR]: props.pageId }}");
    expect(SHEET_OF_ATTR).toBe("data-sheet-of");
  });

  it("the header counts sheets, not editor pages", () => {
    expect(route).not.toContain("Pages ({state.pages.length})");
    expect(route).toContain(
      "{totalSheetPages( state.pages.map((p) => p.id), props.sheetsByPage ?? {}, )}",
    );
  });

  it("each extra sheet has its own row that scrolls to it", () => {
    expect(route).toContain('sheet.kind === "page" ? null : (');
    expect(route).toContain("data-sheet-row={sheet.kind}");
    expect(route).toContain("scrollToSheet(page.id, k);");
    expect(route).toContain("{sheetInfoLabel(sheet)}");
  });

  it("a report that changes nothing does not redraw the editor", () => {
    expect(route).toContain(
      "JSON.stringify(prev[pageId] ?? null) === JSON.stringify(sheets) ? prev : { ...prev, [pageId]: sheets },",
    );
  });
});

describe("Save page as snippet under each page", () => {
  it("the button sits at the right of the row under the page and names the page", () => {
    const at = canvas.indexOf("Save page as snippet </Button>");
    expect(at).toBeGreaterThan(-1);
    const button = canvas.slice(canvas.lastIndexOf("<Button", at), at);
    expect(button).toContain('className="ml-auto"');
    expect(button).toContain("title={`Save page ${i + 1} as a snippet:");
    expect(button).toContain("disabled={page.modules.length === 0}");
    expect(button).toContain("onClick={() => env.onSavePage?.(page)}");
    // After Add Page, in the same row.
    expect(canvas.lastIndexOf("Add Page </Button>", at)).toBeGreaterThan(-1);
  });

  it("it opens the same naming popup as the page menu", () => {
    expect(route).toContain("onSavePage: setSavePage,");
    // The popup no longer says the page's menu was used: the button opens it too.
    expect(route).not.toContain("whose menu you opened");
    expect(route).toContain("the page you picked, by its menu or the button under it");
    expect(route).toContain("onSheets,");
  });
});

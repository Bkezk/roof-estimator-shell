/**
 * Owner, Nov 10: page snippets (a saved snippet that is a whole page), an inserted PDF shown in
 * the editor, and Word import. Each block fails on the code before these were built.
 */
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  docxModules,
  imageSize,
  importedImageHeightIn,
  parseXml,
  readDocx,
  unzip,
  wordImportToast,
} from "./docx-import";
import {
  IMPORT_ACCEPT,
  importFileKind,
  PDF_PREVIEW_MAX_PAGES,
  pdfPreviewPages,
  pdfSheetLabel,
  PUBLISHER_IMPORT_TEXT,
} from "./editor-helpers";
import {
  insertPageSnippet,
  MAX_PAGES,
  newModule,
  pageSnippetModules,
  pageSnippetSchema,
  pagesSchema,
  type DocModule,
  type DocPage,
} from "./model";

const src = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

// ── a zip writer for the tests (one entry stored, the rest deflated) ───────────────────────
function zip(files: Record<string, Uint8Array | string>): Uint8Array {
  const enc = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  const le = (n: number, bytes: number) =>
    Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 255);
  let n = 0;
  for (const [path, body] of Object.entries(files)) {
    const raw = typeof body === "string" ? enc.encode(body) : body;
    const stored = n === 0;
    const data = stored ? raw : new Uint8Array(deflateRawSync(raw));
    const name = enc.encode(path);
    const head = [
      ...le(stored ? 0 : 8, 2),
      ...le(0, 4),
      ...le(0, 4),
      ...le(data.length, 4),
      ...le(raw.length, 4),
      ...le(name.length, 2),
      ...le(0, 2),
    ];
    const at = local.length;
    local.push(...le(0x04034b50, 4), ...le(20, 2), ...le(0, 2), ...head, ...name, ...data);
    central.push(
      ...le(0x02014b50, 4),
      ...le(20, 2),
      ...le(20, 2),
      ...le(0, 2),
      ...head,
      ...le(0, 2),
      ...le(0, 2),
      ...le(0, 2),
      ...le(0, 4),
      ...le(at, 4),
      ...name,
    );
    n++;
  }
  const end = [
    ...le(0x06054b50, 4),
    ...le(0, 4),
    ...le(n, 2),
    ...le(n, 2),
    ...le(central.length, 4),
    ...le(local.length, 4),
    ...le(0, 2),
  ];
  return new Uint8Array([...local, ...central, ...end]);
}
/** A 1 × 1 PNG header is enough for the size reader: signature + IHDR 264 × 160. */
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 8,
  0, 0, 0, 160, 8, 2, 0, 0, 0, 0, 0, 0, 0,
]);
const W = 'xmlns:w="w" xmlns:r="r" xmlns:a="a" xmlns:wp="wp"';
const run = (text: string, pr = "") =>
  `<w:r><w:rPr>${pr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const form = `<?xml version="1.0"?><w:document ${W}><w:body>
<w:p><w:r><w:drawing><wp:inline><wp:extent cx="2514600" cy="1524000"/><a:graphic><a:blip r:embed="rId5"/></a:graphic></wp:inline></w:drawing></w:r></w:p>
<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run("ROOF EVALUATION SUMMARY", '<w:b/><w:sz w:val="36"/>')}</w:p>
<w:p>${run("Customer:", '<w:b/><w:sz w:val="28"/>')}<w:r><w:tab/></w:r><w:sdt><w:sdtPr><w:showingPlcHdr/></w:sdtPr><w:sdtContent>${run("Click here to enter text.")}</w:sdtContent></w:sdt></w:p>
<w:p>${run("Bldg(s) &amp; Sq Ft:", "<w:b/>")}${run(" two ", "<w:i/>")}${run("roofs", '<w:u w:val="single"/>')}</w:p>
<w:sdt><w:sdtPr><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:p>${run("Click here to enter text.")}</w:p></w:sdtContent></w:sdt>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${run("Scope")}</w:p>
<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>${run("Tear off")}</w:p>
<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>${run("New membrane")}</w:p>
<w:p><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr>${run("First")}</w:p>
<w:tbl><w:tr><w:tc><w:p>${run("Item")}</w:p></w:tc><w:tc><w:p>${run("Qty")}</w:p></w:tc></w:tr><w:tr><w:tc><w:p>${run("Drains")}</w:p></w:tc></w:tr></w:tbl>
<w:p>${run("After the table")}</w:p>
<w:sectPr><w:headerReference r:id="rId9"/></w:sectPr>
</w:body></w:document>`;
const docx = () =>
  zip({
    "[Content_Types].xml": "<Types/>",
    "word/document.xml": form,
    "word/_rels/document.xml.rels":
      '<Relationships><Relationship Id="rId5" Target="media/image1.png"/></Relationships>',
    "word/numbering.xml": `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    "word/media/image1.png": png,
  });

describe("page snippets", () => {
  const body = (): DocModule => newModule("body");
  const page = (n: number): DocPage => ({
    id: `p${n}`,
    modules: [body(), newModule("hr"), body()],
  });

  it("a page saves as its modules in order, as fresh copies; an empty page saves nothing", () => {
    const p = page(1);
    const mods = pageSnippetModules(p)!;
    expect(mods.map((m) => m.type)).toEqual(["body", "hr", "body"]);
    expect(mods.map((m) => m.id)).not.toEqual(p.modules.map((m) => m.id));
    expect(pageSnippetModules({ id: "e", modules: [] })).toBeNull();
    expect(pageSnippetSchema.safeParse(mods).success).toBe(true);
    expect(pageSnippetSchema.safeParse([]).success).toBe(false);
  });

  it("inserting one makes a NEW page right after the selected page, any number of times", () => {
    const pages = [page(1), page(2)];
    const mods = pageSnippetModules(page(9))!;
    const a = insertPageSnippet(pages, 0, mods)!;
    expect(a.index).toBe(1);
    expect(a.pages.map((p) => p.id)).toEqual(["p1", a.pageId, "p2"]);
    expect(a.pages[1]!.modules.map((m) => m.type)).toEqual(["body", "hr", "body"]);
    const b = insertPageSnippet(a.pages, 1, mods)!;
    expect(b.pages.length).toBe(4);
    const ids = b.pages.flatMap((p) => p.modules.map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(pagesSchema.safeParse(b.pages).success).toBe(true);
    const full = Array.from({ length: MAX_PAGES }, (_, i) => page(i));
    expect(insertPageSnippet(full, 0, mods)).toBeNull();
  });

  it("the editor offers it: the page menu saves, the snippet's + adds a new page", () => {
    const d = src("src/components/documents/editor-screen.tsx");
    // The menu item and the popup both name the page (owner: "how does it know which page?").
    expect(d).toContain("Save page {i + 1} as a snippet…");
    expect(d).toContain(
      "`Save page ${state.pages.findIndex((x) => x.id === savePage.id) + 1} as a snippet`",
    );
    expect(d).toContain("saveModuleMut.mutate({ name, module: mods[0]!, pageModules: mods });");
    expect(d).toContain("insertPageSnippet(state.pages, selectedPageIndex(state), modules)");
    expect(d).toContain("props.onAddSavedPage(s.name, s.page_modules)");
    const f = src("src/lib/documents.functions.ts");
    expect(f).toContain("pageModules: pageSnippetSchema.optional(),");
    expect(f).toContain("page_modules: data.pageModules ? json(data.pageModules) : null,");
    expect(src("supabase/migrations/20261110200000_document_page_snippets.sql")).toContain(
      "add column if not exists page_modules jsonb",
    );
  });
});

describe("Import document: one button for PDF and Word; Publisher explained", () => {
  it("knows a file by its name, or by its type when the name says nothing", () => {
    expect(importFileKind("Banner 2.PDF")).toBe("pdf");
    expect(importFileKind("form.docx")).toBe("word");
    expect(importFileKind("old letter.doc")).toBe("word");
    expect(importFileKind("flyer.pub")).toBe("publisher");
    expect(importFileKind("scan", "application/pdf")).toBe("pdf");
    expect(importFileKind("photo.png", "image/png")).toBe("other");
    expect(IMPORT_ACCEPT).toContain(".pub");
    expect(PUBLISHER_IMPORT_TEXT).toContain("Export, Create PDF/XPS Document");
  });
  it("the canvas has the one button, and its dialog routes each kind", () => {
    const c = src("src/components/documents/editor/page-canvas.tsx");
    expect(c).toContain("Import document </Button>");
    expect(c).not.toContain("Insert PDF </Button>");
    expect(c).not.toContain("Import Word </Button>");
    expect(c).toContain(
      'if (kind === "pdf") upload.mutate(f); else if (kind === "word") props.onWord(f);',
    );
    expect(c).toContain('kind === "publisher" ? PUBLISHER_IMPORT_TEXT : OTHER_IMPORT_TEXT');
  });
});

describe("an inserted PDF is drawn in the editor", () => {
  it("each of its pages is a sheet in the lineup, with its own tab", () => {
    expect(pdfSheetLabel("Page 2", "Banner 2", 1, 3)).toBe("Page 2 · Banner 2, page 1 of 3");
    expect(pdfSheetLabel("Page 1", "Award letter", 1, 1)).toBe("Page 1 · Award letter");
    const c = src("src/components/documents/editor/page-canvas.tsx");
    expect(c).toContain('if (pdf?.type === "pdf") return ( <PdfSheets');
    const p = src("src/components/documents/editor/pdf-preview.tsx");
    expect(p).toContain("Array.from({ length: Math.max(1, shown) }, (_, k) => (");
    expect(p).toContain("style={{ width: SHEET.width, minHeight: SHEET.height }}");
    expect(p).toContain("frames.current[i - 1]?.replaceChildren(canvas);");
  });
  it("the first pages are drawn, the rest counted", () => {
    expect(pdfPreviewPages(3)).toEqual({ shown: 3, more: 0 });
    expect(pdfPreviewPages(PDF_PREVIEW_MAX_PAGES + 5)).toEqual({
      shown: PDF_PREVIEW_MAX_PAGES,
      more: 5,
    });
    expect(pdfPreviewPages(0)).toEqual({ shown: 0, more: 0 });
  });
  it("the pages are read from the library file and drawn", () => {
    expect(src("src/lib/documents.functions.ts")).toContain(
      "export const documentAssetUrl = createServerFn",
    );
    expect(src("src/components/documents/editor/pdf-preview.tsx")).toContain(
      "await page.render({ canvas, viewport: vp }).promise;",
    );
  });
});

describe("saving a new template (found while testing the import)", () => {
  it("its move to its own address is not asked about as leaving unsaved work", () => {
    const d = src("src/components/documents/editor-screen.tsx");
    expect(d).toContain("savedNew.current = true; void router.navigate({");
    expect(d).toContain("leaveFreelyRef={savedNew}");
    expect(d).toContain("if (template?.id) savedNew.current = false;");
  });
});

describe("Word import", () => {
  it("opens the zip (stored and deflated entries) and reads the XML", async () => {
    const files = await unzip(docx());
    expect([...files.keys()]).toContain("word/document.xml");
    expect(new TextDecoder().decode(files.get("[Content_Types].xml"))).toBe("<Types/>");
    const x = parseXml('<a b="1 &amp; 2"><c/>t&lt;</a>');
    expect(x.children[0]!.attrs["b"]).toBe("1 & 2");
    expect(x.children[0]!.children.map((c) => c.name)).toEqual(["c", "#text"]);
    expect(x.children[0]!.children[1]!.text).toBe("t<");
    expect(imageSize(png)).toEqual({ width: 264, height: 160 });
  });

  it("reads the form: picture, centred title, labels, marks, lists, a table; placeholders dropped", async () => {
    const r = await readDocx(docx());
    expect(r.blocks.map((b) => b.kind)).toEqual(["image", "text", "table", "text"]);
    const img = r.blocks[0] as Extract<(typeof r.blocks)[number], { kind: "image" }>;
    expect([img.image.name, img.image.width, img.image.height]).toEqual(["image1.png", 264, 160]);
    expect(img.image.widthIn).toBeCloseTo(2.75, 2);
    expect(importedImageHeightIn(img.image)).toBe(1.67);
    const nodes = (r.blocks[1] as Extract<(typeof r.blocks)[number], { kind: "text" }>).nodes;
    expect(nodes[0]).toEqual({
      type: "heading",
      attrs: { level: 1, textAlign: "center" },
      content: [{ type: "text", text: "ROOF EVALUATION SUMMARY", marks: [{ type: "bold" }] }],
    });
    // A large bold label at the margin stays a paragraph; its placeholder and the tab before it go.
    expect(nodes[1]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Customer:", marks: [{ type: "bold" }] }],
    });
    expect(nodes[2]!.content).toEqual([
      { type: "text", text: "Bldg(s) & Sq Ft:", marks: [{ type: "bold" }] },
      { type: "text", text: " two ", marks: [{ type: "italic" }] },
      { type: "text", text: "roofs", marks: [{ type: "underline" }] },
    ]);
    expect(nodes[3]).toEqual({ type: "paragraph" }); // the whole-paragraph field: a blank line
    expect(nodes[4]).toEqual({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Scope" }],
    });
    expect(nodes[5]!.type).toBe("bulletList");
    expect(nodes[5]!.content!.length).toBe(2);
    expect(nodes[6]!.type).toBe("orderedList");
    expect(JSON.stringify(r.blocks)).not.toContain("Click here");
    expect(r.blocks[2]).toEqual({
      kind: "table",
      rows: [
        ["Item", "Qty"],
        ["Drains", ""],
      ],
    });
    expect(r.skipped).toEqual([
      "the header and footer (use the document's own letterhead and footer)",
    ]);
  });

  it("the blocks become a page's modules the editor and the PDF accept", async () => {
    const r = await readDocx(docx());
    let n = 0;
    const mods = docxModules(
      r.blocks,
      () => ({ path: "docs/x/1.png", width: 264, height: 160 }),
      () => `m${++n}`,
    );
    expect(mods.map((m) => m.type)).toEqual(["fullPhoto", "body", "table", "body"]);
    expect(pageSnippetSchema.safeParse(mods).success).toBe(true);
    const photo = mods[0] as Extract<DocModule, { type: "fullPhoto" }>;
    expect(photo.heightIn).toBe(1.67);
    expect(photo.image).toEqual({
      kind: "upload",
      path: "docs/x/1.png",
      width: 264,
      height: 160,
      name: "image1.png",
    });
    // A picture that could not be stored is left out, the rest still comes.
    expect(
      docxModules(
        r.blocks,
        () => null,
        () => `k${++n}`,
      ).map((m) => m.type),
    ).toEqual(["body", "table", "body"]);
    expect(wordImportToast("form.docx", 2, r.skipped)).toContain("“form.docx” imported as page 2");
  });

  it("an older .doc and a file that is not Word are refused in plain words", async () => {
    await expect(readDocx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]))).rejects.toThrow(
      /older \.doc file/,
    );
    await expect(
      readDocx(new TextEncoder().encode("%PDF-1.7 not a zip at all, just text")),
    ).rejects.toThrow(/not a Word document/);
    await expect(readDocx(zip({ "a.txt": "x", "b.txt": "y" }))).rejects.toThrow(
      /not a Word document/,
    );
  });

  it("a Word file picked in Import document becomes a new page after that sheet", () => {
    const c = src("src/components/documents/editor/page-canvas.tsx");
    expect(c).toContain('data-input="import-document"');
    expect(c).toContain("wordAfter.current = pdfFor ?? 0;");
    expect(c).toContain(
      "const landed = insertPageSnippet(props.pages, wordAfter.current, modules);",
    );
  });
});

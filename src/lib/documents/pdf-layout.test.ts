/**
 * The document PDF's layout (owner, Oct 26): word wrap that never cuts a word, rich text to
 * blocks with variables, pictures fitted to their box, table columns and header repeats, rows
 * of columns split by lines, and pages that never cut a piece. A fake measure stands in for
 * pdf-lib: every character is half the font size wide (bold a tenth more).
 */
import { describe, expect, it } from "vitest";

import {
  newModule,
  richFromText,
  richLine,
  type DocModule,
  type FullPhotoModule,
  type RichDoc,
} from "./model";
import {
  BLANK_PARAGRAPH,
  BODY_SIZE,
  CONTENT_HEIGHT,
  CONTENT_WIDTH,
  fitImage,
  footerLine,
  HEADING_SIZES,
  inlineRuns,
  layoutModule,
  layoutModules,
  layoutRich,
  layoutSignature,
  layoutTable,
  type LayoutContext,
  lineHeightOf,
  LIST_INDENT,
  LOGO_WIDTH,
  type Measure,
  MODULE_GAP,
  pageLabel,
  paginate,
  type Piece,
  placeLine,
  pricingTableData,
  richBlocks,
  splitAtPdf,
  splitColumns,
  tableColumnWidths,
  wrapRuns,
  contentHeightFor,
} from "./pdf-layout";
import { variableLabel } from "./variables";

const measure: Measure = (text, font, size) =>
  text.length * size * 0.5 * (font === "bold" || font === "boldItalic" ? 1.1 : 1);
const ctx = (over: Partial<LayoutContext> = {}): LayoutContext => ({
  width: CONTENT_WIDTH,
  measure,
  vars: {},
  labelOf: variableLabel,
  image: () => ({ width: 1600, height: 1200 }),
  pricing: { bid: null },
  ...over,
});
const run = (text: string, bold = false) => ({ text, bold, italic: false, underline: false });
const texts = (pieces: Piece[]) =>
  pieces
    .filter((p): p is Extract<Piece, { kind: "text" }> => p.kind === "text")
    .map((p) => p.line.segments.map((s) => s.text).join(""));

describe("wrapRuns", () => {
  it("wraps at words, never cutting one, and drops the spaces at a line's ends", () => {
    // 10 pt → 5 pt per character; 100 pt holds 20 characters.
    const lines = wrapRuns([run("the quick brown fox jumps over the lazy dog")], 100, 10, measure);
    const text = lines.map((l) => l.segments.map((s) => s.text).join(""));
    expect(text).toEqual(["the quick brown fox", "jumps over the lazy", "dog"]);
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(100);
    expect(text.join(" ")).toBe("the quick brown fox jumps over the lazy dog");
  });
  it("keeps a style change inside a line as separate segments and merges equal ones", () => {
    const lines = wrapRuns([run("Re: "), run("Whitley", true), run(" County")], 500, 10, measure);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.segments.map((s) => [s.text, s.font])).toEqual([
      ["Re: ", "regular"],
      ["Whitley", "bold"],
      [" County", "regular"],
    ]);
  });
  it("a hard break forces a line; a word wider than the line is broken so it prints", () => {
    const lines = wrapRuns([run("one\ntwo")], 500, 10, measure);
    expect(lines.map((l) => l.segments[0]!.text)).toEqual(["one", "two"]);
    const long = wrapRuns([run("abcdefghijklmnopqrstuvwxyz")], 50, 10, measure);
    expect(long.map((l) => l.segments[0]!.text)).toEqual(["abcdefghij", "klmnopqrst", "uvwxyz"]);
  });
  it("placeLine offsets by alignment and indent", () => {
    const [l] = wrapRuns([run("hello")], 100, 10, measure); // 25 wide
    expect(placeLine(l!, 100, 0, "left")[0]!.x).toBe(0);
    expect(placeLine(l!, 100, 0, "center")[0]!.x).toBe(37.5);
    expect(placeLine(l!, 100, 0, "right")[0]!.x).toBe(75);
    expect(placeLine(l!, 100, 18, "left")[0]!.x).toBe(18);
  });
});

describe("richBlocks / inlineRuns", () => {
  it("variables print their value, or [Label] when missing; marks become bold / italic / underline", () => {
    const p = richLine([
      "Re: ",
      { variable: "property.name" },
      " for ",
      { variable: "company.name" },
    ]);
    const runs = inlineRuns(p, { "property.name": "Whitley" }, variableLabel);
    expect(runs.map((r) => r.text)).toEqual(["Re: ", "Whitley", " for ", "[Company Name]"]);
    const styled = inlineRuns(
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a", marks: [{ type: "bold" }, { type: "underline" }] },
          { type: "text", text: "b", marks: [{ type: "italic" }] },
          { type: "hardBreak" },
        ],
      },
      {},
      variableLabel,
    );
    expect(styled).toEqual([
      { text: "a", bold: true, italic: false, underline: true },
      { text: "b", bold: false, italic: true, underline: false },
      { text: "\n", bold: false, italic: false, underline: false },
    ]);
  });
  it("headings take their size and stay with the next line; a blank paragraph is 6 pt; lists indent with markers", () => {
    const doc: RichDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Scope" }] },
        { type: "paragraph" },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Tear off" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Install" }] }],
            },
          ],
        },
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }],
            },
          ],
        },
      ],
    };
    const blocks = richBlocks(doc, {}, variableLabel);
    expect(blocks[0]).toMatchObject({ kind: "text", size: HEADING_SIZES[2], keepWithNext: true });
    expect(blocks[1]).toEqual({ kind: "blank", height: BLANK_PARAGRAPH });
    expect(blocks[2]).toMatchObject({ kind: "text", indent: LIST_INDENT, marker: "•" });
    expect(blocks[3]).toMatchObject({ marker: "•" });
    expect(blocks[4]).toMatchObject({ marker: "1.", indent: LIST_INDENT });
    const pieces = layoutRich(doc, 0, 300, ctx());
    expect(texts(pieces)).toEqual(["Scope", "Tear off", "Install", "First"]);
    const first = pieces.find((p) => p.kind === "text" && p.line.marker);
    expect(first && first.kind === "text" ? first.line.markerX : null).toBe(2);
    expect(pieces[0]!.height).toBe(lineHeightOf(HEADING_SIZES[2]));
  });
  it("richFromText paragraphs come out one line each, 10.5 pt at 1.35 line height, with the paragraph gaps between", () => {
    const pieces = layoutRich(richFromText("Dear Jason,\nThank you."), 0, 400, ctx());
    expect(pieces.map((p) => p.kind)).toEqual(["text", "gap", "text"]);
    expect(pieces[0]!.height).toBe(lineHeightOf(BODY_SIZE));
    expect(BODY_SIZE * 1.35).toBeCloseTo(pieces[0]!.height, 1);
  });
});

describe("pictures and tables", () => {
  it("fitImage keeps the shape: by width when no height, by the tighter side otherwise", () => {
    expect(fitImage({ width: 1600, height: 1200 }, 400, null)).toEqual({ width: 400, height: 300 });
    expect(fitImage({ width: 1600, height: 1200 }, 400, 150)).toEqual({ width: 200, height: 150 });
    expect(fitImage({ width: 0, height: 0 }, 400, null)).toEqual({ width: 0, height: 0 });
  });
  it("a full photo with a height fits into it, centred; without one it spans the width; a missing picture is a grey placeholder, never a throw", () => {
    const m = {
      ...newModule("fullPhoto"),
      image: { kind: "logo" as const },
      heightIn: 2,
      caption: "Roof",
    } as FullPhotoModule;
    const [img, , cap] = layoutModule(m, 0, 504, ctx());
    expect(img).toMatchObject({
      kind: "image",
      height: 144,
      width: 192,
      x: 156,
      keepWithNext: true,
    });
    expect(cap).toMatchObject({ kind: "text" });
    const wide = layoutModule({ ...m, heightIn: 0, caption: "" }, 0, 504, ctx())[0];
    expect(wide).toMatchObject({ kind: "image", width: 504, height: 378, x: 0 });
    const missing = layoutModule(m, 0, 504, ctx({ image: () => null }))[0];
    expect(missing).toMatchObject({ kind: "placeholder", text: "picture not printable" });
    expect(layoutModule({ ...m, image: null }, 0, 504, ctx())).toEqual([]);
  });
  it("tableColumnWidths follows the weights, else equal", () => {
    expect(tableColumnWidths([{}, {}, {}], 300)).toEqual([100, 100, 100]);
    expect(tableColumnWidths([{ width: 2 }, { width: 1 }, {}], 400)).toEqual([200, 100, 100]);
  });
  it("a table has a shaded bold header, zebra rows, wrapped cells and {{variables}}; the header travels with the first row and repeats after a break", () => {
    const pieces = layoutTable(
      {
        columns: [
          { title: "Item", align: "left" },
          { title: "Amount", align: "right" },
        ],
        rows: [
          ["Membrane", "{{opportunity.price}}"],
          ["A very long description that must wrap onto more than one line in its cell", "$1"],
          ["Short", "$2"],
        ],
      },
      0,
      200,
      ctx({ vars: { "opportunity.price": "$5" } }),
    );
    expect(pieces).toHaveLength(4);
    const [h, r1, r2, r3] = pieces as Array<Extract<Piece, { kind: "tableRow" }>>;
    expect(h).toMatchObject({ header: true, shade: true, bold: true, keepWithNext: true });
    expect(r1!.cells[1]!.lines).toEqual(["$5"]);
    expect(r1!.cells[1]!.align).toBe("right");
    expect([r1!.shade, r2!.shade, r3!.shade]).toEqual([false, true, false]);
    expect(r2!.cells[0]!.lines.length).toBeGreaterThan(1);
    expect(r2!.height).toBeGreaterThan(r1!.height);
    expect(r1!.repeat).toBe(h);
    // Paginate with room for the header and one row only: page 2 starts with the header again.
    const pages = paginate(pieces, h!.height + r2!.height + 1);
    expect(pages.map((pg) => pg.map((p) => p.piece))).toEqual([
      [h, r1],
      [h, r2],
      [h, r3],
    ]);
  });
  it("the pricing table prints the record's rows, or the hand-edited rows when set; the total row is bold", () => {
    const pricing = {
      bid: {
        name: "",
        total: 1000,
        system: "",
        dueDate: null,
        sections: [{ name: "Main", lengthFt: 100, widthFt: 50, system: "Duro-Last 60 mil" }],
        sqFt: null,
        warranty: "",
      },
    };
    const m = { ...newModule("pricingTable") } as Extract<DocModule, { type: "pricingTable" }>;
    const built = pricingTableData(m, pricing);
    expect(built.rows).toEqual([
      ["Main", "50 × 100 ft", "5,000", "Duro-Last 60 mil"],
      ["Total", "", "", "$1,000.00"],
    ]);
    expect(built.columns.map((c) => c.align)).toEqual(["left", "left", "right", "left"]);
    const edited = pricingTableData({ ...m, rows: [["Everything", "", "", "$5"]] }, pricing);
    expect(edited.rows).toEqual([["Everything", "", "", "$5"]]);
    const pieces = layoutModule(m, 0, 504, ctx({ pricing })) as Array<
      Extract<Piece, { kind: "tableRow" }>
    >;
    expect(pieces.map((p) => p.bold)).toEqual([true, false, true]);
    expect(
      layoutModule({ ...m, mode: "none", showSections: false }, 0, 504, ctx({ pricing })),
    ).toEqual([]);
  });
  it("signatures: two per row, a 2.6 in rule each, the second flush right", () => {
    const rows = layoutSignature(["Customer", "Date", "JBK, Inc."], 0, 504);
    expect(rows).toHaveLength(2);
    const first = rows[0] as Extract<Piece, { kind: "signature" }>;
    expect(first.entries.map((e) => e.label)).toEqual(["Customer", "Date"]);
    expect(first.entries[0]!.width).toBeCloseTo(187.2);
    expect(first.entries[1]!.x).toBeCloseTo(504 - 187.2);
    expect((rows[1] as Extract<Piece, { kind: "signature" }>).entries).toHaveLength(1);
  });
});

describe("modules and columns", () => {
  it("the letterhead is the logo 1.6 in wide beside the text; two columns share a 0.3 in gutter; a photo takes 45 %", () => {
    const lh = layoutModule(newModule("letterhead"), 0, 504, ctx())[0] as Extract<
      Piece,
      { kind: "columns" }
    >;
    expect(lh.kind).toBe("columns");
    expect(lh.columns[0]!.width).toBeCloseTo(LOGO_WIDTH);
    expect(lh.columns[0]!.pieces[0]).toMatchObject({ kind: "image", ref: { kind: "logo" } });
    expect(lh.columns[1]!.x).toBeCloseTo(LOGO_WIDTH + 21.6);
    const two = layoutModule(newModule("twoColumns"), 0, 504, ctx())[0] as Extract<
      Piece,
      { kind: "columns" }
    >;
    expect(two.columns.map((c) => c.width)).toEqual([241.2, 241.2]);
    expect(two.columns[1]!.x).toBeCloseTo(262.8);
    const pl = layoutModule(
      { ...newModule("photoRight"), image: { kind: "logo" } } as DocModule,
      0,
      504,
      ctx(),
    )[0] as Extract<Piece, { kind: "columns" }>;
    expect(pl.columns[1]!.width).toBeCloseTo(504 * 0.45);
    expect(pl.columns[1]!.pieces[0]!.kind).toBe("image");
    expect(pl.columns[0]!.x).toBe(0);
  });
  it("a row of columns is as tall as its taller column; modules flow with a gap between; a pdf module is cut out by splitAtPdf", () => {
    const left = richFromText("a\nb\nc\nd");
    const right = richFromText("x");
    const m = { ...newModule("twoColumns"), left, right } as DocModule;
    const [row] = layoutModule(m, 0, 504, ctx()) as [Extract<Piece, { kind: "columns" }>];
    const leftH = row.columns[0]!.pieces.reduce((a, p) => a + p.height, 0);
    expect(row.height).toBe(leftH);
    expect(row.height).toBeGreaterThan(row.columns[1]!.pieces.reduce((a, p) => a + p.height, 0));
    const flow = layoutModules([newModule("hr"), m], ctx());
    expect(flow.map((p) => p.kind)).toEqual(["rule", "gap", "columns"]);
    expect(flow[1]!.height).toBe(MODULE_GAP);
    const pdf = {
      ...newModule("hr"),
      type: "pdf",
      assetId: "00000000-0000-4000-8000-000000000000",
      name: "T",
      pageCount: 2,
    } as DocModule;
    const segs = splitAtPdf([newModule("hr"), pdf, pdf, newModule("hr")]);
    expect(segs.map((s) => s.kind)).toEqual(["flow", "pdf", "pdf", "flow"]);
    expect(splitAtPdf([pdf]).map((s) => s.kind)).toEqual(["pdf"]);
    expect(layoutModules([], ctx())).toEqual([]);
  });
  it("splitColumns keeps what fits in each column and hands the rest on", () => {
    const m = {
      ...newModule("twoColumns"),
      left: richFromText("a\nb\nc\nd"),
      right: richFromText("x"),
    } as DocModule;
    const [row] = layoutModule(m, 0, 504, ctx()) as [Extract<Piece, { kind: "columns" }>];
    const lineH = lineHeightOf(BODY_SIZE);
    const split = splitColumns(row, lineH * 2 + 4.5)!;
    expect(split).not.toBeNull();
    expect(texts(split[0].columns[0]!.pieces)).toEqual(["a", "b"]);
    expect(texts(split[0].columns[1]!.pieces)).toEqual(["x"]);
    expect(texts(split[1]!.columns[0]!.pieces)).toEqual(["c", "d"]);
    expect(split[1]!.columns[1]!.pieces).toEqual([]);
    expect(splitColumns(row, 1)).toBeNull();
  });
});

describe("paginate", () => {
  const line = (h: number, keep = false): Piece => ({
    kind: "text",
    x: 0,
    width: 100,
    height: h,
    line: { segments: [], width: 0, size: 10, color: "body" },
    keepWithNext: keep,
  });
  it("fills pages top down, moves a piece that does not fit whole, and never starts a page with a gap", () => {
    const pages = paginate([line(40), { kind: "gap", height: 10 }, line(40), line(40)], 100);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.map((p) => [p.piece.kind, p.y])).toEqual([
      ["text", 0],
      ["gap", 40],
      ["text", 50],
    ]);
    expect(pages[1]!.map((p) => [p.piece.kind, p.y])).toEqual([["text", 0]]);
  });
  it("no pieces is one empty page; a piece taller than the page is placed alone rather than lost", () => {
    expect(paginate([], 100)).toEqual([[]]);
    const pages = paginate([line(10), line(500), line(10)], 100);
    expect(pages.map((pg) => pg.map((p) => p.piece.height))).toEqual([[10], [500], [10]]);
  });
  it("a heading keeps the line after it (past the gap between them)", () => {
    const pages = paginate([line(60), line(20, true), { kind: "gap", height: 5 }, line(30)], 100);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.map((p) => p.piece.height)).toEqual([60]);
    expect(pages[1]!.map((p) => p.piece.height)).toEqual([20, 5, 30]);
  });
  it("a row of columns that crosses a page is split by lines, the remainder starting the next page", () => {
    const col = (n: number) => Array.from({ length: n }, () => line(20));
    const row: Piece = {
      kind: "columns",
      height: 100,
      columns: [
        { x: 0, width: 50, pieces: col(5) },
        { x: 60, width: 50, pieces: col(2) },
      ],
    };
    const pages = paginate([line(30), row], 100);
    expect(pages).toHaveLength(2);
    const part = pages[0]![1]!.piece as Extract<Piece, { kind: "columns" }>;
    expect(part.kind).toBe("columns");
    expect(part.height).toBe(60);
    expect(part.columns[0]!.pieces).toHaveLength(3);
    expect(part.columns[1]!.pieces).toHaveLength(2);
    const rest = pages[1]![0]!.piece as Extract<Piece, { kind: "columns" }>;
    expect(rest.columns[0]!.pieces).toHaveLength(2);
    expect(rest.columns[1]!.pieces).toHaveLength(0);
    expect(pages[1]![0]!.y).toBe(0);
  });
  it("the default page is the Letter content box: 504 × 684 pt", () => {
    expect(CONTENT_WIDTH).toBe(504);
    expect(CONTENT_HEIGHT).toBe(684);
  });
});

describe("footer", () => {
  it("the company line comes from the Account variables, blanks skipped; page X of Y", () => {
    expect(
      footerLine({
        "account.name": "JBK, Inc.",
        "account.phone": "(606) 523-9000",
        "account.website": "www.flatroofonline.com",
      }),
    ).toBe("JBK, Inc. · (606) 523-9000 · www.flatroofonline.com");
    expect(footerLine({ "account.name": "JBK, Inc.", "account.phone": "" })).toBe("JBK, Inc.");
    expect(pageLabel(2, 5)).toBe("Page 2 of 5");
  });
});

describe("contentHeightFor: the page break sets where the printed page ends (owner, Oct 26)", () => {
  it("footer on: the page-break inches from the top, less the top margin; clamped to 5–10.5 in", () => {
    expect(contentHeightFor({ footer: true, pageBreakIn: 8.8 })).toBe(Math.round(8.8 * 72) - 54);
    expect(contentHeightFor({ footer: true, pageBreakIn: 5 })).toBe(360 - 54);
    expect(contentHeightFor({ footer: true, pageBreakIn: 99 })).toBe(CONTENT_HEIGHT);
    expect(contentHeightFor({ footer: true, pageBreakIn: Number.NaN })).toBe(
      Math.round(8.8 * 72) - 54,
    );
  });
  it("footer off: the whole margin-to-margin page", () => {
    expect(contentHeightFor({ footer: false, pageBreakIn: 5 })).toBe(CONTENT_HEIGHT);
  });
});

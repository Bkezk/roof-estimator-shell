/**
 * Owner, Nov 3, three takeoff efficiencies, each pinned so the old code fails:
 *   1. Name the sheets: a PDF page's sheet number and title are read off its title block
 *      ("A2.1 Roof Plan"), pages still called "Page N" take that name, and the roof plan is
 *      flagged and offered.
 *   5. Pinch to zoom on a touch screen; a one-finger tap places its point on release so a
 *      second finger makes a pinch, not a corner.
 *   7. Rectangle by typed size: after the first corner, "40 x 120" + Enter makes the rectangle.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { statusLine } from "./hints";
import type { TextItemLike } from "./sheet-scale";
import { DEFAULT_PAGE_NAME, pickSheetTitle, sheetPageName, textLines } from "./sheet-title";
import { isLengthKey, parseTypedSize, pinchGeometry, pinchView, typedRectangle } from "./shapes";

const read = (rel: string) => readFileSync(rel, "utf8");

// ── 1. Name the sheets ──────────────────────────────────────────────────────────────────────

/** A text item at (x, y) in PDF user space with glyph height h. */
const item = (str: string, x: number, y: number, h = 8, width?: number): TextItemLike => ({
  str,
  transform: [h, 0, 0, h, x, y],
  width: width ?? str.length * h * 0.55,
  height: h,
});
const W = 2592; // 36 × 24 in sheet, 72 units per inch
const H = 1728;

/** A typical title block strip down the right edge. */
const titleBlock = (): TextItemLike[] => [
  item("ACME ARCHITECTS", 2300, 1500, 9),
  item("123 MAIN ST, LEXINGTON KY", 2300, 1485, 6),
  item("PROJECT", 2300, 900, 6),
  item("KNOX COUNTY BOE CTC", 2300, 885, 8),
  item("SHEET TITLE", 2300, 400, 6),
  item("ROOF PLAN", 2300, 380, 14),
  item("DRAWN BY", 2300, 200, 6),
  item("JDM", 2380, 200, 6),
  item("SCALE", 2300, 180, 6),
  item('1/8" = 1\'-0"', 2380, 180, 6),
  item("SHEET NO.", 2300, 120, 6),
  item("A2.1", 2300, 90, 20),
];

describe("1. pickSheetTitle: the sheet number and title off the title block", () => {
  it("finds the number and the title, flags a roof plan, and names the page from them", () => {
    const t = pickSheetTitle(titleBlock(), W, H);
    expect(t).toEqual({ number: "A2.1", title: "Roof Plan", roofPlan: true });
    expect(sheetPageName(t)).toBe("A2.1 Roof Plan");
  });
  it("a roof framing plan is structure, not the roof plan; other sheets are not flagged", () => {
    const framing = titleBlock().map((i) =>
      i.str === "ROOF PLAN" ? item("ROOF FRAMING PLAN", 2300, 380, 14) : i,
    );
    expect(pickSheetTitle(framing, W, H)).toEqual({
      number: "A2.1",
      title: "Roof Framing Plan",
      roofPlan: false,
    });
    const elev = titleBlock().map((i) =>
      i.str === "ROOF PLAN"
        ? item("EXTERIOR ELEVATIONS", 2300, 380, 14)
        : i.str === "A2.1"
          ? item("A-301", 2300, 90, 20)
          : i,
    );
    expect(pickSheetTitle(elev, W, H)).toEqual({
      number: "A-301",
      title: "Exterior Elevations",
      roofPlan: false,
    });
  });
  it("a title split into several text items on one line is read whole; labels never win", () => {
    const items = [
      ...titleBlock().filter((i) => i.str !== "ROOF PLAN"),
      item("ROOF", 2300, 380, 14),
      item("PLAN", 2340, 380, 14),
    ];
    expect(pickSheetTitle(items, W, H).title).toBe("Roof Plan");
    // The company name and the project name are not drawing titles; "SHEET TITLE" is a label.
    const noTitle = titleBlock().filter((i) => i.str !== "ROOF PLAN");
    expect(pickSheetTitle(noTitle, W, H)).toEqual({ number: "A2.1", title: null, roofPlan: false });
  });
  it("a bottom-strip title block works too; number-shaped text in the drawing itself is ignored", () => {
    const items: TextItemLike[] = [
      item("A2.1", 1200, 900, 8), // a detail callout in the drawing, not in the block
      item("ROOF PLAN", 1000, 60, 12),
      item("A2.1", 2400, 40, 18),
      item("S1", 2500, 70, 10), // smaller: loses to the larger number
    ];
    expect(pickSheetTitle(items, W, H)).toEqual({
      number: "A2.1",
      title: "Roof Plan",
      roofPlan: true,
    });
  });
  it("a cover sheet is a title; a project name with PLAN in it loses to the line under SHEET TITLE", () => {
    const cover = titleBlock().map((i) =>
      i.str === "ROOF PLAN"
        ? item("COVER SHEET", 2300, 380, 14)
        : i.str === "KNOX COUNTY BOE CTC"
          ? item("TEST PLAN SET", 2300, 885, 16)
          : i,
    );
    expect(pickSheetTitle(cover, W, H)).toEqual({
      number: "A2.1",
      title: "Cover Sheet",
      roofPlan: false,
    });
    // No label at all: the largest drawing-naming line wins.
    const noLabel = cover.filter((i) => i.str !== "SHEET TITLE");
    expect(pickSheetTitle(noLabel, W, H).title).toBe("Test Plan Set");
  });
  it("no text at all: nothing read, the page keeps its name", () => {
    const t = pickSheetTitle([], W, H);
    expect(t).toEqual({ number: null, title: null, roofPlan: false });
    expect(sheetPageName(t)).toBeNull();
    expect(DEFAULT_PAGE_NAME.test("Page 7")).toBe(true);
    expect(DEFAULT_PAGE_NAME.test("A2.1 Roof Plan")).toBe(false);
  });
  it("textLines groups items by baseline, left to right, with the largest glyph height", () => {
    const lines = textLines([
      item("PLAN", 2340, 380, 14),
      item("ROOF", 2300, 380, 10),
      item("X", 10, 10, 6),
    ]);
    expect(lines.map((l) => [l.text, l.h])).toEqual([
      ["ROOF PLAN", 14],
      ["X", 6],
    ]);
  });
  it("the editor reads every default-named page once per document, renames, flags and offers the roof plan", () => {
    const editor = read("src/components/takeoff/editor.tsx");
    expect(editor).toContain('if (!source || source.kind !== "pdf" || locked) return;');
    expect(editor).toContain("const t = await readSheetTitle(doc, p.index).catch(() => null);");
    expect(editor).toContain(
      "const rename = DEFAULT_PAGE_NAME.test(p.name) && r.name !== null && r.name !== p.name;",
    );
    expect(editor).toContain("return { ...p, name, roofPlan: r.roofPlan };");
    expect(editor).toContain("looks like the roof plan.");
    expect(editor).toContain('label: "Open it",');
    expect(editor).toContain("data-roof-plan");
    const underlay = read("src/components/takeoff/underlay.ts");
    expect(underlay).toContain(
      "export function readSheetTitle(doc: PDFDocumentProxy, pageIndex: number)",
    );
    // The flag is saved with the page.
    expect(read("src/lib/takeoff.functions.ts")).toContain("roofPlan: z.boolean().optional(),");
    expect(read("src/lib/takeoff/model.ts")).toContain("roofPlan?: boolean;");
  });
});

// ── 5. Pinch to zoom ────────────────────────────────────────────────────────────────────────

describe("5. pinchView: two fingers zoom about their midpoint", () => {
  const clamp = (z: number) => Math.min(8, Math.max(0.1, z));
  it("the zoom follows the finger distance; the page point under the first midpoint stays under the fingers", () => {
    const start = { d0: 100, mid0: [400, 300] as [number, number], zoom0: 1, x0: 50, y0: 20 };
    const v = pinchView(start, 200, [400, 300], clamp);
    expect(v.zoom).toBe(2);
    // The page point under (400, 300) was ((400 - 50) / 1, (300 - 20) / 1) = (350, 280); at
    // zoom 2 it must still sit under (400, 300): x = 400 - 350 × 2.
    expect(v.x).toBe(400 - 350 * 2);
    expect(v.y).toBe(300 - 280 * 2);
    // Fingers moving together pan by the same amount.
    const moved = pinchView(start, 100, [440, 330], clamp);
    expect(moved).toEqual({ zoom: 1, x: 90, y: 50 });
  });
  it("is clamped, and a zero start distance does not divide by zero", () => {
    const start = { d0: 100, mid0: [0, 0] as [number, number], zoom0: 1, x0: 0, y0: 0 };
    expect(pinchView(start, 5000, [0, 0], clamp).zoom).toBe(8);
    expect(pinchView({ ...start, d0: 0 }, 50, [0, 0], clamp).zoom).toBe(1);
    expect(pinchGeometry({ x: 0, y: 0 }, { x: 30, y: 40 })).toEqual({ d: 50, mid: [15, 20] });
  });
  it("the viewer tracks touch pointers, pinches with two, and places a tap on release", () => {
    const viewer = read("src/components/takeoff/viewer.tsx");
    expect(viewer).toContain(
      'if (e.pointerType === "touch") {\n      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });\n      if (touches.current.size === 2) {',
    );
    expect(viewer).toContain("setView(pinchView(pinch, g.d, g.mid, clampZoom));");
    // The second finger cancels the first finger's press and tap, and never reaches the drawing.
    expect(viewer).toContain(
      "tapRef.current = null;\n        endPress();\n        e.currentTarget.setPointerCapture(e.pointerId);\n        e.stopPropagation();",
    );
    expect(viewer).toContain(
      "tapRef.current = { pointerId: e.pointerId, p, sx: e.clientX, sy: e.clientY };",
    );
    expect(viewer).toContain(
      "if (!cancelled && places && Math.hypot(e.clientX - tap.sx, e.clientY - tap.sy) < TAP_PX)\n        place(tap.p);",
    );
    expect(viewer).toContain("if (touchEnd(e, false)) return;");
    expect(viewer).toContain("touchEnd(e, true);\n          endPress();");
  });
});

// ── 7. Rectangle by typed size ──────────────────────────────────────────────────────────────

describe("7. a typed size makes a rectangle", () => {
  it("parseTypedSize reads two lengths round an x", () => {
    expect(parseTypedSize("40 x 120")).toEqual({ a: 40, b: 120 });
    expect(parseTypedSize("40x120")).toEqual({ a: 40, b: 120 });
    expect(parseTypedSize("40X120")).toEqual({ a: 40, b: 120 });
    expect(parseTypedSize("40*120")).toEqual({ a: 40, b: 120 });
    expect(parseTypedSize("40' x 120'6")).toEqual({ a: 40, b: 120.5 });
    expect(parseTypedSize("40")).toBeNull();
    expect(parseTypedSize("40 x")).toBeNull();
    expect(parseTypedSize("x 40")).toBeNull();
    expect(parseTypedSize("40 x 0")).toBeNull();
    expect(parseTypedSize("40 x 1 x 2")).toBeNull();
    // The keys reach the typed buffer.
    expect(isLengthKey("x")).toBe(true);
    expect(isLengthKey("X")).toBe(true);
    expect(isLengthKey("*")).toBe(true);
    expect(isLengthKey("y")).toBe(false);
  });
  it("typedRectangle lays the rectangle from the corner toward the cursor, at the page scale", () => {
    const fpp = 0.5; // 0.5 ft per px: 40 ft = 80 px
    expect(typedRectangle([100, 100], [500, 500], 40, 120, fpp)).toEqual([
      [100, 100],
      [180, 100],
      [180, 340],
      [100, 340],
    ]);
    // Cursor up and left of the corner: the rectangle goes that way (corners still ordered).
    expect(typedRectangle([100, 100], [0, 0], 40, 120, fpp)).toEqual([
      [20, -140],
      [100, -140],
      [100, 100],
      [20, 100],
    ]);
    // No cursor: right and down.
    expect(typedRectangle([100, 100], null, 10, 10, fpp)).toEqual([
      [100, 100],
      [120, 100],
      [120, 120],
      [100, 120],
    ]);
    expect(typedRectangle([100, 100], [500, 500], 40, 120, null)).toBeNull();
  });
  it("the viewer makes the rectangle on Enter after the first corner, previews it, and says so", () => {
    const viewer = read("src/components/takeoff/viewer.tsx");
    expect(viewer).toContain(
      "const typedSize = canType && draft.length === 1 && typed ? parseTypedSize(typed) : null;",
    );
    expect(viewer).toContain("typedRectangle(draft[0], cursor, typedSize.a, typedSize.b, fpp)");
    expect(viewer).toContain("props.onCreate(tool, rectObjectPoints(tool, typedRect), roles);");
    expect(viewer).toContain("props.onAddCutout(selectedArea.id, typedRect);");
    expect(viewer).toContain("? { a: typedRect[0]!, b: typedRect[2]! }");
    expect(
      statusLine({
        tool: "area",
        edge: false,
        stamp: null,
        draftPoints: 1,
        countSession: false,
        typing: true,
        typedSize: true,
      }),
    ).toContain("Enter makes the rectangle");
    expect(
      statusLine({
        tool: "area",
        edge: false,
        stamp: null,
        draftPoints: 1,
        countSession: false,
        typing: true,
      }),
    ).toBe("Enter places the typed length · Backspace edits it · Esc cancels");
  });
});

/**
 * The phone side of the markup editor (owner, Oct 28: "adding tags and texts on mobile are
 * difficult"): finger-sized handles, labels one size up, where a sheet-placed label lands, and
 * where the selected mark's handles sit. Pure helpers; the editor's wiring is pinned to its source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fullView, textBox, textSizeFor, type PhotoMark } from "./photo-annotations";
import {
  FINGER_PX,
  centreOfView,
  grabTolerance,
  handlePlaces,
  handleSizes,
  rotateBox,
  selectionBounds,
  textScaleFor,
  viewPercent,
} from "./markup-touch";

const W = 2000;
const H = 1000;
const text: PhotoMark = { kind: "text", id: "t1", color: "red", at: [0.5, 0.5], text: "Leak" };
const circle: PhotoMark = { kind: "ellipse", id: "c1", color: "red", a: [0.2, 0.2], b: [0.4, 0.6] };

describe("finger sizes", () => {
  it("a handle's hit area is at least 44 css px on a coarse pointer; the drawn dot stays small", () => {
    expect(handleSizes(true).hit).toBeGreaterThanOrEqual(44);
    expect(handleSizes(true).hit).toBe(FINGER_PX);
    expect(handleSizes(true).drawn).toBeLessThan(handleSizes(true).hit);
    expect(handleSizes(false).hit).toBeLessThan(44);
    expect(handleSizes(false).drawn).toBeLessThanOrEqual(handleSizes(true).drawn);
    // Grabbing a mark's outline: a finger may miss by half a handle, i.e. 22 px, a mouse by less.
    expect(grabTolerance(true)).toBe(22);
    expect(grabTolerance(false)).toBeLessThan(grabTolerance(true));
  });
  it("labels draw one size up on a phone, as drawn elsewhere on a computer", () => {
    expect(textScaleFor(true)).toBeGreaterThan(1);
    expect(textScaleFor(false)).toBe(1);
  });
});

describe("centreOfView: where a label placed from the sheet lands", () => {
  it("the whole picture: its middle; zoomed in: the middle of what is on screen", () => {
    expect(centreOfView(fullView(W, H))).toEqual([1000, 500]);
    expect(centreOfView({ x: 1200, y: 300, w: 400, h: 200 })).toEqual([1400, 400]);
  });
});

describe("the selected mark's bounds and handles", () => {
  it("a text's box grows with the scale about its anchor; a circle's is its box", () => {
    const plain = selectionBounds(text, W, H);
    expect(plain).toEqual(textBox(text, W, H));
    const big = selectionBounds(text, W, H, 1.25);
    expect(big.w).toBeCloseTo(plain.w * 1.25);
    expect(big.h).toBeCloseTo(textSizeFor(W, H) * 1.25);
    expect(big.y + big.h / 2).toBeCloseTo(500); // still centred on `at`
    expect(selectionBounds(circle, W, H)).toEqual({ x: 400, y: 200, w: 400, h: 400 });
  });
  it("rotateBox turns a box's corners into the turned view", () => {
    const b = { x: 400, y: 200, w: 400, h: 400 };
    expect(rotateBox(b, W, H, 0)).toEqual(b);
    // 90: (x, y) → (H − y, x): the box lands at x = 1000 − 600 … 1000 − 200, y = 400 … 800.
    expect(rotateBox(b, W, H, 90)).toEqual({ x: 400, y: 400, w: 400, h: 400 });
    expect(rotateBox(b, W, H, 180)).toEqual({ x: 1200, y: 400, w: 400, h: 400 });
    expect(rotateBox(b, W, H, 270)).toEqual({ x: 200, y: 1200, w: 400, h: 400 });
  });
  it("viewPercent: the box as % of what is on screen, so css can place the handles", () => {
    const b = { x: 400, y: 200, w: 400, h: 400 };
    expect(viewPercent(b, fullView(W, H))).toEqual({ left: 20, top: 20, width: 20, height: 40 });
    // Zoomed to the top-left quarter: the same box is twice as big on screen.
    expect(viewPercent(b, { x: 0, y: 0, w: 1000, h: 500 })).toEqual({
      left: 40,
      top: 40,
      width: 40,
      height: 80,
    });
  });
  it("handlePlaces: the grip at the centre, the × at the top-right; hidden when the centre is off screen", () => {
    const h = handlePlaces(circle, W, H, 0, fullView(W, H));
    expect(h.shown).toBe(true);
    expect(h.grip).toEqual({ left: 30, top: 40 });
    expect(h.remove).toEqual({ left: 40, top: 20 });
    // Zoomed in on the far right: the circle is off screen, so no handles to drag blind.
    const off = handlePlaces(circle, W, H, 0, { x: 1500, y: 750, w: 500, h: 250 });
    expect(off.shown).toBe(false);
    // Turned 90 the handles follow the mark into the turned view.
    const turned = handlePlaces(circle, W, H, 90, fullView(H, W));
    expect(turned.shown).toBe(true);
    expect(turned.grip.left).toBeCloseTo(60);
    expect(turned.grip.top).toBeCloseTo(30);
  });
});

describe("the editor (photo-markup.tsx) wires the phone side through coarsePointer()", () => {
  const src = readFileSync("src/components/service/photo-markup.tsx", "utf8");
  const surface = src.slice(src.indexOf("export function PhotoMarkupSurface("));
  it("one coarse-pointer read drives the label scale, the handle sizes and the grab tolerance", () => {
    expect(surface).toContain("const coarse = useMemo(() => coarsePointer(), []);");
    expect(surface).toContain("const textScale = textScaleFor(coarse);");
    expect(surface).toContain("const handle = handleSizes(coarse);");
    expect(surface).toMatch(
      /hitTest\(history\.marks, p, W, H, \(touch \? grabTolerance\(true\) : 8\)/,
    );
    expect(surface).toContain("textScale={textScale}");
    // The handles are css-px buttons over the picture, placed in % of the view.
    expect(surface).toContain('data-handle="grip"');
    expect(surface).toContain('data-handle="remove"');
    expect(surface).toMatch(/width: handle\.hit,\s*height: handle\.hit,/);
    expect(surface).toContain("handlePlaces(selectedMark, W, H, rotation, view, textScale)");
  });
  it("a sheet-placed label lands at the centre of the view, turned back into the picture, and is selected under Move", () => {
    expect(surface).toContain(
      "const at = pending.at ?? norm(unrotatePoint(centreOfView(view), W, H, rotation));",
    );
    expect(surface).toMatch(
      /if \(fromSheet\) \{[\s\S]*?setTool\("move"\);\s*setSelected\(id\);\s*setHint\("Drag the label where it belongs"\);/,
    );
    // Picking Text / Tag on a phone opens the sheet at once (no tap on the picture first).
    expect(surface).toContain(
      'setPending((t === "text" || t === "tag") && coarse ? { kind: t, at: null } : null);',
    );
    expect(surface).toMatch(/<SheetContent\s+side="bottom"/);
    expect(surface).toContain("labelInput.current?.focus();");
  });
});

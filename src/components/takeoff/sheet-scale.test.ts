import { describe, expect, it } from "vitest";

import { feetPerPx } from "@/lib/takeoff/model";

import {
  findScaleNotes,
  joinTextItems,
  pickSheetScale,
  scaleOrigin,
  sheetScaleLine,
  sheetScaleMessage,
  sheetSizeWarning,
} from "./sheet-scale";

describe("findScaleNotes → feet per page unit (72 units per paper inch)", () => {
  it.each([
    [`1/8" = 1'-0"`, 8 / 72, `1/8" = 1'-0"`],
    [`1/8"=1'`, 8 / 72, `1/8" = 1'`],
    [`3/32" = 1'-0"`, 32 / 3 / 72, `3/32" = 1'-0"`],
    [`1/4" = 1'`, 4 / 72, `1/4" = 1'`],
    [`1" = 20'`, 20 / 72, `1" = 20'`],
    [`1" = 20'-0"`, 20 / 72, `1" = 20'-0"`],
    [`1" = 30'-0"`, 30 / 72, `1" = 30'-0"`],
    [`SCALE: 1/8" = 1'-0"`, 8 / 72, `1/8" = 1'-0"`],
    [`scale 1/16" = 1' - 0"`, 16 / 72, `1/16" = 1'-0"`],
    [`1 1/2" = 1'-0"`, 1 / 1.5 / 72, `1 1/2" = 1'-0"`],
    [`3/4" = 1'6"`, 2 / 72, `3/4" = 1'-6"`],
    [`1 IN = 40 FT`, 40 / 72, `1" = 40'`],
    [`1/8” = 1’-0”`, 8 / 72, `1/8" = 1'-0"`],
  ])("%s", (text, fpp, label) => {
    const notes = findScaleNotes(text);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.fpp).toBeCloseTo(fpp, 12);
    expect(notes[0]!.text).toBe(label);
  });

  it("gives exactly 8/72, 20/72 and (32/3)/72 for the owner's three examples", () => {
    expect(findScaleNotes(`1/8" = 1'-0"`)[0]!.fpp).toBe(8 / 72);
    expect(findScaleNotes(`1" = 20'`)[0]!.fpp).toBe(20 / 72);
    expect(findScaleNotes(`3/32" = 1'-0"`)[0]!.fpp).toBeCloseTo(32 / 3 / 72, 15);
  });

  it("reads metric 1:N only when the sheet names millimetres or metres", () => {
    expect(findScaleNotes("PLAN 1:100")).toEqual([]);
    const n = findScaleNotes("ROOF PLAN 1:100   ALL DIMENSIONS IN mm");
    expect(n).toHaveLength(1);
    expect(n[0]!.text).toBe("1:100");
    expect(n[0]!.fpp).toBeCloseTo(100 / 864, 12);
    expect(findScaleNotes("meets at 1:30 pm, dims in mm")).toEqual([]); // not a metric scale
  });

  it("ignores text that is not a scale note", () => {
    for (const t of [
      "NOT TO SCALE",
      `12'-6" x 20'-0"`,
      `SLOPE 1/4" PER FOOT`,
      "SHEET A-101",
      `A1011/8"=1'`, // a sheet number run into the note: 1011/8" is not a paper size
    ])
      expect(findScaleNotes(t)).toEqual([]);
  });
});

describe("pickSheetScale", () => {
  it("one distinct scale (written twice, two ways) → that scale", () => {
    const r = pickSheetScale(`ROOF PLAN SCALE: 1/8" = 1'-0"  KEY PLAN 1/8"=1'`);
    expect(r.scale?.fpp).toBe(8 / 72);
    expect(r.scale?.feetPerInch).toBe(8);
    expect(r.choices).toEqual([]);
  });
  it("several distinct scales → null, with the list to choose from", () => {
    const r = pickSheetScale(`PLAN 1/8" = 1'-0"  DETAIL 1 1/2" = 1'-0"  SITE 1" = 20'`);
    expect(r.scale).toBeNull();
    expect(r.choices.map((c) => c.text)).toEqual([`1/8" = 1'-0"`, `1 1/2" = 1'-0"`, `1" = 20'`]);
  });
  it("no scale note → null, no choices", () => {
    expect(pickSheetScale("GENERAL NOTES  NOT TO SCALE")).toEqual({ scale: null, choices: [] });
  });
  it("remembers where the note is on the sheet", () => {
    const { text, starts } = joinTextItems([
      {
        str: "ROOF PLAN",
        transform: [10, 0, 0, 10, 100, 700],
        width: 60,
        height: 10,
        hasEOL: true,
      },
      { str: "SCALE: ", transform: [8, 0, 0, 8, 100, 680], width: 30, height: 8 },
      { str: `1/8" = 1'-0"`, transform: [8, 0, 0, 8, 130, 680], width: 50, height: 8 },
    ]);
    expect(text).toBe(`ROOF PLAN\nSCALE: 1/8" = 1'-0"`);
    expect(pickSheetScale(text, starts).scale?.at).toEqual([130, 680]);
  });
  it("joins a note pdf.js split into touching pieces without adding spaces", () => {
    const piece = (str: string, x: number, w: number) => ({
      str,
      transform: [8, 0, 0, 8, x, 50],
      width: w,
      height: 8,
    });
    const { text } = joinTextItems([
      piece("1/", 0, 8),
      piece(`8"`, 8, 8),
      piece(" = ", 16, 12),
      piece("1", 28, 4),
      piece(`'-0"`, 32, 12),
    ]);
    expect(text).toBe(`1/8" = 1'-0"`);
  });
});

describe("the scale set from a sheet note", () => {
  it("is a one-inch (72-unit) level line of b / a feet under the note, tagged as read", () => {
    const s = sheetScaleLine({ text: `1/8" = 1'-0"`, feetPerInch: 8 }, [300, 500], 2592, 1728);
    expect(s).toMatchObject({ ax: 300, ay: 514, bx: 372, by: 514, feet: 8, source: "sheet" });
    expect(s.note).toBe(`1/8" = 1'-0"`);
    expect(feetPerPx(s)).toBe(8 / 72);
    expect(scaleOrigin(s)).toEqual({ source: "sheet", note: `1/8" = 1'-0"` });
  });
  it("stays on the page, and goes near the bottom right when the note's place is unknown", () => {
    const s = sheetScaleLine({ text: `1" = 20'`, feetPerInch: 20 }, [2580, 1720], 2592, 1728);
    expect(s.bx).toBeLessThanOrEqual(2592);
    expect(s.ay).toBeLessThanOrEqual(1728);
    const t = sheetScaleLine({ text: `1" = 20'`, feetPerInch: 20 }, null, 2592, 1728);
    expect(t.bx).toBeLessThan(2592);
    expect(feetPerPx(t)).toBe(20 / 72);
  });
  it("a drawn scale (or an old untagged one) is 'drawn'; none is null", () => {
    expect(scaleOrigin({ ax: 0, ay: 0, bx: 1, by: 0, feet: 1 })).toEqual({ source: "drawn" });
    expect(scaleOrigin(null)).toBeNull();
  });
  it("says where it came from, and warns on a sheet that is not full size", () => {
    expect(sheetScaleMessage(`1/8" = 1'-0"`)).toBe(
      `Scale read from the sheet: 1/8" = 1'-0" — check it against a printed dimension`,
    );
    expect(sheetSizeWarning(36 * 72, 24 * 72)).toBeNull(); // ARCH D
    expect(sheetSizeWarning(22 * 72, 34 * 72)).toBeNull(); // ANSI D
    expect(sheetSizeWarning(612, 792)).toBe(
      "This sheet is 8.5×11 in; if it was printed at a reduced size the scale note is off by that factor.",
    );
    expect(sheetSizeWarning(17 * 72, 11 * 72)).toContain("17×11 in");
  });
});

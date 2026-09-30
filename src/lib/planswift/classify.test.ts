import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  classifyRow,
  classifyRows,
  describeTarget,
  formatInches,
  normalizeRowName,
  parseDims,
  parseInchNumber,
  parseMembrane,
  parseParapetProfile,
  parsePipeSize,
  type ClassifiedRow,
} from "./classify";
import { readPlanSwiftWorkbook, type PlanSwiftRow } from "./parse";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

const row = (name: string, qty: number, units: string, linearTotal: number | null = null) =>
  ({
    sheetRow: 2,
    name,
    description: "",
    qty,
    units,
    unitKind: units === "SQ FT" ? "sqft" : units === "FT" ? "ft" : units === "EA" ? "ea" : "other",
    linearTotal,
    wallHeight: null,
    wallArea: null,
  }) satisfies PlanSwiftRow;

/** [name, target, confidence] per row. */
const brief = (cs: ClassifiedRow[]) => cs.map((c) => [c.row.name, c.target, c.confidence]);

describe("test_pS.xlsx — every row", async () => {
  const sheet = await readPlanSwiftWorkbook(fixture("test_pS.xlsx"));
  const cs = classifyRows(sheet.rows);

  it("targets", () => {
    expect(brief(cs)).toEqual([
      ['50 mill DT / Duro-Teck TPO 2" Iso, 1/2" HD Poly ISO Coverboard', "section", "high"],
      ["Coping/2-piece", "coping", "high"],
      ["tapperd Iso/ Crickets", "tapered", "high"],
      ['Parapet 01 ( 6"_/ 102" )', "parapet", "high"],
      ['Parapet 02 ( 6"_/ 36" )', "parapet", "high"],
      ['Parapet 03 ( 6"_/ 66" )', "parapet", "high"],
      ["Gutter", "gutter", "high"],
      ["Down spouts/ splash blocks", "metals", "medium"],
      ["Exhaust fans 26 X 26 X 12", "curb", "high"],
      ["Roof Hatch 42 X 42 X 12", "curb", "high"],
      ["Drains", "drain", "high"],
    ]);
  });

  it("the membrane of the roof area", () => {
    expect(cs[0]!.details.membrane).toEqual({
      thicknessMil: 50,
      roofSystem: "Duro-Tech TPO",
      systemWords: ["Duro-Teck", "TPO"],
      layers: [
        { count: 1, thicknessIn: 2, kind: "iso", boardName: '2" ISO', text: '2" Iso' },
        {
          count: 1,
          thicknessIn: 0.5,
          kind: "hd-iso",
          boardName: '1/2" HD ISO',
          text: '1/2" HD Poly ISO Coverboard',
        },
      ],
      notes: [],
    });
  });

  it("parapet profiles, curb sizes, the tapered board", () => {
    expect(cs.slice(3, 6).map((c) => [c.details.skirtIn, c.details.verticalIn, c.row.qty])).toEqual(
      [
        [6, 102, 604.56],
        [6, 36, 415.49],
        [6, 66, 114.83],
      ],
    );
    expect(
      cs
        .slice(8, 10)
        .map((c) => [c.details.widthIn, c.details.lengthIn, c.details.heightIn, c.row.qty]),
    ).toEqual([
      [26, 26, 12, 10],
      [42, 42, 12, 1],
    ]);
    expect(cs[2]!.details.quoteBoard).toBe("Tapered ISO");
    expect(cs[7]!.details.kind).toBe("Downspouts");
  });

  it("the review screen's wording", () => {
    expect(cs.map((c) => describeTarget(c))).toEqual([
      'section 13,445.64 sq ft · 50 mil Duro-Tech TPO · 2" ISO + 1/2" HD ISO · perimeter 1,268.56 ft',
      "coping 1,344.01 ft (a Sheet Metals line)",
      "Tapered ISO quote layer, 5,185.38 sq ft",
      'parapet skirt 6", vertical 102", 604.56 ft',
      'parapet skirt 6", vertical 36", 415.49 ft',
      'parapet skirt 6", vertical 66", 114.83 ft',
      "gutter 200.96 ft (Metals › Gutters)",
      "Downspouts 7 EA (a Sheet Metals line)",
      "curb 26 × 26 × 12 in, ×10",
      "curb 42 × 42 × 12 in, ×1",
      "drains ×12",
    ]);
    // Another target for the same row keeps its numbers.
    expect(describeTarget(cs[8]!, "accessory")).toBe("Exhaust fans 26 X 26 X 12 10 EA");
    expect(describeTarget(cs[6]!, "skip")).toBe("left out of the bid");
  });
});

describe("knox.xlsx — every row", async () => {
  const sheet = await readPlanSwiftWorkbook(fixture("knox.xlsx"));
  const cs = classifyRows(sheet.rows);
  const by = (name: string) => cs.find((c) => c.row.name === name)!;

  it("targets", () => {
    expect(brief(cs)).toEqual([
      ["Roof Type 1 (Liquid applied silicone over metal roof)", "section", "high"],
      ["Roof Type 2 ( Fully adhered .60 mil EPDM, 2 layers of 2.6 ISO )", "section", "high"],
      ["crickets", "tapered", "high"],
      ["Coping Cap", "coping", "high"],
      ['Parapet 01 ( 6"_/ 54" )', "parapet", "high"],
      ['Parapet 02 ( 6"_/ 18" )', "parapet", "high"],
      ['Parapet 03 ( 6"_/ 120" )', "parapet", "high"],
      ['A/C ( 98" X 110" X 12" )', "curb", "high"],
      ["Exhaust Fans ( 20 X 20 X 16 )", "curb", "high"],
      ['Exhaust Fan ( 32" X 32" X 16" )', "curb", "high"],
      ['Exhaust Fan ( 42" X 42" X 16" )', "curb", "high"],
      ['Exhaust Fans ( 52" X 29" X 12" )', "curb", "high"],
      ['Curbs ( 30" X 72" X 16" )', "curb", "high"],
      ["Roof Hatch ( 44 X 54 X 12 )", "curb", "high"],
      ["ATR Hub", "accessory", "low"],
      ['4" Stacks', "pipe", "high"],
      ['3" Stacks', "pipe", "high"],
      ['2" Stacks', "pipe", "high"],
      ["Roof Drains", "drain", "high"],
      ["Collector Heads", "metals", "medium"],
      ["gutter", "gutter", "high"],
      ["Down spouts", "metals", "high"],
      ["Cast Iron DS Boots", "unmatched", "low"],
      ["Roof Type 3 ( Standing Seam Metal )", "section", "high"],
      ["Metal Roof Rake", "metals", "high"],
      ["Drip edge", "metals", "high"],
      ["Head wall", "metals", "high"],
      ["Metal Wall Panel", "nondl", "medium"],
      ["Base", "metals", "high"],
      ["J- Chanel", "metals", "high"],
      ["Header", "metals", "high"],
      ["Sill", "metals", "high"],
      ["Jams", "metals", "high"],
      ["cap measurment", "unmatched", "low"],
      ["Alt 9 Metal/ Underlayment", "section", "low"],
      ["Base", "metals", "high"],
      ["Sill", "metals", "high"],
      ["Header", "metals", "high"],
      ["Jams", "metals", "high"],
      ["J-Chanel", "metals", "high"],
      ["Outside corners", "metals", "high"],
      ["ACM Panels", "nondl", "medium"],
    ]);
  });

  it("roof types: membrane, attachment and layers from the name; unknown words kept", () => {
    const rt2 = by("Roof Type 2 ( Fully adhered .60 mil EPDM, 2 layers of 2.6 ISO )");
    expect(rt2.details.membrane).toMatchObject({
      thicknessMil: 60,
      roofSystem: "EPDM Rubber",
      attachment: "adhered",
      layers: [{ count: 2, thicknessIn: 2.6, kind: "iso", boardName: '2.6" ISO' }],
      notes: [],
    });
    const rt1 = by("Roof Type 1 (Liquid applied silicone over metal roof)");
    expect(rt1.details.membrane?.roofSystem).toBeUndefined();
    expect(rt1.details.membrane?.notes).toEqual([
      'Also in the name: "Liquid applied silicone metal".',
    ]);
    expect(by("Roof Type 3 ( Standing Seam Metal )").details.membrane?.notes).toEqual([
      'Also in the name: "Standing Seam Metal".',
    ]);
    expect(by("Alt 9 Metal/ Underlayment").reason).toMatch(/alternate/);
  });

  it("curbs, stacks, parapets, crickets", () => {
    const size = (n: string) => {
      const d = by(n).details;
      return [d.widthIn, d.lengthIn, d.heightIn, by(n).row.qty];
    };
    expect(size('A/C ( 98" X 110" X 12" )')).toEqual([98, 110, 12, 3]);
    expect(size('Curbs ( 30" X 72" X 16" )')).toEqual([30, 72, 16, 3]);
    expect(size("Roof Hatch ( 44 X 54 X 12 )")).toEqual([44, 54, 12, 1]);
    expect(size('Exhaust Fans ( 52" X 29" X 12" )')).toEqual([52, 29, 12, 3]);
    expect(
      ['4" Stacks', '3" Stacks', '2" Stacks'].map((n) => [by(n).details.sizeIn, by(n).row.qty]),
    ).toEqual([
      [4, 10],
      [3, 1],
      [2, 2],
    ]);
    expect(by("Roof Drains").row.qty).toBe(6);
    expect(
      cs
        .filter((c) => c.target === "parapet")
        .map((c) => [c.details.skirtIn, c.details.verticalIn, c.row.qty]),
    ).toEqual([
      [6, 54, 678.79],
      [6, 18, 159.99],
      [6, 120, 91.18],
    ]);
    expect(by("crickets").details.quoteBoard).toBe("Tapered Crickets");
    expect(by("cap measurment").reason).toMatch(/check measurement/);
    expect(by("Cast Iron DS Boots").reason).toMatch(/boots/);
    expect(by("Metal Wall Panel").details.where).toBe("Non-DL › Contractor Applications");
  });
});

describe("name reading", () => {
  it("membrane mil in its spellings", () => {
    expect(parseMembrane("50 mill DT").thicknessMil).toBe(50);
    expect(parseMembrane(".60 mil EPDM").thicknessMil).toBe(60);
    expect(parseMembrane(".060 mil EPDM").thicknessMil).toBe(60);
    expect(parseMembrane("60 mil PVC").thicknessMil).toBe(60);
    expect(parseMembrane("60mil").thicknessMil).toBe(60);
    expect(parseMembrane("45-mil TPO").thicknessMil).toBe(45);
  });

  it("systems", () => {
    const sys = (n: string) => parseMembrane(n).roofSystem;
    expect(sys("Duro-Tuff 50")).toBe("Duro-Tuff");
    expect(sys("DuroBond")).toBe("Duro-Bond");
    expect(sys("Duro Teck")).toBe("Duro-Tech TPO");
    expect(sys("Duro-Last 50 mil")).toBe("Duro-Last");
    expect(sys("60 mil PVC")).toBe("Duro-Last");
    expect(sys("EPDM")).toBe("EPDM Rubber");
    const tpo = parseMembrane("60 mil TPO mechanically fastened");
    expect(tpo.roofSystem).toBeUndefined();
    expect(tpo.attachment).toBe("mechanical");
    expect(tpo.notes[0]).toMatch(/pick Duro-Tech TPO or Non-DL TPO/);
  });

  it("insulation layers", () => {
    expect(parseMembrane("2 layers of 2.6 ISO").layers).toMatchObject([
      { count: 2, thicknessIn: 2.6 },
    ]);
    expect(parseMembrane('1 1/2" ISO + 1/4" Dens Deck').layers.map((l) => l.boardName)).toEqual([
      '1 1/2" ISO',
      '1/4" Dens Deck',
    ]);
  });

  it("dimensions, parapet profiles, pipe sizes, inches", () => {
    expect(parseDims("Exhaust fans 26 X 26 X 12")).toEqual({ a: 26, b: 26, c: 12 });
    expect(parseDims('A/C  ( 98" X 110" X 12" )')).toEqual({ a: 98, b: 110, c: 12 });
    expect(parseDims("RTU 48x96")).toEqual({ a: 48, b: 96 });
    expect(parseDims("Hatch 3' x 4'")).toEqual({ a: 36, b: 48 });
    expect(parseDims("Drains")).toBeNull();
    expect(parseParapetProfile('Parapet  01  ( 6"_/ 102" )')).toEqual({
      skirtIn: 6,
      verticalIn: 102,
    });
    expect(parseParapetProfile('Parapet 01 (6"_/54")')).toEqual({ skirtIn: 6, verticalIn: 54 });
    expect(parseParapetProfile('Parapet 6" / 102"')).toEqual({ skirtIn: 6, verticalIn: 102 });
    expect(parseParapetProfile("Parapet 01")).toBeNull();
    expect(parsePipeSize('4" Stacks')).toBe(4);
    expect(parsePipeSize('1 1/2" pipe')).toBe(1.5);
    expect(parsePipeSize("3in vent stack")).toBe(3);
    expect(parsePipeSize("Stacks")).toBeNull();
    expect(parseInchNumber("1/2")).toBe(0.5);
    expect([0.5, 1.5, 2, 2.6, 0.25].map(formatInches)).toEqual(["1/2", "1 1/2", "2", "2.6", "1/4"]);
  });

  it("an EA row named like a curb but with no size is a curb, flagged", () => {
    const c = classifyRow(row("RTU", 2, "EA"));
    expect([c.target, c.confidence]).toEqual(["curb", "medium"]);
    expect(describeTarget(c)).toBe("curb no size in the name, ×2");
  });

  it("other units are placed by hand", () => {
    expect(classifyRow(row("Concrete", 3, "CY")).target).toBe("unmatched");
  });

  it("normalised names group similar rows", () => {
    expect(normalizeRowName('Parapet  01  ( 6"_/ 102" )')).toBe("parapet");
    expect(normalizeRowName('Parapet 02 (6"_/36")')).toBe("parapet");
    expect(normalizeRowName('4" Stacks')).toBe("stacks");
    expect(normalizeRowName("Exhaust fans 26 X 26 X 12")).toBe("exhaust fans");
    expect(normalizeRowName('Exhaust Fans  ( 52" X 29" X 12" )')).toBe("exhaust fans");
    expect(normalizeRowName("J- Chanel")).toBe("j chanel");
  });
});

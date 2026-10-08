/**
 * The owner's "Monicello Banking Company 2026.xlsx" (Oct 5): imported into a bid whose sections
 * were "wayyyy off". Both roof rows — "Roof Type 1 - 50 Mil DL, Min 6" ISO, 1/8th per Ft
 * Tappered Iso, 1/4" Dens Deck" and Roof Type 2 — were filed as Tapered ISO quotes because of
 * the word "Tappered", so the metal panel row became the only "roof" (a 100 × 2 ft strip at the
 * default 40 mil), "Parrpet 02" was dropped for its spelling, and a 0-quantity stack came along.
 * Now: the roofs are sections carrying their tapered layer, 50 mil Duro-Last ("DL"), with their
 * ISO and DensDeck layers; all three parapets; the metal panel a Sheet Metals line; no 0 rows.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { classifyRows, describeTarget, parseMembrane, parseParapetProfile } from "./classify";
import { readPlanSwiftWorkbook } from "./parse";
import { planSwiftSeed, splitBoardThickness, type PlanSwiftChoice } from "./to-seed";

/** The live Estimate Pricing board list (underlayment_board_group, Oct 6): no 6" ISO exists. */
const LIVE_BOARDS = [
  '1/2" ISO',
  '1" ISO',
  '1 1/2" ISO',
  '2" ISO',
  '2 1/2" ISO',
  '2.7" ISO',
  '3" ISO',
  '3 1/2" ISO',
  '4" ISO',
  "ISO Quote 4'x 8'",
  "1/2\" HD ISO 4'x 4'",
  '1" Rigid',
  '2" Rigid',
  '3" Rigid',
  '4" Rigid',
  '1/4" Dens Deck',
  '3/8" Dens Deck',
  "Tapered ISO",
  "Tapered Crickets",
];

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const BOARDS = ['1/2" ISO', '2" ISO', '6" ISO', '1/4" DensDeck', "Tapered ISO", "Tapered Crickets"];
const LABOR = { "Duro-Last|mechanical": { thicknessLaborByMil: { 40: 1, 50: 1.05, 60: 1.1 } } };

describe("monticello.xlsx — the owner's export, row by row", async () => {
  const sheet = await readPlanSwiftWorkbook(fixture("monticello.xlsx"));
  const cs = classifyRows(sheet.rows);
  const by = (start: string) => cs.find((c) => c.row.name.startsWith(start))!;

  it('13 rows: the 0-quantity 1.5" stack is skipped with a note', () => {
    expect(sheet.rows).toHaveLength(13);
    expect(sheet.rows.map((r) => r.name)).not.toContain('1.5" Stack');
    expect(sheet.warnings).toEqual(['Row 12 "1.5" Stack": quantity 0 — skipped.']);
  });

  it("both Roof Type rows are sections (not tapered quotes), carrying a tapered layer", () => {
    for (const r of [by("Roof Type 1"), by("Roof Type 2")]) {
      expect([r.target, r.confidence]).toEqual(["section", "high"]);
      expect(r.details.taperedInName).toBe(true);
      expect(r.details.quoteBoard).toBe("Tapered ISO");
      expect(r.details.membrane?.thicknessMil).toBe(50);
      expect(r.details.membrane?.roofSystem).toBe("Duro-Last");
      // "1/8th per Ft" is a slope, not a 1" / 8" parapet profile.
      expect(r.details.skirtIn).toBeUndefined();
      expect(r.details.verticalIn).toBeUndefined();
    }
    expect(by("Roof Type 1").details.membrane?.layers.map((l) => l.boardName)).toEqual([
      '6" ISO',
      '1/4" Dens Deck',
    ]);
    expect(by("Roof Type 2").details.membrane?.layers.map((l) => l.boardName)).toEqual([
      '2" ISO',
      '1/4" Dens Deck',
    ]);
    expect(describeTarget(by("Roof Type 1"))).toBe(
      'section 4,157.86 sq ft · 50 mil Duro-Last · 6" ISO + 1/4" Dens Deck · + Tapered ISO quote · perimeter 258.7 ft',
    );
  });

  it('"Parrpet 02" is a parapet like the other two; the metal panel is a Sheet Metals line', () => {
    expect([by("Parrpet 02").target, by("Parrpet 02").confidence]).toEqual(["parapet", "high"]);
    expect(by("Parrpet 02").details).toMatchObject({ skirtIn: 6, verticalIn: 18 });
    const metal = by("Metal MTL1");
    expect([metal.target, metal.confidence]).toEqual(["metals", "medium"]);
    expect(metal.details).toMatchObject({ kind: "Metal panel", where: "Non-DL › Sheet Metals" });
    expect(cs.map((c) => c.target)).toEqual([
      "section",
      "section",
      "coping",
      "parapet",
      "parapet",
      "parapet",
      "curb",
      "curb",
      "pipe",
      "pipe",
      "drain",
      "drain",
      "metals",
    ]);
  });

  it("the seed: two roofs at 50 mil with ISO, the tapered quote, DensDeck; three parapets", () => {
    const choices: PlanSwiftChoice[] = cs.map((c) => ({ row: c, target: c.target }));
    const seed = planSwiftSeed(sheet, choices, {
      fileName: "Monicello Banking Company 2026.xlsx",
      boardNames: BOARDS,
      labor: LABOR,
    });
    expect(seed.sections.map((s) => [s.name, s.length, s.width, s.thickness])).toEqual([
      ["Roof Type 1", 69.67, 59.68, 50],
      ["Roof Type 2", 50.08, 21.28, 50],
    ]);
    expect(seed.sections.map((s) => s.layers!.map((l) => [l.board, !!l.quote]))).toEqual([
      [
        ['6" ISO', false],
        ["Tapered ISO", true],
        ['1/4" DensDeck', false],
      ],
      [
        ['2" ISO', false],
        ["Tapered ISO", true],
        ['1/4" DensDeck', false],
      ],
    ]);
    expect(JSON.stringify(seed)).toContain('"roofSystem":"Duro-Last"');
    expect(seed.parapets.map((p) => [p.name, p.lengthFt, p.skirtInches, p.verticalInches])).toEqual(
      [
        ["Parapet 01", 273.06, 6, 54],
        ["Parrpet 02", 50.08, 6, 18],
        ["Parapet 03", 91.86, 6, 24],
      ],
    );
    expect(seed.nonDlCustom.sheetMetal?.map((l) => [l.description, l.qty])).toEqual([
      ["Coping Aluminum", 380.15],
      ["Metal MTL1/ MTL2 @ Addenda 2 22Ga V-groove", 205.46],
    ]);
    expect(seed.pipeStacks.map((p) => [p.size, p.quantity])).toEqual([
      [4, 1],
      [2, 1],
    ]);
    expect(seed.importInfo.summary).toBe(
      'From PlanSwift "Monicello Banking Company 2026.xlsx": 2 sections, 5,223.38 sq ft; 415 ft of parapet; 2 curbs; 2 tapered quote layers; 2 pipe stacks; 2 Non-DL lines; 2 to place by hand.',
    );
    expect(seed.warnings).toContain(
      "Roof Type 1: a Tapered ISO quote layer from its name, with no price — enter the quote on the Underlayment screen.",
    );
    // The old import's tell-tale: nothing is a 100 × 2 ft strip any more.
    expect(seed.warnings.join("\n")).not.toContain("100.13");
  });
});

describe('"Min 6" ISO" with the live board list (owner, Oct 6: "it would be two layers of 3 inch")', async () => {
  const sheet = await readPlanSwiftWorkbook(fixture("monticello.xlsx"));
  const cs = classifyRows(sheet.rows);
  const seed = planSwiftSeed(
    sheet,
    cs.map((c) => ({ row: c, target: c.target })),
    { fileName: "Monicello Banking Company 2026.xlsx", boardNames: LIVE_BOARDS, labor: LABOR },
  );
  it('Roof Type 1 is 3" ISO + 3" ISO, the tapered quote, then 1/4" Dens Deck; Roof Type 2 2" ISO', () => {
    expect(seed.sections.map((s) => s.layers!.map((l) => l.board))).toEqual([
      ['3" ISO', '3" ISO', "Tapered ISO", '1/4" Dens Deck'],
      ['2" ISO', "Tapered ISO", '1/4" Dens Deck'],
    ]);
    expect(seed.sections[0]!.notes).toContain(
      '6" ISO: no single board that thick — 3" ISO + 3" ISO.',
    );
    expect(seed.sections[0]!.notes).not.toContain("add the layer by hand");
  });
  it("splitBoardThickness: the fewest boards, then the most even split", () => {
    expect(splitBoardThickness(6, "iso", LIVE_BOARDS)).toEqual(['3" ISO', '3" ISO']);
    expect(splitBoardThickness(5, "iso", LIVE_BOARDS)).toEqual(['2 1/2" ISO', '2 1/2" ISO']);
    expect(splitBoardThickness(4.5, "iso", LIVE_BOARDS)).toEqual(['2" ISO', '2 1/2" ISO']);
    expect(splitBoardThickness(7, "iso", LIVE_BOARDS)).toEqual(['3 1/2" ISO', '3 1/2" ISO']);
    expect(splitBoardThickness(9, "iso", LIVE_BOARDS)).toEqual(['3" ISO', '3" ISO', '3" ISO']);
    expect(splitBoardThickness(6, "eps", LIVE_BOARDS)).toEqual(['3" Rigid', '3" Rigid']);
    // Not a flat insulation board, or nothing adds up: left for the by-hand note.
    expect(splitBoardThickness(6, "densdeck", LIVE_BOARDS)).toBeNull();
    expect(splitBoardThickness(0.3, "iso", LIVE_BOARDS)).toBeNull();
  });
});

describe("the import dialog remembers only what the estimator changed", () => {
  it("passes the importer's guess beside each target", () => {
    const src = readFileSync("src/components/import-planswift-dialog.tsx", "utf8");
    expect(src).toMatch(
      /rememberMappings\(\s*safeStorage\("local"\),\s*choices\.map\(\(r\) => \(\{\s*key: r\.row\.key,\s*target: r\.target,\s*guessed: r\.row\.guessed \?\? r\.row\.target,\s*\}\)\),\s*\);/,
    );
  });
});

describe("name reading added for this file", () => {
  it('"DL" is Duro-Last; "Non-DL" is not', () => {
    expect(parseMembrane('50 Mil DL, Min 6" ISO').roofSystem).toBe("Duro-Last");
    expect(parseMembrane("Non-DL TPO 60 mil").roofSystem).toBeUndefined();
    expect(parseMembrane("Non DL membrane").roofSystem).toBeUndefined();
  });
  it("a parapet profile needs an inch mark or the underscore on the skirt", () => {
    expect(parseParapetProfile("1/8th per Ft Tappered Iso")).toBeNull();
    expect(parseParapetProfile('Parrpet  02  ( 6"_/ 18" )')).toEqual({
      skirtIn: 6,
      verticalIn: 18,
    });
    expect(parseParapetProfile("Wall (6_/54)")).toEqual({ skirtIn: 6, verticalIn: 54 });
  });
  it("a tapered-only row is still a tapered quote; a roof with tapered in its name is a section", () => {
    const [onlyTapered, roof] = classifyRows([
      {
        sheetRow: 2,
        name: "Tapered ISO 1/4 per ft",
        description: "",
        qty: 1000,
        units: "SQ FT",
        unitKind: "sqft",
        linearTotal: null,
        wallHeight: null,
        wallArea: null,
      },
      {
        sheetRow: 3,
        name: "Roof Type 4 (tapered)",
        description: "",
        qty: 1000,
        units: "SQ FT",
        unitKind: "sqft",
        linearTotal: null,
        wallHeight: null,
        wallArea: null,
      },
    ]);
    expect(onlyTapered!.target).toBe("tapered");
    expect([roof!.target, roof!.details.taperedInName]).toEqual(["section", true]);
  });
});

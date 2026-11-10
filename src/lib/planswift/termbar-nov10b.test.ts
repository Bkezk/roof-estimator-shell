/**
 * Re-check, Nov 10 (docs/qa/recheck-service-takeoff-setup-roles-2026-11-10.md, Part 2,
 * observation 2): a PlanSwift row named "T-Bar" (a length) had no home of its own. It read
 * "unsure: a length the importer does not recognise" and needed a pick every time.
 *
 * "T-Bar" is the estimator's own word: the termination of a roof side or a parapet (legacy id
 * 2), counted and priced on Accessories › Term Bar. So the row now has its own destination,
 * "Termination bar (Accessories › Term Bar)": the sheet's feet, less what the bid's T-Bar
 * parapets already count there, go in as No Drill "Additional (ft)" under the roof's colour.
 * No price and no labor rate is made up: the Term Bar screen prices it as it prices its own.
 */
import { describe, expect, it } from "vitest";

import type { BidSectionInput, CurbInput, ParapetInput } from "@/lib/engine/bid-builder";
import { defaultEdges } from "@/lib/engine/edges";
import { emptyCustomer, type SavedBidState } from "@/lib/proposal-bid";
import {
  PLANSWIFT_TARGET_LABELS,
  PLANSWIFT_TARGETS,
  TERM_BAR_RE,
  classifyRow,
  classifyRows,
  describeTarget,
} from "./classify";
import { parsePlanSwiftMatrix, type PlanSwiftRow } from "./parse";
import {
  planSwiftSeed,
  savedFromPlanSwiftSeed,
  termBarAdditionalFt,
  type PlanSwiftChoice,
} from "./to-seed";

const row = (name: string, qty: number, units: "FT" | "EA" | "SQ FT"): PlanSwiftRow => ({
  sheetRow: 2,
  name,
  description: "",
  qty,
  units,
  unitKind: units === "FT" ? "ft" : units === "EA" ? "ea" : "sqft",
  linearTotal: null,
  wallHeight: null,
  wallArea: null,
});

describe("the importer knows a termination bar by its names", () => {
  it.each([
    "T-Bar",
    "T Bar",
    "TBar",
    "t-bar",
    "T-BAR",
    "T-Bars",
    "Term Bar",
    "term bar",
    "Term. Bar",
    "Termination Bar",
    "TERMINATION BAR",
    'T-Bar 1"',
    '1" Termination Bar',
    "Alum. T-Bar @ wall",
    "Term Bar Base",
  ])("%s, in feet, is a termination bar: sure, nothing asked", (name) => {
    const c = classifyRow(row(name, 33.53, "FT"));
    expect([c.target, c.confidence]).toEqual(["termbar", "high"]);
    expect(c.details).toMatchObject({
      kind: "Termination bar",
      where: "Accessories › Term Bar",
    });
  });

  it("the review screen offers it by name and says where the feet go", () => {
    expect(PLANSWIFT_TARGETS).toContain("termbar");
    expect(PLANSWIFT_TARGET_LABELS.termbar).toBe("Termination bar (Accessories › Term Bar)");
    expect(describeTarget(classifyRow(row("T-Bar", 33.53, "FT")))).toBe(
      'termination bar 33.53 ft — Accessories › Term Bar, No Drill, "Additional (ft)" in the roof\'s colour',
    );
  });

  it("other words keep their own homes: a parapet, coping, a strap, a gutter, drip edge", () => {
    expect(classifyRow(row('Parapet 01 T-Bar ( 6"_/ 12" )', 16, "FT")).target).toBe("parapet");
    expect(classifyRow(row("Coping", 16, "FT")).target).toBe("coping");
    expect(classifyRow(row("Gutter strap", 10, "FT")).target).toBe("unmatched");
    expect(classifyRow(row('7" Gutters', 40.29, "FT")).target).toBe("gutter");
    expect(classifyRow(row("Drip Edge", 40, "FT")).target).toBe("metals");
    // Not a termination bar: a word that only ends in "t" before "bar", and plain "bar".
    for (const name of ["Wet bar", "Rebar", "Grab bars", "Sub-total bar", "Flat bar"])
      expect(TERM_BAR_RE.test(name)).toBe(false);
  });

  it("a curb whose name says its T-Bar option is still a curb", () => {
    expect(classifyRow(row('A/C Lift & T-Bar ( 30" X 40" X 12" )', 2, "EA")).target).toBe("curb");
    expect(classifyRow(row("Curb, No Lift & T-Bar", 2, "EA")).target).toBe("curb");
  });

  it("termination bar counted by the piece is named and left to place: no length is guessed", () => {
    const c = classifyRow(row("T-Bar", 6, "EA"));
    expect([c.target, c.confidence]).toEqual(["unmatched", "low"]);
    expect(c.reason).toBe(
      "termination bar counted by the piece — the bid takes it in feet: type the length on Accessories › Term Bar (Additional)",
    );
  });
});

// ── The seed and the bid ──────────────────────────────────────────────────────────────────────

const SHEET = parsePlanSwiftMatrix(
  [
    ["Name", "Description", "Takeoff", "Units"],
    ['60 Mill Durobond, 1/4" Tappered ISO, 1 Layer 1.5" Poly ISO', "", 139.37, "SQ FT"],
    ['Parapet 01 ( 6"_/ 12" )', "", 16.41, "FT"],
    ["T-Bar", "", 33.53, "FT"],
  ],
  "Sheet1",
)!;

const factories = (parapetTermOptionId: number) => {
  let seq = 1;
  const newSection = (d: Partial<BidSectionInput> = {}): BidSectionInput => ({
    id: `s${seq++}`,
    name: `Section ${seq - 1}`,
    length: 0,
    width: 0,
    deckType: "Wood",
    thickness: 40,
    color: "White",
    fieldLap: 60,
    fastenerOc: 18,
    perimLengthFt: 0,
    cornerLengthFt: 0,
    enhancementWidthFt: 3,
    perimFastenerOc: 12,
    cornerFastenerOc: 6,
    underlaymentBoard: "",
    layers: [],
    sheetSizeLabel: "1500 sf",
    tearOff: false,
    tearOffType: "",
    toThicknessInches: 0,
    pullTest: 350,
    designTable: 60,
    edges: defaultEdges(0, 0),
    perimCorners: [false, false, false, false],
    isQuickBid: true,
    complexity: 2,
    ...d,
  });
  let pseq = 1;
  const newParapet = (d: Partial<ParapetInput> = {}): ParapetInput => ({
    id: `p${pseq++}`,
    name: `Parapet ${pseq - 1}`,
    lengthFt: 1,
    heightBand: "",
    deckType: "Wood",
    predrill: false,
    canted: false,
    skirtInches: 6,
    cantInches: 0,
    verticalInches: 0,
    wallTopInches: 0,
    dropInches: 0,
    girthInches: 6,
    wallType: 4,
    pieces: 1,
    termOptionId: parapetTermOptionId,
    ...d,
  });
  let cseq = 1;
  const newCurb = (d: Partial<CurbInput> = {}): CurbInput => ({
    id: `c${cseq++}`,
    name: `Curb ${cseq - 1}`,
    quantity: 1,
    widthIn: 1,
    lengthIn: 1,
    curbType: "Open",
    deckType: "Wood",
    styleId: 1,
    dimCIn: 12,
    dimDIn: 6,
    ...d,
  });
  return { newSection, newParapet, newCurb };
};

const blank = (
  color: string,
  over: Partial<SavedBidState> = {},
): SavedBidState & { sectionDefaults: NonNullable<SavedBidState["sectionDefaults"]> } => ({
  roofSystem: "Duro-Last",
  attachment: "mechanical",
  membraneAdhesiveName: "Water Based Adhesive",
  sections: [],
  accessories: [],
  nonDlLines: [],
  metals: [],
  parapets: [],
  curbs: [],
  customer: emptyCustomer(),
  markupMode: 2,
  markup: 35,
  laborRate: 45,
  commission: 0,
  taxExempt: true,
  sectionDefaults: {
    deckType: "Wood",
    thickness: 40,
    color,
    sheetSizeLabel: "1500 sf",
    designTable: 60,
  },
  parapetDefaults: { wallType: 4 },
  ...over,
});

describe("the Activity & Fitness Center sheet's T-Bar row lands on Accessories › Term Bar", () => {
  const cs = classifyRows(SHEET.rows);
  const choices: PlanSwiftChoice[] = cs.map((r) => ({ row: r, target: r.target }));
  const seed = planSwiftSeed(SHEET, choices, {
    fileName: "Activity & Fitness Center.xlsx",
    importedAt: "2026-11-10T20:00:00.000Z",
  });

  it("the seed carries the feet, lists nothing to place by hand and says where they went", () => {
    expect(cs.map((c) => c.target)).toEqual(["section", "parapet", "termbar"]);
    expect(seed.termBarFt).toBe(33.53);
    expect(seed.unmapped).toEqual([]);
    expect(seed.summary).toContain("33.53 ft of termination bar");
    expect(seed.warnings.find((w) => w.startsWith("T-Bar:"))).toBe(
      'T-Bar: 33.53 ft on Accessories › Term Bar (No Drill, "Additional (ft)", the roof\'s colour) — roof sides and parapets terminated in T-Bar count there by themselves, so only the rest is added. Move it to Pre-Drill there if this bar goes on a pre-drilled wall.',
    );
    expect(seed.importInfo.mapping.find((m) => m.name === "T-Bar")!.detail).toBe(
      'Termination bar (Accessories › Term Bar): termination bar 33.53 ft — Accessories › Term Bar, No Drill, "Additional (ft)" in the roof\'s colour',
    );
  });

  it("a bid whose parapets end some other way gets the whole run as Additional, in white", () => {
    // 8 = 6" two-piece: nothing of the parapet counts as term bar.
    const bid = savedFromPlanSwiftSeed(blank("White"), seed, factories(8));
    expect(bid.accessoriesCalc!.termBar!.additionalNoDrill).toEqual({ White: 33.53 });
    expect(bid.accessoriesCalc!.termBar!.additionalPreDrill).toEqual({});
  });

  it("a bid whose parapets end in T-Bar gets only the rest: the engine counts those itself", () => {
    // 2 = T-Bar. The 16.41 ft parapet already counts on the Term Bar screen.
    const bid = savedFromPlanSwiftSeed(blank("White"), seed, factories(2));
    expect(bid.parapets!.map((p) => [p.lengthFt, p.termOptionId])).toEqual([[16.41, 2]]);
    expect(bid.accessoriesCalc!.termBar!.additionalNoDrill).toEqual({ White: 17.12 });
  });

  it("the colour is the one the roof's bar is bought in (tan, or gray for anything else)", () => {
    const tan = savedFromPlanSwiftSeed(blank("Tan"), seed, factories(8));
    expect(tan.accessoriesCalc!.termBar!.additionalNoDrill).toEqual({ Tan: 33.53 });
    const gray = savedFromPlanSwiftSeed(blank("Dark Gray"), seed, factories(8));
    expect(gray.accessoriesCalc!.termBar!.additionalNoDrill).toEqual({ Gray: 33.53 });
  });

  it("it adds to what the bid already has typed there, and leaves the rest of the screen alone", () => {
    const had = blank("White", {
      accessoriesCalc: {
        termBar: {
          additionalNoDrill: { White: 10, Tan: 4 },
          additionalPreDrill: { White: 7 },
          adjustNoDrillPct: 0,
          adjustPreDrillPct: 0,
          stripMastic: true,
          stripMasticLengthFt: 12,
        },
      },
    });
    const bid = savedFromPlanSwiftSeed(had, seed, factories(8));
    expect(bid.accessoriesCalc!.termBar).toMatchObject({
      additionalNoDrill: { White: 43.53, Tan: 4 },
      additionalPreDrill: { White: 7 },
      stripMastic: true,
      stripMasticLengthFt: 12,
    });
  });

  it("two rows add up; a seed from before this (no termBarFt) changes nothing", () => {
    const two = parsePlanSwiftMatrix(
      [
        ["Name", "Description", "Takeoff", "Units"],
        ["Roof 1 60 mil Duro-Last", "", 1000, "SQ FT"],
        ["T-Bar", "", 20.25, "FT"],
        ["Termination Bar", "", 10.5, "FT"],
      ],
      "Sheet1",
    )!;
    const s2 = planSwiftSeed(
      two,
      classifyRows(two.rows).map((r) => ({ row: r, target: r.target })),
      { fileName: "two.xlsx", importedAt: "2026-11-10T20:00:00.000Z" },
    );
    expect(s2.termBarFt).toBe(30.75);
    const { termBarFt: _gone, ...old } = seed;
    const bid = savedFromPlanSwiftSeed(blank("White"), old, factories(8));
    expect(bid.accessoriesCalc!.termBar!.additionalNoDrill).toEqual({});
  });

  it("a row moved to Termination bar by hand that is not a length is listed, never guessed", () => {
    const ea = classifyRows([row("T-Bar", 6, "EA")]);
    const sheet = { ...SHEET, rows: [SHEET.rows[0]!, ea[0]!.row] };
    const s = planSwiftSeed(
      sheet,
      [
        { row: cs[0]!, target: "section" },
        { row: ea[0]!, target: "termbar" },
      ],
      { fileName: "x.xlsx", importedAt: "2026-11-10T20:00:00.000Z" },
    );
    expect(s.termBarFt).toBeUndefined();
    expect(s.unmapped).toEqual([
      {
        label: "6 × T-Bar",
        detail:
          "Termination bar that is not a length in feet — type its feet on Accessories › Term Bar (Additional).",
      },
    ]);
  });
});

describe("termBarAdditionalFt: the sheet's run less the T-Bar parapets", () => {
  it("only parapets terminated in T-Bar (id 2) count, by their termination length", () => {
    const parapets = [
      { lengthFt: 100, termOptionId: 2 },
      { lengthFt: 50, termOptionId: 2, termLengthFt: 40 },
      { lengthFt: 80, termOptionId: 8 },
      { lengthFt: 30 },
    ];
    expect(termBarAdditionalFt(200, parapets)).toBe(60);
    expect(termBarAdditionalFt(200, [])).toBe(200);
  });

  it("never negative, and nothing for no feet", () => {
    expect(termBarAdditionalFt(100, [{ lengthFt: 150, termOptionId: 2 }])).toBe(0);
    expect(termBarAdditionalFt(0, [])).toBe(0);
  });
});

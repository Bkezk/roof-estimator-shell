import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  sectionLayers,
  type BidSectionInput,
  type CurbInput,
  type ParapetInput,
} from "@/lib/engine/bid-builder";
import { defaultEdges } from "@/lib/engine/edges";
import { buildBidInput, emptyCustomer, type SavedBidState } from "@/lib/proposal-bid";
import { classifyRows } from "./classify";
import { readPlanSwiftWorkbook } from "./parse";
import {
  EQUIVALENT_RECT_NOTE,
  matchBoard,
  planSwiftSectionRect,
  planSwiftSeed,
  savedFromPlanSwiftSeed,
  suggestPlanSwiftBidName,
  type PlanSwiftChoice,
} from "./to-seed";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

const BOARDS = [
  '1/2" ISO',
  "1/2\" HD ISO 4'x 4'",
  "1/2\" HD ISO 4'x 8'",
  '2" ISO',
  "2\" ISO 4'x 4'",
  '2.7" ISO',
  "Tapered ISO",
  "Tapered Crickets",
];
// Live-shaped labor combos: which systems / attachments / mils exist.
const LABOR = {
  "Duro-Last|mechanical": { thicknessLaborByMil: { 40: 1, 50: 1.05, 60: 1.1 } },
  "Duro-Tech TPO|mechanical": { thicknessLaborByMil: { 45: 1, 60: 1.05, 80: 1.1 } },
  "EPDM Rubber|adhesive": { thicknessLaborByMil: { 45: 1, 60: 1.05 } },
};

async function load(name: string) {
  const sheet = await readPlanSwiftWorkbook(fixture(name));
  const choices: PlanSwiftChoice[] = classifyRows(sheet.rows).map((c) => ({
    row: c,
    target: c.target,
  }));
  return { sheet, choices };
}

describe("planSwiftSectionRect — the equivalent rectangle", () => {
  it("L, W are the roots of x² − (P/2)x + A = 0: same area and perimeter", () => {
    const r = planSwiftSectionRect(13445.64, 1268.56);
    expect(r.square).toBe(false);
    expect(r.warning).toBeUndefined();
    expect(r.length * r.width).toBeCloseTo(13445.64, 6);
    expect(2 * (r.length + r.width)).toBeCloseTo(1268.56, 6);
    expect(r.length).toBeGreaterThanOrEqual(r.width);
    expect(r.length).toBeCloseTo(612.3215, 3);
    expect(r.width).toBeCloseTo(21.9585, 3);
    // A 100 × 50 rectangle comes back exactly.
    const x = planSwiftSectionRect(5000, 300);
    expect([x.length, x.width]).toEqual([100, 50]);
  });

  it("a perimeter shorter than a square's → a square, with a warning", () => {
    const r = planSwiftSectionRect(10000, 300);
    expect([r.square, r.length, r.width, r.perimeterFt]).toEqual([true, 100, 100, 400]);
    expect(r.warning).toMatch(/shorter than a square's .* check the outline/);
    // Within PlanSwift's rounding of a real square: a square, no warning.
    const s = planSwiftSectionRect(10000, 399.9);
    expect([s.square, s.warning]).toEqual([true, undefined]);
  });

  it("no Linear total → a square and a warning to add the column", () => {
    const r = planSwiftSectionRect(34139.1, null);
    expect(r.square).toBe(true);
    expect(r.length).toBeCloseTo(Math.sqrt(34139.1), 9);
    expect(r.warning).toMatch(/Add the Linear total column/);
    expect(planSwiftSectionRect(100, 0).warning).toMatch(/No Linear total/);
  });
});

describe("test_pS.xlsx → seed", async () => {
  const { sheet, choices } = await load("test_pS.xlsx");
  const seed = planSwiftSeed(sheet, choices, {
    fileName: "test_pS.xlsx",
    boardNames: BOARDS,
    labor: LABOR,
    accountId: "11111111-1111-4111-8111-111111111111",
    importedAt: "2026-09-30T12:00:00.000Z",
  });

  it("one section whose area and perimeter equal the sheet", () => {
    expect(seed.sections).toHaveLength(1);
    const s = seed.sections[0]!;
    expect(s.name).toBe("Roof 1");
    // Two decimals (an eighth of an inch): 612.32 × 21.96 keeps the sheet's area within 0.01 %.
    expect([s.length, s.width]).toEqual([612.32, 21.96]);
    expect(Math.abs(s.length! * s.width! - 13445.64) / 13445.64).toBeLessThan(1e-4);
    expect(2 * (s.length! + s.width!)).toBeCloseTo(1268.56, 1);
    expect(s.edges!.map((e) => [e.side, e.lengthFt])).toEqual([
      ["A", 612.32],
      ["B", 21.96],
      ["C", 612.32],
      ["D", 21.96],
    ]);
    // The summary keeps the sheet's exact area (the rounding is the layout rectangle's alone).
    expect(seed.summary).toContain("13,445.64 sq ft");
    expect(s.edges!.every((e) => !e.isPerimeter)).toBe(true);
    // A typed section (PlanSwift has no outline), so the Sections screen keeps it editable.
    expect(s.measured).toBeUndefined();
    expect(s.notes).toContain(EQUIVALENT_RECT_NOTE);
    expect(s.notes).toContain("1,268.56 ft around (Linear total)");
  });

  it("the system from the name; 50 mil is not a Duro-Tech TPO thickness, so it is flagged, not set", () => {
    expect(seed.roofSystem).toBe("Duro-Tech TPO");
    expect(seed.sectionDefaults.thickness).toBeUndefined();
    expect(seed.warnings).toContain(
      "Roof 1: 50 mil is not a Duro-Tech TPO thickness (45 / 60 / 80) — pick one on the Sections screen.",
    );
  });

  it('layers: 2" ISO, the tapered quote, the 1/2" HD coverboard on top', () => {
    const layers = seed.sections[0]!.layers!;
    expect(layers.map((l) => [l.board, !!l.quote])).toEqual([
      ['2" ISO', false],
      ["Tapered ISO", true],
      ["1/2\" HD ISO 4'x 8'", false],
    ]);
    expect(layers[1]!.quote).toEqual({
      id: "planswift-4",
      name: "tapperd Iso/ Crickets — 5,185.38 sq ft (PlanSwift)",
    });
    // The quote starts blank: its amounts are the estimator's to enter.
    expect(layers[1]!.quote!.lumpSum).toBeUndefined();
  });

  it("three parapets with the sheet's lengths and profile", () => {
    expect(seed.parapets.map((p) => [p.name, p.lengthFt, p.skirtInches, p.verticalInches])).toEqual(
      [
        ["Parapet 01", 604.56, 6, 102],
        ["Parapet 02", 415.49, 6, 36],
        ["Parapet 03", 114.83, 6, 66],
      ],
    );
  });

  it("curbs with footprint and height", () => {
    expect(seed.curbs.map((c) => [c.name, c.quantity, c.widthIn, c.lengthIn, c.dimCIn])).toEqual([
      ["Exhaust fans 26 X 26 X 12", 10, 26, 26, 12],
      ["Roof Hatch 42 X 42 X 12", 1, 42, 42, 12],
    ]);
  });

  it("coping and downspouts as Sheet Metals lines; drains and gutter listed to place", () => {
    expect(seed.nonDlCustom).toEqual({
      sheetMetal: [
        { description: "Coping/2-piece", qty: 1344.01, unitCost: 0, laborPerUnit: 0, laborRate: 0 },
        {
          description: "Down spouts/ splash blocks",
          qty: 7,
          unitCost: 0,
          laborPerUnit: 0,
          laborRate: 0,
        },
      ],
    });
    expect(seed.drains).toEqual([]);
    expect(seed.unmapped).toEqual([
      {
        label: "12 × Drains",
        detail:
          "Drain — add on Accessories › Roof Drains & Boots (no boot and ring were picked — pick them on each drain).",
      },
      { label: "Gutter: 200.96 ft", detail: "Gutter — add on Metals › Gutters." },
    ]);
  });

  it("summary, account, import record", () => {
    expect(seed.summary).toBe(
      'From PlanSwift "test_pS.xlsx": 1 section, 13,445.64 sq ft; 1,134.88 ft of parapet; 11 curbs; 1 tapered quote layer; 2 Non-DL lines; 2 to place by hand.',
    );
    expect(seed.accountId).toBe("11111111-1111-4111-8111-111111111111");
    const info = seed.importInfo;
    expect(info).toMatchObject({
      source: "planswift",
      fileName: "test_pS.xlsx",
      sheetName: "Sheet1",
      importedAt: "2026-09-30T12:00:00.000Z",
      summary: seed.summary,
    });
    expect(info.mapping).toHaveLength(11);
    expect(info.mapping[8]).toEqual({
      sheetRow: 10,
      name: "Exhaust fans 26 X 26 X 12",
      qty: 10,
      units: "EA",
      target: "curb",
      detail: "Curb: curb 26 × 26 × 12 in, ×10",
    });
    // The Linear total makes a 612 × 22 ft rectangle: flagged for a look.
    expect(seed.warnings.some((w) => /612\.32 × 21\.96 ft/.test(w))).toBe(true);
  });

  it("the user's choices win: gutter skipped, drains placed by hand, tapered moved to nothing", () => {
    const moved = choices.map((c) =>
      c.row.row.name === "Gutter"
        ? { ...c, target: "skip" as const }
        : c.row.row.name === "tapperd Iso/ Crickets"
          ? { ...c, target: "unmatched" as const }
          : c,
    );
    const s = planSwiftSeed(sheet, moved, { fileName: "x.xlsx", boardNames: BOARDS });
    expect(s.unmapped.map((u) => u.label)).toEqual([
      "12 × Drains",
      "tapperd Iso/ Crickets: 5,185.38 sq ft",
    ]);
    expect(s.sections[0]!.layers!.some((l) => l.quote)).toBe(false);
    expect(s.importInfo.mapping.find((m) => m.name === "Gutter")!.target).toBe("skip");
    // Without the live labor list the 50 mil is taken as written.
    expect(s.sectionDefaults.thickness).toBe(50);
  });
});

describe("knox.xlsx → seed", async () => {
  const { sheet, choices } = await load("knox.xlsx");
  const seed = planSwiftSeed(sheet, choices, {
    fileName: "knox.xlsx",
    boardNames: BOARDS,
    labor: LABOR,
  });

  it("four sections (roof types 1–3 and the Alt), squares with a warning each", () => {
    expect(seed.sections.map((s) => s.name)).toEqual([
      "Roof Type 1",
      "Roof Type 2",
      "Roof Type 3",
      "Alt 9 Metal/ Underlayment",
    ]);
    for (const [s, area] of [
      [seed.sections[0]!, 34139.1],
      [seed.sections[1]!, 18291.82],
      [seed.sections[2]!, 355.37],
    ] as const) {
      expect(s.length).toBe(Math.round(Math.sqrt(area) * 100) / 100);
      expect(s.width).toBe(s.length);
    }
    expect(seed.warnings.filter((w) => /No Linear total/.test(w))).toHaveLength(4);
  });

  it("the EPDM roof sets the bid's system; its 2.6\" ISO has no board and is flagged", () => {
    expect(seed.roofSystem).toBe("EPDM Rubber");
    expect(seed.attachment).toBe("adhered");
    expect(seed.sectionDefaults.thickness).toBe(60);
    expect(seed.sections[1]!.layers).toBeUndefined();
    expect(seed.sections[1]!.notes).toContain('no "2.6" ISO" board in the list');
    expect(seed.warnings).toContain(
      "Roof Type 1: the name names no membrane — it takes the bid's EPDM Rubber.",
    );
  });

  it("crickets: a Tapered Crickets quote on the largest section", () => {
    expect(seed.sections[0]!.layers!.map((l) => l.board)).toEqual(["Tapered Crickets"]);
  });

  it("curbs, pipe stacks, parapets", () => {
    expect(seed.curbs.map((c) => [c.quantity, c.widthIn, c.lengthIn, c.dimCIn])).toEqual([
      [3, 98, 110, 12],
      [9, 20, 20, 16],
      [1, 32, 32, 16],
      [2, 42, 42, 16],
      [3, 52, 29, 12],
      [3, 30, 72, 16],
      [1, 44, 54, 12],
    ]);
    expect(seed.pipeStacks.map((p) => [p.id, p.size, p.quantity])).toEqual([
      ["planswift-pipe-1", 4, 10],
      ["planswift-pipe-2", 3, 1],
      ["planswift-pipe-3", 2, 2],
    ]);
    expect(seed.parapets.map((p) => [p.name, p.lengthFt, p.verticalInches])).toEqual([
      ["Parapet 01", 678.79, 54],
      ["Parapet 02", 159.99, 18],
      ["Parapet 03", 91.18, 120],
    ]);
  });

  it("sheet metal and panels as Non-DL lines (repeated names numbered); the rest to place", () => {
    expect(seed.nonDlCustom.sheetMetal!.map((l) => [l.description, l.qty])).toEqual([
      ["Coping Cap", 909.21],
      ["Collector Heads", 6],
      ["Down spouts", 148.38],
      ["Metal Roof Rake", 27.28],
      ["Drip edge", 26.05],
      ["Head wall", 26.05],
      ["Base", 159.79],
      ["J- Chanel", 304.18],
      ["Header", 60],
      ["Sill", 60.02],
      ["Jams", 28.08],
      ["Base (2)", 593.06],
      ["Sill (2)", 79.35],
      ["Header (2)", 235.54],
      ["Jams (2)", 442.89],
      ["J-Chanel", 1691.27],
      ["Outside corners", 420.74],
    ]);
    expect(seed.nonDlCustom.customApps!.map((l) => [l.description, l.qty])).toEqual([
      ["Metal Wall Panel", 1598.37],
      ["ACM Panels", 1355.83],
    ]);
    expect(seed.unmapped.map((u) => u.label)).toEqual([
      "6 × Roof Drains",
      "1 × ATR Hub",
      "gutter: 27.22 ft",
      "7 × Cast Iron DS Boots",
      "cap measurment: 3.22 ft",
    ]);
  });
});

describe("the bid made from the seed", async () => {
  // The estimate route's factories (src/routes/estimate.tsx), as the e2e takeoff test copies them.
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
    complexity: 3,
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
  const blank: SavedBidState & { sectionDefaults: NonNullable<SavedBidState["sectionDefaults"]> } =
    {
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
        color: "White",
        sheetSizeLabel: "1500 sf",
        designTable: 60,
      },
      parapetDefaults: { wallType: 4 },
    };
  const { sheet, choices } = await load("test_pS.xlsx");
  const seed = planSwiftSeed(sheet, choices, { fileName: "test_pS.xlsx", boardNames: BOARDS });
  const bid = savedFromPlanSwiftSeed(blank, seed, { newSection, newParapet, newCurb });

  it("sections, parapets, curbs through the route's factories; Non-DL lines at the crew rate", () => {
    const s = bid.sections[0]!;
    expect(Math.abs(s.length * s.width - 13445.64) / 13445.64).toBeLessThan(1e-4);
    expect(s.roofSystem).toBeUndefined();
    expect(bid.roofSystem).toBe("Duro-Tech TPO");
    expect(s.thickness).toBe(50);
    expect(sectionLayers(s)).toHaveLength(3);
    expect(bid.parapets!.map((p) => [p.id, p.lengthFt, p.verticalInches, p.fromTakeoff])).toEqual([
      ["p1", 604.56, 102, true],
      ["p2", 415.49, 36, true],
      ["p3", 114.83, 66, true],
    ]);
    expect(bid.curbs!.map((c) => [c.widthIn, c.lengthIn, c.dimCIn, c.dimDIn, c.curbType])).toEqual([
      [26, 26, 12, 6, "Open"],
      [42, 42, 12, 6, "Open"],
    ]);
    expect(bid.nonDlCalc!.custom!.sheetMetal!.map((l) => [l.description, l.laborRate])).toEqual([
      ["Coping/2-piece", 45],
      ["Down spouts/ splash blocks", 45],
    ]);
    expect(bid.importInfo).toBe(seed.importInfo);
  });

  it("the engine's bid input reads it: roof area and parapet footage match the sheet", () => {
    const input = buildBidInput(bid);
    expect(
      Math.abs(input.sections[0]!.length * input.sections[0]!.width - 13445.64) / 13445.64,
    ).toBeLessThan(1e-4);
    expect(input.parapets.reduce((t, p) => t + p.lengthFt, 0)).toBeCloseTo(1134.88, 6);
    expect(input.curbs.map((c) => c.quantity)).toEqual([10, 1]);
  });
});

describe("helpers", () => {
  it("board spelling: exact, else the 4'x8' entry, else none", () => {
    expect(matchBoard('2" ISO', BOARDS)).toBe('2" ISO');
    expect(matchBoard('1/2" HD ISO', BOARDS)).toBe("1/2\" HD ISO 4'x 8'");
    expect(matchBoard('2.6" ISO', BOARDS)).toBeNull();
    expect(matchBoard('2.6" ISO', undefined)).toBe('2.6" ISO');
  });

  it("the default bid name", () => {
    expect(suggestPlanSwiftBidName("Knox County", "knox.xlsx")).toBe("Knox County · knox");
    expect(suggestPlanSwiftBidName(null, "test_pS.xlsx")).toBe("test_pS");
    expect(suggestPlanSwiftBidName("Acme — Plant 2", "")).toBe("Acme — Plant 2");
  });
});

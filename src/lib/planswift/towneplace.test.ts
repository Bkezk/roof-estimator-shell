/**
 * The owner's "Towneplace Suites - London.xlsx" (Oct 6): "it put downspouts in curbs and
 * misunderstood the piece count … walk pads were not picked up … it also put the drops into curbs
 * and downspouts into the NDL". The fixture is the sheet row for row as the bid's import record
 * kept it. Was: `3" X 4" Drops` ×7 a 3 × 4 in curb (18 "curbs"), `3" x 4" Downspouts` a Non-DL
 * Sheet Metals line, `6" 2-piece` (1,437.55 ft of two-piece edge metal) "place by hand", and
 * `Walkpads` ×10 recognised but never written. Now: drops and downspouts go to the Metals
 * screen's Downspouts by size, the two-piece metal to the Metals list (compression + cover) with
 * the catalog's prices, and the walk pads to Accessories › Walk Pads.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { MetalsCatalogItem } from "@/lib/engine/adapters";
import type { BidSectionInput, CurbInput, ParapetInput } from "@/lib/engine/bid-builder";
import { defaultEdges } from "@/lib/engine/edges";
import { emptyCustomer, type SavedBidState } from "@/lib/proposal-bid";
import { classifyRows, describeTarget, downspoutSize, twoPieceSize } from "./classify";
import { readPlanSwiftWorkbook } from "./parse";
import {
  downspoutRows,
  planSwiftSeed,
  savedFromPlanSwiftSeed,
  twoPieceRows,
  walkPadRowFor,
  type PlanSwiftChoice,
} from "./to-seed";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

/** The live Metals catalog's shape (buildMetalsCatalog, Oct 6), the rows this file needs. */
const item = (category: string, description: string, unitCost: number): MetalsCatalogItem => ({
  key: `metals::${category}::${description}`,
  category,
  description,
  unitCost,
  laborPerUnit: 0.05,
  laborRate: 45,
});
const METALS: MetalsCatalogItem[] = [
  item('Downspouts 3"X4"', '3"X4" Downspout - Open', 4.1),
  item('Downspouts 3"X4"', '3"X4" Downspout - Closed', 4.3),
  item('Downspouts 3"X4"', "Drop/Outlet", 9.5),
  item('Downspouts 3"X4"', "45° A-Style Elbow", 7),
  item('Downspouts 3"X4"', "80° B-Style Elbow", 7.5),
  item('Downspouts 4"X4"', '4"X4" Downspout - Open', 5),
  item("Downspout accessories", "Downspout Straps", 1.2),
  item("Two-Piece Metals", '3" 2-Piece Compression', 2.5),
  item("Two-Piece Metals", '3" 2-Piece Compression — Cover', 3.7),
  item("Two-Piece Metals", '6" 2-Piece Compression', 3.25),
  item("Two-Piece Metals", '6" 2-Piece Compression — Cover', 4.7),
  item("Two-Piece Metals", '6" 2-Piece Compression — Outside Corner', 33.85),
  item("Pitch Pans", "Pitch Pan 4x4", 20),
];
/** The live Accessories › Walk Pads rows (walk_pads_wall_vents, Oct 6). */
const WALK_PADS = [
  '30" x 60" White - Walk Pad',
  '60" x 60" White - Walk Pad',
  '30" x 60" Gray - Walk Pad',
  '60" x 60" Gray - Walk Pad',
  '30" x 60" Safety - Walk Pad',
  '30" x 60" Tan - Walk Pad',
  '30"X 60" Safety Fully Skirted Walk Pad',
  '30"X 60" White Fully Skirted Walk Pad',
  "White Parapet Wall Vent",
];
const BOARDS = ['2" ISO', "1/2\" HD ISO 4'x 4'", "Tapered ISO"];

describe("towneplace.xlsx — the owner's export, row by row", async () => {
  const sheet = await readPlanSwiftWorkbook(fixture("towneplace.xlsx"));
  const cs = classifyRows(sheet.rows);
  const by = (start: string) => cs.find((c) => c.row.name.startsWith(start))!;

  it("15 rows, no warnings from the sheet itself", () => {
    expect(sheet.rows).toHaveLength(15);
    expect(sheet.warnings).toEqual([]);
  });

  it('`3" X 4" Drops` ×7 are downspout drops / outlets (Metals), not a 3 × 4 in curb', () => {
    const r = by('3" X 4" Drops');
    expect([r.target, r.confidence]).toEqual(["downspout", "high"]);
    expect(r.details).toMatchObject({ dsSize: '3"X4"', dsPart: "Drop/Outlet", dsClosed: false });
    expect(r.details.widthIn).toBeUndefined();
    expect(describeTarget(r, r.target)).toBe('drops / outlets 3"X4", ×7 (Metals › Downspouts)');
  });

  it('`3" x 4" Downspouts` 70.01 ft is a downspout length by size (Metals), not a Non-DL line', () => {
    const r = by('3" x 4" Downspouts');
    expect([r.target, r.confidence]).toEqual(["downspout", "high"]);
    expect(r.details).toMatchObject({ dsSize: '3"X4"', dsPart: "length", dsClosed: false });
    expect(describeTarget(r, r.target)).toBe(
      'downspout 3"X4" open, 70.01 ft (Metals › Downspouts)',
    );
  });

  it('`6" 2-piece` 1,437.55 ft is two-piece edge metal, not "place by hand"', () => {
    const r = by('6" 2-piece');
    expect([r.target, r.confidence]).toEqual(["twopiece", "high"]);
    expect(r.details.twoPieceIn).toBe(6);
    expect(describeTarget(r, r.target)).toBe(
      'two-piece edge metal 6", 1,437.55 ft — compression metal and cover (Metals › Two-Piece Metals)',
    );
  });

  it("the real curbs stay curbs; walk pads, stacks, drains, gutter, splash blocks as before", () => {
    expect(by("Exhaust fans").target).toBe("curb");
    expect(by("Roof Hatch").target).toBe("curb");
    expect([by("Walkpads").target, by("Walkpads").details.kind]).toEqual([
      "accessory",
      "Walk pads",
    ]);
    expect(by('3" Stacks').target).toBe("pipe");
    expect(by("Drains").target).toBe("drain");
    expect(by("Gutter").target).toBe("gutter");
    expect(by("Splash Blocks").target).toBe("unmatched");
    expect(by("50 mill").target).toBe("section");
    expect(by("tapperd").target).toBe("tapered");
  });

  describe("→ seed", () => {
    const choices: PlanSwiftChoice[] = cs.map((row) => ({ row, target: row.target }));
    const seed = planSwiftSeed(sheet, choices, {
      fileName: "Towneplace Suites - London.xlsx",
      boardNames: BOARDS,
      metalsCatalog: METALS,
      walkPadRows: WALK_PADS,
      importedAt: "2026-10-06T18:24:32.807Z",
    });

    it("two curb groups (11 curbs), not three (18)", () => {
      expect(seed.curbs.map((c) => [c.name, c.quantity, c.widthIn, c.lengthIn])).toEqual([
        ["Exhaust fans 26 X 26 X 12", 10, 26, 26],
        ["Roof Hatch 42 X 42 X 12", 1, 42, 42],
      ]);
    });

    it('Metals › Downspouts: one 3"X4" entry — 70.01 ft open and 7 drops', () => {
      expect(seed.metalsCalc.downspouts).toEqual([
        {
          size: '3"X4"',
          lengthByDesc: { '3"X4" Downspout - Open': 70.01 },
          accQty: { "Drop/Outlet": 7 },
        },
      ]);
      expect(seed.nonDlCustom).toEqual({});
    });

    it("Metals list: the 6\" compression metal and its cover, each 1,437.55 ft at the catalog's prices", () => {
      expect(seed.metals).toEqual([
        {
          description: 'Two-Piece Metals — 6" 2-Piece Compression',
          price: 3.25,
          laborPerUnit: 0.05,
          laborRate: 45,
          quantity: 1437.55,
        },
        {
          description: 'Two-Piece Metals — 6" 2-Piece Compression — Cover',
          price: 4.7,
          laborPerUnit: 0.05,
          laborRate: 45,
          quantity: 1437.55,
        },
      ]);
    });

    it('Accessories › Walk Pads: 10 of the 30" x 60" White pad, with a warning to check size and colour', () => {
      expect(seed.walkPads).toEqual({ '30" x 60" White - Walk Pad': 10 });
      expect(seed.warnings).toContain(
        'Walkpads: 10 placed as "30" x 60" White - Walk Pad" — change the size or colour on Accessories › Walk Pads if the job uses another.',
      );
      expect(seed.warnings).toContain(
        '3" x 4" Downspouts: read as "3"X4" Downspout - Open" — change it to Closed on Metals › Downspouts if these are closed.',
      );
    });

    it("to place by hand: drains, the gutter and the splash blocks only", () => {
      expect(seed.unmapped.map((u) => u.label)).toEqual([
        "12 × Drains",
        "Gutter: 200.96 ft",
        "7 × Splash Blocks",
      ]);
      expect(seed.summary).toBe(
        'From PlanSwift "Towneplace Suites - London.xlsx": 1 section, 13,938.63 sq ft; 1,134.88 ft of parapet; 11 curbs; 1 tapered quote layer; 10 pipe stacks; 70.01 ft of downspout; 7 downspout drops / elbows; 1,437.55 ft of two-piece metal; 10 walk pads; 3 to place by hand.',
      );
      const m = seed.importInfo.mapping;
      expect(m.find((x) => x.name === '3" X 4" Drops')).toMatchObject({
        target: "downspout",
        detail: 'Downspout (Metals): drops / outlets 3"X4", ×7 (Metals › Downspouts)',
      });
      expect(m.find((x) => x.name === '6" 2-piece')!.target).toBe("twopiece");
    });

    it("without the live catalogs the same rows are listed to place, never a curb or Non-DL", () => {
      const bare = planSwiftSeed(sheet, choices, { fileName: "x.xlsx", boardNames: BOARDS });
      expect(bare.curbs).toHaveLength(2);
      expect(bare.nonDlCustom).toEqual({});
      expect(bare.metalsCalc.downspouts).toEqual([]);
      expect(bare.metals).toEqual([]);
      expect(bare.walkPads).toEqual({});
      expect(bare.unmapped.map((u) => u.label)).toEqual([
        "12 × Drains",
        '6" 2-piece: 1,437.55 ft',
        "10 × Walkpads",
        "Gutter: 200.96 ft",
        '7 × 3" X 4" Drops',
        "7 × Splash Blocks",
        '3" x 4" Downspouts: 70.01 ft',
      ]);
      expect(bare.unmapped.find((u) => u.label.startsWith("7 × 3"))!.detail).toBe(
        'Drop/Outlet 3"X4" — add on Metals › Downspouts (the Metals catalog was not loaded).',
      );
    });

    it("the bid made from the seed carries the downspouts, the two-piece lines and the walk pads", () => {
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
      const blank: SavedBidState & {
        sectionDefaults: NonNullable<SavedBidState["sectionDefaults"]>;
      } = {
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
        // What a bid may already hold: the import adds to it, never replaces it.
        metalsCalc: {
          downspouts: [
            { size: '4"X4"', lengthByDesc: { '4"X4" Downspout - Open': 12 }, accQty: {} },
          ],
        },
        accessoriesCalc: { walkPads: { qty: { '60" x 60" Gray - Walk Pad': 2 }, adjustPct: 0 } },
      };
      const bid = savedFromPlanSwiftSeed(blank, seed, { newSection, newParapet, newCurb });
      expect(bid.metalsCalc!.downspouts!.map((d) => d.size)).toEqual(['4"X4"', '3"X4"']);
      expect(bid.metalsCalc!.downspouts![1]).toEqual(seed.metalsCalc.downspouts[0]);
      expect(bid.metals!.map((m) => [m.description, m.quantity])).toEqual([
        ['Two-Piece Metals — 6" 2-Piece Compression', 1437.55],
        ['Two-Piece Metals — 6" 2-Piece Compression — Cover', 1437.55],
      ]);
      expect(bid.accessoriesCalc!.walkPads!.qty).toEqual({
        '60" x 60" Gray - Walk Pad': 2,
        '30" x 60" White - Walk Pad': 10,
      });
      expect(bid.curbs).toHaveLength(2);
      expect(bid.importInfo).toBe(seed.importInfo);
    });
  });
});

describe("the readers behind it", () => {
  it("downspoutSize: a two-number size up to 8 in; a height or a bigger footprint is a curb's", () => {
    expect(downspoutSize({ widthIn: 3, lengthIn: 4 })).toBe('3"X4"');
    expect(downspoutSize({ widthIn: 4, lengthIn: 5 })).toBe('4"X5"');
    expect(downspoutSize({ widthIn: 3, lengthIn: 4, heightIn: 12 })).toBeUndefined();
    expect(downspoutSize({ widthIn: 26, lengthIn: 26 })).toBeUndefined();
    expect(downspoutSize({})).toBeUndefined();
  });

  it("twoPieceSize: the inches before or after the words", () => {
    expect(twoPieceSize('6" 2-piece')).toBe(6);
    expect(twoPieceSize("4 in two piece edge")).toBe(4);
    expect(twoPieceSize('2-Piece Compression 8"')).toBe(8);
    expect(twoPieceSize("2-piece")).toBeUndefined();
  });

  it("the catalog lookups", () => {
    expect(downspoutRows(METALS, '3"X4"').map((i) => i.description)).toEqual([
      '3"X4" Downspout - Open',
      '3"X4" Downspout - Closed',
      "Drop/Outlet",
      "45° A-Style Elbow",
      "80° B-Style Elbow",
    ]);
    expect(downspoutRows(METALS, '5"X7"')).toEqual([]);
    expect(downspoutRows(undefined, '3"X4"')).toEqual([]);
    expect(twoPieceRows(METALS, 6)!.base.description).toBe('6" 2-Piece Compression');
    expect(twoPieceRows(METALS, 6)!.cover!.description).toBe('6" 2-Piece Compression — Cover');
    expect(twoPieceRows(METALS, 7)).toBeNull();
  });

  it("walkPadRowFor: size and colour from the name, else 30 x 60 in the bid's colour, else White", () => {
    expect(walkPadRowFor("Walkpads", WALK_PADS, undefined)).toBe('30" x 60" White - Walk Pad');
    expect(walkPadRowFor("Walkpads", WALK_PADS, "Gray")).toBe('30" x 60" Gray - Walk Pad');
    expect(walkPadRowFor("60x60 walk pads", WALK_PADS, "Tan")).toBe('60" x 60" White - Walk Pad');
    expect(walkPadRowFor("Safety walkway pads", WALK_PADS, "White")).toBe(
      '30" x 60" Safety - Walk Pad',
    );
    expect(walkPadRowFor("skirted walk pads", WALK_PADS, undefined)).toBe(
      '30"X 60" White Fully Skirted Walk Pad',
    );
    expect(walkPadRowFor("Walkpads", [], undefined)).toBeNull();
    expect(walkPadRowFor("Walkpads", undefined, undefined)).toBeNull();
  });
});

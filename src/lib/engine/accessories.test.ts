/**
 * §12 Accessories money path — anchored against the captured legacy bid (docs §12.0):
 * Material $264.25 / hours 3.775 (footer 3.78) / labor $169.88 at $45; Drip Edge 1 ft → 10 ft →
 * 21 fasteners → 0.275 h (shown 0.28); Wood Items Required 925/925; Vents White 7 → 3.5 h.
 * Ref rows below mirror the LIVE pricing_catalog / accessory_labor shapes.
 */
import { describe, expect, it } from "vitest";

import {
  computeAccessories,
  parapetEdgeFastenersCount,
  emptyAccessoriesState,
  normalizeAccessoriesState,
  roundToNextTen,
  foldColor,
  F32_SCRAP,
  fastenerKey,
  type AccessoriesState,
} from "./accessories";
import { buildAccessoryRefData, type MembraneScreen } from "./adapters";
import type { BidSectionInput } from "./bid-builder";

const screen = (columns: string[], rows: MembraneScreen["rows"]): MembraneScreen => ({
  columns,
  rows,
});

/** Live-shaped catalog rows for the screens this suite exercises. */
const CATALOG = [
  {
    id: "duro_last:drip_edge",
    category: "Drip Edge",
    data: screen(
      ["Description", "Part #", "White Price", "Tan Price", "Gray Price"],
      [
        {
          Description: 'Drip Edge 2"',
          "Part #": "1220",
          "White Price": 8.4,
          "Tan Price": 9.98,
          "Gray Price": 9.98,
        },
        {
          Description: 'Drip Edge 2" Clip',
          "Part #": "1228",
          "White Price": 0,
          "Tan Price": 0,
          "Gray Price": 0,
        },
        {
          Description: 'Drip Edge 2" Corner',
          "Part #": "1558",
          "White Price": 0,
          "Tan Price": 0,
          "Gray Price": 0,
        },
        {
          Description: 'Drip Edge 4"',
          "Part #": "1583",
          "White Price": 10.08,
          "Tan Price": 11.08,
          "Gray Price": 11.08,
        },
      ],
    ),
  },
  {
    id: "duro_last:vents",
    category: "Vents",
    data: screen(
      ["Description", "Part #", "Price"],
      [
        { Description: "Tan Vent", "Part #": "1231", Price: 25.75 },
        { Description: "White Vent", "Part #": "1231", Price: 25.75 },
        { Description: "Gray Vent", "Part #": "1231", Price: 25.75 },
      ],
    ),
  },
  {
    id: "duro_last:termination_bars",
    category: "Termination Bars",
    data: screen(
      ["Description", "Part #", "Price"],
      [
        { Description: "White", "Part #": "1225", Price: 0.75 },
        { Description: "Tan", "Part #": "1225B", Price: 0.9 },
        { Description: "Gray", "Part #": "1225G", Price: 0.9 },
      ],
    ),
  },
  {
    id: "duro_last:membrane_accs",
    category: "Membrane Accs",
    data: screen(
      ["Description", "Part #", "Parts/Package", "Price/Package"],
      [
        { Description: "ARP (SqFt)", "Part #": "1001", "Parts/Package": 1, "Price/Package": 3 },
        { Description: "T-Patch", "Part #": "8067", "Parts/Package": 50, "Price/Package": 10 },
      ],
    ),
  },
  {
    id: "duro_last:sealants",
    category: "Sealants",
    data: screen(
      ["Description", "Part #", "Price"],
      [
        { Description: "Duro-Caulk Plus - White", "Part #": "1136", Price: 10.2 },
        { Description: "Duro-Caulk Plus - Gray", "Part #": "1134", Price: 10.2 },
        { Description: "Strip Mastic (Pail)", "Part #": "1129", Price: 149.15 },
      ],
    ),
  },
  {
    id: "duro_last:panduit",
    category: "Panduit",
    data: screen(
      ["Description", "Part #", "Parts/Bag", "Price/Part"],
      [
        { Description: '3/8" x 14"', "Part #": "1222", "Parts/Bag": 50, "Price/Part": 0.88 },
        { Description: '3/8" x 20"', "Part #": "1222P", "Parts/Bag": 50, "Price/Part": 1.3 },
      ],
    ),
  },
  {
    id: "duro_last:pipe_stacks",
    category: "Pipe Stacks",
    data: screen(
      ["Description", "Size", "Price", "Tan Price", "Gray Price"],
      [
        {
          Description: '1" Closed Only',
          Size: "1",
          Price: 11.7,
          "Tan Price": 12.7,
          "Gray Price": 12.7,
          "Open Part #": "0",
        },
        {
          Description: '4"',
          Size: "4",
          Price: 20,
          "Tan Price": 21,
          "Gray Price": 21,
          "Open Part #": "1320",
        },
      ],
    ),
  },
  {
    id: "duro_last:exceptional_metals",
    category: "Exceptional Metals",
    // Live shape: the two-piece prices ride the metals subscreens, not a rows/columns screen.
    data: {
      subscreens: {
        two_piece_metals: {
          rows: [
            { description: '3" 2-Piece Compression', part_no: "2597", price: 2.5 },
            { description: "Cover", part_no: "2598", price: 3.7 },
            { description: "Outside Corner", part_no: "2298", price: 30.6 },
            { description: "Inside Corner", part_no: "2299", price: 30.6 },
            { description: '6" 2-Piece Compression', part_no: "2602B", price: 3.25 },
            { description: "Cover", part_no: "2602T", price: 4.7 },
            { description: "Outside Corner", part_no: "2303", price: 33.85 },
            { description: "Inside Corner", part_no: "2302", price: 33.85 },
          ],
        },
      },
    } as unknown as MembraneScreen,
  },
  {
    id: "duro_last:fasteners_and_bits",
    category: "Fasteners & Bits",
    data: screen(
      ["Description", "Part #", "Subtype", "Price/Box", "Fasteners/Box"],
      [
        {
          Description: "Metal Anchors",
          "Part #": "1241",
          Subtype: "",
          "Price/Box": 255,
          "Fasteners/Box": 1000,
        },
        {
          Description: '1 1/2"',
          "Part #": "1442",
          Subtype: "Spade",
          "Price/Box": 208,
          "Fasteners/Box": 2000,
        },
        {
          Description: '2" Poly Plates',
          "Part #": "1305P",
          Subtype: "DL-Plates",
          "Price/Box": 290,
          "Fasteners/Box": 1000,
        },
        {
          Description: '3" Insulation Plates',
          "Part #": "1305I",
          Subtype: "DL-Plates",
          "Price/Box": 240,
          "Fasteners/Box": 1000,
        },
      ],
    ),
  },
];

const LABOR = [
  {
    id: "drip_edges",
    category: "Drip Edges",
    data: screen(
      ["Description", "Labor(Hrs)"],
      [
        { Description: 'Drip Edge 2"', "Labor(Hrs)": 0.0275 },
        { Description: 'Drip Edge 2" Corner', "Labor(Hrs)": 0.2 },
        { Description: 'Drip Edge 4"', "Labor(Hrs)": 0.0275 },
      ],
    ),
  },
  {
    id: "vents",
    category: "Vents",
    data: screen(["Description", "Labor(Hrs)"], [{ Description: "Vents", "Labor(Hrs)": 0.5 }]),
  },
  {
    id: "termination_bars",
    category: "Termination Bars",
    data: screen(
      ["Description", "PreDrill Labor(Hrs)", "NoDrill Labor (Hrs)"],
      [{ Description: "Term Bar", "PreDrill Labor(Hrs)": 0.035, "NoDrill Labor (Hrs)": 0.0175 }],
    ),
  },
  {
    id: "two_piece_metals",
    category: "Two Piece Metals",
    data: screen(
      ["Description", "Labor (Hr/Ft)", "Corner Labor(Hr/Piece)"],
      [
        { Description: '3" 2-Piece Compression', "Labor (Hr/Ft)": 0.043, "Corner Labor(Hr/Piece)": 0.2 },
        { Description: '6" 2-Piece Compression', "Labor (Hr/Ft)": 0.043, "Corner Labor(Hr/Piece)": 0.2 },
      ],
    ),
  },
  {
    id: "pipe_stack_usages",
    category: "Pipe Stack Usages",
    data: screen(
      ["Description", "Multiplier"],
      [
        { Description: "Plumbing", Multiplier: 0.5 },
        { Description: "Hot Stack", Multiplier: 1 },
        { Description: "Pitch Pan", Multiplier: 1.5 },
      ],
    ),
  },
];

const ref = buildAccessoryRefData(CATALOG, LABOR);

const section = (over: Partial<BidSectionInput>): BidSectionInput => ({
  id: "s1",
  name: "A",
  length: 55,
  width: 100,
  deckType: "Wood",
  thickness: 40,
  color: "White",
  fieldLap: 64,
  fastenerOc: 15,
  perimLengthFt: 0,
  cornerLengthFt: 0,
  enhancementWidthFt: 0,
  perimFastenerOc: 0,
  cornerFastenerOc: 0,
  underlaymentBoard: "",
  sheetSizeLabel: "",
  tearOff: false,
  tearOffType: "",
  toThicknessInches: 0,
  ...over,
});

/** The §12.0 anchor bid: section A 55×100 White + section B 1×1 with a 2" Drip Edge side. */
function anchorArgs(state: AccessoriesState = emptyAccessoriesState()) {
  const blankEdge = {
    isPerimeter: false,
    termination: "No Termination",
    blockingFt: 0,
    arpSizeIn: 0,
  };
  return {
    state,
    ref,
    sections: [
      section({}),
      section({
        id: "s2",
        name: "B",
        length: 1,
        width: 1,
        edges: [
          { side: "A", lengthFt: 1, ...blankEdge },
          { side: "B", lengthFt: 1, ...blankEdge, termination: '2" Drip Edge' },
          { side: "C", lengthFt: 1, ...blankEdge },
          { side: "D", lengthFt: 1, ...blankEdge },
        ],
      }),
    ],
    parapets: [] as import("./bid-builder").ParapetInput[],
    curbs: [] as import("./bid-builder").CurbInput[],
    roofSystem: "Duro-Last",
    attachment: "mechanical" as const,
    arpCalcSqFt: 0,
    parapetEdgeFasteners: 0,
  };
}

describe("§12.0 anchors (captured legacy bid)", () => {
  it("drip edge: 1 ft of roof edge → 10 ft scrap length, $84.00, 21 fasteners, 0.275 h", () => {
    const r = computeAccessories(anchorArgs());
    expect(r.dripEdge.counts.roofEdgesFt).toBe(1);
    expect(r.dripEdge.sizes["2"].calcByColor.White).toBe(1);
    expect(r.dripEdge.sizes["2"].lengthWithScrapByColor.White).toBe(10);
    expect(r.dripEdge.sizes["2"].adjTotalLengthFt).toBe(10);
    expect(r.dripEdge.cost).toBeCloseTo(84.0, 2);
    expect(r.dripEdge.fastenersNeeded).toBe(21);
    expect(r.dripEdge.billedHours).toBeCloseTo(0.275, 4);
  });

  it("vents derive 1 per 1,000 sq ft of mechanical section by colour: White 7 → $180.25 / 3.5 h", () => {
    const r = computeAccessories(anchorArgs());
    expect(r.vents.calcByColor["White"]).toBe(7); // 6 (5500 sf) + 1 (1 sf)
    expect(r.vents.cost).toBeCloseTo(7 * 25.75, 2);
    expect(r.vents.hours).toBeCloseTo(3.5, 4);
  });

  it("footer: material $264.25, hours 3.775 (bills unrounded; displays 3.78 / $169.88 at $45)", () => {
    const r = computeAccessories(anchorArgs());
    expect(r.totalCost).toBeCloseTo(264.25, 2);
    expect(r.manHours).toBeCloseTo(3.775, 4);
    expect(Math.round(r.manHours * 45 * 100) / 100).toBeCloseTo(169.88, 2);
  });

  it("Wood Items Required: membrane rows 924 + 1 → Fasteners 925 / Poly Plates 925", () => {
    const r = computeAccessories(anchorArgs());
    expect(r.deckNeeds.wood.fasteners).toBe(925);
    expect(r.deckNeeds.wood.polyPlates).toBe(925);
    expect(r.deckNeeds.wood.insulPlates).toBe(0);
    expect(r.deckNeeds.wood.inductionPlates).toBe(0);
  });

  it("entered fasteners net the needs and bill by whole boxes (§12.5 shared box count)", () => {
    const st = emptyAccessoriesState();
    st.fastenerQty = {
      wood: {
        [fastenerKey('1 1/2"', "Spade")]: 900,
        [fastenerKey('2" Poly Plates', "DL-Plates")]: 925,
      },
      dripEdge: { [fastenerKey('1 1/2"', "Spade")]: 21 },
    };
    const r = computeAccessories(anchorArgs(st));
    expect(r.deckNeeds.wood.fasteners).toBe(25); // 925 − 900
    expect(r.deckNeeds.wood.polyPlates).toBe(0);
    expect(r.dripEdge.fastenersNeeded).toBe(0); // 21 − 21
    // 921 spades across both slots → ONE box count: Ceil(921/2000) = 1 box at $208.
    const spade = r.fasteners.rows.find((x) => x.key === fastenerKey('1 1/2"', "Spade"))!;
    expect(spade.totalQty).toBe(921);
    expect(spade.boxes).toBe(1);
    expect(spade.cost).toBeCloseTo(208, 2);
    const poly = r.fasteners.rows.find(
      (x) => x.key === fastenerKey('2" Poly Plates', "DL-Plates"),
    )!;
    expect(poly.boxes).toBe(1);
    expect(r.fasteners.cost).toBeCloseTo(208 + 290, 2);
  });
});

describe("term bar (§12.2)", () => {
  it("prices per ten-rounded scrap foot per colour; fasteners at 21/10 ft; labor split by drill", () => {
    const blankEdge = {
      isPerimeter: false,
      termination: "No Termination",
      blockingFt: 0,
      arpSizeIn: 0,
    };
    const args = anchorArgs();
    args.sections = [
      section({
        color: "Dark Gray", // folds to the GRAY bar
        edges: [
          { side: "A", lengthFt: 40, ...blankEdge, termination: "T-Bar" },
          { side: "B", lengthFt: 100, ...blankEdge },
          { side: "C", lengthFt: 55, ...blankEdge },
          { side: "D", lengthFt: 100, ...blankEdge },
        ],
      }),
    ];
    const r = computeAccessories(args);
    expect(r.termBar.counts.roofEdgesFt).toBe(40);
    expect(r.termBar.noDrillByColor.Gray).toBe(40);
    // R10(f32 1.03 × 40) = R10(41.2) = 50 ft × $0.90/ft.
    expect(r.termBar.adjTotalLengthFt).toBe(50);
    expect(r.termBar.cost).toBeCloseTo(50 * 0.9, 2);
    expect(r.termBar.fastenersNeeded).toBe(Math.ceil((50 / 10) * 21));
    // 50 × 0.0175 = 0.875, group-rounded to 2dp (§12.2 OnRecalculate) → 0.88.
    expect(r.termBar.billedHours).toBeCloseTo(0.88, 4);
  });

  it("curbs with T-Bar options add (2A+2B+12)/12 × qty ft; parapet WallType 4 rides pre-drill", () => {
    const args = anchorArgs();
    args.sections = [section({})];
    args.curbs = [
      {
        id: "c1",
        name: "curb",
        quantity: 2,
        widthIn: 24,
        lengthIn: 36,
        curbType: "Open",
        deckType: "Wood",
        termOption: 3,
      },
    ];
    args.parapets = [
      {
        id: "p1",
        name: "wall",
        lengthFt: 20,
        heightBand: "",
        deckType: "Wood",
        predrill: false,
        canted: false,
        girthInches: 24,
        termOptionId: 2,
        wallType: 4,
        color: "White",
      },
    ];
    const r = computeAccessories(args);
    // Curb: (48 + 72 + 12)/12 × 2 = 22 ft (White, no-drill). Parapet: 20 ft pre-drill.
    expect(r.termBar.counts.curbsFt).toBeCloseTo(22, 4);
    expect(r.termBar.noDrillByColor.White).toBeCloseTo(22, 4);
    expect(r.termBar.preDrillByColor.White).toBe(20);
    // R10(1.03f×22)=30 × 0.0175 + R10(1.03f×20)=30 × 0.035 = 0.525 + 1.05 = 1.575 → 1.58 (2dp).
    expect(roundToNextTen(F32_SCRAP * 22)).toBe(30);
    expect(r.termBar.billedHours).toBeCloseTo(1.58, 4);
  });

  it("base term bar (UseTermBarOnBase) joins Cost but not Fasteners nor billed hours (quirk)", () => {
    const args = anchorArgs();
    args.sections = [section({})];
    args.parapets = [
      {
        id: "p1",
        name: "wall",
        lengthFt: 30,
        heightBand: "",
        deckType: "Wood",
        predrill: false,
        canted: false,
        girthInches: 24,
        useTermBarOnBase: true,
        wallType: 1,
      },
    ];
    const r = computeAccessories(args);
    expect(r.termBar.baseNoDrillFt).toBe(30);
    // Cost: R10(1.03f × 30) = 40 ft on the WHITE bar; fasteners/billed hours exclude the base.
    expect(r.termBar.cost).toBeCloseTo(40 * 0.75, 2);
    expect(r.termBar.fastenersNeeded).toBe(0);
    expect(r.termBar.billedHours).toBe(0);
    expect(r.termBar.linkBaseHours.noDrill).toBeCloseTo(40 * 0.0175, 4);
  });
});

describe("pipe stacks & panduit (§12.3/§12.4)", () => {
  it("labor multiplies open ×1.25 and size >12 ×1.5 / >18 ×2; straps derive from circumference", () => {
    const args = anchorArgs();
    args.sections = [section({})];
    const st = emptyAccessoriesState();
    st.pipeStacks = [
      {
        id: "ps1",
        usage: "Plumbing",
        color: "White",
        open: true,
        size: 4,
        quantity: 2,
        adjustPct: 0,
      },
    ];
    args.state = st;
    const r = computeAccessories(args);
    expect(r.pipeStacks.cost).toBeCloseTo(2 * 20, 2);
    expect(r.pipeStacks.hours).toBeCloseTo(2 * 1.25 * 0.5, 4);
    // c = Ceil((4 + 0.25)π) = 14 in → no 20" strap band, 14" straps = Ceil(14/11) = 2 × qty 2.
    expect(r.pipeStacks.panduit20).toBe(0);
    expect(r.pipeStacks.panduit14).toBe(4);
    // Sealant: 14/12 × 2 = 2.33 ft → Ceil(2.33 × 2 / 10) = 1 White tube.
    expect(r.pipeStacks.sealantTubesByColor["White"]).toBe(1);
    expect(r.sealants.calcByPart["1136"]).toBe(1);
    // Panduit boxes: 4 × 14" straps → Ceil(4/50) = 1 bag = 50 × $0.88.
    expect(r.panduit.boxesByRow['3/8" x 14"']).toBe(1);
    expect(r.panduit.cost).toBeCloseTo(50 * 0.88, 2);
  });
});

describe("state normalization (snapshot drift)", () => {
  it("fills later-added fields on a partial saved state", () => {
    const st = normalizeAccessoriesState({ pipeStacks: [] } as Partial<AccessoriesState>);
    expect(st.fascia["3"].vinylCovers.on).toBe(false);
    expect(st.snapCover["8"].adjustPct).toBe(0);
    expect(st.adhesivesExtra).toEqual({});
    expect(st.sealants.showDiscontinued).toBe(false);
  });

  it("colour fold: Dark Gray/Rock Ply buy gray, Terra Cotta buys tan", () => {
    expect(foldColor("Dark Gray")).toBe("Gray");
    expect(foldColor("Rock Ply")).toBe("Gray");
    expect(foldColor("Terra Cotta")).toBe("Tan");
    expect(foldColor("White")).toBe("White");
  });
});

describe("§12.9 corrections", () => {
  it("Duro-Caulk tubes = ToInt32(Ceil(feet)/12) banker's: 6→0, 13→1, 18→2, 30→2", () => {
    // Drive the footage through fascia vinyl covers (raw feet, no scrap).
    const tubesFor = (ft: number) => {
      const st = emptyAccessoriesState();
      st.fascia["3"].vinylCovers = { on: true, qty: { White: ft } };
      const r = computeAccessories(anchorArgs(st));
      return r.sealants.calcByPart["1136"];
    };
    expect(tubesFor(6)).toBe(0);
    expect(tubesFor(13)).toBe(1);
    expect(tubesFor(18)).toBe(2);
    expect(tubesFor(30)).toBe(2);
    expect(tubesFor(42)).toBe(4);
  });

  it("caulk colour buckets: term-bar footage is the TEN-ROUNDED scrap length per colour", () => {
    const blankEdge = {
      isPerimeter: false,
      termination: "No Termination",
      blockingFt: 0,
      arpSizeIn: 0,
    };
    const args = anchorArgs();
    args.sections = [
      section({
        color: "Terra Cotta", // folds to the TAN bar; caulk lands on the Tan row (1138)
        edges: [
          { side: "A", lengthFt: 40, ...blankEdge, termination: "T-Bar" },
          { side: "B", lengthFt: 100, ...blankEdge },
          { side: "C", lengthFt: 55, ...blankEdge },
          { side: "D", lengthFt: 100, ...blankEdge },
        ],
      }),
    ];
    const r = computeAccessories(args);
    // Bar length R10(1.03f × 40) = 50 → ToInt32(Ceil(50)/12) = ToInt32(4.1667) = 4 tubes (Tan).
    expect(r.sealants.calcByPart["1138"]).toBe(4);
    expect(r.sealants.calcByPart["1136"]).toBe(0);
  });

  it("drains/washers/capstone tubes land on WHITE (RefID 13 → part 1136)", () => {
    const st = emptyAccessoriesState();
    st.drains = [
      {
        id: "d1",
        quantity: 2,
        roofType: "None",
        reuseRings: false,
        bootSize: "",
        ringSize: "",
        adjustPct: 0,
      },
    ];
    const args = anchorArgs(st);
    args.parapets = [
      {
        id: "p1",
        name: "w",
        lengthFt: 45,
        heightBand: "",
        deckType: "Wood",
        predrill: false,
        canted: false,
        girthInches: 24,
        capstoneOption: 2,
      },
    ];
    const r = computeAccessories(args);
    // 2 drains + Ceil(Ceil(45)/40) = 2 capstone tubes → 4 on White (washer tubes ride the
    // same bucket via washersQtyTotal; this suite's mini-catalog has no washer rows).
    expect(r.sealants.calcByPart["1136"]).toBe(4);
    expect(r.sealants.calcByPart["1134"]).toBe(0);
  });

  it("T-Patch counts DURO-TUFF sections only: Round(L×W/250)", () => {
    const dl = computeAccessories(anchorArgs());
    expect(dl.membraneAccs.tPatchCalc).toBe(0); // Duro-Last → 0 (the §12.0 anchor)
    const args = anchorArgs();
    args.roofSystem = "Duro-Tuff";
    const dt = computeAccessories(args);
    expect(dt.membraneAccs.tPatchCalc).toBe(22); // Round(5500/250) + Round(1/250) = 22 + 0
  });

  it("pitch-pocket filler: CLOSED pitch-pan stacks add one; rate by size (→ part 1121)", () => {
    const st = emptyAccessoriesState();
    st.pipeStacks = [
      {
        id: "a",
        usage: "Pitch Pan",
        color: "White",
        open: false,
        size: 4,
        quantity: 2,
        adjustPct: 0,
      },
      {
        id: "b",
        usage: "Pitch Pan",
        color: "White",
        open: true,
        size: 16,
        quantity: 1,
        adjustPct: 0,
      },
      {
        id: "c",
        usage: "Plumbing",
        color: "White",
        open: false,
        size: 4,
        quantity: 3,
        adjustPct: 0,
      },
    ];
    const r = computeAccessories(anchorArgs(st));
    // (2 + 1) × 1  +  (1 + 0) × 4  = 7; the Plumbing stack contributes nothing.
    expect(r.sealants.calcByPart["1121"]).toBe(7);
  });

  it('EdgeFasteners (§12.9 worked values): Duro-Last 40 ft adjusted, 36" vertical', () => {
    const wall = (over: object) => ({
      id: "p1",
      name: "w",
      lengthFt: 38,
      pieces: 1,
      heightBand: "",
      deckType: "Wood",
      predrill: false,
      canted: false,
      girthInches: 60,
      verticalInches: 36,
      ...over,
    });
    // AdjustedLength = 38 + 1 + 1 = 40. Mechanical, no cant → CalcTabCount 1 → 40.
    expect(parapetEdgeFastenersCount([wall({}) as never], "Duro-Last", "mechanical")).toBe(40);
    // With a cant → 2 tabs → 80.
    expect(
      parapetEdgeFastenersCount(
        [wall({ canted: true, cantInches: 4 }) as never],
        "Duro-Last",
        "mechanical",
      ),
    ).toBe(80);
    // Adhered, no cant → TabCount 1 → Round(40 / 1.25 × 1) = 32.
    expect(parapetEdgeFastenersCount([wall({}) as never], "Duro-Last", "adhered")).toBe(32);
    // Vertical ≤ 30 → 0 regardless.
    expect(
      parapetEdgeFastenersCount([wall({ verticalInches: 30 }) as never], "Duro-Last", "mechanical"),
    ).toBe(0);
  });
});

describe("Base & Snap Cover pricing (Exceptional Metals two-piece grid)", () => {
  it('prices bar/cover/corners from the captured admin subscreen; 3" at 42 fasteners/10 ft', () => {
    expect(ref.twoPiece["3"].priced).toBe(true);
    expect(ref.twoPiece["6"].pricePerFt).toBeCloseTo(3.25, 2);
    const blankEdge = { isPerimeter: false, termination: "No Termination", blockingFt: 0, arpSizeIn: 0 };
    const st = emptyAccessoriesState();
    st.snapCover["3"].coversOn = true;
    st.snapCover["3"].insideCorners = 2;
    const args = anchorArgs(st);
    args.sections = [
      section({
        edges: [
          { side: "A", lengthFt: 25, ...blankEdge, termination: '3" 2-pc Metal' },
          { side: "B", lengthFt: 100, ...blankEdge },
          { side: "C", lengthFt: 55, ...blankEdge },
          { side: "D", lengthFt: 100, ...blankEdge },
        ],
      }),
    ];
    const r = computeAccessories(args);
    const s3 = r.snapCover.sizes["3"];
    // 25 ft → R10(1.03f × 25) = 30 ft; covers prefill the total length.
    expect(s3.totalLengthFt).toBe(30);
    expect(s3.coversQty).toBe(30);
    expect(s3.cost).toBeCloseTo(30 * 2.5 + 30 * 3.7 + 2 * 30.6, 2);
    expect(s3.fastenersNeeded).toBe(Math.ceil((30 / 10) * 42));
    // Labor: Round(30 × 0.043 + 2 × 0.2, 4) = 1.69 h.
    expect(s3.hours).toBeCloseTo(1.69, 4);
    expect(r.warnings.length).toBe(0);
  });
});

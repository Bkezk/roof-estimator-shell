/**
 * Takeoff → Bid, end to end, on the REAL code (no browser): draw a realistic takeoff the way the
 * editor does (`buildObject`, "Edge from this area" via `perimeterRunsByRole`, a count session =
 * one object with one point per click), measure it (`takeoffQuantities`), seed a bid
 * (`bidSeedFromTakeoff`), build the bid state exactly as the estimate route's `?takeoff=` handler
 * does, run the estimating engine (`buildBidInput` → `buildEstimateInputs` → `computeEstimate` →
 * `buildReviewLedger`), then change the drawing and re-apply it (`applyTakeoffToBid`).
 *
 * The assertions pin what the code does. The test drive's findings were first pinned here as
 * "ESTIMATOR:" gaps; each is now fixed in the hand-off layer (create-bid.ts, seed-to-bid.ts,
 * model.ts, edge-lines.ts — the estimating engine is untouched) and its assertion flipped to the
 * expected behaviour, marked "FIXED (#n):" with the finding's number.
 */
import { describe, expect, it } from "vitest";

import {
  buildObject,
  perimeterRunsByRole,
  uniqueName,
  type NewObjectRoles,
} from "@/components/takeoff/shapes";
import { buildLaborTables, type EngineAdminData, type LaborCombo } from "@/lib/engine/adapters";
import {
  buildEstimateInputs,
  curbLinealFt,
  sectionLayers,
  type BidSectionInput,
  type CurbInput,
  type ParapetInput,
} from "@/lib/engine/bid-builder";
import { defaultEdges, resolveSectionZones, summarizeEdges } from "@/lib/engine/edges";
import { computeEstimate } from "@/lib/engine/estimate";
import { buildReviewLedger } from "@/lib/engine/review-ledger";
import { buildBidInput, emptyCustomer, type SavedBidState } from "@/lib/proposal-bid";

import { applyTakeoffToBid, bidAccountFromTakeoff, bidSeedFromTakeoff } from "./create-bid";
import { followAreaEdits } from "./edge-lines";
import { syncSideTags } from "./side-tags";
import { newBidFromSeed as seedToBid } from "./seed-to-bid";
import {
  sectionSideRolesText,
  takeoffQuantities,
  type ObjectKind,
  type PagePoint,
  type TakeoffObject,
  type TakeoffPage,
  type TakeoffSetup,
} from "./model";

// ── The route's factories (module-private in src/routes/estimate.tsx:289-365), copied verbatim ──
let seq = 1;
const newSection = (defaults: Partial<BidSectionInput> = {}): BidSectionInput => ({
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
  ...defaults,
});
let pseq = 1;
const newParapet = (defaults: Partial<ParapetInput> = {}): ParapetInput => ({
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
  ...defaults,
});
let cseq = 1;
const newCurb = (defaults: Partial<CurbInput> = {}): CurbInput => ({
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
  ...defaults,
});

// ── The takeoff ──────────────────────────────────────────────────────────────────────────────
/** 100 px = 100 ft: one page unit is one foot. */
const page: TakeoffPage = {
  index: 0,
  name: "A1 Roof plan",
  rotation: 0,
  scale: { ax: 0, ay: 0, bx: 100, by: 0, feet: 100 },
};
const setup: TakeoffSetup = {
  roofSystem: "Duro-Last",
  attachment: "mechanical",
  thickness: 50,
  color: "White",
  sheetSizeLabel: "1500 sf",
  deckType: "Steel",
  designTable: 90,
  pullTest: 425,
  fieldLap: 60,
  edge: { isPerimeter: true, termination: '4" Fascia', blocking: true, arpSizeIn: 0 },
  parapet: {
    roofSystem: "Duro-Last",
    attachment: "adhered",
    membraneAdhesiveName: "Water Based Adhesive",
    heightBand: '0"-30"',
    deckType: "Steel",
  },
  drain: { roofType: "BUR", bootSize: '4" Drain Boot', ringSize: '4" Clamping Ring' },
  notes: "Re-roof over existing BUR.",
};
const ACCOUNT = "11111111-1111-4111-8111-111111111111";

const SECTION1: PagePoint[] = [
  [0, 0],
  [100, 0],
  [100, 60],
  [0, 60],
];
const SECTION1_GROWN: PagePoint[] = [
  [0, 0],
  [120, 0],
  [120, 60],
  [0, 60],
];
const PENTHOUSE: PagePoint[] = [
  [20, 20],
  [30, 20],
  [30, 28],
  [20, 28],
];
const DRAINS: PagePoint[] = [
  [10, 10],
  [90, 10],
  [10, 50],
  [90, 50],
];

/** Draw the scenario the way the editor does; `grow` = Section 1 stretched to 120 ft + a drain. */
function drawTakeoff(opts: { grow?: boolean; regenerateEdges?: boolean } = {}): TakeoffObject[] {
  let objs: TakeoffObject[] = [];
  const add = (kind: ObjectKind, pts: PagePoint[], roles: NewObjectRoles = {}) => {
    const o = buildObject(kind, `o${objs.length + 1}`, 0, pts, objs, setup, page.scale, roles);
    objs = [...objs, o];
    return o;
  };
  // Sections — Section 1's outline is first drawn at 100 ft; "grow" drags its east side later.
  const s1 = add("area", SECTION1);
  const s2 = add("area", [
    [200, 0],
    [240, 0],
    [240, 30],
    [200, 30],
  ]);
  add("area", [
    [300, 0],
    [350, 0],
    [350, 20],
    [320, 20],
    [320, 40],
    [300, 40],
  ]);
  // Cut-out tool on Section 1; pitch typed on Section 2 (Objects tab).
  objs = objs.map((o) =>
    o.id === s1.id && o.kind === "area"
      ? { ...o, attrs: { ...o.attrs, cutouts: [PENTHOUSE] } }
      : o.id === s2.id && o.kind === "area"
        ? { ...o, attrs: { ...o.attrs, pitch: 4 } }
        : o,
  );
  // "Edge from this area" on Section 1: side 0 (north, 100 ft) gutter, sides 1–3 parapet.
  const edgeRuns = (pts: PagePoint[]) =>
    perimeterRunsByRole(pts, ["gutter", "parapet", "parapet", "parapet"]);
  for (const run of edgeRuns(SECTION1))
    add("linear", run.points, { linear: run.role, fromArea: s1.id });
  // The estimator types the parapet wall height on the line (Objects tab).
  objs = objs.map((o) =>
    o.kind === "linear" && o.attrs.role === "parapet"
      ? { ...o, attrs: { ...o.attrs, heightIn: 24 } }
      : o,
  );
  add(
    "linear",
    [
      [50, 0],
      [50, 60],
    ],
    { linear: "expansion_joint" },
  );
  add(
    "linear",
    [
      [10, 30],
      [35, 30],
    ],
    { linear: "walkway" },
  );
  add(
    "linear",
    [
      [200, 40],
      [212, 40],
    ],
    { linear: "other" },
  );
  // Counts: one count session per role (each click adds a point to the same object).
  add("count", opts.grow ? [...DRAINS, [110, 30]] : DRAINS, { count: "drain" });
  add(
    "count",
    [
      [40, 10],
      [60, 10],
      [70, 40],
    ],
    { count: "curb" },
  );
  add(
    "count",
    [
      [5, 5],
      [15, 5],
      [25, 5],
      [35, 5],
      [45, 5],
      [55, 5],
    ],
    { count: "pipe" },
  );
  add(
    "count",
    [
      [65, 5],
      [75, 5],
    ],
    { count: "vent" },
  );
  add(
    "count",
    [
      [100, 20],
      [100, 40],
    ],
    { count: "scupper" },
  );
  add("count", [[80, 55]], { count: "other" });

  if (opts.grow) {
    // Drag Section 1's east corners out to 120 ft. The editor commits the drag through
    // `followAreaEdits` (editor.tsx `commit`): the "Edge from this area" lines follow the sides.
    const before = objs;
    objs = followAreaEdits(
      before,
      objs.map((o) => (o.id === s1.id ? { ...o, points: SECTION1_GROWN } : o)),
      () => 1,
    ).objects;
    if (opts.regenerateEdges) {
      // Delete the old edge lines, then "Edge from this area" again on the grown outline.
      objs = objs.filter(
        (o) => !(o.kind === "linear" && (o.attrs as { fromArea?: string }).fromArea),
      );
      for (const run of edgeRuns(SECTION1_GROWN)) {
        const made = buildObject("linear", `r${run.role}`, 0, run.points, objs, setup, page.scale, {
          linear: run.role,
          fromArea: s1.id,
        });
        objs = [
          ...objs,
          made.kind === "linear" && run.role === "parapet"
            ? { ...made, attrs: { ...made.attrs, heightIn: 24 } }
            : made,
        ];
      }
    }
  }
  return objs;
}

/** A brand-new bid's state before the seed lands (the route's `saved` for an empty new bid). */
const blankSaved = (): SavedBidState => ({
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
});

/**
 * The NEW-bid branch of the `?takeoff=` handler: `newBidFromSeed` (seed-to-bid.ts, which the
 * route calls) with the route's factories, then hydrateSaved (estimate.tsx) normalizing layers.
 */
function newBidFromSeed(saved: SavedBidState, seed: ReturnType<typeof bidSeedFromTakeoff>) {
  const merged = seedToBid({ ...saved, sectionDefaults: saved.sectionDefaults! }, seed, {
    newSection,
    newParapet,
    newCurb,
  });
  return { ...merged, sections: merged.sections.map((s) => ({ ...s, layers: sectionLayers(s) })) };
}

// Live-shaped admin data, as src/lib/engine/review-ledger.test.ts builds it, with the Steel deck
// and 50 mil rows this bid uses.
const deckOrder = ["Wood", "Steel", "Concrete"];
const combo: LaborCombo = {
  roof_system: "Duro-Last",
  attachment: "mechanical",
  base: { tab_value: 60, tab_multiplier: 1 },
  deck_multipliers: { Wood: 1, Steel: 1.1, Concrete: 2 },
  fastener_spacing_multipliers: [
    { spacing_in: 18, multiplier: 1 },
    { spacing_in: 12, multiplier: 1.1 },
  ],
  sheet_size_multipliers: [{ label: "1500 sf", roof_section: 1, underlayment: 1 }],
  thickness_multipliers: [
    { mil: 40, multiplier: 1 },
    { mil: 50, multiplier: 1.05 },
  ],
};
const admin: EngineAdminData = {
  deckOrder,
  priceMatrix: {
    40: { rollGoods: { White: 1.23 }, parapet: { White: 1.4 } },
    50: { rollGoods: { White: 1.45 }, parapet: { White: 1.6 } },
  },
  labor: { "Duro-Last|mechanical": buildLaborTables(combo, deckOrder) },
  settings: {
    hoursPerDay: 9,
    masterEliteCont: true,
    salesTax: 0.0625,
    taxMaterialOnly: true,
    shippingMode: "stepped",
    shippingPercent: 0,
  },
  parapetLabor: {
    bands: ['0"-30"', '31"-60"'],
    lookup: {
      "Structural Metal": {
        '0"-30"': {
          noDrillNoCant: 2.25,
          noDrillCanted: 3.375,
          predrillNoCant: 3.5,
          predrillCanted: 5.25,
        },
        '31"-60"': {
          noDrillNoCant: 3,
          noDrillCanted: 4.5,
          predrillNoCant: 4.5,
          predrillCanted: 6.75,
        },
      },
    },
  },
  autoRates: {
    counterflash: { price: 4, laborPerUnit: 0.0167, laborRate: 45 },
    parapetBlocking: { price: 0.57, laborPerUnit: 0.04, laborRate: 40 },
    masonryRemove: { price: 0, laborPerUnit: 0.1, laborRate: 45 },
    masonryReplace: { price: 5, laborPerUnit: 0, laborRate: 45 },
    arpPricePerSqFt: 3,
  },
  membraneAdhesives: {
    1: {
      "Water Based Adhesive": {
        byDeckName: { Wood: 700, Steel: 700 },
        underlaymentUniform: 700,
        wallCoverage: 350,
      },
    },
  },
  adhesivePrices: { "Water Based Adhesive": 120 },
  curbLabor: {
    setupMinutes: 8,
    minutesByDeck: { "Structural Metal": 7.5, Wood: 7.5 },
    multiplierByType: { Open: 1, Closed: 1 },
    curbTypes: ["Open", "Closed"],
  },
};

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

// ══════════════════════════════════════════════════════════════════════════════════════════════
const objects = drawTakeoff();
const q = takeoffQuantities([page], objects);
const seed = bidSeedFromTakeoff(setup, q, {
  takeoffName: "Maple St. warehouse",
  accountId: ACCOUNT,
});

describe("1. Quantities", () => {
  const byName = (n: string) => q.sections.find((s) => s.name === n)!;

  it("sections: plan vs sloped area, cut-out, perimeter", () => {
    expect(q.sections.map((s) => s.name)).toEqual(["Section 1", "Section 2", "Section 3"]);
    // Section 1: 100 × 60 less the 10 × 8 penthouse, flat.
    expect(byName("Section 1").planAreaSqFt).toBe(5920);
    expect(byName("Section 1").areaSqFt).toBe(5920);
    expect(byName("Section 1").perimeterFt).toBe(320);
    expect(byName("Section 1").edgeLengthsFt).toEqual([100, 60, 100, 60]);
    // Section 2: 40 × 30 at 4:12 → 1200 × 1.0541.
    const s2 = byName("Section 2");
    expect(s2.planAreaSqFt).toBe(1200);
    expect(s2.slopeFactor).toBeCloseTo(1.0541, 4);
    expect(s2.areaSqFt).toBeCloseTo(1264.91, 2);
    expect(s2.perimeterFt).toBe(140); // plan perimeter
    // FIXED (#5): the rakes (the two shorter sides of the rectangle, assumed — the takeoff has
    // no eave direction) run up the 4:12 slope: 30 × 1.0541 = 31.62 ft each.
    expect(s2.slopedEdgeLengthsFt.map((l) => Math.round(l * 100) / 100)).toEqual([
      40, 31.62, 40, 31.62,
    ]);
    expect(s2.slopedPerimeterFt).toBeCloseTo(143.25, 2);
    expect(s2.rakeNote).toBe("rakes assumed: the two shorter sides (B, D) run up the slope");
    // Section 3: L-shape, 6 sides.
    const s3 = byName("Section 3");
    expect(s3.areaSqFt).toBe(1400);
    expect(s3.perimeterFt).toBe(180);
    expect(s3.edgeLengthsFt).toEqual([50, 20, 30, 20, 20, 40]);
    expect(q.totals.roofAreaSqFt).toBeCloseTo(8584.91, 2);
    expect(q.totals.planAreaSqFt).toBe(8520);
    expect(q.totals.perimeterFt).toBe(640);
    expect(q.totals.slopedPerimeterFt).toBeCloseTo(643.25, 2);
  });

  it("linears per role (Edge from this area = one gutter run + one 3-side parapet run)", () => {
    const perRole = Object.fromEntries(
      ["parapet", "gutter", "expansion_joint", "walkway", "other"].map((r) => [
        r,
        sum(q.linears.filter((l) => l.role === r).map((l) => l.lengthFt)),
      ]),
    );
    expect(perRole).toEqual({
      parapet: 220,
      gutter: 100,
      expansion_joint: 60,
      walkway: 25,
      other: 12,
    });
    expect(q.linears.map((l) => l.name)).toEqual([
      "Gutter 1",
      "Parapet 1",
      "Expansion joint 1",
      "Walkway 1",
      "Line 1",
    ]);
    expect(q.totals.parapetFt).toBe(220);
    // FIXED (#12): the penthouse cut-out's 36 ft of wall is reported with its section (and not
    // invented as a parapet or linear).
    expect(q.linears.some((l) => l.lengthFt === 36)).toBe(false);
    expect(q.sections[0]!.cutoutPerimetersFt).toEqual([36]);
    expect(q.totals.cutoutWallFt).toBe(36);
  });

  it("counts per role (one count session = one row)", () => {
    expect(q.counts.map((c) => [c.role, c.name, c.qty])).toEqual([
      ["drain", "Drain 1", 4],
      ["curb", "Curb 1", 3],
      ["pipe", "Pipe 1", 6],
      ["vent", "Vent 1", 2],
      ["scupper", "Scupper 1", 2],
      ["other", "Item 1", 1],
    ]);
    // Drain picks came from the setup's drain defaults.
    expect(q.counts[0]).toMatchObject({
      roofType: "BUR",
      bootSize: '4" Drain Boot',
      ringSize: '4" Clamping Ring',
    });
  });
});

describe("2. Seed → bid", () => {
  const bid = newBidFromSeed(blankSaved(), seed);
  const sec = (n: string) => bid.sections.find((s) => s.name === n)!;

  it("three bid sections with the measured layout rectangle and drawn edges", () => {
    expect(bid.sections.map((s) => s.name)).toEqual(["Section 1", "Section 2", "Section 3"]);
    // Section 1: the cut-out shrinks the layout rectangle, not a side: 101.91 × 58.09 = 5920.
    // FIXED (#13): the bid section has no deduction field (BidSectionInput), so length × width
    // must carry the net area; the true sides stay and the note says the layout is the net-area
    // equivalent of the 100 × 60 outline.
    expect(sec("Section 1").notes).toBe(
      "Measured in Takeoff: 5920 sq ft (6000 sq ft outline less 80 sq ft of cut-outs; layout 101.9 × 58.1 ft is the net-area equivalent, the sides stay as drawn), 320 ft around, 4 sides; penthouse walls 36 ft (not seeded); parapet wall sides B, C, D; gutter side A.",
    );
    // Two decimals (an eighth of an inch); the rectangle keeps the net area within 0.01 %.
    expect(sec("Section 1").length).toBe(101.91);
    expect(sec("Section 1").width).toBe(58.09);
    expect(Math.abs(sec("Section 1").length * sec("Section 1").width - 5920) / 5920).toBeLessThan(
      1e-4,
    );
    expect(sec("Section 1").edges!.map((e) => [e.side, e.lengthFt])).toEqual([
      ["A", 100],
      ["B", 60],
      ["C", 100],
      ["D", 60],
    ]);
    // Section 2: the slope stretches the width: 40 × 31.62 = 1264.9 (plan 1200).
    expect(sec("Section 2").length).toBe(40);
    expect(sec("Section 2").width).toBe(31.62);
    expect(sec("Section 2").notes).toBe(
      "Measured in Takeoff: 1264.9 sq ft (1200 sq ft on plan at 4:12, ×1.054), 143.2 ft around (140 ft on plan; rakes assumed: the two shorter sides (B, D) run up the slope), 4 sides.",
    );
    // FIXED (#5): the rake edges run up the slope (31.62 ft) — their length, perimeter run and
    // blocking are sloped; the eaves (A, C) keep the plan length.
    expect(sec("Section 2").edges!.map((e) => e.lengthFt)).toEqual([40, 31.62, 40, 31.62]);
    expect(sec("Section 2").edges![1]!.blockingFt).toBe(31.62);
    expect(sec("Section 2").edges![1]!.perimLengthFt).toBe(31.62);
    // Section 3: the L keeps its six drawn sides; the re-entrant corner is not enhanced.
    expect([sec("Section 3").length, sec("Section 3").width]).toEqual([70, 20]);
    expect(sec("Section 3").edges!.map((e) => e.side)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(sec("Section 3").perimCorners).toEqual([true, true, false, true, true, true]);
    // Setup section answers reached every section.
    for (const s of bid.sections)
      expect(s).toMatchObject({
        deckType: "Steel",
        thickness: 50,
        color: "White",
        fieldLap: 60,
        pullTest: 425,
        designTable: 90,
      });
  });

  it("linear roles reach the section edges: parapet sides and the gutter side", () => {
    // FIXED (#1): Section 1's sides B, C, D run along the parapet line → no roof-edge
    // termination and no blocking (the wall is flashed on the Parapets screen; the perimeter
    // flag stays — the wind zone runs along a walled edge too); side A runs along the gutter
    // line → the drip edge a gutter hangs from. Matched geometrically, side by side.
    const s1 = sec("Section 1");
    expect(s1.edges!.map((e) => [e.side, e.termination, e.isPerimeter, e.blockingFt])).toEqual([
      ["A", '4" Drip Edge', true, 100],
      ["B", "No Termination", true, 0],
      ["C", "No Termination", true, 0],
      ["D", "No Termination", true, 0],
    ]);
    // So the bid no longer orders fascia or blocking along the 220 ft of parapet wall.
    const edgeSum = summarizeEdges(bid.sections.map((s) => s.edges ?? []));
    expect(
      edgeSum.terminations.map((t) => [t.termination, Math.round(t.totalFt * 100) / 100]),
    ).toEqual([
      ['4" Drip Edge', 100],
      ['4" Fascia', 323.24],
    ]);
    expect(edgeSum.blockingFt).toBeCloseTo(423.24, 2);
    // Expansion joint / walkway / other lines leave the edges alone (Sections 2 and 3 keep the
    // setup's fascia everywhere).
    for (const n of ["Section 2", "Section 3"])
      expect(sec(n).edges!.every((e) => e.termination === '4" Fascia')).toBe(true);
  });

  it("the parapet run becomes one parapet, from the linear (not from the section)", () => {
    expect(bid.parapets).toHaveLength(1);
    const p = bid.parapets![0]!;
    expect(p).toMatchObject({
      name: "Parapet 1",
      lengthFt: 220,
      verticalInches: 24,
      heightBand: '0"-30"',
      deckType: "Steel",
      fromTakeoff: true,
    });
    // The bid-level parapet defaults took the setup's parapet material …
    expect(bid.parapetDefaults).toEqual({
      wallType: 4,
      roofSystem: "Duro-Last",
      attachment: "adhered",
      membraneAdhesiveName: "Water Based Adhesive",
    });
    // FIXED (#3): … and the seeded wall takes them too, exactly as "Add parapet" on the Parapets
    // screen does (`parapetFromDefaults`): it prices as the Setup's ADHERED parapet system.
    expect(p.attachment).toBe("adhered");
    expect(p.roofSystem).toBe("Duro-Last");
    expect(p.membraneAdhesiveName).toBe("Water Based Adhesive");
    expect(p.wallType).toBe(4);
  });

  it("curbs: one curb row of 3 with a BLANK size, and the notice says so", () => {
    // FIXED (#4): a curb counted without a size is carried with a blank size (the Curbs screen
    // marks 0 as missing), never the 1" × 1" factory default, and the notice lists it.
    expect(
      bid.curbs!.map((c) => [c.name, c.quantity, c.widthIn, c.lengthIn, c.deckType, c.curbType]),
    ).toEqual([["Curb 1", 3, 0, 0, "Steel", "Open"]]);
    expect(curbLinealFt(bid.curbs![0]!)).toBe(0);
    expect(seed.unmapped).toContainEqual({
      label: "3 curbs, size not measured",
      detail:
        '"Curb 1" — on the Curbs screen with a blank size (it prices as almost nothing until one is entered); enter its width × length there.',
    });
  });

  it("drains → one Roof Drains row; pipes without a size, vents, scuppers, other → the notice", () => {
    expect(bid.accessoriesCalc!.drains).toEqual([
      {
        id: "takeoff-drain-1",
        quantity: 4,
        roofType: "BUR",
        reuseRings: false,
        bootSize: '4" Drain Boot',
        ringSize: '4" Clamping Ring',
        adjustPct: 0,
        takeoffObjectId: "o9",
        takeoffObjectIds: ["o9"],
      },
    ]);
    // FIXED (#6): these pipes were counted without a size, so they go to the notice as "size
    // not measured" (a sized pipe count seeds Pipe Stacks — see the next check).
    expect(bid.accessoriesCalc!.pipeStacks).toEqual([]);
    expect(seed.unmapped).toEqual([
      {
        label: "3 curbs, size not measured",
        detail:
          '"Curb 1" — on the Curbs screen with a blank size (it prices as almost nothing until one is entered); enter its width × length there.',
      },
      {
        label: "6 pipes, size not measured",
        detail:
          '"Pipe 1" — add on Accessories › Pipe Stacks with its size (or give the pipe count a size in the takeoff).',
      },
      { label: "2 × Vent 1", detail: "Vent — add on Accessories › Vents." },
      { label: "2 × Scupper 1", detail: "Scupper — add on Metals or Non-DL, as quoted." },
      { label: "1 × Item 1", detail: "Other — add on wherever it belongs." },
      { label: "Gutter 1: 100 ft", detail: "Gutter — add on Metals › Gutters." },
      {
        label: "Expansion joint 1: 60 ft",
        detail: "Expansion joint — add as a Non-DL or custom line.",
      },
      { label: "Walkway 1: 25 ft", detail: "Walkway pad — add on Accessories › Walk Pads." },
      { label: "Line 1: 12 ft", detail: "Other — add as a Non-DL or custom line." },
      // FIXED (#12): the penthouse walls are offered, not seeded.
      {
        label: "Section 1: 36 ft of penthouse wall (not seeded)",
        detail:
          "Cut-out walls (penthouse / well) — flash them as a parapet on the Parapets screen, or a curb, as quoted.",
      },
    ]);
  });

  it("a pipe count with a size (the Pipe role's quick pick) seeds Accessories › Pipe Stacks", () => {
    // FIXED (#6): the count tool's Pipe role takes a size (Objects tab, quick picks 2/3/4/6").
    const sized = objects.map((o) =>
      o.kind === "count" && o.attrs.role === "pipe"
        ? { ...o, attrs: { ...o.attrs, sizeIn: 4 } }
        : o,
    );
    const s = bidSeedFromTakeoff(setup, takeoffQuantities([page], sized));
    const b = newBidFromSeed(blankSaved(), s);
    expect(b.accessoriesCalc!.pipeStacks!.map((p) => [p.id, p.size, p.quantity, p.usage])).toEqual([
      ["takeoff-pipe-1", 4, 6, "Plumbing"],
    ]);
    expect(s.unmapped.some((u) => u.label.includes("pipe"))).toBe(false);
  });

  it("the summary, the customer link, the setup notes", () => {
    // FIXED (#13): the summary counts by role ("4 drains"), not by default object name; the roof
    // edge is the built one (rakes sloped).
    expect(seed.summary).toBe(
      'From takeoff "Maple St. warehouse": 3 sections, 8584.9 sq ft, 643.2 ft of roof edge; 220 ft of parapet; 4 drains, 3 curbs, 6 pipes, 2 vents, 2 scuppers, 1 other item.',
    );
    expect(seed.accountId).toBe(ACCOUNT);
    expect(bidAccountFromTakeoff(null, ACCOUNT)).toBe(ACCOUNT);
    // FIXED (#10): the setup's free-text notes reach the bid's notes.
    expect(seed.setupNotes).toBe("Re-roof over existing BUR.");
    expect(bid.customer.notes).toBe("Takeoff notes: Re-roof over existing BUR.");
  });
});

describe("3. Engine on the seeded bid", () => {
  const saved = newBidFromSeed(blankSaved(), seed);
  const bidInput = buildBidInput(saved);
  const build = buildEstimateInputs(bidInput, admin);
  const est = computeEstimate(build.inputs);
  const ledger = buildReviewLedger({
    bid: bidInput,
    result: build,
    est,
    crewRate: bidInput.crewLaborRatePerHour,
  });

  it("computes without error; warnings are only about data this fixture does not carry", () => {
    expect(est.money.grandTotal).toBeGreaterThan(0);
    expect(build.warnings).toEqual([]);
  });

  it("roof area, perimeter and parapet footage match the takeoff", () => {
    // Within the two-decimal rounding of each section's layout rectangle.
    expect(
      Math.abs(est.roofSqFootage - q.totals.roofAreaSqFt) / q.totals.roofAreaSqFt,
    ).toBeLessThan(1e-4);
    // The bid's edges are the built roof edge (Section 2's rakes sloped, #5).
    expect(
      sum(bidInput.sections.flatMap((s) => (s.edges ?? []).map((e) => e.lengthFt))),
    ).toBeCloseTo(q.totals.slopedPerimeterFt, 1);
    // Perimeter-enhancement zone length = sides less one 3 ft enhancement width per marked corner
    // on each side: 643.25 − 2 × 3 × (4 + 4 + 5) = 565.25.
    expect(sum(bidInput.sections.map((s) => resolveSectionZones(s).perimLengthFt))).toBeCloseTo(
      565.25,
      1,
    );
    expect(sum(bidInput.parapets.map((p) => p.lengthFt))).toBe(q.totals.parapetFt);
  });

  it("the Review ledger carries every takeoff item it was given", () => {
    const row = (label: string) => ledger.purchases.duroLast.find((r) => r.label === label)!.cost;
    expect(row("Roof Sections")).toBeGreaterThan(0);
    expect(row("Parapets")).toBeGreaterThan(0);
    expect(row("Curbs")).toBeGreaterThanOrEqual(0);
    expect(est.curbLaborHours).toBeGreaterThan(0);
    expect(row("Roof Sections")).toBeCloseTo(13171.66, 0);
    expect(row("Parapets")).toBe(888);
    // Drains sit in accessoriesCalc; they are priced only when the admin data carries the §12
    // accessories reference lists, which this fixture does not. The $240 is the wall adhesive
    // of the ADHERED parapet (#3: the seeded wall takes the Setup's parapet material).
    expect(row("Accessories")).toBe(240);
    // Was $25,827.95 before the fixes: the seeded wall now prices as the Setup's adhered system
    // (+$369.24, #3); the blank curb size (#4) and the edge changes (#1, #5) make up the rest.
    // Within $1: the two-decimal layout rectangles move the roof area by under 0.01 %.
    expect(est.money.grandTotal).toBeCloseTo(26188.86, 0);
  });

  it("unsized curbs are flagged; a size measured in the takeoff prices the real curb", () => {
    // FIXED (#4): 3 unsized curbs carry a blank size (setup time only, 0.4 h) AND are on the
    // notice ("3 curbs, size not measured"); the count tool's Curb role now takes W × L × H,
    // and a measured 48 × 96 × 18 in RTU curb reaches the bid: 9.4 h, wrap height 18 in.
    expect(est.curbLaborHours).toBeCloseTo(0.4, 6);
    expect(seed.unmapped.map((u) => u.label)).toContain("3 curbs, size not measured");
    const measured = objects.map((o) =>
      o.kind === "count" && o.attrs.role === "curb"
        ? { ...o, attrs: { ...o.attrs, widthIn: 48, lengthIn: 96, heightIn: 18 } }
        : o,
    );
    const s = bidSeedFromTakeoff(setup, takeoffQuantities([page], measured));
    const b = buildBidInput(newBidFromSeed(blankSaved(), s));
    expect(b.curbs.map((c) => [c.widthIn, c.lengthIn, c.dimCIn])).toEqual([[48, 96, 18]]);
    expect(computeEstimate(buildEstimateInputs(b, admin).inputs).curbLaborHours).toBeCloseTo(
      9.4,
      6,
    );
    expect(s.unmapped.map((u) => u.label)).not.toContain("3 curbs, size not measured");
    expect(build.warnings).toEqual([]);
  });

  it("a seeded wall and the same wall added by hand price the same", () => {
    // The hand-added wall as the Parapets screen's "Add parapet" builds it (estimate.tsx:4379).
    const { fromTakeoff: _seeded, ...wall } = saved.parapets![0]!;
    const hand = newParapet({
      ...wall,
      id: "hand",
      deckType: saved.sectionDefaults!.deckType,
      wallType: saved.parapetDefaults!.wallType ?? 4,
      roofSystem: saved.parapetDefaults!.roofSystem!,
      attachment: saved.parapetDefaults!.attachment!,
      membraneAdhesiveName: saved.parapetDefaults!.membraneAdhesiveName!,
    });
    const run = (p: ParapetInput) => {
      const b = buildEstimateInputs({ ...bidInput, parapets: [p] }, admin);
      const e = computeEstimate(b.inputs);
      return {
        attachment: p.attachment ?? bidInput.attachment,
        hours: b.breakdown.parapetHoursById[p.id],
        parapetMaterial: b.parapetMaterial,
        adhesiveMaterial: b.adhesiveMaterial,
        grandTotal: e.money.grandTotal,
        warnings: b.warnings,
      };
    };
    const seeded = run(saved.parapets![0]!);
    const byHand = run(hand);
    // FIXED (#3): same 220 ft wall, same system — the seeded wall is billed as the Setup's
    // ADHERED parapet system like the hand-added one: same adhesive, same total ($0 gap, was
    // $369.24).
    expect([seeded.attachment, byHand.attachment]).toEqual(["adhered", "adhered"]);
    expect(seeded.hours).toBeCloseTo(byHand.hours!, 6);
    expect([seeded.adhesiveMaterial, byHand.adhesiveMaterial]).toEqual([240, 240]);
    expect(byHand.grandTotal - seeded.grandTotal).toBeCloseTo(0, 6);
  });
});

describe("4. Update flow (Section 1 → 120 ft, one more drain)", () => {
  /** The saved bid as the estimator left it after seeding and editing. */
  const first = newBidFromSeed(blankSaved(), seed);
  const edited: SavedBidState = {
    ...first,
    markup: 28,
    sections: first.sections.map((s) =>
      s.name === "Section 1"
        ? {
            ...s,
            deckType: "Concrete",
            fastenerOc: 12,
            notes: "Penthouse walls need counterflashing.",
            // The estimator changed edge details on the Sections screen: a 2" drip edge on the
            // gutter side A, 12" ARP along the parapet side B.
            edges: s.edges!.map((e) =>
              e.side === "A"
                ? { ...e, termination: '2" Drip Edge' }
                : e.side === "B"
                  ? { ...e, arpSizeIn: 12 }
                  : e,
            ),
          }
        : s,
    ),
    parapets: [
      { ...first.parapets![0]!, termOptionId: 2, attachment: "adhered" },
      newParapet({ name: "Hand wall", lengthFt: 12 }),
    ],
    curbs: [{ ...first.curbs![0]!, widthIn: 48, lengthIn: 96, curbType: "Closed" }],
    accessoriesCalc: {
      ...first.accessoriesCalc,
      drains: [
        { ...first.accessoriesCalc!.drains![0]!, adjustPct: 15, reuseRings: true },
        {
          id: "manual-drain",
          quantity: 1,
          roofType: "BUR",
          reuseRings: false,
          bootSize: '3" Boot',
          ringSize: '3" Ring',
          adjustPct: 0,
        },
      ],
    },
  };
  const apply = (objs: TakeoffObject[], bid: SavedBidState = edited) => {
    const s2 = bidSeedFromTakeoff(setup, takeoffQuantities([page], objs), { accountId: ACCOUNT });
    // estimate.tsx — the update branch of the `?takeoff=` handler.
    return applyTakeoffToBid(
      {
        sections: bid.sections,
        parapets: bid.parapets,
        curbs: bid.curbs,
        pipeStacks: bid.accessoriesCalc!.pipeStacks,
        drains: bid.accessoriesCalc!.drains,
        notes: bid.customer.notes,
        parapetDefaults: bid.parapetDefaults,
        sectionDefaults: bid.sectionDefaults,
      },
      s2,
      { newSection, newParapet, newCurb },
    );
  };

  it("re-measures Section 1 and keeps the estimator's material edits", () => {
    const r = apply(drawTakeoff({ grow: true }));
    const s1 = r.sections.find((s) => s.name === "Section 1")!;
    expect(s1.measured!.areaSqFt).toBe(7120); // 120 × 60 − 80
    expect(Math.abs(s1.length * s1.width - 7120) / 7120).toBeLessThan(1e-4);
    expect(s1.deckType).toBe("Concrete");
    expect(s1.fastenerOc).toBe(12);
    // FIXED (#2): the estimator's edge details are kept (the 2" drip edge on A, the ARP on B),
    // on the re-measured lengths; the parapet sides stay parapet sides …
    expect(
      s1.edges!.map((e) => [e.side, e.lengthFt, e.termination, e.arpSizeIn, e.blockingFt]),
    ).toEqual([
      ["A", 120, '2" Drip Edge', 0, 120],
      ["B", 60, "No Termination", 12, 0],
      ["C", 120, "No Termination", 0, 0],
      ["D", 60, "No Termination", 0, 0],
    ]);
    // … and the section note keeps the estimator's text; only the measurement line is updated.
    expect(s1.notes).toBe(
      "Penthouse walls need counterflashing.\nMeasured in Takeoff: 7120 sq ft (7200 sq ft outline less 80 sq ft of cut-outs; layout 121.3 × 58.7 ft is the net-area equivalent, the sides stay as drawn), 360 ft around, 4 sides; penthouse walls 36 ft (not seeded); parapet wall sides B, C, D; gutter side A.",
    );
    // Curbs keep the hand-set size and style (the takeoff has none), take the count.
    expect(r.curbs.map((c) => [c.quantity, c.widthIn, c.lengthIn, c.curbType])).toEqual([
      [3, 48, 96, "Closed"],
    ]);
  });

  it("the parapet follows the grown area; re-made edge lines keep the wall's edits", () => {
    // FIXED (#11): dragging the area takes its "Edge from this area" lines along (the editor's
    // commit), so Parapet 1 is re-measured at 240 ft with its hand-set options.
    const followed = apply(drawTakeoff({ grow: true }));
    expect(
      followed.parapets.map((p) => [p.name, p.lengthFt, p.termOptionId, p.attachment]),
    ).toEqual([
      ["Parapet 1", 240, 2, "adhered"],
      ["Hand wall", 12, undefined, undefined],
    ]);
    // Re-made (old lines deleted first — new object ids): FIXED (#7) matched by the area sides
    // the wall runs along, the wall's hand-set options kept.
    const fresh = apply(drawTakeoff({ grow: true, regenerateEdges: true }));
    expect(fresh.parapets.map((p) => [p.name, p.lengthFt, p.termOptionId, p.attachment])).toEqual([
      ["Parapet 1", 240, 2, "adhered"],
      ["Hand wall", 12, undefined, undefined],
    ]);
  });

  it("drains: the takeoff row is updated in place (hand edits kept), the hand-added row kept", () => {
    const r = apply(drawTakeoff({ grow: true }));
    // FIXED (#8): the quantity is updated on the matched row; adjustPct 15 and "reuse rings"
    // set on the bid stay.
    expect(r.drains.map((d) => [d.id, d.quantity, d.adjustPct, d.reuseRings])).toEqual([
      ["takeoff-drain-1", 5, 15, true],
      ["manual-drain", 1, 0, false],
    ]);
  });

  it("the change list", () => {
    const r = apply(drawTakeoff({ grow: true }));
    // FIXED (#9): only what changed, with old → new (Sections 2 and 3 and Curb 1 did not).
    expect(r.changes).toEqual([
      "Section 1: 5,920 → 7,120 sq ft; perimeter 320 → 360 ft.",
      "Parapet 1: 220 → 240 ft.",
      "Drains: 4 → 5.",
    ]);
    // Bid-level edits are outside what the update touches.
    expect(edited.markup).toBe(28);
  });

  it("the setup notes are carried once, not duplicated on re-apply", () => {
    // FIXED (#10).
    expect(edited.customer.notes).toBe("Takeoff notes: Re-roof over existing BUR.");
    const r = apply(drawTakeoff({ grow: true }));
    expect(r.notes).toBe("Takeoff notes: Re-roof over existing BUR.");
    const again = apply(drawTakeoff({ grow: true }), {
      ...edited,
      customer: { ...edited.customer, notes: `Call before 8am.\n${r.notes}` },
    });
    expect(again.notes).toBe("Call before 8am.\nTakeoff notes: Re-roof over existing BUR.");
  });

  it("re-made edge lines in the other order (new first, old deleted after) keep the wall", () => {
    // Make the new lines while the old ones still exist → "Parapet 2"; then delete the old.
    const objs = drawTakeoff({ grow: true });
    const s1 = objs.find((o) => o.kind === "area" && o.attrs.name === "Section 1")!;
    let next = objs;
    for (const run of perimeterRunsByRole(SECTION1_GROWN, [
      "gutter",
      "parapet",
      "parapet",
      "parapet",
    ]))
      next = [
        ...next,
        buildObject("linear", `n-${run.role}`, 0, run.points, next, setup, page.scale, {
          linear: run.role,
          fromArea: s1.id,
        }),
      ];
    next = next.filter(
      (o) => !(o.kind === "linear" && ["Parapet 1", "Gutter 1"].includes(o.attrs.name)),
    );
    const r = apply(next);
    // FIXED (#7): the new line runs along the same sides of the same area, so it is the same
    // wall: it keeps the hand-set termination and takes the drawing's new name.
    expect(r.parapets.map((p) => [p.name, p.lengthFt, p.termOptionId])).toEqual([
      ["Parapet 2", 240, 2],
      ["Hand wall", 12, undefined],
    ]);
    expect(r.changes).toContain('Parapet 1: renamed "Parapet 2"; 220 → 240 ft.');
  });

  it("side tags (the editor's edge table) change nothing: tagged and untagged seed and apply alike", () => {
    // The editor tags each side with the parapet / gutter line along it (side-tags.ts) on every
    // edit; the seed reads the tag first and the geometry otherwise — the bid is the same.
    for (const opts of [{}, { grow: true }, { grow: true, regenerateEdges: true }]) {
      const untagged = drawTakeoff(opts);
      const tagged = syncSideTags(untagged);
      expect(tagged).not.toBe(untagged);
      const s1 = tagged.find((o) => o.kind === "area" && o.attrs.name === "Section 1")!;
      expect(s1.kind === "area" && s1.attrs.edges!.map((e) => e.alongRole ?? null)).toEqual([
        "gutter",
        "parapet",
        "parapet",
        "parapet",
      ]);
      const qTagged = takeoffQuantities([page], tagged);
      expect(qTagged).toEqual(takeoffQuantities([page], untagged));
      expect(bidSeedFromTakeoff(setup, qTagged, { accountId: ACCOUNT })).toEqual(
        bidSeedFromTakeoff(setup, takeoffQuantities([page], untagged), { accountId: ACCOUNT }),
      );
      expect(apply(tagged)).toEqual(apply(untagged));
    }
    const s1q = takeoffQuantities([page], syncSideTags(objects)).sections[0]!;
    expect(sectionSideRolesText(s1q)).toBe("parapet sides: B, C, D (220 ft) · gutter: A (100 ft)");
  });
});

describe("5. Names", () => {
  it("sections keep the takeoff's names; an older 'Roof 1' passes through and is not reused", () => {
    expect(newBidFromSeed(blankSaved(), seed).sections.map((s) => s.name)).toEqual([
      "Section 1",
      "Section 2",
      "Section 3",
    ]);
    const legacy: TakeoffObject[] = objects.map((o) =>
      o.kind === "area" && o.attrs.name === "Section 1"
        ? { ...o, attrs: { ...o.attrs, name: "Roof 1" } }
        : o,
    );
    // A new area drawn next to a "Roof 1" does not take number 1 again.
    expect(
      uniqueName(
        "Section",
        legacy.filter((o) => o.kind === "area" && o.attrs.name === "Roof 1"),
      ),
    ).toBe("Section 2");
    const s = bidSeedFromTakeoff(setup, takeoffQuantities([page], legacy));
    expect(s.sections.map((x) => x.name)).toEqual(["Roof 1", "Section 2", "Section 3"]);
  });

  it("renaming an area in the takeoff keeps the bid section (and its edits)", () => {
    const first = newBidFromSeed(blankSaved(), seed);
    const edited = first.sections.map((x) =>
      x.name === "Section 1" ? { ...x, deckType: "Concrete" } : x,
    );
    const renamed: TakeoffObject[] = objects.map((o) =>
      o.kind === "area" && o.attrs.name === "Section 1"
        ? { ...o, attrs: { ...o.attrs, name: "Main roof" } }
        : o,
    );
    const r = applyTakeoffToBid(
      { sections: edited },
      bidSeedFromTakeoff(setup, takeoffQuantities([page], renamed)),
      { newSection, newParapet, newCurb },
    );
    // FIXED (#7): matched by the takeoff object id stored on the section, so a rename keeps the
    // section with its hand edits and takes the new name.
    expect(r.changes[0]).toBe('Section 1: renamed "Main roof".');
    expect(r.changes.some((c) => c.startsWith("Removed section"))).toBe(false);
    expect(r.sections.find((x) => x.name === "Main roof")!.deckType).toBe("Concrete");
    expect(r.sections).toHaveLength(3);
  });
});

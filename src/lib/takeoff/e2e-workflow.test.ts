/**
 * Takeoff → Bid, end to end, on the REAL code (no browser): draw a realistic takeoff the way the
 * editor does (`buildObject`, "Edge from this area" via `perimeterRunsByRole`, a count session =
 * one object with one point per click), measure it (`takeoffQuantities`), seed a bid
 * (`bidSeedFromTakeoff`), build the bid state exactly as the estimate route's `?takeoff=` handler
 * does, run the estimating engine (`buildBidInput` → `buildEstimateInputs` → `computeEstimate` →
 * `buildReviewLedger`), then change the drawing and re-apply it (`applyTakeoffToBid`).
 *
 * The assertions pin what the code does TODAY. Lines marked "ESTIMATOR:" are places where the
 * result differs from what an estimator would expect; they document the gap rather than hide it,
 * so a future fix shows up here as a (welcome) failing assertion to update.
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
import {
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
  complexity: 3,
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
    // Drag Section 1's east corners out to 120 ft (the vertex drag changes only the area).
    objs = objs.map((o) => (o.id === s1.id ? { ...o, points: SECTION1_GROWN } : o));
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

/** src/routes/estimate.tsx:1233-1257 — the NEW-bid branch of the `?takeoff=` handler. */
function newBidFromSeed(saved: SavedBidState, seed: ReturnType<typeof bidSeedFromTakeoff>) {
  const secDefaults = { ...saved.sectionDefaults!, ...seed.sectionDefaults };
  const merged: SavedBidState = {
    ...saved,
    ...(seed.roofSystem ? { roofSystem: seed.roofSystem } : {}),
    ...(seed.attachment ? { attachment: seed.attachment as SavedBidState["attachment"] } : {}),
    ...(seed.membraneAdhesiveName ? { membraneAdhesiveName: seed.membraneAdhesiveName } : {}),
    sections: seed.sections.map((o) => newSection({ ...secDefaults, ...o })),
    parapets: seed.parapets.map((o) => newParapet(o)),
    curbs: seed.curbs.map((o) => newCurb(o)),
    accessoriesCalc: { ...saved.accessoriesCalc, pipeStacks: seed.pipeStacks, drains: seed.drains },
    sectionDefaults: secDefaults,
    parapetDefaults: { ...saved.parapetDefaults, ...seed.parapetDefaults },
  };
  // hydrateSaved (estimate.tsx:981) normalizes each section's layers.
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
    expect(s2.perimeterFt).toBe(140); // plan perimeter (rakes not sloped — see check 2)
    // Section 3: L-shape, 6 sides.
    const s3 = byName("Section 3");
    expect(s3.areaSqFt).toBe(1400);
    expect(s3.perimeterFt).toBe(180);
    expect(s3.edgeLengthsFt).toEqual([50, 20, 30, 20, 20, 40]);
    expect(q.totals.roofAreaSqFt).toBeCloseTo(8584.91, 2);
    expect(q.totals.planAreaSqFt).toBe(8520);
    expect(q.totals.perimeterFt).toBe(640);
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
    // ESTIMATOR: the penthouse cut-out has 36 ft of wall around it; it is subtracted from the
    // area but its perimeter is not reported anywhere (no parapet / curb / linear for it).
    expect(q.linears.some((l) => l.lengthFt === 36)).toBe(false);
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
    expect(sec("Section 1").length).toBeCloseTo(101.909, 3);
    expect(sec("Section 1").width).toBeCloseTo(58.091, 3);
    expect(sec("Section 1").length * sec("Section 1").width).toBeCloseTo(5920, 6);
    expect(sec("Section 1").edges!.map((e) => [e.side, e.lengthFt])).toEqual([
      ["A", 100],
      ["B", 60],
      ["C", 100],
      ["D", 60],
    ]);
    // Section 2: the slope stretches the width: 40 × 31.62 = 1264.9 (plan 1200).
    expect(sec("Section 2").length).toBe(40);
    expect(sec("Section 2").width).toBeCloseTo(31.623, 3);
    expect(sec("Section 2").notes).toBe(
      "Measured in Takeoff: 1264.9 sq ft (1200 sq ft on plan at 4:12, ×1.054), 140 ft around, 4 sides.",
    );
    // ESTIMATOR: the rake edges of a pitched roof run up the slope (31.62 ft), but the bid's
    // edges, perimeter and blocking keep the plan length (30 ft) — edge metal short by 5.4%.
    expect(sec("Section 2").edges!.map((e) => e.lengthFt)).toEqual([40, 30, 40, 30]);
    expect(sec("Section 2").edges![1]!.blockingFt).toBe(30);
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

  it("linear roles do NOT reach the section edges: every side gets the setup edge default", () => {
    // ESTIMATOR: Section 1's sides B, C, D are parapet walls and side A carries a gutter, yet
    // all four keep the setup's '4" Fascia' termination, perimeter flag and wood blocking.
    const s1 = sec("Section 1");
    expect(s1.edges!.map((e) => [e.side, e.termination, e.isPerimeter, e.blockingFt])).toEqual([
      ["A", '4" Fascia', true, 100],
      ["B", '4" Fascia', true, 60],
      ["C", '4" Fascia', true, 100],
      ["D", '4" Fascia', true, 60],
    ]);
    // So the bid orders fascia and blocking along the parapet walls too: 640 ft of fascia for a
    // building with 220 ft of parapet and 100 ft of gutter edge on Section 1.
    const edgeSum = summarizeEdges(bid.sections.map((s) => s.edges ?? []));
    expect(edgeSum.terminations).toEqual([{ termination: '4" Fascia', totalFt: 640 }]);
    expect(edgeSum.blockingFt).toBe(640);
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
    // ESTIMATOR: … but the seeded wall itself did not: "Add parapet" on the Parapets screen
    // (estimate.tsx:4379) copies roofSystem / attachment / adhesive from parapetDefaults, the
    // seed path (estimate.tsx:1247) does not, so this wall prices as the bid's MECHANICAL system
    // while the Setup says parapets are ADHERED.
    expect(p.attachment).toBeUndefined();
    expect(p.roofSystem).toBeUndefined();
    expect(p.membraneAdhesiveName).toBeUndefined();
  });

  it("curbs: one curb row of 3, with the 1 in × 1 in factory footprint", () => {
    expect(
      bid.curbs!.map((c) => [c.name, c.quantity, c.widthIn, c.lengthIn, c.deckType, c.curbType]),
    ).toEqual([["Curb 1", 3, 1, 1, "Steel", "Open"]]);
    // ESTIMATOR: a curb counted without a size (the count tool asks for none) lands as a
    // 1" × 1" curb — 0.33 lineal ft each — and prices as such, with no warning.
    expect(curbLinealFt(bid.curbs![0]!)).toBeCloseTo(0.33, 2);
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
      },
    ]);
    // ESTIMATOR: pipes are drawn without a size (the count tool never asks), so none reach
    // Accessories › Pipe Stacks.
    expect(bid.accessoriesCalc!.pipeStacks).toEqual([]);
    expect(seed.unmapped).toEqual([
      {
        label: "6 × Pipe 1",
        detail: "Pipe stack — add on Accessories › Pipe Stacks (no size was given).",
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
    ]);
  });

  it("the summary, the customer link, the setup notes", () => {
    // ESTIMATOR: the summary lists counts by their default object NAME ("4 Drain 1").
    expect(seed.summary).toBe(
      'From takeoff "Maple St. warehouse": 3 sections, 8584.9 sq ft, 640 ft of roof edge; 220 ft of parapet; 4 Drain 1, 3 Curb 1, 6 Pipe 1, 2 Vent 1, 2 Scupper 1, 1 Item 1.',
    );
    expect(seed.accountId).toBe(ACCOUNT);
    expect(bidAccountFromTakeoff(null, ACCOUNT)).toBe(ACCOUNT);
    // ESTIMATOR: the setup's free-text notes are not carried to the bid (seed, summary, notes).
    expect(JSON.stringify(seed)).not.toContain("existing BUR");
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
    expect(est.roofSqFootage).toBeCloseTo(q.totals.roofAreaSqFt, 6);
    expect(sum(bidInput.sections.flatMap((s) => (s.edges ?? []).map((e) => e.lengthFt)))).toBe(
      q.totals.perimeterFt,
    );
    // Perimeter-enhancement zone length = sides less one 3 ft enhancement width per marked corner
    // on each side: 640 − 2 × 3 × (4 + 4 + 5) = 562.
    expect(sum(bidInput.sections.map((s) => resolveSectionZones(s).perimLengthFt))).toBe(562);
    expect(sum(bidInput.parapets.map((p) => p.lengthFt))).toBe(q.totals.parapetFt);
  });

  it("the Review ledger carries every takeoff item it was given", () => {
    const row = (label: string) => ledger.purchases.duroLast.find((r) => r.label === label)!.cost;
    expect(row("Roof Sections")).toBeGreaterThan(0);
    expect(row("Parapets")).toBeGreaterThan(0);
    expect(row("Curbs")).toBeGreaterThanOrEqual(0);
    expect(est.curbLaborHours).toBeGreaterThan(0);
    expect(row("Roof Sections")).toBeCloseTo(13171.66, 2);
    expect(row("Parapets")).toBe(888);
    // Drains sit in accessoriesCalc; they are priced only when the admin data carries the §12
    // accessories reference lists, which this fixture does not.
    expect(row("Accessories")).toBe(0);
    expect(est.money.grandTotal).toBeCloseTo(25827.95, 2);
  });

  it("the 1 in × 1 in seeded curbs price as almost nothing", () => {
    // ESTIMATOR: 3 unsized curbs = 0.525 h in all; the same 3 curbs at a typical 48 × 96 in
    // RTU footprint are 9.4 h. Nothing warns that the curb has no size.
    expect(est.curbLaborHours).toBeCloseTo(0.525, 6);
    const sized = buildEstimateInputs(
      { ...bidInput, curbs: bidInput.curbs.map((c) => ({ ...c, widthIn: 48, lengthIn: 96 })) },
      admin,
    );
    expect(computeEstimate(sized.inputs).curbLaborHours).toBeCloseTo(9.4, 6);
    expect(build.warnings).toEqual([]);
  });

  it("a seeded wall and the same wall added by hand price differently", () => {
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
    // ESTIMATOR: same 220 ft wall, same labor, but the seeded wall is billed as the bid's
    // mechanical system — no wall adhesive ($0 vs $240) and $369.24 less on the bid total.
    expect([seeded.attachment, byHand.attachment]).toEqual(["mechanical", "adhered"]);
    expect(seeded.hours).toBeCloseTo(byHand.hours!, 6);
    expect([seeded.adhesiveMaterial, byHand.adhesiveMaterial]).toEqual([0, 240]);
    expect(byHand.grandTotal - seeded.grandTotal).toBeCloseTo(369.24, 2);
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
            // The estimator fixed the parapet sides on the Sections screen.
            edges: s.edges!.map((e) =>
              e.side === "A" ? e : { ...e, termination: "No Termination", blockingFt: 0 },
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
  const apply = (objs: TakeoffObject[]) => {
    const s2 = bidSeedFromTakeoff(setup, takeoffQuantities([page], objs), { accountId: ACCOUNT });
    // estimate.tsx:1195 — the update branch.
    return applyTakeoffToBid(
      {
        sections: edited.sections,
        parapets: edited.parapets,
        curbs: edited.curbs,
        pipeStacks: edited.accessoriesCalc!.pipeStacks,
        drains: edited.accessoriesCalc!.drains,
      },
      s2,
      { newSection, newParapet, newCurb },
    );
  };

  it("re-measures Section 1 and keeps the estimator's material edits", () => {
    const r = apply(drawTakeoff({ grow: true }));
    const s1 = r.sections.find((s) => s.name === "Section 1")!;
    expect(s1.measured!.areaSqFt).toBe(7120); // 120 × 60 − 80
    expect(s1.length * s1.width).toBeCloseTo(7120, 6);
    expect(s1.deckType).toBe("Concrete");
    expect(s1.fastenerOc).toBe(12);
    // ESTIMATOR: the hand-fixed parapet sides are reset to the takeoff's fascia + blocking …
    expect(s1.edges!.map((e) => e.termination)).toEqual(Array(4).fill('4" Fascia'));
    // … and the section notes are replaced by the takeoff's measurement line.
    expect(s1.notes).toBe("Measured in Takeoff: 7120 sq ft, 360 ft around, 4 sides.");
    // Curbs keep the hand-set size and style (the takeoff has none), take the count.
    expect(r.curbs.map((c) => [c.quantity, c.widthIn, c.lengthIn, c.curbType])).toEqual([
      [3, 48, 96, "Closed"],
    ]);
  });

  it("the parapet does not follow the grown area unless its edge lines are re-made", () => {
    // ESTIMATOR: "Edge from this area" lines are independent once made — dragging the area
    // leaves Parapet 1 at 220 ft while the wall is now 240 ft.
    const stale = apply(drawTakeoff({ grow: true }));
    expect(stale.parapets.map((p) => [p.name, p.lengthFt])).toEqual([
      ["Parapet 1", 220],
      ["Hand wall", 12],
    ]);
    // Re-made (old lines deleted first, so the names come back as "Parapet 1" / "Gutter 1"):
    // re-measured by name, the wall's hand-set options kept.
    const fresh = apply(drawTakeoff({ grow: true, regenerateEdges: true }));
    expect(fresh.parapets.map((p) => [p.name, p.lengthFt, p.termOptionId, p.attachment])).toEqual([
      ["Parapet 1", 240, 2, "adhered"],
      ["Hand wall", 12, undefined, undefined],
    ]);
  });

  it("drains: the takeoff row is replaced (hand edits on it lost), the hand-added row kept", () => {
    const r = apply(drawTakeoff({ grow: true }));
    expect(r.drains.map((d) => [d.id, d.quantity, d.adjustPct, d.reuseRings])).toEqual([
      ["manual-drain", 1, 0, false],
      // ESTIMATOR: adjustPct 15 and "reuse rings" set on the bid are gone.
      ["takeoff-drain-1", 5, 0, false],
    ]);
  });

  it("the change list", () => {
    const r = apply(drawTakeoff({ grow: true }));
    // ESTIMATOR: every matched item is listed as re-measured whether or not it changed
    // (Sections 2 and 3, Parapet 1, Curb 1 did not), and the one real count change (4 → 5
    // drains) reads only as "1 row(s)".
    expect(r.changes).toEqual([
      'Re-measured section "Section 1".',
      'Re-measured section "Section 2".',
      'Re-measured section "Section 3".',
      'Re-measured parapet "Parapet 1".',
      'Re-counted curb "Curb 1".',
      "Drains from the drawing: 1 row(s).",
    ]);
    // Bid-level edits are outside what the update touches.
    expect(edited.markup).toBe(28);
  });

  it("re-made edge lines in the other order (new first, old deleted after) orphan the wall", () => {
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
    // ESTIMATOR: the wall with the hand-set termination / attachment is removed and a bare
    // "Parapet 2" is added in its place.
    expect(r.parapets.map((p) => [p.name, p.lengthFt, p.termOptionId])).toEqual([
      ["Hand wall", 12, undefined],
      ["Parapet 2", 240, undefined],
    ]);
    expect(r.changes).toContain('Removed parapet "Parapet 1" (no longer in the drawing).');
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

  it("renaming an area in the takeoff replaces the bid section (and its edits)", () => {
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
    // ESTIMATOR: matching is by name only (not by the takeoff object id), so a rename drops the
    // section with its hand edits and adds a fresh one.
    expect(r.changes[0]).toBe('Removed section "Section 1" (no longer in the drawing).');
    expect(r.sections.find((x) => x.name === "Main roof")!.deckType).toBe("Steel");
  });
});
